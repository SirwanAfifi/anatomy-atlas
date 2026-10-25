"""Export the pinned Z-Anatomy source as a compact, selectable muscle atlas.

Run through convert-anatomy.mjs. Embedded source scripts must remain disabled.
This script changes only the in-memory scene; it never saves the upstream blend.
"""
import argparse
import hashlib
import json
import math
import os
import re
import sys
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
output = Path(args.output).resolve()
output.mkdir(parents=True, exist_ok=True)
source_revision = '6271cab1422c5b7baf7ee2a16ac21695da1bb295'

# Explicit allowlist: no collection-wide export of organ/vascular/nerve models.
# All names below are the full structures, not the source's insertion markers.
GROUPS = {
    'chest': ['Clavicular head of pectoralis major muscle', 'Sternocostal head of pectoralis major muscle', '(Abdominal part of pectoralis major muscle)'],
    'front-shoulders': ['Clavicular part of deltoid muscle', 'Acromial part of deltoid muscle'],
    'rear-shoulders': ['Scapular spinal part of deltoid muscle', 'Infraspinatus muscle', 'Teres major muscle', 'Teres minor muscle', 'Supraspinatus muscle'],
    'biceps': ['Long head of biceps brachii', 'Short head of biceps brachii', 'Brachialis muscle'],
    'triceps': ['Long head of triceps brachii', 'Lateral head of triceps brachii', 'Medial head of triceps brachii'],
    'forearms': ['Brachioradialis muscle', 'Extensor carpi radialis longus', 'Extensor carpi radialis brevis', 'Extensor digitorum', 'Extensor digiti minimi', 'Humeral head of extensor carpi ulnaris', 'Ulnar head of extensor carpi ulnaris', 'Humeral head of flexor carpi ulnaris', 'Ulnar head of flexor carpi ulnaris', 'Flexor carpi radialis', 'Palmaris longus muscle', 'Superficial head of pronator teres', 'Humero-ulnar head of flexor digitorum superficialis', 'Radial head of flexor digitorum superficialis', 'Abductor pollicis longus', 'Extensor pollicis brevis', 'Extensor pollicis longus'],
    'abdominals': ['Rectus abdominis muscle'],
    'obliques': ['External abdominal oblique muscle'],
    # The pinned source swaps these two names. Their actual placement is decisive:
    # "Ascending" spans z=1.415..1.575 (neck), "Descending" z=1.120..1.414.
    'traps': ['Ascending part of trapezius muscle'],
    'traps-middle': ['Transverse part of trapezius muscle', 'Descending part of trapezius muscle'],
    'lats': ['Latissimus dorsi muscle'],
    'lowerback': ['Iliocostalis lumborum muscle', 'Iliocostalis thoracis muscle', 'Longissimus thoracis muscle', 'Spinalis thoracis muscle'],
    'glutes': ['Gluteus maximus muscle', 'Gluteus medius muscle', 'Tensor fasciae latae'],
    'quads': ['Rectus femoris muscle', 'Vastus lateralis muscle', 'Vastus medialis muscle', 'Vastus intermedius muscle'],
    'adductors': ['Adductor longus', 'Adductor magnus', 'Gracilis muscle', 'Pectineus muscle'],
    'hamstrings': ['Long head of biceps femoris', 'Short head of biceps femoris', 'Semitendinosus muscle', 'Semimembranosus muscle'],
    'tibialis': ['Tibialis anterior muscle'],
    'calves': ['Lateral head of gastrocnemius', 'Medial head of gastrocnemius', 'Soleus muscle', 'Calcaneal tendon'],
}
CONTEXT = [
    'Sternocleidomastoid muscle', 'Scalenus anterior muscle', 'Scalenus medius muscle',
    'Scalenus posterior muscle', 'Splenius capitis muscle', 'Splenius colli muscle',
    'Levator scapulae', 'Sternohyoid muscle', 'Sternothyroid muscle', 'Omohyoid muscle',
    'Serratus anterior muscle', 'External intercostal muscles', 'Linea alba',
    'Sartorius muscle', 'Fibularis longus muscle', 'Fibularis brevis muscle',
    'Extensor digitorum longus', 'Extensor hallucis longus', 'Iliotibial tract',
    'Inguinal ligament', 'Lateral patellar retinaculum', 'Medial patellar retinaculum',
]
LABELS = {
    'Ascending part of trapezius muscle': 'Upper trapezius · descending fibres',
    'Descending part of trapezius muscle': 'Lower trapezius · ascending fibres',
    'Transverse part of trapezius muscle': 'Middle trapezius · transverse fibres',
    'Clavicular part of deltoid muscle': 'Anterior deltoid',
    'Acromial part of deltoid muscle': 'Lateral deltoid',
    'Scapular spinal part of deltoid muscle': 'Posterior deltoid',
    'Calcaneal tendon': 'Achilles tendon',
}
BACK_GROUPS = {'rear-shoulders', 'triceps', 'traps', 'traps-middle', 'lats', 'lowerback', 'glutes', 'hamstrings', 'calves'}

def slug(value):
    return re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')

def source_pair(base):
    pair = [bpy.data.objects.get(base + suffix) for suffix in ('.l', '.r')]
    if all(pair):
        return pair
    solo = bpy.data.objects.get(base)
    if solo:
        return [solo]
    raise RuntimeError('Required source structure missing: ' + base)

regions_sources = []
for group, bases in GROUPS.items():
    for base in bases:
        for obj in source_pair(base):
            regions_sources.append((group, base, obj))
context_sources = {obj for base in CONTEXT for obj in source_pair(base)}

# Only primary bone/cartilage meshes; annotation/insertion objects have distinct
# materials and are not selected. Internal ear structures are intentionally absent.
for collection_name in ['Axial skeleton', 'Appendicular skeleton']:
    for obj in bpy.data.collections[collection_name].objects:
        names = [slot.material.name if slot.material else '' for slot in obj.material_slots]
        if obj.type != 'MESH' or not len(obj.data.polygons):
            continue
        if re.search(r'\.(?:i|j|o[lr]|e[lr])$', obj.name):
            continue
        if any(term in obj.name.lower() for term in ['malleus', 'incus', 'stapes', 'sinus', 'arytenoid', 'cricoid', 'corniculate']):
            continue
        if names and all(name.startswith(('Bone', 'Cartilage', 'Teeth', 'Dentine')) for name in names):
            context_sources.add(obj)

# The supplied surface atlas gives a continuous, restrained head and extremities.
# Combine adjacent regions and weld boundaries before smoothing to avoid seams.
skin_sources = {'head': [], 'hand-left': [], 'hand-right': [], 'foot-left': [], 'foot-right': []}
for obj in bpy.data.objects:
    if obj.type != 'MESH' or not len(obj.data.polygons):
        continue
    if not any(slot.material and slot.material.name.startswith('Skin') for slot in obj.material_slots):
        continue
    names = {c.name for c in obj.users_collection}
    bounds = [obj.matrix_world @ Vector(v) for v in obj.bound_box]
    zmax = max(v.z for v in bounds)
    xmin = min(abs(v.x) for v in bounds)
    side = 'left' if obj.name.endswith('.l') else 'right'
    if 'Head' in names:
        skin_sources['head'].append(obj)
    elif zmax < .875 and xmin > .21:
        skin_sources['hand-' + side].append(obj)
    elif zmax < .125:
        skin_sources['foot-' + side].append(obj)

all_sources = [entry[2] for entry in regions_sources] + list(context_sources) + [o for group in skin_sources.values() for o in group]
all_bounds = [o.matrix_world @ Vector(v) for o in all_sources for v in o.bound_box]
zmin = min(p.z for p in all_bounds)
zmax = max(p.z for p in all_bounds)
scale = 2.0 / (zmax - zmin)
normalization = Matrix.Diagonal((scale, scale, scale, 1.0)) @ Matrix.Translation((0, 0, -zmin))
def to_gltf(v):
    return [round(v.x, 6), round(v.z, 6), round(-v.y, 6)]

scene = bpy.data.scenes.new('Anatomy Atlas Export')
bpy.context.window.scene = scene
scene.render.engine = 'CYCLES'
scene.unit_settings.system = 'METRIC'

# Higher-resolution, multi-scale fibre detail. Coherent fine strands carry the
# close-up surface; broad modulation stays restrained so it does not resemble
# corrugated plastic. These are authored cues, not scanned fascicle measurements.
size = 2048
u, v = np.meshgrid(np.arange(size, dtype=np.float32) / size, np.arange(size, dtype=np.float32) / size)
flow = .14 * np.sin(2 * np.pi * 2 * v) + .045 * np.sin(2 * np.pi * 5 * v)
phase = 2 * np.pi * (76 * u + flow)
fine_phase = 2 * np.pi * (211 * u + .33 * np.sin(2 * np.pi * 3 * v))
dx = .095 * np.cos(phase) + .038 * np.cos(phase * 2 + .2) + .027 * np.cos(fine_phase)
dy = .005 * np.sin(2 * np.pi * 3 * v)
length = np.sqrt(dx * dx + dy * dy + 1)
pixels = np.ones((size, size, 4), dtype=np.float32)
pixels[:, :, 0] = .5 - dx / length * .5
pixels[:, :, 1] = .5 - dy / length * .5
pixels[:, :, 2] = .5 + 1 / length * .5
normal_image = bpy.data.images.new('Atlas fine directional fibres 2K', width=size, height=size, alpha=False)
normal_image.colorspace_settings.name = 'Non-Color'
normal_image.pixels.foreach_set(pixels.ravel())
normal_image.pack()

# glTF stores roughness in the green channel. The Blender exporter handles
# packing this data while preserving the per-material base roughness value.
roughness_pixels = np.ones((size, size, 4), dtype=np.float32)
roughness_value = .55 + .028 * np.sin(phase) + .012 * np.sin(fine_phase)
roughness_pixels[:, :, :3] = roughness_value[:, :, None]
roughness_image = bpy.data.images.new('Atlas fibre roughness 2K', width=size, height=size, alpha=False)
roughness_image.colorspace_settings.name = 'Non-Color'
roughness_image.pixels.foreach_set(roughness_pixels.ravel())
roughness_image.pack()

def linear_hex(value):
    values = [int(value[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in values) + (1,)

def material(name, color, roughness, fibres=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = linear_hex(color)
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = mat.diffuse_color
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = 0
    bsdf.inputs['Specular IOR Level'].default_value = .3
    if fibres:
        texture = mat.node_tree.nodes.new('ShaderNodeTexImage')
        texture.image = normal_image
        texture.interpolation = 'Linear'
        normal = mat.node_tree.nodes.new('ShaderNodeNormalMap')
        normal.inputs['Strength'].default_value = .6
        mat.node_tree.links.new(texture.outputs['Color'], normal.inputs['Color'])
        mat.node_tree.links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
        roughness_texture = mat.node_tree.nodes.new('ShaderNodeTexImage')
        roughness_texture.image = roughness_image
        roughness_texture.interpolation = 'Linear'
        mat.node_tree.links.new(roughness_texture.outputs['Color'], bsdf.inputs['Roughness'])
    mat.use_backface_culling = True
    return mat

muscle_materials = [material('Atlas muscle ' + str(i + 1), color, .57, True) for i, color in enumerate(['b66c61', 'b97064', 'b2685e', 'b96e62'])]
tendon_mat = material('Atlas tendon and aponeurosis', 'e7ddc8', .64)
bone_mat = material('Atlas supporting bone', 'd5c6a9', .70)
cartilage_mat = material('Atlas cartilage', 'd7d6c8', .67)
skin_mat = material('Atlas neutral surface', 'd7c4aa', .68)

def replace_material(original_name, tone=0):
    if original_name.startswith(('Bone', 'Teeth', 'Dentine')):
        return bone_mat
    if original_name.startswith('Cartilage'):
        return cartilage_mat
    if original_name in ['Tendon', 'Fascia', 'Ligament']:
        return tendon_mat
    return muscle_materials[tone % len(muscle_materials)]

def assign_fibre_uv(mesh):
    coords = np.array([v.co[:] for v in mesh.vertices], dtype=np.float64)
    centered = coords - coords.mean(axis=0)
    _, axes = np.linalg.eigh(centered.T @ centered)
    long_axis = axes[:, 2]
    # Stable direction prevents otherwise equivalent left/right PCA signs flipping.
    if long_axis[2] < 0:
        long_axis *= -1
    tangent = axes[:, 1]
    bitangent = np.cross(long_axis, tangent)
    projection = centered @ long_axis
    angles = np.arctan2(centered @ bitangent, centered @ tangent) / (2 * np.pi) + .5
    along = (projection - projection.min()) / max(float(np.ptp(projection)), 1e-8)
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    uv = mesh.uv_layers.new(name='AtlasFibres')
    for poly in mesh.polygons:
        vals = [float(angles[mesh.loops[i].vertex_index]) for i in poly.loop_indices]
        crosses = max(vals) - min(vals) > .5
        for index, loop_index in enumerate(poly.loop_indices):
            vertex_index = mesh.loops[loop_index].vertex_index
            x = vals[index] + (1 if crosses and vals[index] < .5 else 0)
            uv.data[loop_index].uv = (x, float(along[vertex_index]))

REFINE_SURFACES = (
    'Clavicular head of pectoralis major muscle',
    'Sternocostal head of pectoralis major muscle',
    '(Abdominal part of pectoralis major muscle)',
    'Clavicular part of deltoid muscle', 'Acromial part of deltoid muscle',
    'Scapular spinal part of deltoid muscle',
    'Gluteus maximus muscle', 'Gluteus medius muscle',
    'Ascending part of trapezius muscle', 'Transverse part of trapezius muscle',
    'Descending part of trapezius muscle',
)
surface_refinement = {'smoothedMeshes': 0, 'subdividedMeshes': 0, 'maxDisplacement': 0.0, 'refinedBoundaryVertices': 0, 'maxBoundaryDisplacement': 0.0}

def refine_muscle_surface(mesh):
    """Suppress small reconstruction ridges without shrinking the muscle belly.

    Alternating Taubin passes have a near-zero shrinkage response. Tendon faces,
    open boundaries and attachment tips stay fixed in that pass. A second small
    curve pass softens stair-stepped material junctions without relabelling faces.
    No topology or material assignment changes.
    """
    positions = np.array([vertex.co[:] for vertex in mesh.vertices], dtype=np.float64)
    original = positions.copy()
    edges = np.array([edge.vertices[:] for edge in mesh.edges], dtype=np.int64)
    if not len(edges):
        return
    editable = np.ones(len(positions), dtype=bool)
    edge_uses = np.zeros(len(edges), dtype=np.int32)
    edge_classes = np.zeros(len(edges), dtype=np.uint8)
    edge_ids = {tuple(sorted(edge)): index for index, edge in enumerate(edges)}
    for polygon in mesh.polygons:
        muscle_face = mesh.materials[polygon.material_index] in muscle_materials
        if not muscle_face:
            editable[list(polygon.vertices)] = False
        for edge in polygon.edge_keys:
            edge_id = edge_ids[tuple(sorted(edge))]
            edge_uses[edge_id] += 1
            edge_classes[edge_id] |= 1 if muscle_face else 2
    editable[edges[edge_uses < 2].ravel()] = False
    centered = original - original.mean(axis=0)
    _, axes = np.linalg.eigh(centered.T @ centered)
    axial = centered @ axes[:, 2]
    tip_margin = max(float(np.ptp(axial)) * .015, .0005)
    attachment_tips = (axial < axial.min() + tip_margin) | (axial > axial.max() - tip_margin)
    editable[attachment_tips] = False
    neighbors = np.concatenate((edges[:, 0], edges[:, 1]))
    sources = np.concatenate((edges[:, 1], edges[:, 0]))
    degree = np.bincount(neighbors, minlength=len(positions)).clip(1)[:, None]
    for _ in range(12):
        for coefficient in (.48, -.5):
            sums = np.zeros_like(positions)
            np.add.at(sums, neighbors, positions[sources])
            positions[editable] += coefficient * (sums / degree - positions)[editable]
        delta = positions - original
        distance = np.linalg.norm(delta, axis=1)
        limited = distance > .002
        positions[limited] = original[limited] + delta[limited] * (.002 / distance[limited, None])
    boundary_edges = edges[(edge_classes == 3) & (edge_uses == 2)]
    if len(boundary_edges):
        boundary_targets = np.concatenate((boundary_edges[:, 0], boundary_edges[:, 1]))
        boundary_sources = np.concatenate((boundary_edges[:, 1], boundary_edges[:, 0]))
        boundary_degree = np.bincount(boundary_targets, minlength=len(positions))
        # Only regular curve interiors: preserve chain endpoints, junctions,
        # attachment tips and all original material identities.
        boundary_editable = (boundary_degree == 2) & ~attachment_tips
        for _ in range(4):
            sums = np.zeros_like(positions)
            np.add.at(sums, boundary_targets, positions[boundary_sources])
            offset = sums / boundary_degree.clip(1)[:, None] - positions
            positions[boundary_editable] += .45 * offset[boundary_editable]
            delta = positions - original
            distance = np.linalg.norm(delta, axis=1)
            limited = boundary_editable & (distance > .00075)
            positions[limited] = original[limited] + delta[limited] * (.00075 / distance[limited, None])
        boundary_delta = np.linalg.norm(positions[boundary_editable] - original[boundary_editable], axis=1)
        surface_refinement['refinedBoundaryVertices'] += int(boundary_editable.sum())
        if len(boundary_delta):
            surface_refinement['maxBoundaryDisplacement'] = max(surface_refinement['maxBoundaryDisplacement'], float(boundary_delta.max()))
    delta = np.linalg.norm(positions - original, axis=1)
    mesh.vertices.foreach_set('co', positions.astype(np.float32).ravel())
    mesh.update()
    surface_refinement['smoothedMeshes'] += 1
    surface_refinement['maxDisplacement'] = max(surface_refinement['maxDisplacement'], float(delta.max()))

def copy_mesh(source, name, tone=0):
    # The pinned muscle meshes have no source modifiers. Refine their actual
    # surfaces below instead of interpreting voxel-like ridges as fibre detail.
    mesh = source.data.copy()
    mesh.validate(verbose=False)
    mesh.transform(normalization @ source.matrix_world)
    mesh.name = name + '-geometry'
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    old_materials = [m.name if m else '' for m in mesh.materials]
    for i, old_name in enumerate(old_materials):
        mesh.materials[i] = replace_material(old_name, tone)
    if source.name.startswith('Iliotibial tract'):
        for i in range(len(mesh.materials)):
            mesh.materials[i] = tendon_mat
    for poly in mesh.polygons:
        poly.use_smooth = True
    if any(m in muscle_materials for m in mesh.materials):
        refine_muscle_surface(mesh)
        assign_fibre_uv(mesh)
        if any(source.name == base + suffix for base in REFINE_SURFACES for suffix in ('.l', '.r', '')):
            # Reserve new triangles for the broad low-density silhouettes where
            # they improve close-ups. Dense limbs and supporting bones stay intact.
            modifier = obj.modifiers.new('Refined muscle contour', 'SUBSURF')
            modifier.levels = 1
            modifier.render_levels = 1
            modifier.uv_smooth = 'PRESERVE_BOUNDARIES'
            surface_refinement['subdividedMeshes'] += 1
    return obj

regions = []
for index, (group, base, source) in enumerate(regions_sources):
    side = 'left' if source.name.endswith('.l') else 'right' if source.name.endswith('.r') else 'midline'
    label = LABELS.get(base, base.strip('()'))
    region_name = slug(label)
    identity = region_name + '-' + side
    name = 'region-' + identity[:38] + '-' + hashlib.sha1(identity.encode()).hexdigest()[:8]
    obj = copy_mesh(source, name, index // 2)
    obj['regionId'] = identity
    obj['sourceName'] = source.name
    obj['muscle'] = group
    bounds = [v.co for v in obj.data.vertices]
    center = Vector(tuple((min(v[i] for v in bounds) + max(v[i] for v in bounds)) / 2 for i in range(3)))
    direction = [0, .06, -1 if group in BACK_GROUPS else 1]
    if group in {'glutes', 'obliques', 'rear-shoulders', 'front-shoulders', 'forearms'}:
        direction[0] = .42 if side == 'left' else -.42
    regions.append({'id': identity, 'muscle': group, 'region': region_name, 'label': label, 'side': side, 'meshNames': [name], 'focus': {'target': to_gltf(center), 'direction': direction}, 'sourceName': source.name})

for source in sorted(context_sources, key=lambda o: o.name):
    copy_mesh(source, 'context-' + slug(source.name))

for label, sources in skin_sources.items():
    vertices, faces = [], []
    for source in sources:
        offset = len(vertices)
        vertices.extend([normalization @ source.matrix_world @ v.co for v in source.data.vertices])
        faces.extend([tuple(i + offset for i in poly.vertices) for poly in source.data.polygons])
    mesh = bpy.data.meshes.new('surface-' + label)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(skin_mat)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.000015)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new('context-surface-' + label, mesh)
    scene.collection.objects.link(obj)
    for poly in mesh.polygons:
        poly.use_smooth = True
    modifier = obj.modifiers.new('Continuous surface', 'SUBSURF')
    modifier.levels = 2
    modifier.render_levels = 2

# Markers are anatomical centers (not screen-coordinate overlays).
JOINTS = {
    'shoulder': (.18, .035, 1.39),
    'elbow': (.245, .025, 1.105),
    'wrist': (.26, -.02, .85),
    'hip': (.09, .025, .88),
    'knee': (.085, .005, .447),
    'ankle': (.085, .035, .075),
}
joints = []
for name, position in JOINTS.items():
    for side, sign in [('left', 1), ('right', -1)]:
        p = normalization @ Vector((position[0] * sign, position[1], position[2]))
        joints.append({'id': name + '-' + side, 'label': side.title() + ' ' + name, 'position': to_gltf(p)})

bpy.context.view_layer.update()
for obj in scene.objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = next(iter(scene.objects))
raw_path = output / 'male-uncompressed.glb'
bpy.ops.export_scene.gltf(
    filepath=str(raw_path), export_format='GLB', use_selection=True,
    use_active_scene=True, export_yup=True, export_apply=True,
    export_extras=True, export_animations=False, export_cameras=False,
    export_lights=False, export_skins=False, export_morph=False,
    export_materials='EXPORT', export_image_format='AUTO',
    export_copyright='Z-Anatomy / BodyParts3D. Adapted model: CC BY-SA 4.0. See NOTICE.txt.',
)
manifest = {
    'version': 1,
    'model': {'id': 'male', 'label': 'Male anatomical model', 'url': '/assets/anatomy/male.glb'},
    'regions': regions,
    'joints': joints,
    'source': {
        'name': 'Z-Anatomy', 'revision': source_revision,
        'url': 'https://github.com/Z-Anatomy/Models-of-human-anatomy/tree/' + source_revision,
        'archiveSha256': 'e029688545627bd0214b269e1063143abb580aad72b2c2445d6d8a9a0d9da736',
        'license': 'CC BY-SA 4.0', 'notice': '/assets/anatomy/NOTICE.txt',
        'conversion': 'Blender ' + bpy.app.version_string,
        'modifications': ['Selected muscles, tendons, and supporting skeletal surfaces; internal systems excluded.', 'Normalized feet to Y=0 and height to 2; anterior faces +Z.', 'Replaced Blender display shaders with PBR materials, preserving tendon assignments.', 'Authored 2K multiscale directional fibre normal and roughness maps with per-muscle cylindrical UVs.', 'Denoised muscle interiors with bounded nonshrinking smoothing; softened regular muscle/tendon boundary curves by at most 0.75 mm while preserving material identities and attachment tips.', 'Applied one contour-subdivision level to broad low-density pectoral, deltoid, gluteal and trapezius meshes.', 'Joined, welded, and subdivided source head/hand/foot surface regions.', 'Corrected swapped ascending/descending trapezius labels by actual source placement.', 'Meshopt-compressed with 16-bit positions, 14-bit normals and high-precision UVs; no geometry decimation.'],
    },
    'stats': {'regions': len(regions), 'muscleGroups': len(GROUPS), 'joints': len(joints), 'sourceObjects': len(all_sources), 'exportObjects': len(scene.objects), 'height': 2, 'rawBytes': raw_path.stat().st_size, 'surfaceRefinement': surface_refinement, 'textureResolution': size},
}
(output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('ATLAS_EXPORT ' + json.dumps(manifest['stats']))
