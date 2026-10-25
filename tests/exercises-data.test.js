import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {muscleGroups} from '../src/anatomy.js';
import {EXERCISE_SOURCE, getExercisesForMuscle, getMuscleExerciseInfo, loadExerciseCatalog, validateExerciseCatalog} from '../src/exercises.js';

const folder = new URL('../public/assets/exercises/', import.meta.url);
const bytes = await readFile(new URL('catalog.json', folder));
const catalog = JSON.parse(bytes);
const provenance = JSON.parse(await readFile(new URL('provenance.json', folder), 'utf8'));

test('pinned catalog and attribution are complete and contain no separately licensed media', async () => {
  assert.equal(validateExerciseCatalog(catalog), catalog);
  assert.equal(catalog.exercises.length, 1324);
  assert.equal(new Set(catalog.exercises.map(e => e.id)).size, 1324);
  assert.equal(catalog.source.revision, EXERCISE_SOURCE.revision);
  assert.equal(catalog.source.sha256, '656634224b8977b99a6d765470ee123260d4979715eaa4e7c0b7c8bb0d79f93d');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), provenance.catalogSha256);
  assert.equal(catalog.source.mediaIncluded, false);
  assert.equal(catalog.source.language, 'en');
  const files = await readdir(folder);
  for (const required of ['LICENSE.txt', 'SOURCE-NOTICE.md', 'catalog.json', 'provenance.json']) assert.ok(files.includes(required));
  // Openly licensed visual assets are tracked separately from this text catalog.
  assert.ok(!files.includes('images') && !files.includes('videos'));
  assert.match(await readFile(new URL('LICENSE.txt', folder), 'utf8'), /MIT License/);
  assert.match(await readFile(new URL('LICENSE.txt', folder), 'utf8'), /Hasan Emir Yıldırım/);
  assert.match(await readFile(new URL('SOURCE-NOTICE.md', folder), 'utf8'), /does not grant you any rights/);
  assert.ok(catalog.exercises.every(e => !e.image && !e.gif_url && !e.media_id));
});

test('all atlas groups have an explicit mapping or an honest absence explanation', () => {
  for (const id of Object.keys(muscleGroups)) {
    const info = getMuscleExerciseInfo(id);
    assert.ok(info.note.length > 30, id);
    if (id === 'tibialis') {
      assert.equal(getExercisesForMuscle(catalog, id).length, 0);
      assert.match(info.note, /no exercises explicitly tagged/);
    } else {
      assert.ok(info.aliases.length, id);
      assert.ok(getExercisesForMuscle(catalog, id).length, id);
    }
  }
  assert.deepEqual(getExercisesForMuscle(catalog, 'unknown'), []);
});

test('bench press remains a pectoral target and a triceps supporting-muscle match', () => {
  const chest = getExercisesForMuscle(catalog, 'chest').find(e => e.id === '0025');
  const triceps = getExercisesForMuscle(catalog, 'triceps').find(e => e.id === '0025');
  assert.equal(chest.name, 'barbell bench press');
  assert.equal(chest.match, 'primary');
  assert.equal(triceps.match, 'secondary');
  assert.deepEqual(chest.steps, catalog.exercises.find(e => e.id === '0025').steps);
});

test('broad or unrelated muscle labels do not imply specific posterior shoulder, oblique or shin targets', () => {
  const rear = getExercisesForMuscle(catalog, 'rear-shoulders');
  assert.ok(rear.every(e => e.match === 'secondary' && e.secondaryMuscles.some(m => ['rear deltoids', 'rotator cuff'].includes(m))));
  assert.equal(getExercisesForMuscle(catalog, 'obliques', {relationship: 'primary'}).length, 0);
  assert.ok(getExercisesForMuscle(catalog, 'obliques').every(e => e.secondaryMuscles.includes('obliques')));
  assert.deepEqual(getExercisesForMuscle(catalog, 'traps').map(e => e.id), getExercisesForMuscle(catalog, 'traps-middle').map(e => e.id));
  assert.match(getMuscleExerciseInfo('front-shoulders').note, /not specific to the anterior/);
  assert.match(getMuscleExerciseInfo('traps-middle').note, /not specific to a fibre region/);
  // The upstream “smith toe raise” has a vague shins label but describes calf raises.
  assert.ok(catalog.exercises.find(e => e.id === '1396').secondaryMuscles.includes('shins'));
  assert.deepEqual(getExercisesForMuscle(catalog, 'tibialis'), []);
});

test('search, equipment and relationship filters compose without changing source data', () => {
  const before = JSON.stringify(catalog);
  const filtered = getExercisesForMuscle(catalog, 'chest', {query: ' BENCH press ', equipment: 'BARBELL', relationship: 'primary'});
  assert.ok(filtered.length > 0);
  assert.ok(filtered.every(e => e.name.includes('bench') && e.name.includes('press') && e.equipment === 'barbell' && e.match === 'primary'));
  assert.ok(getExercisesForMuscle(catalog, 'quads', {equipment: 'body weight'}).length);
  assert.deepEqual(getExercisesForMuscle(catalog, 'biceps', {query: 'unmatchedzzzz'}), []);
  const all = getExercisesForMuscle(catalog, 'triceps');
  const firstSecondary = all.findIndex(e => e.match === 'secondary');
  assert.ok(firstSecondary > 0);
  assert.ok(all.slice(firstSecondary).every(e => e.match === 'secondary'));
  assert.equal(new Set(all.map(e => e.id)).size, all.length);
  assert.equal(JSON.stringify(catalog), before);
});

test('malformed or duplicate records fail at the loading boundary', () => {
  assert.throws(() => validateExerciseCatalog({}), /Invalid exercise catalog/);
  assert.throws(() => validateExerciseCatalog({...catalog, exercises: []}), /Invalid exercise catalog/);
  assert.throws(() => validateExerciseCatalog({...catalog, exercises: [catalog.exercises[0], catalog.exercises[0]]}), /Invalid exercise catalog record/);
  assert.throws(() => validateExerciseCatalog({...catalog, exercises: [{...catalog.exercises[0], steps: []}]}), /Invalid exercise catalog record/);
  assert.throws(() => validateExerciseCatalog({...catalog, source: {...catalog.source, revision: 'unreviewed'}}), /Invalid exercise catalog/);
});

test('catalog failures can be retried and cancellation propagates to fetch', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const controller = new AbortController();
  let attempts = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, EXERCISE_SOURCE.catalogUrl);
    assert.equal(options.signal, controller.signal);
    attempts++;
    return attempts === 1 ? {ok: false, status: 503} : {ok: true, json: async () => catalog};
  };
  await assert.rejects(loadExerciseCatalog({signal: controller.signal}), /503/);
  assert.equal(await loadExerciseCatalog({signal: controller.signal}), catalog);
  assert.equal(attempts, 2);
});
