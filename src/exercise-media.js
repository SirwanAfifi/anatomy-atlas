import {assetUrl} from './asset-url.js';

/** Independently licensed photographs matched to the original exercise records. */
export const EXERCISE_MEDIA_SOURCE = Object.freeze({
  url: 'https://github.com/yuhonas/free-exercise-db',
  revision: 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5',
  manifestUrl: assetUrl('/assets/exercises/media-manifest.json'),
  licenseUrl: assetUrl('/assets/exercises/MEDIA-LICENSE.txt'),
});

export function validateExerciseMedia(manifest) {
  if (manifest?.version !== 1 || manifest.source?.revision !== EXERCISE_MEDIA_SOURCE.revision
    || !manifest.exercises || typeof manifest.exercises !== 'object' || Array.isArray(manifest.exercises)
    || !Object.keys(manifest.exercises).length) throw new Error('Invalid exercise media manifest');
  for (const [id, media] of Object.entries(manifest.exercises)) {
    if (!/^\d+$/.test(id) || !media || typeof media.sourceId !== 'string' || !media.sourceId
      || typeof media.sourceName !== 'string' || !media.sourceName
      || !['normalized-name', 'reviewed-alias'].includes(media.match)
      || !Array.isArray(media.images) || !media.images.length
      || !media.images.every(url => typeof url === 'string' && /^\/assets\/exercises\/media\/[\w%().\/-]+\.(jpg|jpeg|png|webp)$/.test(url) && !decodeURIComponent(url).split('/').includes('..'))) {
      throw new Error('Invalid exercise media record');
    }
  }
  return manifest;
}

export async function loadExerciseMedia({signal} = {}) {
  const response = await fetch(EXERCISE_MEDIA_SOURCE.manifestUrl, {signal});
  if (!response.ok) throw new Error(`Exercise images unavailable (${response.status})`);
  return validateExerciseMedia(await response.json());
}

// Unmatched exercises never receive an unrelated image or a text-only card.
export function bindExerciseMedia(catalog, manifest) {
  return {...catalog, exercises: catalog.exercises.filter(exercise => Object.hasOwn(manifest.exercises, exercise.id))
    .map(exercise => ({...exercise, media: manifest.exercises[exercise.id]}))};
}
