# Internal development evidence

These files precede the final B0 verification and are retained to make internal iterations inspectable. They are not final acceptance results.

- `iteration-1-*`: first rendered design, before name-priority, ambiguity, accessibility, wording and hatch refinements.
- `verification-iteration-2.json` and `verification-iteration-3.json`: earlier browser harness results, including hidden-map readiness, pointer-focus and asynchronous clipboard timing failures.
- `resilience-iteration-3.json`: initial resilience pass, before adding direct polygon taps and extended enlarged-text inspection.
- `resilience-iteration-4.json`: direct phone tap failures that exposed missing SVG hatch definitions; fixed before B0.
- `touch-target-debug*.png`: unedited diagnostic renderings used to locate that defect; the final visible hatch appears in the main evidence folder.
- `performance-initial-*`: superseded interaction timing that could detect a code already present in previous results. Use the final parent-folder performance reports, which switch to a different community.
- `axe-*.json`: earlier desktop-only audit outputs, superseded by the ten final desktop/mobile reports.

The first mobile continuous-capture attempt also stopped at the icon-only data button because its accessible name disappeared at the phone breakpoint. The product name was fixed, the scans expanded to mobile, and both complete final traces were captured successfully. This is documented as a real internal finding rather than a final failure.
