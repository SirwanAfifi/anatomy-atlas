import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {EXERCISE_SOURCE, validateExerciseCatalog} from '../src/exercises.js';

const output = new URL('../public/assets/exercises/', import.meta.url);
const upstream = `https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/${EXERCISE_SOURCE.revision}/`;
const sourceArgument = process.argv.indexOf('--source');
if (sourceArgument >= 0 && !process.argv[sourceArgument + 1]) throw new Error('--source requires a path to the original JSON');
const download = async path => {
  const response = await fetch(upstream + path, {signal: AbortSignal.timeout(180000)});
  if (!response.ok) throw new Error(`Download failed for ${path}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};
const source = sourceArgument < 0 ? await download('data/exercises.json') : await readFile(process.argv[sourceArgument + 1]);
const sourceHash = createHash('sha256').update(source).digest('hex');
if (sourceHash !== '656634224b8977b99a6d765470ee123260d4979715eaa4e7c0b7c8bb0d79f93d') {
  throw new Error('Source checksum differs from the reviewed pinned dataset');
}
const raw = JSON.parse(source.toString('utf8'));
if (!Array.isArray(raw) || raw.length !== 1324) throw new Error('Unexpected source record count; review the pinned source');
const catalog = {
  version: 1,
  source: {
    url: EXERCISE_SOURCE.url,
    revision: EXERCISE_SOURCE.revision,
    path: 'data/exercises.json',
    sha256: sourceHash,
    license: 'MIT (metadata and instructions only)',
    language: 'en',
    mediaIncluded: false,
  },
  exercises: raw.map(record => ({
    id: record.id,
    name: record.name,
    category: record.category,
    equipment: record.equipment,
    target: record.target,
    // Preserve both upstream supporting-muscle fields without promoting them to targets.
    secondaryMuscles: [...new Set([...(record.secondary_muscles || []), record.muscle_group].filter(Boolean))],
    instructions: record.instructions?.en,
    steps: record.instruction_steps?.en,
  })),
};
validateExerciseCatalog(catalog);
await mkdir(output, {recursive: true});
const notices = [['LICENSE', 'LICENSE.txt'], ['NOTICE.md', 'SOURCE-NOTICE.md']];
for (const [sourcePath, outputPath] of notices) {
  // --source supports a fully offline repeat conversion once notices are present.
  let text;
  if (sourceArgument >= 0) {
    try { text = await readFile(new URL(outputPath, output)); } catch {}
  }
  await writeFile(new URL(outputPath, output), text || await download(sourcePath));
}
const data = JSON.stringify(catalog) + '\n';
await writeFile(new URL('catalog.json', output), data);
await writeFile(new URL('provenance.json', output), JSON.stringify({
  ...catalog.source,
  recordCount: catalog.exercises.length,
  catalogSha256: createHash('sha256').update(data).digest('hex'),
  conversion: 'scripts/import-exercises.mjs; English metadata and instruction steps; secondary fields deduplicated; all media excluded.',
}, null, 2) + '\n');
console.log(`Imported ${catalog.exercises.length} exercises (${(Buffer.byteLength(data) / 1024).toFixed(0)} KiB) into ${fileURLToPath(output)}`);
