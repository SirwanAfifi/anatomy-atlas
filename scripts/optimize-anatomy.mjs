import {readFile, writeFile, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {dedup, prune, join, meshopt} from '@gltf-transform/functions';
import {MeshoptDecoder, MeshoptEncoder} from 'meshoptimizer';

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const root = 'public/assets/anatomy';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder});
const document = await io.read(`${root}/male-uncompressed.glb`);
// Batch only nonselectable supporting anatomy. Named muscle nodes and extras
// remain distinct so picking and anatomical identities survive optimization.
// The "high" preset clamps normals to an 8-bit filter. Keep a finer grid for
// close-up highlights and fibre UVs; compression still preserves mesh identity.
await document.transform(dedup(), join({filter: node => node.getName().startsWith('context-')}), prune(), meshopt({
  encoder: MeshoptEncoder, level: 'medium',
  quantizePosition: 16, quantizeNormal: 14, quantizeTexcoord: 16,
}));
await io.write(`${root}/male.glb`, document);
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
const data = await readFile(`${root}/male.glb`);
manifest.stats.compressedBytes = data.length;
manifest.stats.sha256 = createHash('sha256').update(data).digest('hex');
manifest.stats.meshes = document.getRoot().listMeshes().length;
manifest.stats.triangles = document.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((n, p) => n + (p.getIndices()?.getCount() || p.getAttribute('POSITION').getCount()) / 3, 0), 0);
await writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
await rm(`${root}/male-uncompressed.glb`);
console.log(`Anatomy GLB: ${(data.length / 1024 / 1024).toFixed(2)} MiB; ${manifest.stats.triangles.toLocaleString()} triangles; ${manifest.regions.length} regions.`);
