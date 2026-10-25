import {assetUrl} from './asset-url.js';

/** Local, pinned exercise metadata. Muscle matching is independent of the renderer. */
export const EXERCISE_SOURCE = Object.freeze({
  url: 'https://github.com/hasaneyldrm/exercises-dataset',
  revision: '7455efae41b330c265e7cd4b78dfa848e7ce5ebd',
  catalogUrl: assetUrl('/assets/exercises/catalog.json'),
  licenseUrl: assetUrl('/assets/exercises/LICENSE.txt'),
});

const groupNote = 'Matches use the dataset’s muscle groups, apply to either side, and are not specific to an individual muscle subdivision.';
// Only explicit muscle labels and equivalent anatomical names are matched. Broad
// terms such as core, upper back, ankles and shins are not exact-muscle evidence.
const mappings = {
  chest: {primary: ['pectorals'], secondary: ['chest', 'upper chest']},
  'front-shoulders': {
    primary: ['delts'], secondary: ['deltoids', 'shoulders'],
    note: 'The dataset uses general deltoid and shoulder labels; these matches are not specific to the anterior head. They apply to either side.',
  },
  'rear-shoulders': {
    primary: [], secondary: ['rear deltoids', 'rotator cuff'],
    note: 'The dataset identifies rear deltoids and rotator cuff muscles as secondary muscles. General shoulder exercises are excluded here. Matches apply to either side and do not identify individual cuff muscles.',
  },
  biceps: {primary: ['biceps'], secondary: ['biceps', 'brachialis']},
  triceps: {primary: ['triceps'], secondary: ['triceps']},
  forearms: {primary: ['forearms'], secondary: ['forearms', 'wrist flexors', 'wrist extensors', 'grip muscles']},
  abdominals: {primary: ['abs'], secondary: ['abdominals', 'lower abs']},
  obliques: {
    primary: [], secondary: ['obliques'],
    note: 'The dataset lists obliques as secondary muscles and does not distinguish internal from external obliques. Matches apply to either side.',
  },
  traps: {
    primary: ['traps'], secondary: ['traps', 'trapezius'],
    note: 'The dataset groups the trapezius together, so upper, middle and lower fibres share these matches. Exercises are not specific to a fibre region or side.',
  },
  'traps-middle': {
    primary: ['traps'], secondary: ['traps', 'trapezius'],
    note: 'The dataset groups the trapezius together, so upper, middle and lower fibres share these matches. Exercises are not specific to a fibre region or side.',
  },
  lats: {primary: ['lats'], secondary: ['lats', 'latissimus dorsi']},
  lowerback: {
    primary: ['spine'], secondary: ['lower back'],
    note: 'Matches use the dataset’s spine and lower-back labels, rather than individual spinal erectors. They apply to either side.',
  },
  glutes: {primary: ['glutes'], secondary: ['glutes']},
  quads: {primary: ['quads'], secondary: ['quadriceps']},
  adductors: {primary: ['adductors'], secondary: ['inner thighs']},
  hamstrings: {primary: ['hamstrings'], secondary: ['hamstrings']},
  tibialis: {
    primary: [], secondary: [],
    note: 'This dataset has no exercises explicitly tagged for tibialis anterior. Calf exercises and the broad “shins” label are not substituted for this muscle.',
  },
  calves: {primary: ['calves'], secondary: ['calves', 'soleus']},
};

export function getMuscleExerciseInfo(muscleId) {
  const mapping = mappings[muscleId];
  return {
    note: mapping?.note || groupNote,
    aliases: mapping ? [...new Set([...mapping.primary, ...mapping.secondary])] : [],
  };
}

const normalized = value => String(value || '').trim().toLowerCase();

/** Validate at the network boundary so malformed catalogs produce a retryable error. */
export function validateExerciseCatalog(catalog) {
  if (catalog?.version !== 1 || catalog.source?.revision !== EXERCISE_SOURCE.revision
    || !Array.isArray(catalog.exercises) || catalog.exercises.length === 0) {
    throw new Error('Invalid exercise catalog');
  }
  const ids = new Set();
  for (const exercise of catalog.exercises) {
    if (!exercise || !['id', 'name', 'category', 'equipment', 'target', 'instructions'].every(key => typeof exercise[key] === 'string' && exercise[key].trim())
      || !/^\d+$/.test(exercise.id) || ids.has(exercise.id)
      || !Array.isArray(exercise.secondaryMuscles) || !exercise.secondaryMuscles.every(value => typeof value === 'string' && value.trim())
      || !Array.isArray(exercise.steps) || !exercise.steps.length || !exercise.steps.every(value => typeof value === 'string' && value.trim())) {
      throw new Error('Invalid exercise catalog record');
    }
    ids.add(exercise.id);
  }
  return catalog;
}

export async function loadExerciseCatalog({signal} = {}) {
  const response = await fetch(EXERCISE_SOURCE.catalogUrl, {signal});
  if (!response.ok) throw new Error(`Exercise catalog unavailable (${response.status})`);
  return validateExerciseCatalog(await response.json());
}

/** Primary targets precede supporting muscles; filter without mutating the catalog. */
export function getExercisesForMuscle(catalog, muscleId, {query = '', equipment = 'all', relationship = 'all'} = {}) {
  const mapping = mappings[muscleId];
  if (!mapping) return [];
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  const equipmentKey = normalized(equipment);
  return catalog.exercises.flatMap(exercise => {
    const match = mapping.primary.includes(normalized(exercise.target)) ? 'primary'
      : exercise.secondaryMuscles.some(name => mapping.secondary.includes(normalized(name))) ? 'secondary' : null;
    if (!match || (relationship !== 'all' && relationship !== match)
      || (equipmentKey && equipmentKey !== 'all' && normalized(exercise.equipment) !== equipmentKey)) return [];
    const haystack = normalized(`${exercise.name} ${exercise.equipment} ${exercise.target} ${exercise.secondaryMuscles.join(' ')}`);
    if (!terms.every(term => haystack.includes(term))) return [];
    return [{...exercise, match}];
  }).sort((a, b) => (a.match === b.match ? 0 : a.match === 'primary' ? -1 : 1)
    || a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id));
}
