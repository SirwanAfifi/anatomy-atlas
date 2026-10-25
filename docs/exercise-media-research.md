# Exercise photo integration

The exercise cards use locally bundled photographs from
[Free Exercise DB](https://github.com/yuhonas/free-exercise-db), pinned to
revision `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5`.
The repository declares its contents public domain under the
[Unlicense](https://github.com/yuhonas/free-exercise-db/blob/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/LICENSE.md).
Its [README](https://github.com/yuhonas/free-exercise-db/blob/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/README.md)
explicitly describes using both JSON files and images locally. No separate
media exception is stated there. These are the upstream licensing declarations,
not an independent chain-of-title audit.

The original requested exercise metadata remains the Hasan Emir Yıldırım
catalog. Gym visual media from that catalog is not included. This integration
uses the openly licensed alternative selected by the user.

## Imported assets

- Source image catalog: 876 records; `dist/exercises.json`.
- Source catalog SHA-256: `5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf`.
- Matched application records: **157** of the original 1,324 records.
- Original JPEG files: **310**, approximately **18.1 MiB**.
- Each mapped exercise has two source photographs. Duplicate records that map
  to the same source exercise share files.
- Every image retains its original bytes and dimensions. No resizing,
  cropping, retouching, AI editing, or conversion is performed.
- `media-manifest.json` records each mapping, image dimensions, size and SHA-256.
- `MEDIA-LICENSE.txt` and `MEDIA-NOTICE.txt` retain licensing and attribution.

Images are paired exercise photographs, not videos or animation frames with
timing. Interfaces should identify them as photos/views, rather than pretending
that they demonstrate a continuous motion sequence.

## Reproduce

```sh
node scripts/import-exercise-media.mjs
```

The importer fetches from the pinned revision, verifies the source catalog
checksum, and writes the separate image manifest without changing the original
exercise catalog. Downloaded source metadata is cached under
`.cache/exercise-visual-source/`. Image requests are bounded to six concurrent
downloads. The runtime serves all photographs from `/assets/exercises/media/`.

## Matching policy

Names first match after case and punctuation normalization. The importer also
contains a short, explicit list of reviewed equivalent names, such as `barbell
step-up` → `Barbell Step Ups`, `dumbbell biceps curl` → `Dumbbell Bicep Curl`, and
`lever seated hip adduction` → `Thigh Adductor`. A generic barbell bench press
maps to the source's medium-grip flat bench press. No fuzzy search or
muscle-only similarity assigns photographs.

Manual review found identically named records describing incompatible
techniques. The importer excludes these rather than using a misleading image:
standing versus partner-assisted chest stretches; dumbbell versus strongman
carry implements; lateral versus forward band walks; generic squat versus
supported sissy squat; supine versus prone flutter kicks; standing versus lying
hamstring/quad stretches; wrist- versus towel-assisted chin-ups; unweighted
sit-up versus overhead weighted Otis Up; static versus jumping split squats;
goblet/back-weighted versus belt squats; and running versus hanging wind sprints.
Ambiguous spelling aliases for hug-knees-to-chest, iron-cross, and world's
greatest stretch were also omitted after the descriptions differed.

The images illustrate the named exercise using the source demonstrator's
technique. They do not identify an individual left/right anatomical subdivision.
Unmatched exercises have no invented or generic stand-in image.

## Visual coverage

Counts use the application's existing primary/supporting muscle mappings.
The same exercise can therefore appear in several rows.

| Atlas group | Primary | Supporting | Total with photos |
| --- | ---: | ---: | ---: |
| Pectorals | 21 | 7 | 28 |
| Anterior deltoid | 14 | 54 | 68 |
| Posterior shoulder | 0 | 3 | 3 |
| Upper arm flexors | 5 | 24 | 29 |
| Triceps | 6 | 34 | 40 |
| Forearms | 6 | 19 | 25 |
| Rectus abdominis | 31 | 1 | 32 |
| External obliques | 0 | 14 | 14 |
| Upper trapezius | 5 | 8 | 13 |
| Mid/lower trapezius | 5 | 8 | 13 |
| Latissimus dorsi | 15 | 0 | 15 |
| Spinal erectors | 2 | 11 | 13 |
| Gluteal muscles | 19 | 18 | 37 |
| Quadriceps | 7 | 24 | 31 |
| Adductors | 2 | 0 | 2 |
| Hamstrings | 5 | 36 | 41 |
| Tibialis anterior | 0 | 0 | 0 |
| Calves | 8 | 21 | 29 |

Tibialis anterior remains absent because the original exercise catalog has no
explicit match. No calf exercise is relabelled to fill that gap.
