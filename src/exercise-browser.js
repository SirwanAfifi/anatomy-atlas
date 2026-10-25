import {muscleGroups} from './anatomy.js';
import {EXERCISE_MEDIA_SOURCE, loadExerciseMedia, bindExerciseMedia} from './exercise-media.js';
import {EXERCISE_SOURCE, loadExerciseCatalog, getExercisesForMuscle, getMuscleExerciseInfo} from './exercises.js';
import {assetUrl} from './asset-url.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const titleCase = value => String(value).replace(/\b\w/g, letter => letter.toUpperCase());
const pageSize = 6;

/** HTML exercise browsing is independent of the renderer and survives WebGL failures. */
export function createExerciseBrowser(root) {
  let muscle = null;
  let catalog = null;
  let request = null;
  let error = false;
  let disposed = false;
  let limit = pageSize;
  let filters = {query: '', equipment: 'all', relationship: 'all'};
  let opener = null;
  let activeExercise = null;
  const events = new AbortController();
  const listen = (element, type, listener) => element.addEventListener(type, listener, {signal: events.signal});
  const $ = selector => root.querySelector(selector);

  root.innerHTML = `<div class="exercise-heading"><div><p class="eyebrow">ANATOMY IN MOTION</p><h2 id="exercises-title">Find your next movement.</h2></div><span class="exercise-total" hidden></span></div>
    <p class="exercise-context">Select a muscle to discover movements in pictures.</p><details class="exercise-mapping-note" hidden><summary>About these matches</summary><p></p></details>
    <div class="exercise-content" hidden>
      <div class="exercise-loading" role="status" hidden>Loading exercises…</div>
      <div class="exercise-error" role="status" hidden><p>Exercises could not load. Try again to explore this muscle.</p><button type="button" data-exercise-action="retry">Try again</button></div>
      <div class="exercise-catalog" hidden>
        <div class="exercise-filters">
          <label class="exercise-search"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M21 21l-5.3-5.3M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0"/></svg><input type="search" id="exercise-search" aria-label="Search exercises" placeholder="Search exercises" autocomplete="off"></label>
          <label class="exercise-filter"><span>Equipment</span><select id="exercise-equipment" aria-label="Exercise equipment"><option value="all">All equipment</option></select></label>
          <label class="exercise-filter"><span>Muscle role</span><select id="exercise-relationship" aria-label="Muscle role"><option value="all">All matches</option><option value="primary">Primary target</option><option value="secondary">Supporting muscle</option></select></label>
        </div>
        <p id="exercise-results" class="exercise-results" role="status" aria-live="polite"></p>
        <div class="exercise-grid"></div>
        <div class="exercise-empty" hidden><h3>No exercises match these filters.</h3><p>Try another search or equipment type.</p><button type="button" data-exercise-action="reset">Clear filters</button></div>
        <button type="button" class="exercise-more" data-exercise-action="more" hidden>Show more exercises</button>
      </div>
    </div>
    <p class="exercise-credit" hidden>Photos: <a href="${escape(EXERCISE_MEDIA_SOURCE.url)}" target="_blank" rel="noreferrer">Free Exercise DB</a> <span>·</span> <a href="${escape(EXERCISE_MEDIA_SOURCE.licenseUrl)}" target="_blank" rel="noreferrer">Public domain</a><br>Exercise data by <a href="${escape(EXERCISE_SOURCE.url)}" target="_blank" rel="noreferrer">Hasan Emir Yıldırım</a> <span>·</span> <a href="${escape(EXERCISE_SOURCE.licenseUrl)}" target="_blank" rel="noreferrer">MIT licence</a></p>
    <dialog id="exercise-dialog" class="exercise-dialog" aria-labelledby="exercise-dialog-title"><button type="button" class="exercise-dialog-close icon-button" aria-label="Close exercise" autofocus>×</button><div class="exercise-dialog-content"></div></dialog>`;

  function renderResults({focusNext = false} = {}) {
    if (!catalog || !muscle) return;
    const matches = getExercisesForMuscle(catalog, muscle, filters);
    const visible = matches.slice(0, limit);
    const previousCount = $('.exercise-grid').children.length;
    $('#exercise-results').textContent = matches.length ? `Showing ${visible.length} of ${matches.length} exercises` : 'No matching exercises';
    $('.exercise-grid').innerHTML = visible.map(exercise => `<article class="exercise-card"><button type="button" class="exercise-open" data-exercise-id="${escape(exercise.id)}" aria-haspopup="dialog"><span class="exercise-card-media"><img id="exercise-photo-${escape(exercise.id)}" data-exercise-image src="${escape(assetUrl(exercise.media.images[0]))}" alt="${escape(titleCase(exercise.name))} demonstration" width="640" height="480" loading="lazy" decoding="async"><span class="exercise-image-count">${exercise.media.images.length} views</span></span><span class="exercise-card-body"><span class="exercise-card-top"><span class="exercise-role ${exercise.match}">${exercise.match === 'primary' ? 'Primary target' : 'Supporting muscle'}</span><span class="exercise-card-arrow" aria-hidden="true">↗</span></span><span class="exercise-card-name">${escape(titleCase(exercise.name))}</span><span class="exercise-equipment">${escape(titleCase(exercise.equipment))}</span></span></button><div class="exercise-media-error" hidden role="status"><span>Photo could not load.</span><button type="button" data-exercise-action="retry-image" data-image-target="exercise-photo-${escape(exercise.id)}">Retry image</button></div></article>`).join('');
    $('.exercise-empty').hidden = matches.length > 0;
    $('[data-exercise-action="more"]').hidden = visible.length >= matches.length;
    if (focusNext) $('.exercise-grid').children[previousCount]?.querySelector('[data-exercise-id]').focus({preventScroll: true});
  }

  function render() {
    $('#exercises-title').textContent = muscle ? `Exercises for ${muscleGroups[muscle].name}` : 'Find your next movement.';
    $('.exercise-content').hidden = !muscle;
    $('.exercise-credit').hidden = !muscle;
    $('.exercise-mapping-note').hidden = !muscle;
    $('.exercise-total').hidden = !muscle || !catalog;
    root.setAttribute('aria-busy', String(Boolean(request) && Boolean(muscle)));
    if (!muscle) {
      $('.exercise-context').textContent = 'Select a muscle to discover movements in pictures.';
      return;
    }
    const info = getMuscleExerciseInfo(muscle);
    $('.exercise-context').textContent = 'Explore the movement. Select a photo to see each position.';
    $('.exercise-mapping-note p').textContent = info.note || 'Matched to this muscle group. Exercises apply to either anatomical side.';
    $('.exercise-loading').hidden = !request;
    $('.exercise-error').hidden = !error;
    $('.exercise-catalog').hidden = !catalog;
    if (!catalog) return;
    const all = getExercisesForMuscle(catalog, muscle);
    $('.exercise-total').textContent = `${all.length} visual exercises`;
    const options = [...new Set(all.map(exercise => exercise.equipment))].sort();
    $('#exercise-equipment').innerHTML = '<option value="all">All equipment</option>' + options.map(value => `<option value="${escape(value)}">${escape(titleCase(value))}</option>`).join('');
    $('#exercise-equipment').value = filters.equipment;
    $('#exercise-search').value = filters.query;
    $('#exercise-relationship').value = filters.relationship;
    if (!all.length) {
      $('.exercise-filters').hidden = true;
      $('.exercise-grid').innerHTML = '';
      $('.exercise-empty').hidden = true;
      $('[data-exercise-action="more"]').hidden = true;
      $('#exercise-results').textContent = 'No matching exercise photos are available for this muscle yet. Select another muscle to continue exploring.';
    } else {
      $('.exercise-filters').hidden = false;
      renderResults();
    }
  }

  async function load() {
    if (catalog || request || disposed) return;
    const controller = new AbortController();
    request = controller;
    error = false;
    render();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const [data, media] = await Promise.all([loadExerciseCatalog({signal: controller.signal}), loadExerciseMedia({signal: controller.signal})]);
      if (!disposed) catalog = bindExerciseMedia(data, media);
    } catch { if (!disposed) error = true; }
    finally {
      clearTimeout(timeout);
      request = null;
      if (!disposed) render();
    }
  }

  function closeDialog() {
    const dialog = $('#exercise-dialog');
    if (dialog.open) dialog.close();
  }

  function openExercise(id, button) {
    const exercise = catalog?.exercises.find(entry => entry.id === id);
    if (!exercise) return;
    opener = button;
    activeExercise = exercise;
    const match = getExercisesForMuscle(catalog, muscle).find(entry => entry.id === id)?.match;
    const secondary = exercise.secondaryMuscles.length ? `<div><dt>Supporting muscles</dt><dd>${escape(exercise.secondaryMuscles.join(', '))}</dd></div>` : '';
    $('.exercise-dialog-content').innerHTML = `<p class="eyebrow">MOVEMENT LIBRARY</p><h2 id="exercise-dialog-title">${escape(titleCase(exercise.name))}</h2><p class="exercise-dialog-match"><span class="exercise-role ${match}">${match === 'primary' ? 'Primary target' : 'Supporting muscle'}</span> <span>for ${escape(muscleGroups[muscle].name.toLowerCase())}</span></p><div class="exercise-gallery"><img id="exercise-gallery-photo" class="exercise-gallery-image" data-exercise-image src="${escape(assetUrl(exercise.media.images[0]))}" alt="${escape(titleCase(exercise.name))}, view 1 of ${exercise.media.images.length}" width="640" height="480"><div class="exercise-media-error" hidden role="status"><span>Photo could not load.</span><button type="button" data-exercise-action="retry-image" data-image-target="exercise-gallery-photo">Retry image</button></div></div><div class="exercise-image-picker" role="group" aria-label="Movement views">${exercise.media.images.map((url, index) => `<button type="button" data-image-index="${index}" aria-pressed="${index === 0}" aria-label="Show view ${index + 1}"><img data-exercise-thumbnail src="${escape(assetUrl(url))}" alt="" width="64" height="48"><span>View ${index + 1}</span></button>`).join('')}</div><details class="exercise-instructions-details"><summary>Instructions &amp; muscle details</summary><dl class="exercise-facts"><div><dt>Equipment</dt><dd>${escape(titleCase(exercise.equipment))}</dd></div><div><dt>Primary target</dt><dd>${escape(titleCase(exercise.target))}</dd></div>${secondary}</dl><h3>How to perform</h3><ol class="exercise-steps">${exercise.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol></details><p class="exercise-dialog-credit">Photos: <a href="${escape(EXERCISE_MEDIA_SOURCE.url)}" target="_blank" rel="noreferrer">Free Exercise DB</a> · <a href="${escape(EXERCISE_MEDIA_SOURCE.licenseUrl)}" target="_blank" rel="noreferrer">Public domain</a><br>Instructions from <a href="${escape(EXERCISE_SOURCE.url)}" target="_blank" rel="noreferrer">Exercises Dataset</a>.</p>`;
    $('#exercise-dialog').showModal();
    $('#exercise-dialog').scrollTop = 0;
  }

  listen($('#exercise-search'), 'input', event => { filters.query = event.target.value; limit = pageSize; renderResults(); });
  for (const [id, key] of [['exercise-equipment', 'equipment'], ['exercise-relationship', 'relationship']]) {
    listen($(`#${id}`), 'change', event => { filters[key] = event.target.value; limit = pageSize; renderResults(); });
  }
  listen(root, 'click', event => {
    const card = event.target.closest('[data-exercise-id]');
    if (card) { openExercise(card.dataset.exerciseId, card); return; }
    const imageView = event.target.closest('[data-image-index]');
    if (imageView && activeExercise) {
      const index = Number(imageView.dataset.imageIndex);
      const image = $('.exercise-gallery-image');
      image.classList.remove('is-failed');
      $('.exercise-gallery .exercise-media-error').hidden = true;
      image.src = assetUrl(activeExercise.media.images[index]);
      image.alt = `${titleCase(activeExercise.name)}, view ${index + 1} of ${activeExercise.media.images.length}`;
      root.querySelectorAll('[data-image-index]').forEach(button => button.setAttribute('aria-pressed', String(button === imageView)));
    }
    const actionButton = event.target.closest('[data-exercise-action]');
    const action = actionButton?.dataset.exerciseAction;
    if (action === 'retry-image') {
      const image = $(`#${actionButton.dataset.imageTarget}`);
      if (image) {
        const control = image.closest('.exercise-card')?.querySelector('[data-exercise-id]') || $('[data-image-index][aria-pressed="true"]');
        control?.focus({preventScroll: true});
        image.classList.remove('is-failed');
        actionButton.closest('.exercise-media-error').hidden = true;
        const source = `${image.getAttribute('src').split('?')[0]}?retry=${Date.now()}`;
        image.src = source;
        if (image.matches('.exercise-gallery-image')) {
          const thumbnail = $('[data-image-index][aria-pressed="true"] img');
          thumbnail.hidden = false;
          thumbnail.src = source;
        }
      }
    }
    if (action === 'retry') load();
    if (action === 'more') { limit += pageSize; renderResults({focusNext: true}); }
    if (action === 'reset') { filters = {query: '', equipment: 'all', relationship: 'all'}; limit = pageSize; render(); $('#exercise-search').focus(); }
    if (event.target.closest('.exercise-dialog-close')) closeDialog();
  });
  root.addEventListener('error', event => {
    const image = event.target;
    if (image.matches?.('[data-exercise-thumbnail]')) { image.hidden = true; return; }
    if (!image.matches?.('[data-exercise-image]')) return;
    image.classList.add('is-failed');
    const fallback = image.closest('.exercise-card, .exercise-gallery')?.querySelector('.exercise-media-error');
    if (fallback) fallback.hidden = false;
  }, {capture: true, signal: events.signal});
  listen($('#exercise-dialog'), 'close', () => { activeExercise = null; opener?.isConnected && opener.focus({preventScroll: true}); opener = null; });
  listen($('#exercise-dialog'), 'keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); closeDialog(); }
  });
  listen($('#exercise-dialog'), 'click', event => {
    if (event.target !== $('#exercise-dialog')) return;
    const rect = event.target.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog();
  });

  return {
    setMuscle(id) {
      if (id === muscle) return;
      closeDialog();
      muscle = muscleGroups[id] ? id : null;
      filters = {query: '', equipment: 'all', relationship: 'all'};
      limit = pageSize;
      render();
      if (muscle && !catalog) load();
    },
    focus() {
      root.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'});
      $('#exercises-title').setAttribute('tabindex', '-1');
      $('#exercises-title').focus({preventScroll: true});
    },
    dispose() { disposed = true; request?.abort(); closeDialog(); events.abort(); },
  };
}
