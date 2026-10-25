import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fetchAnatomy} from './fetch-anatomy.mjs';

const blender = process.env.BLENDER_PATH;
if (!blender) throw new Error('Set BLENDER_PATH to the Blender 4.5 LTS executable. No global installation is required.');
const source = await fetchAnatomy(process.argv[2]);
const result = spawnSync(blender, [
  '--background', '--factory-startup', '--disable-autoexec', source, '--python-exit-code', '1',
  '--python', resolve('scripts/prepare-anatomy.py'), '--',
  '--output', resolve('public/assets/anatomy'),
], {stdio: 'inherit'});
if (result.status !== 0) throw new Error(`Blender conversion failed: ${result.status}`);
await import('./optimize-anatomy.mjs');
