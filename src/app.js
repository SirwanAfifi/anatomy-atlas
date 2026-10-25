import {muscleGroups} from './anatomy.js';
import {createAnatomyViewer} from './viewer.js';
import {createExerciseBrowser} from './exercise-browser.js';

const $ = (query, root = document) => root.querySelector(query);
const $$ = (query, root = document) => [...root.querySelectorAll(query)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const preferencesKey = 'anatomy-atlas:preferences';
let preferences = {};
try { preferences = JSON.parse(localStorage.getItem(preferencesKey)) || {}; } catch {}
const state = {
  theme: preferences.theme === 'dark' ? 'dark' : 'light',
  detail: preferences.detail !== false,
  joints: preferences.joints === true,
  labels: preferences.labels === true,
  area: 'full', selection: null, query: '',
};
const areaNames = {full: 'Full body', upper: 'Upper body', lower: 'Lower body'};
const sideNames = {left: 'Left', right: 'Right', midline: 'Midline'};
let regions = [];
let manifest = null;
let viewer = null;
let loadToken = 0;
let manifestRequest = null;
let exerciseBrowser = null;

const iconPaths = {
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5M16.5 12a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0',
  moon: 'M20.8 13.5A9 9 0 0 1 10.5 3.2 9 9 0 1 0 20.8 13.5Z',
  search: 'M21 21l-5.3-5.3M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0',
  close: 'M6 6l12 12M18 6 6 18',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  focus: 'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  rotate: 'M3 10a9 9 0 1 1 2 8M3 4v6h6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  cube: 'm12 3 9 5v9l-9 5-9-5V8l9-5Zm0 10 9-5M12 13 3 8m9 5v9m-4.5-17.5 9 5',
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" class="icon" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${iconPaths[name] || iconPaths.focus}"/></svg>`;
}
function savePreferences() {
  try { localStorage.setItem(preferencesKey, JSON.stringify({theme: state.theme, detail: state.detail, joints: state.joints, labels: state.labels})); } catch {}
}
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  $('meta[name="theme-color"]')?.setAttribute('content', state.theme === 'dark' ? '#17211f' : '#f5f4f0');
  viewer?.setTheme(state.theme);
}
function control(name, label) {
  return `<button class="display-toggle ${state[name] ? 'active' : ''}" type="button" data-toggle="${name}" aria-pressed="${state[name]}"><span class="toggle-dot" aria-hidden="true"></span>${label}</button>`;
}
function shell() {
  return `<header class="site-header">
    <a class="brand" href="/" aria-label="Anatomy Atlas home"><span class="brand-icon" aria-hidden="true"><svg viewBox="0 0 32 40"><path d="M16 3v34M11 8c-7 3-9 10-5 15m15-15c7 3 9 10 5 15M7 15l9 6 9-6M9 28l7-4 7 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="5" r="3" fill="currentColor"/></svg></span><span>Anatomy <b>Atlas</b><small>HUMAN MUSCULATURE</small></span></a>
    <p class="header-caption">A closer look at the human body.</p>
    <button class="theme-button icon-button" type="button" data-action="theme" aria-label="Switch to ${state.theme === 'light' ? 'dark' : 'light'} mode">${icon(state.theme === 'light' ? 'moon' : 'sun')}</button>
  </header>
  <main class="atlas-workspace">
    <div class="atlas-column"><section class="atlas-panel" aria-labelledby="atlas-title">
      <div class="atlas-heading"><div><p class="eyebrow">INTERACTIVE ANATOMY</p><h1 id="atlas-title">A new perspective.</h1><p class="intro-copy">Turn the body. Discover the muscles. Explore every angle.</p></div><span class="atlas-edition">${icon('cube')} 3D ATLAS</span></div>
      <div class="atlas-toolbar">
        <div class="anatomy-area-picker" role="group" aria-label="Anatomy area">${Object.entries(areaNames).map(([key, label]) => `<button type="button" data-area-button="${key}" class="${state.area === key ? 'active' : ''}" aria-pressed="${state.area === key}">${label}</button>`).join('')}</div>
        <div class="display-controls" role="group" aria-label="Anatomy display">${control('detail', 'Fibres')}${control('labels', 'Labels')}${control('joints', 'Joints')}</div>
      </div>
      <div class="body-stage" aria-busy="true">
        <div class="viewer-mount"></div>
        <div class="viewport-meta" aria-hidden="true"><span class="viewport-kicker">THE MUSCULAR SYSTEM</span><span class="viewport-model">Male anatomy <span>·</span> <span id="structure-count">3D</span></span></div>
        <div class="viewport-orbit-hint" aria-hidden="true">${icon('rotate')}<span>360°</span></div>
        <div class="camera-tools" role="group" aria-label="Camera zoom and reset"><button type="button" data-action="zoom-in" aria-label="Zoom in" title="Zoom in (+)">${icon('plus')}</button><button type="button" data-action="zoom-out" aria-label="Zoom out" title="Zoom out (−)">${icon('minus')}</button><span></span><button type="button" data-action="reset-view" aria-label="Reset camera" title="Reset camera (Home)">${icon('focus')}</button></div>
        <div class="camera-presets" role="group" aria-label="Camera direction">${['front', 'back', 'left', 'right'].map(view => `<button type="button" data-camera-view="${view}" aria-label="View from ${view}">${view[0].toUpperCase() + view.slice(1)}</button>`).join('')}</div>
        <div class="map-loading" role="status"><div class="loading-symbol">${icon('cube')}</div><b>Preparing your perspective</b><span id="loading-message">Loading anatomical structures…</span><progress id="model-progress" max="100" aria-label="Loading 3D anatomy"></progress></div>
        <div class="map-error" role="status" hidden><span class="error-icon">${icon('cube')}</span><h2>Unable to open the 3D view</h2><p id="viewer-error-message"></p><button type="button" data-action="retry">Try again</button></div>
        <div class="map-tooltip" id="map-tooltip" aria-hidden="true"></div>
      </div>
      <div class="canvas-caption"><span><i class="legend-swatch"></i> Click a muscle to explore</span><span class="navigation-hint">Drag to rotate <i>·</i> Scroll to zoom</span><span class="keyboard-hint"><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> to rotate</span></div>
      <p id="viewport-instructions" class="sr-only">Drag to rotate. Scroll or pinch to zoom. With the canvas focused, use arrow keys to rotate, plus and minus to zoom, and Home to reset. Use the muscle browser to select anatomy with the keyboard. Escape clears the selection.</p>
    </section><section id="exercise-panel" class="exercise-panel" aria-labelledby="exercises-title"></section></div>
    <aside class="explorer-panel" aria-label="Muscle explorer"><section class="selection-card" id="selection-card" aria-live="polite" aria-atomic="true" tabindex="-1"></section><section class="muscle-browser" aria-labelledby="muscles-title"><div class="browser-heading"><h2 id="muscles-title">Muscle groups</h2><span class="count-badge">${Object.keys(muscleGroups).length}</span></div><label class="muscle-search">${icon('search')}<input type="search" id="muscle-search" placeholder="Find a muscle" aria-label="Find a muscle group" autocomplete="off"></label><div class="muscle-list" id="muscle-list"></div><p class="list-empty" hidden>No matching muscles.</p></section></aside>
  </main>
  <div class="mobile-selection" id="mobile-selection" hidden aria-live="polite"></div>
  <footer class="site-footer"><span>Anatomy Atlas <span class="footer-separator">/</span> A study in human movement</span><span>Model: <a href="https://github.com/Z-Anatomy/Models-of-human-anatomy" target="_blank" rel="noreferrer">Z-Anatomy</a> &amp; BodyParts3D <span class="footer-separator">·</span> <a href="/assets/anatomy/NOTICE.txt" target="_blank" rel="noreferrer">Credits &amp; licence</a></span></footer>`;
}

function matchingRegions() {
  const query = state.query.trim().toLowerCase();
  if (!query) return null;
  return new Set(regions.filter(region => {
    const group = muscleGroups[region.muscle];
    return `${group.name} ${group.area} ${group.latin} ${region.label} ${region.latin || ''}`.toLowerCase().includes(query);
  }).map(region => region.id));
}
function applyDisplay() { viewer?.setDisplayOptions({detail: state.detail, labels: state.labels, joints: state.joints}); }
function applySearch() { viewer?.setSearchMatches(matchingRegions()); }
function applySelection() { viewer?.setSelection(state.selection); }
function updateArea() {
  $$('[data-area-button]').forEach(button => {
    const active = button.dataset.areaButton === state.area;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
function selectRegion(entry, {focus = false, group = false} = {}) {
  state.selection = {...entry, groupSelection: group};
  clearHover();
  updateSelection(); applySelection(); renderMuscleList();
  if (focus) {
    state.area = 'full'; updateArea();
    viewer?.focusRegion(entry.id, {group});
  }
}
function selectMuscle(muscle) {
  const entry = regions.find(region => region.muscle === muscle && region.side === state.selection?.side)
    || regions.find(region => region.muscle === muscle);
  selectRegion(entry || {id: null, muscle, label: muscleGroups[muscle].name, side: 'midline'}, {focus: true, group: true});
}
function clearSelection() {
  state.selection = null;
  updateSelection(); applySelection(); renderMuscleList(); clearHover();
}
function preserveControlFocus(root) {
  const active = document.activeElement;
  if (!root.contains(active)) return () => {};
  const keys = ['muscleButton', 'structure', 'group', 'sideButton', 'action'];
  const identity = keys.filter(key => active.dataset[key] !== undefined).map(key => [key, active.dataset[key]]);
  return () => {
    const replacement = identity.length && $$('button', root).find(button => identity.every(([key, value]) => button.dataset[key] === value));
    const fallback = root.id === 'selection-card' ? $('.muscle-list-item.active') || root : root;
    (replacement || fallback).focus({preventScroll: true});
  };
}
function updateSelection() {
  const target = $('#selection-card');
  const restoreFocus = preserveControlFocus(target);
  const entry = state.selection;
  exerciseBrowser?.setMuscle(entry?.muscle || null);
  const mobile = $('#mobile-selection');
  mobile.hidden = !entry;
  mobile.innerHTML = entry ? `<div><b>${escape(entry.groupSelection ? muscleGroups[entry.muscle].name : entry.label)}</b><span>${entry.groupSelection ? 'Muscle group' : `${sideNames[entry.side]} · ${muscleGroups[entry.muscle].area}`}</span></div><button type="button" data-action="inspect">Inspect ${icon('arrow')}</button><button type="button" class="mobile-clear" data-action="clear" aria-label="Clear region">${icon('close')}</button>` : '';
  target.classList.toggle('is-empty', !entry);
  if (!entry) {
    target.innerHTML = `<p class="eyebrow">REGION INSPECTOR</p><div class="selection-empty-icon">${icon('focus')}</div><h2>Follow your curiosity.</h2><p>Rotate the body and select a muscle to see what lies beneath the movement.</p><div class="selection-guide"><span class="guide-line"></span> Or choose a muscle group below</div>`;
    restoreFocus();
    return;
  }
  const group = muscleGroups[entry.muscle];
  const structures = [...new Map(regions.filter(region => region.muscle === entry.muscle).map(region => [region.label, region])).values()];
  const sides = ['left', 'right'].filter(side => regions.some(region => region.muscle === entry.muscle && region.side === side));
  const sidePicker = sides.length > 1 ? `<div class="side-picker" role="group" aria-label="Select anatomical side">${sides.map(side => `<button type="button" data-side-button="${side}" aria-label="Select ${side} side" aria-pressed="${!entry.groupSelection && entry.side === side}">${sideNames[side]} side</button>`).join('')}</div>` : '';
  target.innerHTML = `<div class="selection-heading"><p class="eyebrow">SELECTED ${entry.groupSelection ? 'GROUP' : 'REGION'}</p><button type="button" class="icon-button clear-selection" data-action="clear" aria-label="Clear selection">${icon('close')}</button></div><span class="selection-indicator"><i></i>${escape(group.area)}</span><h2>${escape(entry.groupSelection ? group.name : entry.label)}</h2><p class="anatomical-name">${escape(entry.latin || group.latin)}</p><dl class="region-facts"><div><dt>Muscle group</dt><dd>${escape(group.name)}</dd></div><div><dt>Anatomical side</dt><dd>${entry.groupSelection ? 'Both sides' : sideNames[entry.side]}</dd></div><div><dt>Body model</dt><dd>Male</dd></div></dl>${sidePicker}<div class="structure-list"><h3>Structures in this group <span>${structures.length}</span></h3>${structures.map(region => `<button type="button" class="structure-item ${region.label === entry.label && !entry.groupSelection ? 'active' : ''}" data-structure="${escape(region.label)}" data-group="${entry.muscle}" aria-pressed="${region.label === entry.label && !entry.groupSelection}"><i></i>${escape(region.label)}</button>`).join('')}</div>`;
  target.insertAdjacentHTML('beforeend', `<button type="button" class="explore-exercises" data-action="exercises">Explore exercises ${icon('arrow')}</button>`);
  restoreFocus();
}
function renderMuscleList() {
  const restoreFocus = preserveControlFocus($('#muscle-list'));
  const query = state.query.trim().toLowerCase();
  const matches = matchingRegions();
  const entries = Object.entries(muscleGroups).filter(([key, group]) => `${group.name} ${group.area} ${group.latin}`.toLowerCase().includes(query) || regions.some(region => region.muscle === key && matches?.has(region.id)));
  $('#muscle-list').innerHTML = entries.map(([key, group]) => `<button type="button" class="muscle-list-item ${state.selection?.muscle === key ? 'active' : ''}" data-muscle-button="${key}" aria-pressed="${state.selection?.muscle === key}"><span><b>${escape(group.name)}</b><small>${escape(group.area)}</small></span>${icon('arrow')}</button>`).join('');
  $('.list-empty').hidden = entries.length > 0;
  restoreFocus();
}
function hoverRegion(entry, pointer) {
  const tooltip = $('#map-tooltip');
  if (!entry || !pointer) { clearHover(); return; }
  tooltip.innerHTML = `<b>${escape(entry.label)}</b><span>${sideNames[entry.side]} · ${escape(muscleGroups[entry.muscle].name)}</span>`;
  tooltip.classList.add('visible');
  const box = $('.body-stage').getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(pointer.clientX - box.left + 14, box.width - tooltip.offsetWidth - 8))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(pointer.clientY - box.top - tooltip.offsetHeight - 14, box.height - tooltip.offsetHeight - 8))}px`;
}
function clearHover() { $('#map-tooltip')?.classList.remove('visible'); }
function loadingProgress(progress) {
  const value = $('#model-progress');
  if (Number.isFinite(progress)) {
    value.value = Math.round(Math.max(0, Math.min(1, progress)) * 100);
    $('#loading-message').textContent = progress >= 1 ? 'Preparing materials and lighting…' : `Loading 3D anatomy · ${value.value}%`;
  } else {
    value.removeAttribute('value');
    $('#loading-message').textContent = 'Loading anatomical structures…';
  }
}
function showError(error) {
  $('.body-stage').setAttribute('aria-busy', 'false');
  $('.body-stage').classList.remove('is-ready');
  $('.map-loading').hidden = true;
  $('.map-error').hidden = false;
  $('#viewer-error-message').textContent = /webgl|context|gpu/i.test(error?.message || '')
    ? 'This browser could not start WebGL 2. Enable hardware acceleration or try another browser. You can still explore the muscle list.'
    : 'The anatomical model could not load. Check your connection and try again. The muscle list remains available.';
  console.error('Anatomy viewer:', error);
}
async function loadViewer() {
  const token = ++loadToken;
  manifestRequest?.abort();
  viewer?.dispose(); viewer = null;
  clearHover();
  $('.body-stage').setAttribute('aria-busy', 'true');
  $('.body-stage').classList.remove('is-ready');
  $('.map-error').hidden = true;
  $('.map-loading').hidden = false;
  loadingProgress(null);
  try {
    if (!manifest) {
      const request = new AbortController();
      manifestRequest = request;
      const timeout = setTimeout(() => request.abort(), 30000);
      try {
        const response = await fetch('/assets/anatomy/manifest.json', {signal: request.signal});
        if (!response.ok) throw new Error(`Anatomy metadata unavailable (${response.status})`);
        const data = await response.json();
        if (!data.model?.url || !Array.isArray(data.regions) || !data.regions.length || data.regions.some(region => !muscleGroups[region.muscle])) throw new Error('Invalid anatomy metadata');
        if (token !== loadToken) return;
        manifest = data;
      } finally { clearTimeout(timeout); }
    }
    if (token !== loadToken) return;
    regions = manifest.regions;
    if (state.selection && !regions.some(region => region.id === state.selection.id)) {
      const entry = regions.find(region => region.muscle === state.selection.muscle);
      state.selection = entry ? {...entry, groupSelection: true} : null;
    }
    $('#structure-count').textContent = `${regions.length} structures`;
    renderMuscleList(); updateSelection();
    viewer = createAnatomyViewer({
      container: $('.viewer-mount'), manifest,
      onSelect: entry => selectRegion(entry),
      onHover: hoverRegion,
      onProgress: progress => { if (token === loadToken) loadingProgress(progress); },
      onError: error => { if (token === loadToken) showError(error); },
      onReady: () => {
        if (token !== loadToken) return;
        $('.map-loading').hidden = true;
        $('.map-error').hidden = true;
        $('.body-stage').setAttribute('aria-busy', 'false');
        $('.body-stage').classList.add('is-ready');
      },
    });
    applyTheme(); applyDisplay(); applySelection(); applySearch();
    await viewer.ready;
    if (token !== loadToken) return;
    $('.anatomy-canvas')?.setAttribute('aria-describedby', 'viewport-instructions');
    $('.map-loading').hidden = true;
    $('.map-error').hidden = true;
    $('.body-stage').setAttribute('aria-busy', 'false');
    $('.body-stage').classList.add('is-ready');
    if (state.selection) viewer.focusRegion(state.selection.id, {group: state.selection.groupSelection});
    else if (state.area !== 'full') viewer.frame(state.area);
  } catch (error) { if (token === loadToken) showError(error); }
}

applyTheme();
$('#app').innerHTML = shell();
exerciseBrowser = createExerciseBrowser($('#exercise-panel'));
updateSelection(); renderMuscleList();
$('#muscle-search').addEventListener('input', event => { state.query = event.target.value; renderMuscleList(); applySearch(); });
document.addEventListener('click', event => {
  const toggle = event.target.closest('[data-toggle]');
  if (toggle) {
    const key = toggle.dataset.toggle;
    state[key] = !state[key];
    toggle.classList.toggle('active', state[key]); toggle.setAttribute('aria-pressed', String(state[key]));
    savePreferences(); applyDisplay(); return;
  }
  const area = event.target.closest('[data-area-button]');
  if (area) { state.area = area.dataset.areaButton; clearHover(); updateArea(); viewer?.frame(state.area); return; }
  const camera = event.target.closest('[data-camera-view]');
  if (camera) { clearHover(); viewer?.setView(camera.dataset.cameraView); return; }
  const muscle = event.target.closest('[data-muscle-button]');
  if (muscle) { selectMuscle(muscle.dataset.muscleButton); return; }
  const side = event.target.closest('[data-side-button]');
  if (side && state.selection) {
    const entries = regions.filter(region => region.muscle === state.selection.muscle && region.side === side.dataset.sideButton);
    const entry = entries.find(region => region.label === state.selection.label) || entries[0];
    if (entry) selectRegion(entry, {focus: true});
    return;
  }
  const structure = event.target.closest('[data-structure]');
  if (structure) {
    const entries = regions.filter(region => region.muscle === structure.dataset.group && region.label === structure.dataset.structure);
    const entry = entries.find(region => region.side === state.selection?.side) || entries[0];
    if (entry) selectRegion(entry, {focus: true});
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'clear') clearSelection();
  if (action === 'exercises') exerciseBrowser.focus();
  if (action === 'inspect') {
    $('#selection-card').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'});
    $('#selection-card').focus({preventScroll: true});
  }
  if (action === 'retry') loadViewer();
  if (action === 'zoom-in') viewer?.zoom(0.8);
  if (action === 'zoom-out') viewer?.zoom(1.25);
  if (action === 'reset-view') { state.area = 'full'; updateArea(); viewer?.setView('home'); }
  if (action === 'theme') {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    applyTheme(); savePreferences();
    const button = $('.theme-button');
    button.innerHTML = icon(state.theme === 'light' ? 'moon' : 'sun');
    button.setAttribute('aria-label', `Switch to ${state.theme === 'light' ? 'dark' : 'light'} mode`);
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') clearSelection();
  if (event.key === 'Home' && event.target.matches('.anatomy-canvas')) { state.area = 'full'; updateArea(); }
});
window.addEventListener('pagehide', () => { loadToken++; manifestRequest?.abort(); viewer?.dispose(); viewer = null; exerciseBrowser?.dispose(); });
window.addEventListener('pageshow', event => { if (event.persisted) { exerciseBrowser = createExerciseBrowser($('#exercise-panel')); exerciseBrowser.setMuscle(state.selection?.muscle || null); loadViewer(); } });
Object.defineProperty(window, '__atlasDiagnostics', {get: () => ({...viewer?.getDiagnostics(), regionCount: regions.length, selection: state.selection?.id || null, groupSelection: state.selection?.groupSelection || false, area: state.area, theme: state.theme})});
Object.defineProperty(window, '__atlasProjectRegion', {value: id => viewer?.projectRegion(id) || null});
loadViewer();
