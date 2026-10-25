import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {muscleGroups} from '../src/anatomy.js';
import {getExercisesForMuscle} from '../src/exercises.js';
import {EXERCISE_MEDIA_SOURCE, bindExerciseMedia, validateExerciseMedia, loadExerciseMedia} from '../src/exercise-media.js';

const assetRoot = new URL('../public/', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('assets/exercises/catalog.json', assetRoot), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('assets/exercises/media-manifest.json', assetRoot), 'utf8'));

test('visual assets have a pinned open source, licence and traceable exercise matches', async () => {
  assert.equal(manifest.version, 1);
  assert.equal(validateExerciseMedia(manifest), manifest);
  assert.equal(manifest.source.url, 'https://github.com/yuhonas/free-exercise-db');
  assert.equal(manifest.source.revision, 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5');
  assert.equal(manifest.source.license, 'Unlicense');
  assert.match(manifest.source.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.source.licenseUrl, '/assets/exercises/MEDIA-LICENSE.txt');
  assert.match(await readFile(new URL(manifest.source.licenseUrl.slice(1), assetRoot), 'utf8'), /public domain/i);
  const ids = new Set(catalog.exercises.map(exercise => exercise.id));
  assert.ok(Object.keys(manifest.exercises).length >= 100);
  for (const [id, media] of Object.entries(manifest.exercises)) {
    assert.ok(ids.has(id), `Unknown catalog exercise ${id}`);
    assert.ok(media.sourceId && media.sourceName, id);
    assert.ok(['normalized-name', 'reviewed-alias'].includes(media.match), id);
    assert.equal(media.images.length, 2, `Two source views expected for ${id}`);
    assert.equal(new Set(media.images).size, 2, `Distinct views expected for ${id}`);
  }
  // Keep the standard bench press separate from its incline/decline variants.
  assert.match(manifest.exercises['0025'].sourceName, /bench press/i);
  assert.doesNotMatch(manifest.exercises['0025'].sourceName, /incline|decline/i);
});

test('all referenced photos are self-hosted original JPEGs with matching integrity metadata', async () => {
  const paths = new Set(Object.values(manifest.exercises).flatMap(media => media.images));
  assert.deepEqual([...paths].sort(), Object.keys(manifest.files).sort());
  for (const path of paths) {
    assert.match(path, /^\/assets\/exercises\/media\/[A-Za-z0-9_-]+\/[01]\.jpg$/);
    assert.ok(!path.includes('..'));
    const metadata = manifest.files[path];
    const image = await readFile(new URL(path.slice(1), assetRoot));
    assert.equal(image.readUInt16BE(0), 0xffd8, path);
    assert.equal(image.length, metadata.bytes, path);
    assert.equal(createHash('sha256').update(image).digest('hex'), metadata.sha256, path);
    assert.ok(metadata.width > 0 && metadata.height > 0, path);
  }
});

test('visual catalog retains source exercise facts and muscle roles without empty image cards', () => {
  const original = JSON.stringify(catalog);
  const visual = bindExerciseMedia(catalog, manifest);
  assert.equal(JSON.stringify(catalog), original);
  assert.equal(visual.exercises.length, Object.keys(manifest.exercises).length);
  for (const exercise of visual.exercises) {
    const source = catalog.exercises.find(entry => entry.id === exercise.id);
    const {media, ...record} = exercise;
    assert.deepEqual(record, source);
    assert.deepEqual(media, manifest.exercises[exercise.id]);
  }
  for (const group of Object.keys(muscleGroups)) {
    const matches = getExercisesForMuscle(visual, group);
    if (group === 'tibialis') assert.equal(matches.length, 0);
    else assert.ok(matches.length > 0, `${group} has no visual matches`);
    assert.ok(matches.every(exercise => exercise.media.images.length === 2));
  }
  assert.equal(getExercisesForMuscle(visual, 'chest').find(exercise => exercise.id === '0025').match, 'primary');
  assert.equal(getExercisesForMuscle(visual, 'triceps').find(exercise => exercise.id === '0025').match, 'secondary');
});

test('unreviewed and nonlocal image manifests fail before rendering', () => {
  assert.throws(() => validateExerciseMedia({}), /Invalid exercise media/);
  assert.throws(() => validateExerciseMedia({...manifest, source: {...manifest.source, revision: 'unreviewed'}}), /Invalid exercise media/);
  const record = manifest.exercises['0025'];
  for (const images of [[], ['https://example.com/photo.jpg'], ['/assets/exercises/media/../secret.jpg']]) {
    assert.throws(() => validateExerciseMedia({...manifest, exercises: {'0025': {...record, images}}}), /Invalid exercise media/);
  }
});

test('image manifest errors can be retried and fetch receives cancellation', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const controller = new AbortController();
  let attempts = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, EXERCISE_MEDIA_SOURCE.manifestUrl);
    assert.equal(options.signal, controller.signal);
    attempts++;
    return attempts === 1 ? {ok: false, status: 503} : {ok: true, json: async () => manifest};
  };
  await assert.rejects(loadExerciseMedia({signal: controller.signal}), /503/);
  assert.equal(await loadExerciseMedia({signal: controller.signal}), manifest);
  assert.equal(attempts, 2);
});
