import assert from 'node:assert/strict';
import {readFile, readdir, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import {muscleGroups} from '../src/anatomy.js';

const directory = resolve('public/assets/anatomy');
const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
assert.equal(manifest.version, 1, 'Unsupported anatomy manifest version');
assert.equal(manifest.model.id, 'male');
assert.equal(manifest.model.url, '/assets/anatomy/male.glb', 'Model must be self-hosted');
assert.ok(Array.isArray(manifest.regions) && manifest.regions.length > 36, 'Detailed anatomical regions are missing');
assert.ok(manifest.source, 'Source provenance is missing');

const bytes = await readFile(resolve(directory, 'male.glb'));
assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.stats.sha256, 'Model checksum must match its quality/provenance manifest');
assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'Invalid GLB header');
assert.equal(bytes.readUInt32LE(4), 2, 'Expected glTF 2.0');
assert.equal(bytes.readUInt32LE(8), bytes.length, 'Truncated GLB');
assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, 'Missing JSON chunk');
const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
assert.ok((json.extensionsUsed || []).includes('EXT_meshopt_compression'), 'Model must use Meshopt compression');
for (const resource of [...(json.images || []), ...(json.buffers || [])]) {
  assert.ok(!resource.uri || resource.uri.startsWith('data:'), 'GLB must embed its resources');
}

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder});
const document = await io.readBinary(bytes);
const muscleMaterials = document.getRoot().listMaterials().filter(material => /^Atlas muscle /i.test(material.getName()));
assert.ok(muscleMaterials.length > 0, 'Anatomical muscle materials are missing');
for (const material of muscleMaterials) {
  for (const [kind, texture] of [['normal', material.getNormalTexture()], ['roughness', material.getMetallicRoughnessTexture()]]) {
    const size = texture?.getSize();
    assert.ok(size && size[0] >= 2048 && size[1] >= 2048, `${material.getName()} needs a 2K ${kind} map for close-up detail`);
  }
}
const nodes = document.getRoot().listNodes().filter(node => node.getMesh());
const meshNames = new Set(nodes.map(node => node.getName()));
assert.equal(meshNames.size, nodes.length, 'Mesh node names must be unique');
const ids = new Set(), claimedMeshes = new Set(), coverage = new Set();
const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
for (const region of manifest.regions) {
  assert.ok(region.id && !ids.has(region.id), `Duplicate or empty region ID: ${region.id}`);
  ids.add(region.id);
  assert.ok(muscleGroups[region.muscle], `Unknown group for ${region.id}`);
  coverage.add(region.muscle);
  assert.ok(region.region && region.label, `Missing anatomical name for ${region.id}`);
  assert.ok(['left', 'right', 'midline'].includes(region.side), `Invalid side for ${region.id}`);
  assert.ok(Array.isArray(region.meshNames) && region.meshNames.length, `No meshes for ${region.id}`);
  for (const name of region.meshNames) {
    assert.ok(meshNames.has(name), `Missing mesh ${name} for ${region.id}`);
    assert.ok(!claimedMeshes.has(name), `Mesh ${name} belongs to multiple regions`);
    claimedMeshes.add(name);
  }
  assert.ok(vector(region.focus?.target) && vector(region.focus?.direction), `Invalid focus for ${region.id}`);
  assert.ok(Math.hypot(...region.focus.direction) > .5, `Missing focus direction for ${region.id}`);
  if (region.side === 'left') assert.ok(region.focus.target[0] > 0, `Left anatomy must lie on model +X: ${region.id}`);
  if (region.side === 'right') assert.ok(region.focus.target[0] < 0, `Right anatomy must lie on model -X: ${region.id}`);
}
assert.deepEqual([...coverage].sort(), Object.keys(muscleGroups).sort(), 'All 18 muscle groups must be represented');
assert.ok(manifest.regions.some(region => region.side === 'left') && manifest.regions.some(region => region.side === 'right'), 'Bilateral anatomy is missing');
assert.ok(Array.isArray(manifest.joints) && manifest.joints.length >= 10, 'Joint landmarks are missing');
for (const joint of manifest.joints) assert.ok(joint.id && joint.label && vector(joint.position), 'Invalid joint landmark');

const bounds = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
let triangles = 0;
for (const node of nodes) {
  const matrix = node.getWorldMatrix();
  for (const primitive of node.getMesh().listPrimitives()) {
    const positions = primitive.getAttribute('POSITION');
    assert.ok(positions, `Mesh ${node.getName()} has no positions`);
    const normals = primitive.getAttribute('NORMAL');
    assert.ok(normals, `Mesh ${node.getName()} has no shading normals`);
    if (claimedMeshes.has(node.getName())) {
      assert.ok([5122, 5126].includes(normals.getComponentType()), `Muscle ${node.getName()} must retain high-precision shading normals`);
    }
    const vertex = [];
    for (let i = 0; i < positions.getCount(); i++) {
      positions.getElement(i, vertex);
      const [x, y, z] = vertex;
      const point = [matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12], matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13], matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]];
      point.forEach((value, axis) => {assert.ok(Number.isFinite(value), 'Invalid vertex'); bounds.min[axis] = Math.min(bounds.min[axis], value); bounds.max[axis] = Math.max(bounds.max[axis], value);});
    }
    if (primitive.getMode() === 4) triangles += (primitive.getIndices()?.getCount() || positions.getCount()) / 3;
  }
}
const dimensions = bounds.max.map((value, axis) => value - bounds.min[axis]);
assert.ok(dimensions[0] > .3 && dimensions[2] > .1, 'Anatomy must be genuinely three-dimensional');
assert.ok(Math.abs(dimensions[1] - 2) < .05 && Math.abs(bounds.min[1]) < .05, 'Model must be Y-up, height 2, feet at zero');
assert.ok(triangles > 50000, 'Detailed source geometry is missing');
const files = await readdir(directory);
const notices = files.filter(name => /licen[cs]e|attribution|credits/i.test(name));
assert.ok(notices.length >= 1, 'Missing bundled licence/attribution');
const notice = (await Promise.all(notices.map(name => readFile(resolve(directory, name), 'utf8')))).join('\n');
assert.match(notice, /Z-Anatomy/i);
assert.match(notice, /BodyParts3D/i);
assert.match(notice, /(?:CC BY-SA 4\.0|Attribution.ShareAlike 4\.0)/i);
for (const file of files) assert.ok(!/\.(blend|zip|fbx)$/i.test(file) && (await stat(resolve(directory, file))).isFile(), 'Only browser assets and notices belong in the shipped model directory');
console.log(`3D anatomy passed: ${manifest.regions.length} regions, ${coverage.size} groups, ${nodes.length} meshes, ${Math.round(triangles).toLocaleString()} triangles, ${(bytes.length / 1024 / 1024).toFixed(1)} MiB. Local resources and licences verified.`);
