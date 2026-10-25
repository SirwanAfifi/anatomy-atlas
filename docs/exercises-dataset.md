# Exercise dataset integration

The inspector uses all 1,324 English exercise records from
[hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset),
pinned to revision `7455efae41b330c265e7cd4b78dfa848e7ce5ebd`.
The catalog is served locally from `/assets/exercises/catalog.json` and is
loaded only when exercises are requested. No runtime external API is required.

## Source and reproduction

Run `node scripts/import-exercises.mjs` to fetch the pinned source and regenerate
the catalog and provenance. To use a downloaded original JSON offline, run
`node scripts/import-exercises.mjs --source /path/to/exercises.json` after the
notices have been downloaded once. The original source JSON SHA-256 is
`656634224b8977b99a6d765470ee123260d4979715eaa4e7c0b7c8bb0d79f93d`.

The conversion retains IDs, exercise names, categories, equipment, primary
targets, English prose, and English instruction steps. It combines and
deduplicates `secondary_muscles` and `muscle_group` without promoting either to
a primary target. Instruction content is retained as supplied by the dataset.
Other languages and all Gym Visual media fields are omitted from this catalog. The compact catalog is about
1.42 MiB. `provenance.json` includes the catalog checksum and conversion method.

The non-media data is MIT licensed, copyright 2026 Hasan Emir Yıldırım. The
original `LICENSE` and `NOTICE.md` are bundled as `LICENSE.txt` and
`SOURCE-NOTICE.md`. The original notices explain that Gym visual images and
animations have a separate license; none are downloaded, bundled, or embedded
by this integration. The anatomical model's CC BY-SA license remains separate.

## Matching to anatomy

`src/exercises.js` owns matching independently of Three.js. A primary match
requires a compatible explicit `target`. A secondary match requires a compatible
supporting-muscle label. An exercise appears once per group, with primary taking
precedence, and primary matches sort first. Search, equipment, and relationship
filters compose over this result.

Exercise labels are group level and bilateral. Selecting a particular side,
muscle head or anatomical subdivision does not manufacture a more specific
exercise relationship. Mapping notes make the broad matches visible in the UI.

| Atlas group | Primary | Secondary | Source labels / limits |
| --- | ---: | ---: | --- |
| Pectorals | 158 | 94 | pectorals; chest, upper chest |
| Anterior deltoid | 143 | 428 | delts; deltoids, shoulders. Broad shoulder matches, not anterior-head-specific. |
| Posterior shoulder | 0 | 26 | rear deltoids, rotator cuff only; broad shoulders/delts excluded |
| Upper arm flexors | 151 | 194 | biceps; biceps, brachialis |
| Triceps | 141 | 268 | triceps |
| Forearms | 37 | 275 | forearms; wrist flexors/extensors, grip muscles |
| Rectus abdominis | 169 | 3 | abs; abdominals, lower abs |
| External obliques | 0 | 72 | obliques; source does not distinguish internal/external |
| Upper trapezius | 15 | 80 | traps; traps, trapezius; no fibre-specific distinction |
| Mid/lower trapezius | 15 | 80 | same broad trapezius matches |
| Latissimus dorsi | 81 | 6 | lats; lats, latissimus dorsi |
| Spinal erectors | 19 | 71 | spine; lower back; no individual erector distinction |
| Gluteal muscles | 144 | 136 | glutes |
| Quadriceps | 44 | 161 | quads; quadriceps |
| Adductors | 6 | 1 | adductors; inner thighs |
| Hamstrings | 28 | 289 | hamstrings |
| Tibialis anterior | 0 | 0 | no explicit source match |
| Calves | 59 | 147 | calves; calves, soleus |

These counts overlap across groups. Broad labels such as `core`, `upper back`,
`ankles`, `groin`, and `shins` do not establish a specific muscle match. In
particular, source record `1396` (smith toe raise) mentions `shins` as secondary
but describes raising the heels, so it is not substituted as tibialis-anterior
training. Source record `1389` is a posterior-tibialis stretch, a different
muscle. An explicit empty state is preferable to a misleading exercise list.

## Validation

Run `node --test tests/exercises-data.test.js`. Checks cover the pinned record
count, unique IDs, local-only assets, licensing notices, catalog checksum,
mapping coverage and exclusions, primary/secondary ordering, composed filters,
instruction preservation, invalid responses, and retry after fetch failure.
Browser tests separately exercise the inspector integration. The visual browser joins a separate, independently licensed photo manifest and displays only verified image matches. See [media provenance](exercise-media-research.md).

Desktop and 390px dark mobile screenshots are generated under the ignored
`test-results/` directory. The browser suite verifies local-only loading, combined filters, pagination,
primary/supporting labels, side-invariant matches, dialog focus and Escape,
late loading after muscle changes, retry, missing target coverage, and browsing
without WebGL. Run `npm run check`, `npm test`, and `npm run build` to validate the integration.
