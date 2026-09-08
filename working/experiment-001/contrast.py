"""Reproduce selected text/control contrast checks; not a full WCAG audit."""
from pathlib import Path
import json
import re

root = Path(__file__).resolve().parents[2]
css = (root / "assets/styles/atlas.css").read_text()

def token(name):
    return re.search(r"--" + name + r":\s*(#[0-9a-f]{6})", css).group(1)

def declaration(selector, property):
    block = re.search(re.escape(selector) + r"\s*\{([^}]+)", css).group(1)
    value = re.search(property + r":\s*([^;]+)", block).group(1)
    return re.search(r"#[0-9a-f]{6}", value).group(0)

def luminance(color):
    rgb = [int(color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    linear = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    return sum(a * b for a, b in zip(linear, (.2126, .7152, .0722)))

def ratio(a, b):
    low, high = sorted((luminance(a), luminance(b)))
    return (high + .05) / (low + .05)

checks = []
for foreground in ("ink", "blue", "muted"):
    for background in ("paper", "white", "sea"):
        checks.append((foreground + "/" + background, token(foreground), token(background), 4.5))
checks.append(("active control text", token("white"), token("blue"), 4.5))
checks.append(("keyboard focus", token("focus"), token("paper"), 3))
for selector in (".search-box", ".filters select", ".outline-button"):
    checks.append((selector + " boundary", declaration(selector, "border"), token("paper"), 3))
checks.append(("map index text", declaration(".map-index", "color"), token("paper"), 4.5))
checks.append(("identifier text", declaration(".community-code", "color"), token("paper"), 4.5))
checks.append(("snapshot caption", declaration(".snapshot-caption", "color"), token("paper"), 4.5))
report = {
    "method": "WCAG relative sRGB luminance formula, CSS values read from candidate source. Main text/control tokens only; no full conformance claim. Map class fill colours are supplemented by explicit text, selection outline and equivalent list.",
    "checks": [{"name": name, "foreground": fg, "background": bg, "ratio": round(ratio(fg, bg), 3), "minimum": minimum, "status": "PASS" if ratio(fg, bg) >= minimum else "FAIL"} for name, fg, bg, minimum in checks],
}
(Path(__file__).parent / "evidence/contrast.json").write_text(json.dumps(report, indent=2) + "\n")
assert all(c["status"] == "PASS" for c in report["checks"]), report
print(f"PASS: {len(checks)} selected text and control contrast pairs")
