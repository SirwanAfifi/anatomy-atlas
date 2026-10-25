import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

export const revision = '6271cab1422c5b7baf7ee2a16ac21695da1bb295';
export const checksum = 'e029688545627bd0214b269e1063143abb580aad72b2c2445d6d8a9a0d9da736';
export const archiveURL = `https://raw.githubusercontent.com/Z-Anatomy/Models-of-human-anatomy/${revision}/Z-Anatomy.zip`;

export async function fetchAnatomy(directory = '.cache/anatomy') {
  const cache = resolve(directory);
  await mkdir(cache, {recursive: true});
  const archive = resolve(cache, 'Z-Anatomy.zip');
  let bytes;
  try { bytes = await readFile(archive); } catch {}
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== checksum) {
    console.log('Downloading pinned Z-Anatomy source (87 MB)…');
    const response = await fetch(archiveURL);
    if (!response.ok) throw new Error(`Source download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== checksum) throw new Error('Source checksum mismatch; refusing conversion.');
    await writeFile(archive, bytes);
  }
  const extraction = spawnSync(process.env.PYTHON || 'python3', ['-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extract("Z-Anatomy/Startup.blend", sys.argv[2])', archive, cache], {stdio: 'inherit'});
  if (extraction.status !== 0) throw new Error('Source extraction failed. Python 3 is required.');
  const source = resolve(cache, 'Z-Anatomy/Startup.blend');
  console.log(`Verified source: ${source}`);
  return source;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await fetchAnatomy(process.argv[2]);
}
