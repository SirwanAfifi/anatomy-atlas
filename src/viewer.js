import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { assetUrl } from './asset-url.js';

const PALETTE = {
  light: { background: '#f5f4ee', selected: '#68b59a', related: '#8dbca7', hover: '#ddbe8c', shadow: 0.065, contact: 0.22 },
  dark: { background: '#19221e', selected: '#8cd1af', related: '#81bba1', hover: '#e3c695', shadow: 0.16, contact: 0.4 },
};
const HOME_DIRECTION = new THREE.Vector3(0.24, 0.035, 1).normalize();
const CARDINALS = {
  front: new THREE.Vector3(0, 0.015, 1),
  back: new THREE.Vector3(0, 0.015, -1),
  left: new THREE.Vector3(1, 0.015, 0),
  right: new THREE.Vector3(-1, 0.015, 0),
};
const cameraDirections = new Set(['front', 'back', 'left', 'right', 'home']);

/**
 * Owns one WebGL context. All application state can be supplied before `ready`.
 * The GLB and manifest share a Y-up, two-metre-tall coordinate space, facing +Z.
 */
export function createAnatomyViewer({
  container, manifest, onSelect = () => {}, onHover = () => {},
  onProgress = () => {}, onError = () => {}, onReady = () => {},
}) {
  const regionById = new Map(manifest.regions.map(region => [region.id, region]));
  const regionByMeshName = new Map();
  for (const region of manifest.regions) {
    for (const name of region.meshNames) regionByMeshName.set(name, region);
  }
  const regionMeshes = new Map();
  const regionBounds = new Map();
  const appearance = [];
  const modelMeshes = [];
  const ownedGeometries = new Set();
  const ownedMaterials = new Set();
  const ownedTextures = new Set();
  const cleanup = [];
  const labels = [];
  const activePointers = new Map();
  const intervals = [];
  const durations = [];
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;
  const pointer = new THREE.Vector2();
  const projection = new THREE.Vector3();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const scene = new THREE.Scene();
  const annotationScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.015, 30);
  const modelBounds = new THREE.Box3(new THREE.Vector3(-0.65, 0, -0.22), new THREE.Vector3(0.65, 2, 0.22));
  const jointsGroup = new THREE.Group();
  jointsGroup.name = 'Joint landmarks';
  annotationScene.add(jointsGroup);

  let renderer, controls, composer, gtao, environmentTarget, resizeObserver;
  let model, shadow, contactShadow, keyLight, labelLayer;
  let loaded = false, disposed = false, contextLost = false;
  let selection = null, searchMatches = null, theme = 'light';
  let display = { detail: true, labels: false, joints: false };
  let framing = 'full', hoverId = null, lastHover = null;
  let pendingPointer = null, multiTouch = false, tween = null;
  let frameHandle = 0, lastFrameTime = 0, lastAdaptation = 0, loadedAt = 0;
  let width = 1, height = 1, quality = 0, frames = 0, drawCalls = 0, triangles = 0;
  let inspectionReady = true, inspectionTimer = 0;
  let restoring = false;
  let previousFrameChained = false;
  let fittedBounds = modelBounds.clone(), fittedPadding = 1.2;

  const listen = (target, type, callback, options) => {
    target.addEventListener(type, callback, options);
    cleanup.push(() => target.removeEventListener(type, callback, options));
  };
  const invalidate = () => {
    if (!disposed && renderer && !contextLost && !document.hidden && !frameHandle) {
      frameHandle = requestAnimationFrame(renderFrame);
    }
  };
  const reportError = error => {
    if (!disposed) onError(error instanceof Error ? error : new Error(String(error)));
  };

  function rememberMaterial(material) {
    ownedMaterials.add(material);
    for (const value of Object.values(material)) if (value?.isTexture) ownedTextures.add(value);
  }

  function setTheme(nextTheme) {
    theme = nextTheme === 'dark' ? 'dark' : 'light';
    const palette = PALETTE[theme];
    // Let the app's warm/cool stage gradient show through. A solid background
    // rendered through the tone mapper would turn the intended off-white gray.
    scene.background = null;
    renderer?.setClearColor(0x000000, 0);
    if (shadow) shadow.material.opacity = palette.shadow;
    if (contactShadow) contactShadow.material.opacity = palette.contact;
    if (labelLayer) labelLayer.dataset.theme = theme;
    updateAppearance();
    invalidate();
  }

  function setSelection(nextSelection) {
    selection = nextSelection && regionById.has(nextSelection.id) ? { ...nextSelection } : null;
    updateAppearance();
    updateLabelCandidates();
    invalidate();
  }

  function setSearchMatches(matches) {
    searchMatches = matches == null ? null : new Set(matches);
    updateAppearance();
    updateLabelCandidates();
    invalidate();
  }

  function setDisplayOptions(options) {
    display = { ...display, ...options };
    jointsGroup.visible = display.joints;
    if (labelLayer) labelLayer.hidden = !display.labels;
    updateAppearance();
    updateLabelCandidates();
    invalidate();
  }

  function updateAppearance() {
    const palette = PALETTE[theme];
    const selectedColor = new THREE.Color(palette.selected);
    const relatedColor = new THREE.Color(palette.related);
    const hoveredColor = new THREE.Color(palette.hover);
    for (const entry of appearance) {
      const { material, region, color, emissive, emissiveIntensity, normalScale, bumpScale, roughness, fibreRoughnessMap } = entry;
      const exact = region && selection?.id === region.id && !selection.groupSelection;
      const related = region && region.muscle === selection?.muscle;
      const hovered = region?.id === hoverId;
      const dimmed = region && searchMatches && !searchMatches.has(region.id);
      material.color?.copy(color);
      material.emissive?.copy(emissive);
      if ('emissiveIntensity' in material) material.emissiveIntensity = emissiveIntensity;
      if (exact) material.color?.lerp(selectedColor, 0.72);
      else if (hovered) material.color?.lerp(hoveredColor, 0.42);
      else if (related) material.color?.lerp(relatedColor, selection.groupSelection ? 0.5 : 0.24);
      if (dimmed && !exact && !related && !hovered) material.color?.multiplyScalar(0.38);
      if (exact && material.emissive) {
        material.emissive.copy(selectedColor);
        material.emissiveIntensity = 0.045;
      }
      if (normalScale && material.normalScale) material.normalScale.copy(normalScale).multiplyScalar(display.detail ? 1 : 0);
      if ('bumpScale' in material) material.bumpScale = display.detail ? bumpScale : 0;
      if (fibreRoughnessMap) {
        const nextMap = display.detail ? fibreRoughnessMap : null;
        if (material.roughnessMap !== nextMap) {
          material.roughnessMap = nextMap;
          material.needsUpdate = true;
        }
        // The authored map varies around .55. Keep that same finish when the
        // directional fibre texture is disabled, instead of making tissue chalky.
        material.roughness = display.detail ? roughness : roughness * 0.55;
      } else if ('roughness' in material) material.roughness = roughness;
    }
  }

  function fitDistance(bounds, padding = 1.2) {
    const size = bounds.getSize(new THREE.Vector3());
    const halfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
    // Reserve a little space for the stage's camera controls and body landmarks.
    const availableAspect = Math.max(0.25, width / Math.max(1, height - 56));
    return Math.max(size.y / (2 * Math.tan(halfFov)), size.x / (2 * Math.tan(halfFov) * availableAspect)) * padding + size.z * 0.5;
  }

  function areaBounds(area) {
    const bounds = modelBounds.clone();
    const bodyHeight = bounds.max.y - bounds.min.y;
    if (area === 'upper') bounds.min.y += bodyHeight * 0.36;
    if (area === 'lower') {
      bounds.max.y = bounds.min.y + bodyHeight * 0.56;
      bounds.min.x = Math.max(bounds.min.x, -0.38);
      bounds.max.x = Math.min(bounds.max.x, 0.38);
    }
    return bounds;
  }

  function cancelTween() {
    tween = null;
    if (controls) controls.enableDamping = !reducedMotion.matches;
  }

  function moveCamera(target, direction, distance, immediate = false) {
    if (!controls) return;
    cancelTween();
    if (loaded && !immediate && !reducedMotion.matches) beginMotion();
    const targetTo = target.clone();
    const destination = targetTo.clone().addScaledVector(direction.clone().normalize(), THREE.MathUtils.clamp(distance, controls.minDistance, controls.maxDistance));
    // Flush residual orbit inertia before an authored camera move.
    controls.enableDamping = false;
    controls.update();
    if (immediate || reducedMotion.matches || !loaded) {
      camera.position.copy(destination);
      controls.target.copy(targetTo);
      controls.update();
      controls.enableDamping = !reducedMotion.matches;
    } else {
      const orbitFrom = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      const orbitTo = new THREE.Spherical().setFromVector3(destination.clone().sub(targetTo));
      const thetaDelta = Math.atan2(Math.sin(orbitTo.theta - orbitFrom.theta), Math.cos(orbitTo.theta - orbitFrom.theta));
      tween = { start: performance.now(), to: destination, orbitFrom, orbitTo, thetaDelta, targetFrom: controls.target.clone(), targetTo };
    }
    clearHover();
    invalidate();
  }

  function frame(area = 'full') {
    framing = ['full', 'upper', 'lower'].includes(area) ? area : 'full';
    if (!controls) return;
    const bounds = areaBounds(framing);
    fittedBounds.copy(bounds);
    fittedPadding = 1.2;
    const center = bounds.getCenter(new THREE.Vector3());
    const direction = camera.position.clone().sub(controls.target).normalize();
    moveCamera(center, direction.lengthSq() ? direction : HOME_DIRECTION, fitDistance(bounds));
  }

  function focusRegion(id, { group = false } = {}) {
    const region = regionById.get(id);
    if (!region || !loaded) return;
    const bounds = new THREE.Box3();
    const members = group ? manifest.regions.filter(item => item.muscle === region.muscle) : [region];
    for (const item of members) {
      const box = regionBounds.get(item.id);
      if (box) bounds.union(box);
    }
    if (bounds.isEmpty()) return;
    fittedBounds.copy(bounds);
    fittedPadding = 1.65;
    const target = bounds.getCenter(new THREE.Vector3());
    const direction = new THREE.Vector3(...(region.focus?.direction || [0, 0.03, 1]));
    // Maintain enough surrounding anatomy to understand a small structure.
    const distance = Math.max(0.85, fitDistance(bounds, 1.65));
    moveCamera(target, direction, distance);
  }

  function setView(view) {
    if (!cameraDirections.has(view) || !controls) return;
    if (view === 'home') {
      framing = 'full';
      const bounds = areaBounds('full');
      fittedBounds.copy(bounds);
      fittedPadding = 1.2;
      moveCamera(bounds.getCenter(new THREE.Vector3()), HOME_DIRECTION, fitDistance(bounds));
    } else {
      moveCamera(controls.target, CARDINALS[view], camera.position.distanceTo(controls.target));
    }
  }

  function zoom(factor) {
    if (!controls || !Number.isFinite(factor) || factor <= 0) return;
    const direction = camera.position.clone().sub(controls.target);
    moveCamera(controls.target, direction, direction.length() * THREE.MathUtils.clamp(factor, 0.5, 2));
  }

  function pick(clientX, clientY) {
    if (!loaded || !renderer) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    // Include the supporting skeleton: a nearer context mesh must occlude muscles.
    const first = raycaster.intersectObjects(modelMeshes, false)[0];
    return first?.object.userData.atlasRegion || null;
  }

  function clearHover() {
    pendingPointer = null;
    if (hoverId || lastHover) {
      hoverId = null;
      lastHover = null;
      onHover(null, {});
      updateAppearance();
      invalidate();
    }
  }

  function updateHover() {
    if (!pendingPointer || activePointers.size) return;
    const event = pendingPointer;
    pendingPointer = null;
    const region = pick(event.clientX, event.clientY);
    if (hoverId !== (region?.id || null)) {
      hoverId = region?.id || null;
      updateAppearance();
    }
    lastHover = region;
    renderer.domElement.style.cursor = region ? 'pointer' : 'grab';
    onHover(region, event);
  }

  function updateLabelCandidates() {
    if (!labelLayer) return;
    for (const label of labels) label.element.remove();
    labels.length = 0;
    if (!display.labels || !loaded) return;
    const candidates = selection
      ? manifest.regions.filter(region => region.muscle === selection.muscle)
      : manifest.regions.filter(region => !searchMatches || searchMatches.has(region.id));
    // One anchor per structure/group, with camera visibility resolved each frame.
    const seen = new Set();
    for (const region of candidates) {
      const key = selection ? `${region.label}:${region.side}` : `${region.muscle}:${region.side}`;
      if (seen.has(key) || !regionBounds.has(region.id)) continue;
      seen.add(key);
      const element = document.createElement('span');
      element.className = 'anatomy-label';
      element.textContent = region.label;
      element.setAttribute('aria-hidden', 'true');
      labelLayer.appendChild(element);
      labels.push({ region, element });
    }
  }

  function projectRegion(id) {
    const bounds = regionBounds.get(id);
    if (!bounds || !renderer) return null;
    const center = bounds.getCenter(new THREE.Vector3());
    projection.copy(center).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    const point = {
      x: rect.left + (projection.x + 1) * rect.width * 0.5,
      y: rect.top + (1 - projection.y) * rect.height * 0.5,
      visible: false,
    };
    if (projection.z > -1 && projection.z < 1 && Math.abs(projection.x) < 0.96 && Math.abs(projection.y) < 0.96) {
      point.visible = pick(point.x, point.y)?.id === id;
    }
    return point;
  }

  function updateLabels() {
    if (!display.labels || !loaded) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const occupied = [];
    let shown = 0;
    for (const { region, element } of labels) {
      element.hidden = true;
      if (shown >= (width < 550 ? 4 : 8)) continue;
      const point = projectRegion(region.id);
      if (!point?.visible) continue;
      const x = point.x - rect.left, y = point.y - rect.top;
      const labelWidth = Math.min(190, Math.max(85, region.label.length * 5.6));
      if (x < labelWidth / 2 + 8 || x > width - labelWidth / 2 - 8 || y < 30 || y > height - 90) continue;
      if (occupied.some(other => Math.abs(other.x - x) < (other.width + labelWidth) * 0.5 + 8 && Math.abs(other.y - y) < 34)) continue;
      element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
      element.hidden = false;
      occupied.push({ x, y, width: labelWidth });
      shown++;
    }
  }

  function configureResolution() {
    if (!renderer || disposed || contextLost) return;
    // Slow devices may lower resolution during a gesture, but inspection always
    // returns to full detail. Modest supersampling also cleans up non-Retina views.
    const nativeRatio = window.devicePixelRatio || 1;
    const cap = inspectionReady || quality < 2 ? 2 : quality === 2 ? 1.5 : 1;
    const pixelRatio = inspectionReady ? Math.min(2, Math.max(1.5, nativeRatio)) : Math.min(nativeRatio, cap);
    if (renderer.getPixelRatio() !== pixelRatio || renderer.domElement.width !== Math.floor(width * pixelRatio) || renderer.domElement.height !== Math.floor(height * pixelRatio)) {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
    }
    if (composer) {
      const {width: bufferWidth, height: bufferHeight} = renderer.domElement;
      // Size postprocessing explicitly in backing pixels, avoiding fractional
      // targets and a second device-pixel-ratio multiplication.
      if (composer.readBuffer.width !== bufferWidth || composer.readBuffer.height !== bufferHeight) composer.setSize(bufferWidth, bufferHeight);
      const aoScale = inspectionReady ? 1 : quality === 0 ? 0.75 : 0.5;
      const aoWidth = Math.max(1, Math.round(bufferWidth * aoScale));
      const aoHeight = Math.max(1, Math.round(bufferHeight * aoScale));
      if (gtao.width !== aoWidth || gtao.height !== aoHeight) gtao.setSize(aoWidth, aoHeight);
      gtao.enabled = inspectionReady || quality < 3;
    }
  }

  function beginMotion() {
    clearTimeout(inspectionTimer);
    inspectionTimer = 0;
    if (!inspectionReady) return;
    inspectionReady = false;
    configureResolution();
  }

  function scheduleInspection() {
    if (!loaded || inspectionReady || inspectionTimer || activePointers.size) return;
    inspectionTimer = setTimeout(() => {
      inspectionTimer = 0;
      if (disposed || contextLost || document.hidden || tween || activePointers.size) return;
      inspectionReady = true;
      previousFrameChained = false;
      configureResolution();
      invalidate();
    }, 180);
  }

  function resize() {
    if (!renderer || disposed) return;
    const previousFit = loaded && controls ? fitDistance(fittedBounds, fittedPadding) : 0;
    const bounds = container.getBoundingClientRect();
    width = Math.max(1, Math.round(bounds.width));
    height = Math.max(1, Math.round(bounds.height));
    configureResolution();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (previousFit) {
      const ratio = fitDistance(fittedBounds, fittedPadding) / previousFit;
      if (Math.abs(ratio - 1) > 0.01) {
        cancelTween();
        const offset = camera.position.clone().sub(controls.target).multiplyScalar(ratio);
        offset.clampLength(controls.minDistance, controls.maxDistance);
        camera.position.copy(controls.target).add(offset);
        controls.update();
      }
    }
    if (keyLight) keyLight.shadow.needsUpdate = true;
    invalidate();
  }

  function constrainPan() {
    const target = controls.target;
    const clamped = target.clone();
    clamped.x = THREE.MathUtils.clamp(clamped.x, -0.75, 0.75);
    clamped.y = THREE.MathUtils.clamp(clamped.y, 0.12, 1.95);
    clamped.z = THREE.MathUtils.clamp(clamped.z, -0.35, 0.35);
    const shift = clamped.sub(target);
    if (shift.lengthSq() > 0) {
      target.add(shift);
      camera.position.add(shift);
    }
  }

  function renderFrame(now) {
    frameHandle = 0;
    if (disposed || contextLost || document.hidden || !renderer) return;
    const start = performance.now();
    const interval = lastFrameTime ? now - lastFrameTime : 0;
    // Only measure a continuous animation/damping chain. Hover events and idle
    // redraws may be hundreds of milliseconds apart even on a very fast GPU.
    if (previousFrameChained && interval > 0 && interval < 150 && loaded) {
      intervals.push(interval);
      if (intervals.length > 90) intervals.shift();
    }
    lastFrameTime = now;
    if (tween) {
      const t = Math.min(1, (now - tween.start) / 440);
      const smooth = t * t * (3 - 2 * t);
      controls.target.lerpVectors(tween.targetFrom, tween.targetTo, smooth);
      // Follow the shortest orbit around the moving target, rather than a chord
      // through the body when switching between opposite camera directions.
      const radius = THREE.MathUtils.clamp(THREE.MathUtils.lerp(tween.orbitFrom.radius, tween.orbitTo.radius, smooth), controls.minDistance, controls.maxDistance);
      const phi = THREE.MathUtils.lerp(tween.orbitFrom.phi, tween.orbitTo.phi, smooth);
      const theta = tween.orbitFrom.theta + tween.thetaDelta * smooth;
      camera.position.setFromSphericalCoords(radius, phi, theta).add(controls.target);
      if (t === 1) cancelTween();
    }
    const moving = controls.update();
    previousFrameChained = Boolean(moving || tween);
    constrainPan();
    camera.updateMatrixWorld();
    updateHover();
    updateLabels();
    renderer.info.reset();
    composer.render();
    if (jointsGroup.visible) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(annotationScene, camera);
      renderer.autoClear = true;
    }
    drawCalls = renderer.info.render.calls;
    triangles = renderer.info.render.triangles;
    frames++;
    durations.push(performance.now() - start);
    if (durations.length > 90) durations.shift();
    if (!inspectionReady && loaded && quality < 3 && now - loadedAt > 4000 && now - lastAdaptation > 6000 && intervals.length >= 60) {
      const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
      if (mean > 35) {
        quality++;
        intervals.length = 0;
        lastAdaptation = now;
        configureResolution();
      }
    }
    if (moving || tween || pendingPointer) invalidate();
    else scheduleInspection();
  }

  function bindInput() {
    const canvas = renderer.domElement;
    listen(canvas, 'pointerdown', event => {
      cancelTween();
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY, moved: false, primary: event.button === 0 });
      if (activePointers.size > 1) multiTouch = true;
      canvas.style.cursor = 'grabbing';
      clearHover();
      invalidate();
    });
    listen(canvas, 'pointermove', event => {
      const start = activePointers.get(event.pointerId);
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) start.moved = true;
      if (activePointers.size === 0 && event.pointerType !== 'touch') {
        pendingPointer = { clientX: event.clientX, clientY: event.clientY };
        invalidate();
      }
    });
    listen(canvas, 'pointerup', event => {
      const start = activePointers.get(event.pointerId);
      const canSelect = start?.primary && !start.moved && !multiTouch && activePointers.size === 1;
      activePointers.delete(event.pointerId);
      if (!activePointers.size) multiTouch = false;
      canvas.style.cursor = 'grab';
      if (canSelect) {
        const region = pick(event.clientX, event.clientY);
        if (region) onSelect(region);
      }
      invalidate();
    });
    const cancelPointer = event => {
      activePointers.delete(event.pointerId);
      if (!activePointers.size) multiTouch = false;
      canvas.style.cursor = 'grab';
      clearHover();
    };
    listen(canvas, 'pointercancel', cancelPointer);
    listen(canvas, 'lostpointercapture', event => {
      // OrbitControls releases capture before our pointerup handler. Defer cleanup.
      queueMicrotask(() => {
        if (activePointers.has(event.pointerId)) cancelPointer(event);
      });
    });
    listen(canvas, 'pointerleave', () => { if (!activePointers.size) clearHover(); });
    listen(canvas, 'keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(0.84); }
      else if (event.key === '-' || event.key === '_') { event.preventDefault(); zoom(1.19); }
      else if (event.key === 'Home') { event.preventDefault(); setView('home'); }
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
        const step = Math.PI / 12;
        if (event.key === 'ArrowLeft') spherical.theta -= step;
        if (event.key === 'ArrowRight') spherical.theta += step;
        if (event.key === 'ArrowUp') spherical.phi -= step;
        if (event.key === 'ArrowDown') spherical.phi += step;
        spherical.phi = THREE.MathUtils.clamp(spherical.phi, controls.minPolarAngle, controls.maxPolarAngle);
        moveCamera(controls.target, new THREE.Vector3().setFromSpherical(spherical), spherical.radius);
      }
    });
    controls.addEventListener('change', invalidate);
    const startOrbit = () => { cancelTween(); beginMotion(); };
    controls.addEventListener('start', startOrbit);
    controls.addEventListener('end', invalidate);
    cleanup.push(() => controls.removeEventListener('change', invalidate), () => controls.removeEventListener('start', startOrbit), () => controls.removeEventListener('end', invalidate));
    listen(document, 'visibilitychange', () => {
      if (document.hidden) {
        cancelAnimationFrame(frameHandle);
        frameHandle = 0;
        lastFrameTime = 0;
        previousFrameChained = false;
        clearTimeout(inspectionTimer);
        inspectionTimer = 0;
      } else {
        inspectionReady = true;
        configureResolution();
        invalidate();
      }
    });
    listen(reducedMotion, 'change', () => {
      if (reducedMotion.matches && tween) {
        camera.position.copy(tween.to);
        controls.target.copy(tween.targetTo);
      }
      cancelTween();
      invalidate();
    });
    listen(canvas, 'webglcontextlost', event => {
      event.preventDefault();
      contextLost = true;
      clearTimeout(inspectionTimer);
      inspectionTimer = 0;
      cancelAnimationFrame(frameHandle);
      frameHandle = 0;
      clearHover();
      reportError(new Error('The 3D graphics context was interrupted. Restore the window or use Retry to reload the model.'));
    });
    listen(canvas, 'webglcontextrestored', () => {
      if (disposed || restoring) return;
      contextLost = false;
      inspectionReady = true;
      restoring = true;
      // Three recreates texture/program resources lazily from their retained source.
      // Render-target environments have no retained pixels and must be regenerated.
      createEnvironment();
      keyLight.shadow.needsUpdate = true;
      resize();
      renderer.compileAsync(scene, camera).then(() => {
        restoring = false;
        if (!disposed) { onReady(); invalidate(); }
      }).catch(error => { restoring = false; reportError(error); });
    });
  }

  function createEnvironment() {
    environmentTarget?.dispose();
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    environmentTarget = pmrem.fromScene(room, 0.045);
    scene.environment = environmentTarget.texture;
    scene.environmentIntensity = 0.3;
    room.dispose();
    pmrem.dispose();
  }

  function createStudio() {
    createEnvironment();
    keyLight = new THREE.DirectionalLight(0xffead9, 2.25);
    keyLight.position.set(-1.5, 5.5, 2.5);
    keyLight.target.position.set(0, 1, 0);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -1.6;
    keyLight.shadow.camera.right = 1.6;
    keyLight.shadow.camera.top = 1.8;
    keyLight.shadow.camera.bottom = -1.8;
    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = 9;
    keyLight.shadow.normalBias = 0.007;
    keyLight.shadow.bias = -0.0001;
    keyLight.shadow.radius = 4;
    keyLight.shadow.autoUpdate = false;
    keyLight.shadow.needsUpdate = true;
    scene.add(keyLight, keyLight.target);
    const fill = new THREE.DirectionalLight(0xe3eef7, 0.9);
    fill.position.set(3, 2, 2);
    const rim = new THREE.DirectionalLight(0xffeee0, 1.4);
    rim.position.set(1.5, 3, -3);
    scene.add(fill, rim, new THREE.HemisphereLight(0xf6f2e9, 0xa59686, 0.3));
    const groundGeometry = new THREE.PlaneGeometry(20, 20);
    const groundMaterial = new THREE.ShadowMaterial({ color: 0x26382f, opacity: PALETTE.light.shadow, depthWrite: false });
    ownedGeometries.add(groundGeometry);
    rememberMaterial(groundMaterial);
    shadow = new THREE.Mesh(groundGeometry, groundMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.008;
    shadow.receiveShadow = true;
    scene.add(shadow);
    const contactImage = document.createElement('canvas');
    contactImage.width = contactImage.height = 128;
    const context = contactImage.getContext('2d');
    const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
    gradient.addColorStop(0, 'rgba(31, 42, 35, 1)');
    gradient.addColorStop(0.35, 'rgba(31, 42, 35, .65)');
    gradient.addColorStop(1, 'rgba(31, 42, 35, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    const contactTexture = new THREE.CanvasTexture(contactImage);
    contactTexture.colorSpace = THREE.SRGBColorSpace;
    const contactMaterial = new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, opacity: PALETTE.light.contact, depthWrite: false, toneMapped: false });
    const contactGeometry = new THREE.PlaneGeometry(0.54, 0.38);
    ownedGeometries.add(contactGeometry);
    rememberMaterial(contactMaterial);
    contactShadow = new THREE.Mesh(contactGeometry, contactMaterial);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.set(0, -0.005, 0.04);
    contactShadow.renderOrder = 1;
    scene.add(contactShadow);
  }

  function registerModel(root) {
    root.updateMatrixWorld(true);
    const materials = new Map();
    root.traverse(object => {
      if (!object.isMesh) return;
      modelMeshes.push(object);
      ownedGeometries.add(object.geometry);
      if (!object.geometry.boundsTree) object.geometry.boundsTree = new MeshBVH(object.geometry, { targetLeafSize: 12 });
      object.raycast = acceleratedRaycast;
      // Blender exports a material-split object as a named parent with primitives.
      // Resolve its identity from the parent as well as single-material meshes.
      let region, ancestor = object;
      while (ancestor && !region) {
        region = regionById.get(ancestor.userData.regionId) || regionByMeshName.get(ancestor.name);
        ancestor = ancestor.parent;
      }
      object.userData.atlasRegion = region || null;
      object.castShadow = true;
      object.receiveShadow = true;
      if (region) {
        if (!regionMeshes.has(region.id)) regionMeshes.set(region.id, []);
        regionMeshes.get(region.id).push(object);
      }
      const originals = Array.isArray(object.material) ? object.material : [object.material];
      const clones = originals.map(original => {
        // Clone by anatomical identity, so a selected muscle never recolours neighbours.
        const key = `${original.uuid}:${region?.id || 'context'}`;
        if (materials.has(key)) return materials.get(key);
        const material = original.clone();
        material.name = original.name;
        if (/muscle/i.test(material.name) && material.color) material.color.multiply(new THREE.Color().setRGB(1, 0.82, 0.86));
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
          if (material[key]) material[key].anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
        rememberMaterial(material);
        appearance.push({
          material, region, color: material.color?.clone() || new THREE.Color(1, 1, 1),
          emissive: material.emissive?.clone() || new THREE.Color(0), emissiveIntensity: material.emissiveIntensity ?? 1,
          normalScale: material.normalScale?.clone(), bumpScale: material.bumpScale ?? 1,
          roughness: material.roughness ?? 0.65,
          fibreRoughnessMap: /muscle/i.test(material.name) ? material.roughnessMap : null,
        });
        materials.set(key, material);
        ownedMaterials.add(original);
        return material;
      });
      object.material = Array.isArray(object.material) ? clones : clones[0];
    });
    for (const [id, meshes] of regionMeshes) {
      const box = new THREE.Box3();
      for (const mesh of meshes) box.union(new THREE.Box3().setFromObject(mesh));
      regionBounds.set(id, box);
    }
    const absent = manifest.regions.filter(region => !regionMeshes.has(region.id));
    if (absent.length) throw new Error(`The anatomy model is missing ${absent.length} named regions.`);
    modelBounds.setFromObject(root);
    if (modelBounds.isEmpty()) throw new Error('The anatomy model contains no visible geometry.');
  }

  function createJoints() {
    // Joint centres sit beneath muscle. Use clearly diagrammatic anchored halos,
    // rather than burying a tiny solid sphere inside the anatomical surface.
    const image = document.createElement('canvas');
    image.width = image.height = 128;
    const context = image.getContext('2d');
    context.beginPath();
    context.arc(64, 64, 46, 0, Math.PI * 2);
    context.fillStyle = 'rgba(232, 248, 239, .75)';
    context.fill();
    context.lineWidth = 6;
    context.strokeStyle = '#527b65';
    context.stroke();
    context.beginPath();
    context.arc(64, 64, 9, 0, Math.PI * 2);
    context.fillStyle = '#35664c';
    context.fill();
    const texture = new THREE.CanvasTexture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    rememberMaterial(material);
    for (const joint of manifest.joints || []) {
      const marker = new THREE.Sprite(material);
      marker.position.fromArray(joint.position);
      marker.scale.set(0.065, 0.065, 1);
      marker.renderOrder = 10;
      marker.name = joint.label;
      jointsGroup.add(marker);
    }
    jointsGroup.visible = display.joints;
  }

  async function initialize() {
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      renderer.domElement.className = 'anatomy-canvas';
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute('role', 'img');
      renderer.domElement.setAttribute('aria-label', 'Interactive 3D anatomy. Drag to rotate, scroll to zoom. With this view focused, use arrow keys to rotate, plus and minus to zoom, and Home to reset. Select named muscles using the muscle browser.');
      renderer.domElement.style.touchAction = 'none';
      renderer.domElement.style.cursor = 'grab';
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.9;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.info.autoReset = false;
      container.appendChild(renderer.domElement);
      labelLayer = document.createElement('div');
      labelLayer.className = 'anatomy-label-layer';
      labelLayer.setAttribute('aria-hidden', 'true');
      labelLayer.hidden = !display.labels;
      container.appendChild(labelLayer);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = !reducedMotion.matches;
      controls.dampingFactor = 0.09;
      controls.rotateSpeed = 0.65;
      controls.zoomSpeed = 0.7;
      controls.panSpeed = 0.65;
      controls.minDistance = 0.32;
      controls.maxDistance = 7;
      controls.minPolarAngle = 0.14;
      controls.maxPolarAngle = Math.PI * 0.87;
      controls.screenSpacePanning = true;
      controls.target.set(0, 1, 0);
      camera.position.copy(controls.target).addScaledVector(HOME_DIRECTION, 4.3);
      controls.update();
      createStudio();
      const renderTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Math.min(4, renderer.capabilities.maxSamples) });
      composer = new EffectComposer(renderer, renderTarget);
      composer.setPixelRatio(1);
      composer.addPass(new RenderPass(scene, camera));
      gtao = new GTAOPass(scene, camera, 1, 1);
      gtao.blendIntensity = 0.42;
      gtao.updateGtaoMaterial({ radius: 0.065, distanceExponent: 1.6, thickness: 0.035, scale: 1 });
      gtao.updatePdMaterial({ radius: 4, lumaPhi: 8, depthPhi: 2, normalPhi: 3, samples: 16 });
      composer.addPass(gtao);
      composer.addPass(new OutputPass());
      bindInput();
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
      resize();
      setTheme(theme);
      onProgress(0);
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(assetUrl(manifest.model.url), progress => {
        if (!disposed) onProgress(progress.lengthComputable && progress.total ? Math.min(0.92, progress.loaded / progress.total * 0.92) : null);
      });
      if (disposed) {
        gltf.scene.traverse(object => {
          if (!object.isMesh) return;
          object.geometry.dispose();
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            for (const value of Object.values(material)) if (value?.isTexture) { value.source?.data?.close?.(); value.dispose(); }
            material.dispose();
          }
        });
        return;
      }
      model = gltf.scene;
      scene.add(model);
      registerModel(model);
      createJoints();
      updateAppearance();
      const bounds = areaBounds(framing);
      fittedBounds.copy(bounds);
      moveCamera(bounds.getCenter(new THREE.Vector3()), HOME_DIRECTION, fitDistance(bounds), true);
      keyLight.shadow.needsUpdate = true;
      onProgress(0.96);
      await renderer.compileAsync(scene, camera);
      if (disposed) return;
      loaded = true;
      loadedAt = performance.now();
      updateLabelCandidates();
      onProgress(1);
      onReady();
      invalidate();
    } catch (error) {
      reportError(error);
      throw error;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(inspectionTimer);
    inspectionTimer = 0;
    cancelAnimationFrame(frameHandle);
    frameHandle = 0;
    resizeObserver?.disconnect();
    for (const remove of cleanup) remove();
    controls?.dispose();
    for (const pass of composer?.passes || []) pass.dispose?.();
    composer?.dispose();
    environmentTarget?.dispose();
    keyLight?.shadow.dispose();
    for (const geometry of ownedGeometries) {
      geometry.boundsTree = null;
      geometry.dispose();
    }
    for (const material of ownedMaterials) material.dispose();
    for (const texture of ownedTextures) {
      texture.source?.data?.close?.();
      texture.dispose();
    }
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer?.domElement.remove();
    labelLayer?.remove();
    scene.clear();
    annotationScene.clear();
    modelMeshes.length = 0;
    appearance.length = 0;
    regionMeshes.clear();
    regionBounds.clear();
  }

  function getDiagnostics() {
    const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const frameInterval = average(intervals);
    return {
      loaded, disposed, contextLost, framing, theme, frames, drawCalls, triangles,
      modelMeshes: modelMeshes.length, selectableRegions: regionMeshes.size,
      selectedRegionIds: selection ? (selection.groupSelection ? manifest.regions.filter(region => region.muscle === selection.muscle).map(region => region.id) : [selection.id]) : [],
      hoveredRegionId: hoverId, inspectionReady,
      quality: inspectionReady ? 'inspection' : ['high', 'balanced-ao', 'balanced-resolution', 'efficient'][quality],
      motionQuality: quality,
      pixelRatio: renderer?.getPixelRatio() || 0, width, height,
      renderTargets: composer ? {
        beauty: {width: composer.readBuffer.width, height: composer.readBuffer.height},
        output: {width: composer.writeBuffer.width, height: composer.writeBuffer.height},
        ao: {width: gtao.width, height: gtao.height},
      } : null,
      materialTextures: [...ownedTextures].filter(texture => texture.image?.width).map(texture => ({name: texture.name, width: texture.image.width, height: texture.image.height, anisotropy: texture.anisotropy})),
      averageFrameMs: average(durations), averageFrameIntervalMs: frameInterval,
      interactionFps: frameInterval ? 1000 / frameInterval : null,
      camera: camera.position.toArray(), target: controls?.target.toArray() || null,
      memory: renderer ? { ...renderer.info.memory } : null,
      renderer: renderer?.getContext().getParameter(renderer.getContext().RENDERER) || null,
    };
  }

  const ready = initialize();
  return { ready, setSelection, setSearchMatches, setDisplayOptions, setTheme, frame, focusRegion, setView, zoom, resize, dispose, getDiagnostics, projectRegion };
}
