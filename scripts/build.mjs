import {cp, mkdir, stat} from 'node:fs/promises';
import {build} from 'vite';

// Fail before replacing a valid dist if the deliverable model is absent.
await Promise.all(['male.glb', 'manifest.json', 'NOTICE.txt'].map(file => stat(`public/assets/anatomy/${file}`)));
await Promise.all(['catalog.json', 'LICENSE.txt', 'SOURCE-NOTICE.md', 'media-manifest.json', 'MEDIA-LICENSE.txt'].map(file => stat(`public/assets/exercises/${file}`)));
await build();
await mkdir('dist/assets', {recursive: true});
await cp('public/assets/anatomy', 'dist/assets/anatomy', {recursive: true});
await cp('public/assets/exercises', 'dist/assets/exercises', {recursive: true});
console.log('Built Anatomy Atlas with self-hosted 3D anatomy in dist/.');
