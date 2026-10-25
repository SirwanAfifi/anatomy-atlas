# Anatomy assets

## Current 3D atlas

The interactive application uses `public/assets/anatomy/male.glb`, a locally
served, Meshopt-compressed GLB derived from the Z-Anatomy male model. The source
is pinned to revision `6271cab1422c5b7baf7ee2a16ac21695da1bb295` of
[Z-Anatomy/Models-of-human-anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy).
The downloaded ZIP must have SHA-256
`e029688545627bd0214b269e1063143abb580aad72b2c2445d6d8a9a0d9da736`.

The conversion exports an explicit allowlist of muscle subdivisions and their
original tendon material assignments, with primary supporting bone geometry.
Adjacent source skin regions are joined, welded and smoothed to provide a neutral
head, hands, and feet. Organ, vascular, nerve, inner-ear and insertion-marker
collections are excluded. Deep structures needed to complete the listed muscle
families retain their natural occlusion by superficial anatomy.

The source muscle surfaces do not have image textures or UVs. Nonportable Blender
display shaders are replaced with PBR red-muscle, pale-tendon and bone materials.
Directional cylindrical UVs and seamless **2048 × 2048 normal and roughness maps**
provide multiscale fibre detail. These authored material cues are illustrative,
not scanned fascicle data. The pinned muscle meshes have no upstream modifiers;
the low-density pectoral and deltoid surfaces and coarse reconstruction ridges
are present in the underlying geometry.

The quality refinement uses alternating nonshrinking smoothing passes on muscle
interiors, with displacement capped at 0.002 units in the normalized 2 m body.
Tendon faces, open boundaries and attachment tips stay fixed during this interior
step. A separate curve-only pass softens regular muscle/tendon junctions by at
most 0.00075 units (0.75 mm), retaining material identities, chain endpoints,
branch junctions and attachment tips. It does not fill or invent missing anatomy.
One subdivision level refines only broad pectoral, deltoid, gluteal and trapezius
surfaces; dense limb muscles and supporting bones are not subdivided. No source
geometry is decimated. Head and extremity surface regions retain their existing
subdivision after boundary welding. Geometry conditioning is a visual adaptation,
not an increase in the accuracy or measured resolution of the source dataset.

Compression uses Meshopt's medium encoder with 16-bit positions and 14-bit
normals. UVs use 16 bits where bounded; cylindrical seam coordinates outside
[0,1] retain floating-point precision. The high preset intentionally filters normals at 8-bit precision, which
was unsuitable for the close-up material treatment. The delivered geometry still
uses Meshopt compression and retains every anatomical selection identity.

The export normalizes feet to Y=0 and body height to 2 units. Anterior faces +Z;
anatomical right is -X. The manifest is independent of camera view and stores
stable identities, source names, group memberships, sides, mesh references,
focus anchors, joint anchors, source provenance and final asset statistics.

### Reproduce the GLB

Use Blender 4.5 LTS and Python 3. A portable Blender executable is sufficient.
Install the project's npm dependencies, then run:

```sh
BLENDER_PATH=/absolute/path/to/blender node scripts/convert-anatomy.mjs
```

An optional final argument changes the source cache directory (default
`.cache/anatomy`). `scripts/fetch-anatomy.mjs` downloads and verifies the exact
ZIP and extracts only `Z-Anatomy/Startup.blend`. The orchestrator opens that
file using `--factory-startup --disable-autoexec`, runs our conversion script,
and compresses it using `scripts/optimize-anatomy.mjs`. No upstream Python
scripts are installed or executed. Large source files remain outside `public/`.

The conversion checks every named structure. It intentionally corrects two
swapped names in the pinned source: the mesh called “Ascending part of
trapezius” occupies the upper neck (source Z 1.415–1.575), while “Descending
part” occupies the lower trapezius (Z 1.120–1.414). Display labels and group
membership follow anatomical placement; `sourceName` preserves the original
names so the change is auditable.

### Attribution and reuse

Adapted model assets and derived anatomical metadata are **CC BY-SA 4.0**.
Required Z-Anatomy and BodyParts3D credits, a list of changes, the original
source notices and full licence text are bundled alongside the model. The
application's credits link opens `NOTICE.txt`. Source authors do not endorse
the adaptation. No source Wikipedia definitions or unrelated organ assets
with separate noncommercial notices are exported.
