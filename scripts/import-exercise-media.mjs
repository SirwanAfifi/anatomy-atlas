import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const revision = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5';
const sourceHash = '5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf';
const sourceUrl = 'https://github.com/yuhonas/free-exercise-db';
const raw = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${revision}/`;
const cache = resolve(project, '.cache/exercise-visual-source');
const output = resolve(project, 'public/assets/exercises');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const normalizeName = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');

// These are explicit spelling/plural equivalents or a reviewed same-equipment
// variant. No fuzzy or muscle-only fallback assigns a picture to an exercise.
const aliases = {
  '0025': 'Barbell_Bench_Press_-_Medium_Grip',
  '0083': 'Barbell_Rollout_from_Bench',
  '0114': 'Barbell_Step_Ups',
  '0157': 'Cable_Deadlifts',
  '0220': 'Cable_Shrugs',
  '0284': 'Donkey_Calf_Raises',
  '0285': 'Dumbbell_Alternate_Bicep_Curl',
  '0294': 'Dumbbell_Bicep_Curl',
  '0308': 'Dumbbell_Flyes',
  '0336': 'Dumbbell_Lunges',
  '0431': 'Dumbbell_Step_Ups',
  '0466': 'Gironda_Sternum_Chins',
  '0471': 'Handstand_Push-Ups',
  '0562': 'Landmine_180s',
  '0576': 'Leverage_Chest_Press',
  '0577': 'Leverage_Chest_Press',
  '0598': 'Thigh_Adductor',
  '0603': 'Leverage_Shoulder_Press',
  '0609': 'London_Bridges',
  '0627': 'Mixed_Grip_Chin',
  '0630': 'Mountain_Climbers',
  '0652': 'Pullups',
  '0662': 'Pushups',
  '0678': 'Rocky_Pull-Ups_Pulldowns',
  '0720': 'Side_To_Side_Chins',
  '0759': 'Smith_Incline_Shoulder_Raise',
  '0832': 'Weighted_Crunches',
  '0841': 'Weighted_Pull_Ups',
  '0859': 'Wrist_Roller',
  '0863': 'External_Rotation',
  '1167': 'Dynamic_Chest_Stretch',
  '1297': 'Isometric_Chest_Squeezes',
  '1299': 'Leverage_Incline_Chest_Press',
  '1300': 'Leverage_Decline_Chest_Press',
  '1377': 'Calf_Stretch_Hands_Against_Wall',
};

// Matching titles alone cannot settle these variants. The existing instructions
// describe a different setup or movement from the candidate source photographs.
const exclusions = {
  '1259': 'Existing standing independent stretch differs from seated partner-assisted photos.',
  '2133': 'Existing dumbbell carry differs from the source strongman implements.',
  '0628': 'Existing lateral band walk differs from the source forward/backward monster walk.',
  '0851': 'Existing generic weighted squat instructions differ from a supported sissy squat.',
  '0459': 'Existing supine flutter kicks differ from prone bench kicks.',
  '1511': 'Existing standing hamstring stretch differs from lying strap-assisted stretch.',
  '1564': 'Existing standing quad stretch differs from a prone strap-assisted stretch.',
  '0638': 'Existing wrist-assisted one-arm chin-up differs from towel-assisted setup.',
  '0641': 'Existing unweighted partial sit-up differs from a weighted overhead Otis Up.',
  '2368': 'Existing static split squat differs from the source jumping split squat.',
  '0852': 'Existing goblet/back-weighted squat differs from the source belt squat.',
  '0858': 'Existing running wind sprints differ from hanging knee raises.',
};

async function download(path) {
  const response = await fetch(raw + path, {signal: AbortSignal.timeout(90000)});
  if (!response.ok) throw new Error(`Failed ${path}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function sourceFile(filename, sourcePath) {
  const path = resolve(cache, filename);
  try { return await readFile(path); } catch {}
  const bytes = await download(sourcePath);
  await writeFile(path, bytes);
  return bytes;
}

function jpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Expected original JPEG media');
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error('Invalid JPEG marker');
    let marker = bytes[offset++];
    while (marker === 0xff) marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error('Invalid JPEG segment');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return {width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3)};
    offset += length;
  }
  throw new Error('JPEG dimensions unavailable');
}

await mkdir(cache, {recursive: true});
await mkdir(output, {recursive: true});
const sourceBytes = await sourceFile('exercises.json', 'dist/exercises.json');
if (digest(sourceBytes) !== sourceHash) throw new Error('Pinned image catalog checksum differs; review before importing');
const source = JSON.parse(sourceBytes);
const catalog = JSON.parse(await readFile(resolve(output, 'catalog.json'), 'utf8'));
const byId = new Map(source.map(exercise => [exercise.id, exercise]));
const byName = new Map();
for (const exercise of source) {
  const name = normalizeName(exercise.name);
  if (byName.has(name)) throw new Error(`Ambiguous source name: ${name}`);
  byName.set(name, exercise);
}
const exercises = {};
const paths = new Set();
for (const exercise of catalog.exercises) {
  if (exclusions[exercise.id]) continue;
  const mapped = aliases[exercise.id] ? byId.get(aliases[exercise.id]) : byName.get(normalizeName(exercise.name));
  if (!mapped) { if (aliases[exercise.id]) throw new Error(`Missing reviewed alias ${exercise.id}`); continue; }
  if (!Array.isArray(mapped.images) || mapped.images.length !== 2) throw new Error(`Expected two photos: ${mapped.id}`);
  for (const path of mapped.images) {
    if (!/^[\w()-]+\/[01]\.jpg$/.test(path)) throw new Error(`Unexpected image path: ${path}`);
    paths.add(path);
  }
  exercises[exercise.id] = {
    sourceId: mapped.id,
    sourceName: mapped.name,
    images: mapped.images.map(path => `/assets/exercises/media/${path}`),
    match: aliases[exercise.id] ? 'reviewed-alias' : 'normalized-name',
  };
}

const files = {};
const queue = [...paths].sort();
let completed = 0;
async function worker() {
  while (queue.length) {
    const path = queue.shift();
    const destination = resolve(output, 'media', path);
    let bytes;
    try { bytes = await readFile(destination); } catch {}
    if (!bytes) {
      bytes = await download(`exercises/${path}`);
      await mkdir(dirname(destination), {recursive: true});
      await writeFile(destination, bytes);
    }
    const dimensions = jpegDimensions(bytes);
    if (dimensions.width < 100 || dimensions.height < 100) throw new Error(`Unexpectedly small source photo: ${path}`);
    files[`/assets/exercises/media/${path}`] = {sha256: digest(bytes), bytes: bytes.length, ...dimensions};
    completed++;
    if (completed % 50 === 0) console.log(`Imported ${completed}/${paths.size} photographs`);
  }
}
await Promise.all(Array.from({length: 6}, worker));
const license = await sourceFile('LICENSE.md', 'LICENSE.md');
await writeFile(resolve(output, 'MEDIA-LICENSE.txt'), license);
await writeFile(resolve(output, 'MEDIA-NOTICE.txt'), `Exercise photographs: Free Exercise DB by yuhonas and contributors.\nSource: ${sourceUrl}\nRevision: ${revision}\nLicence: Unlicense / public domain, as declared by the upstream repository.\nThe upstream README explicitly permits use of its JSON and images locally.\nOriginal JPEG files are copied unchanged; no resizing, cropping or AI edits.\nMaps: strict normalized names and reviewed equivalent exercise aliases only.\nUnmatched exercises have no photographs; no image is reused solely by muscle.\nThe source photographs are separate from Hasan Emir Yıldırım's MIT metadata\nand from Gym visual's separately licensed media, which are not included.\n`);
const manifest = {
  version: 1,
  source: {url: sourceUrl, revision, license: 'Unlicense', licenseUrl: '/assets/exercises/MEDIA-LICENSE.txt', sourceSha256: sourceHash, sourcePath: 'dist/exercises.json'},
  exercises,
  files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
};
await writeFile(resolve(output, 'media-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(resolve(cache, 'mapping-exclusions.json'), JSON.stringify(exclusions, null, 2) + '\n');
console.log(`Mapped ${Object.keys(exercises).length} exercises to ${paths.size} original photographs (${(Object.values(files).reduce((n, file) => n + file.bytes, 0) / 1024 / 1024).toFixed(1)} MiB).`);
