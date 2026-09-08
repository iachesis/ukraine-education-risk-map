# Design and evidence notes

Read the [visual gallery](review.html) and use the atlas before this explanation. This is the creator's account, not an independent evaluation or user research.

## Product interpretation

The assumed primary audience is an education coordinator, local-government colleague or analyst locating a community, understanding its recorded category and placing it in regional context. A parent or journalist should also be able to complete a lookup without learning GIS. These are audience assumptions; no interviews were conducted.

[MoES's September 2024 explanation](https://mon.gov.ua/news/zatverdzheno-perelik-hromad-za-rivnem-ryzyku-v-systemi-osvity-iak-pereviryty-svii-rehion) places risk zoning in education policy, including shelter priorities and returning to in-person or blended education. It does not establish the effective date of this repository's snapshot. [The earlier methodology explanation](https://mon.gov.ua/news/uriad-zatverdyv-metodyku-otsinky-ryzykiv-bezpeky-v-osviti-poviazanykh-z-rosiiskoiu-ahresiieiu) supports an ordered five-category interpretation. The product helps people inspect recorded classifications; it does not issue school-opening or travel advice.

The chosen expression is a civic atlas: warm paper, Ukrainian Manrope typography, a restrained blue-green ordinal scale and one gold selection accent. The map is the main visual object. A small book-like mark establishes an experimental identity without suggesting MoES authorship. The existing layout was replaced after desktop and phone inspection.

The useful journey is national context → named community → exact record → comparison or reuse. Search works before the boundary download finishes. Results carry region, type, code and class. Selection stays open, preserves the class fill and gains a gold outline. Regional totals and CSV export describe records in the snapshot, never population or schools. Missing geometry stays searchable. Map and list reach the same records.

## Decisive alternatives

| Alternative | Concrete benefit | Decision and cost |
| --- | --- | --- |
| Existing Leaflet + vanilla modules | Known projection, gestures, bounds and local assets; no build or hosting change | **Adapt.** Replace product structure and state while reusing the renderer. A 1,769-feature atlas does not need another application framework. |
| MapLibre/vector tiles | More headroom for very large multilayer maps | **Defer.** [Official large-data guidance](https://maplibre.org/maplibre-gl-js/docs/guides/large-data/) is useful, but this snapshot has no tile service or need for a new style/hosting pipeline. Added maintenance and deployment decisions are not justified here. |
| React or another UI framework | Familiar component ecosystem | **Defer.** Small modules and native controls cover this single-page state. A new build/runtime would not solve the observed lookup, coverage or loading problems. |
| Raw GeoJSON + localStorage | Minimal source change | **Reject for runtime delivery.** The baseline transfers about 8.9 MB of geometry, exceeds storage quota in the tested environment and blocks search behind geometry. Preserve originals; serve a deterministic compressed derivative and use HTTP caching. |
| Custom geometry simplification | Potentially smaller paths | **Reject.** Reuse TopoJSON shared arcs/quantization; retain every feature/ring and verify quantized vertices. No custom simplifier or hand-edited geography. |
| Traffic-light warning dashboard | Familiar urgency cues | **Reject as the overall expression.** It invites live alarm interpretation and overweights colour. An ordered atlas scale, explicit words and patterned special/unknown cases fit a dated categorical dataset. |
| Hosted basemap, analytics or backend | Additional context and persistence | **Defer.** None is required for these records or journeys; each adds disclosure, network dependence or operations. URL state and local CSV reuse cover this experiment. |

The [UNDP Crisis Risk Dashboard](https://data.undp.org/products/crisis-risk-dashboard) informed contextual exploration; [Our World in Data's reuse guidance](https://ourworldindata.org/easier-to-reuse-our-data) informed carrying scope and provenance with exports. Neither was copied as a layout. No image, school metric or score was invented to enrich the page.

## Reused capabilities and provenance

| Capability/asset | Source and version | Use and limits |
| --- | --- | --- |
| Leaflet | Existing vendored 1.9.4; [official reference](https://leafletjs.com/reference.html), BSD-2-Clause | Projection, SVG polygons, gestures, bounds, tooltips and scale. Existing files unchanged. |
| Fuse | Existing vendored 7.0.0, Apache-2.0 | Name-only fuzzy fallback. Identifiers are never fuzzily guessed. |
| TopoJSON | [Server](https://github.com/topojson/topojson-server) 3.0.1; [client](https://github.com/topojson/topojson-client) 3.1.0, ISC | Shared arcs/quantization and vendored runtime decoder. License alongside decoder. |
| Manrope | `@fontsource-variable/manrope` 5.3.0, SIL OFL 1.1 | Local Cyrillic, Cyrillic extended and Latin WOFF2; license in `assets/fonts/`. No Google Fonts request. |
| Atlas mark | Authored in this session | Code-native SVG; no generated or borrowed brand imagery. |
| Browser platform | Native dialog, history/URL, Intl, Blob, Clipboard, DecompressionStream, HTTP cache | No persisted app state or service. Modern browsers required; tested versions are in RETURN. |
| Verification | Playwright 1.63.0, axe-core 4.13.0, Prettier 3.9.6 | Exact versions in isolated lockfile. Chromium reused an available cache; Firefox/WebKit installed only under this experiment. `npm audit` reported zero vulnerabilities at installation. |
| Risk and boundaries | Pinned repository JSON | No provenance/date fields beyond code/name/region/risk and geometry ID. The repository MIT license alone does not establish upstream administrative-data provenance or effective date. |

The derivative uses quantization of 1,000,000 and gzip level 9, with no simplification. It retains all 27 ADM1 and 1,769 ADM3 features, checks 2,264 rings and 400,977 source vertices, and has a conservative half-cell positional bound below 1.11 m. This describes the transformation, not source accuracy. Leaflet also performs normal display-only path simplification. Raw inputs remain downloadable and byte-identical.

ADM1 IDs cannot safely be joined to risk-code region prefixes: five unmatched IDs exist on each side. ADM1 is an outline layer only. Region filters use the explicit source `region` field and joined ADM3 features. No unofficial crosswalk was invented.

## Internal iterations and interventions

One accountable local Astra Max agent owned interpretation, design and engineering. There were no supporting agents, auxiliary model calls, image-generation calls or external critiques. The human supplied the charter and commission; no subsequent art direction or correction was received before B0.

1. Read Issue #17, its charter/comment, repository instructions/history and public product. Inspected desktop/phone baseline before changing it. Completed the full census.
2. Chose the civic atlas and reused Leaflet. Created deterministic geometry delivery, explicit record interpretation, responsive structure and primary/secondary interactions.
3. Inspected actual rendering in the Codex browser and native screenshots. Refined exact-name priority, ambiguity codes, focus return, persistent selection/history, long names, comparison guidance and enlarged-text layout.
4. Exercised three engines, accessibility and failures. Earlier harness failures concerned hidden-but-ready map state, Safari pointer focus and asynchronous clipboard feedback. Retained reports distinguish them from product failures.
5. A direct phone map tap exposed hatch definitions being created before Leaflet's SVG existed. Corrected initialization order and verified visible patterns and real taps. Final phone capture exposed an icon-only button's absent accessible name; fixed it and expanded mobile accessibility scans. Added caption backing over dark geography.
6. Corrected an interaction benchmark querying a code already among earlier results. Superseded initial measurements remain under `evidence/development/`; final timing waits for a different community.

These are internal B0 iterations, not an externally requested B1. No claim is made that autonomy caused the outcome or that this ranks models. Session identity, effort observations and exact freeze are in the return packet.

## Source uncertainty and boundary

The repository's January 12, 2026 change date is observable; the official effective date is not. Consolidated legal pages returned HTTP 403 during research, so current legal versions were **not verified**. The UI supplies source links and states uncertainty without claiming current legal effect. Geometry age and upstream authority remain unresolved. Names and territorial coverage, including Crimea and Sevastopol, are preserved from the snapshot.

Six unmapped records retain valid classifications in search/list/comparison/export. Chornobyl has a separate hatched status inherited from baseline handling, with no invented risk class or KATOTTG code. Runtime fixtures test absent records, missing/null classes and invalid values without modifying pinned input files.

Human first-look and task evaluation remain unrun. Automated checks do not establish physical-device, screen-reader or full WCAG conformance. Production adoption and any commissioned B1 remain separate decisions under Issue #17.
