# Освітній атлас — Experiment 001

A working experimental atlas of the education-risk classifications recorded for Ukrainian territorial communities. The interface supports name/code lookup, regional and class filtering, a map and equivalent record list, comparison of up to three communities, scoped CSV export and shareable selections.

This branch is a review candidate for [Issue #17](https://github.com/iachesis/ukraine-education-risk-map/issues/17). Its source snapshot is not a live safety feed. The official effective date of the included classifications has not been established.

## Run locally

From this checkout's root:

```sh
python3 -m http.server 8018 --bind 127.0.0.1
```

Open [the atlas](http://127.0.0.1:8018/). There is no application install or build step, third-party tile service, account or API key. Serve over HTTP; opening `index.html` as a file cannot load the data modules.

Start the review with [the paired visual gallery](working/experiment-001/review.html), then [RETURN.md](working/experiment-001/RETURN.md) for identities, evidence, executed checks and limitations. The baseline remains reproducible at `8e24e53dffcc77caf6b2e23a7b96b370b5948529`.

## Source and implementation

- `assets/data/data.json`, `adm1.json` and `adm3.json` are unchanged pinned inputs. Geometry properties contain identifiers, not community names.
- `assets/derived/` contains reproducible geography metadata and compressed TopoJSON. The census and derivation check every identifier, classification and geometry feature.
- `assets/js/atlas-domain.js`, `atlas-map.js` and `atlas.js` separate record interpretation, Leaflet rendering and interface state. The application is vanilla JavaScript with vendored Leaflet, Fuse and TopoJSON client.
- `assets/styles/atlas.css`, `assets/fonts/` and `assets/atlas-mark.svg` contain the candidate's visual system. Fonts are served locally.
- `working/experiment-001/` contains isolated development dependencies, verification scripts and the review packet. These tools are optional for running the application.

The baseline's older modules/assets remain available but are not loaded by the candidate entry point. Production hosting configuration and embedding targets are unchanged.

## Reproduce verification

```sh
cd working/experiment-001
npm ci --ignore-scripts --cache .cache
PLAYWRIGHT_BROWSERS_PATH=.browsers npx playwright install chromium firefox webkit
python3 census.py --check
node derive.mjs --check
PLAYWRIGHT_BROWSERS_PATH=.browsers node verify.mjs
PLAYWRIGHT_BROWSERS_PATH=.browsers node resilience.mjs
```

Keep the preview server running in another terminal. See [the test record](working/experiment-001/RETURN.md#verification) for capture/performance commands and exact tested conditions. Do not substitute test fixtures into the pinned input files.

## License

Project code uses the [MIT license](LICENSE.md). Added dependency and asset licenses, provenance limits and reuse choices are recorded in [design notes](working/experiment-001/NOTES.md#reused-capabilities-and-provenance).
