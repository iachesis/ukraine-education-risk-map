import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  root,
  evidence,
  candidate,
  launch,
  ready,
  settle,
} from "./tooling.mjs";
const raw = JSON.parse(
  await fs.readFile(new URL("assets/data/data.json", root)),
);
const results = [];
const browser = await launch();
async function test(name, fn, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    ...options,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  try {
    const detail = await fn(page, context);
    results.push({ name, status: "PASS", errors, detail });
    console.log("PASS", name);
  } catch (e) {
    results.push({
      name,
      status: "FAIL",
      error: e.message.split("\n").slice(0, 5).join("\n"),
      errors,
    });
    console.log("FAIL", name, e.message.split("\n")[0]);
  }
  await context.close();
}
await test("Search useful while geometry delayed 3000 ms", async (page) => {
  await page.route("**/boundaries.topo.json.gz", async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.continue();
  });
  await page.goto(candidate, { waitUntil: "domcontentloaded" });
  await page.locator("#search[data-ready]").waitFor();
  await page.locator("#search").fill("Харківська");
  await page.locator("#suggestion-6312027").waitFor();
  assert.equal(await page.locator("#map-state").isVisible(), true);
  const resultMs = await page.evaluate(() => performance.now());
  await page.screenshot({ path: evidence + "candidate-delayed-geometry.png" });
  await ready(page);
  return { searchResultMs: resultMs };
});
await test("Data HTTP 503, clear failure, successful manual retry", async (page) => {
  let first = true;
  await page.route("**/assets/data/data.json", (route) =>
    first
      ? ((first = false), route.fulfill({ status: 503, body: "Unavailable" }))
      : route.continue(),
  );
  await page.goto(candidate);
  await page.locator("#retry-data").waitFor();
  assert.equal(await page.locator("#search").isEnabled(), false);
  await page.screenshot({ path: evidence + "candidate-data-failure.png" });
  await page.locator("#retry-data").click();
  await ready(page);
  assert.equal(await page.locator("#search").isEnabled(), true);
});
await test("Invalid metadata response is visibly rejected", async (page) => {
  await page.route("**/assets/data/data.json", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" }),
  );
  await page.goto(candidate);
  await page.locator("#retry-data").waitFor();
  assert.match(await page.locator("#data-state").innerText(), /Не вдалося/);
});
await test("Geometry failure preserves working search/list; retry succeeds", async (page) => {
  let fail = true;
  await page.route("**/boundaries.topo.json.gz", (route) =>
    fail ? route.abort("failed") : route.continue(),
  );
  await page.goto(candidate);
  await page.locator("#retry-map").waitFor();
  await page.locator("#search[data-ready]").waitFor();
  await page.screenshot({ path: evidence + "candidate-map-failure.png" });
  await page.locator("#search").fill("Харківська");
  await page.locator("#suggestion-6312027").click();
  assert.match(
    await page.locator(".risk-card strong").innerText(),
    /Дуже високий/,
  );
  await page.locator("#list-view").click();
  assert.ok(await page.locator(".community-row").count());
  await page.locator("#map-view").click();
  fail = false;
  await page.locator("#retry-map").click();
  await ready(page);
});
await test("Corrupt gzip is visibly rejected; metadata stays usable", async (page) => {
  await page.route("**/boundaries.topo.json.gz", (route) =>
    route.fulfill({ status: 200, body: "NOT A GZIP" }),
  );
  await page.goto(candidate);
  await page.locator("#retry-map").waitFor();
  await page.locator("#search[data-ready]").waitFor();
  assert.equal(await page.locator("#search").isEnabled(), true);
});
await test("Unavailable localStorage/sessionStorage does not affect application", async (page, context) => {
  await context.addInitScript(() => {
    for (const name of ["localStorage", "sessionStorage"])
      Object.defineProperty(window, name, {
        get() {
          throw new DOMException(
            "TEST FIXTURE: storage blocked",
            "SecurityError",
          );
        },
      });
  });
  await page.goto(candidate);
  await ready(page);
  assert.equal(await page.locator("#unknown-hatch circle").count(), 1);
  await page.locator("#search").fill("UA63120270000028556");
  await page.locator("#suggestion-6312027").click();
  assert.match(
    await page.locator(".risk-card strong").innerText(),
    /Дуже високий/,
  );
});
await test("Separate missing/invalid fixtures display neutral categories and pattern", async (page) => {
  const fixture = structuredClone(raw);
  delete fixture["4604001"];
  delete fixture["7104011"].risk;
  fixture["4804021"].risk = "INVALID_TEST_ONLY";
  fixture["5608005"].risk = null;
  await page.route("**/assets/data/data.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(fixture),
    }),
  );
  await page.goto(candidate);
  await ready(page);
  for (const [id, label] of [
    ["4604001", "Немає запису про рівень"],
    ["7104011", "Рівень не вказано"],
    ["4804021", "Невідоме значення рівня"],
    ["5608005", "Рівень не вказано"],
  ]) {
    await page.locator("#search").fill(raw[id].code || id);
    if (id === "4604001") await page.locator("#search").fill(id);
    await page.locator("#suggestion-" + id).click();
    assert.equal(await page.locator(".risk-card strong").innerText(), label);
    assert.equal(
      await page.locator(`[data-community="${id}"]`).getAttribute("fill"),
      "url(#unknown-hatch)",
    );
  }
  await page.screenshot({ path: evidence + "fixture-unknown-only.png" });
});
await test("Keyboard focus visible, tab access and source dialog confinement", async (page) => {
  await page.goto(candidate);
  await ready(page);
  await page.keyboard.press("Tab");
  assert.match(
    await page.locator(".skip-link").evaluate((n) => getComputedStyle(n).top),
    /12px/,
  );
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement.id), "search");
  const outline = await page.locator(".search-box").evaluate((n) => ({
    style: getComputedStyle(n).outlineStyle,
    width: getComputedStyle(n).outlineWidth,
  }));
  assert.equal(outline.style, "solid");
  assert.equal(outline.width, "3px");
  await page.screenshot({ path: evidence + "candidate-keyboard-focus.png" });
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "region");
});
for (const width of [390, 320])
  await test(
    `Touch at ${width}px: select, map navigation, reset, no overflow`,
    async (page) => {
      await page.goto(candidate);
      await ready(page);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.locator("#search").fill("Харківська");
      await page.locator("#suggestion-6312027").tap();
      assert.equal(
        await page.locator("#detail").getAttribute("data-record"),
        "6312027",
      );
      await page.locator(".detail-show-map").tap();
      await settle(page);
      await page.locator("#zoom-out").tap();
      await settle(page);
      await page.locator("#fit-map").tap();
      assert.equal(await page.locator("#detail").isVisible(), false);
      await page.locator("#risk-select").selectOption("special");
      await settle(page);
      assert.equal(await page.locator("#zone-hatch path").count(), 1);
      await page.locator('[data-community="3200000"]').tap();
      assert.equal(
        await page.locator("#detail").getAttribute("data-record"),
        "3200000",
      );
      await page.locator("#list-view").tap();
      assert.equal(await page.locator(".community-row").count(), 1);
      await page.locator(".community-open").tap();
      assert.equal(
        await page.locator(".risk-card strong").innerText(),
        "Особлива територія",
      );
      await page.locator(".detail-show-map").tap();
      await settle(page);
      await page.screenshot({
        path: evidence + `candidate-touch-${width}.png`,
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
    },
    {
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
    },
  );
await test("200% text enlargement: content reflow, controls and long name", async (page) => {
  await page.goto(candidate);
  await ready(page);
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("body *")].filter(
      (n) =>
        n.matches("input,select,button") ||
        [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()),
    );
    const sizes = nodes.map((n) => parseFloat(getComputedStyle(n).fontSize));
    nodes.forEach((n, i) => (n.style.fontSize = sizes[i] * 2 + "px"));
  });
  await page.screenshot({ path: evidence + "candidate-text-200.png" });
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(layout.scrollWidth <= layout.width + 1, JSON.stringify(layout));

  await page.locator("#search").fill(raw["2110007"].code);
  await page.locator("#suggestion-2110007").click();
  assert.match(await page.locator("#detail-title").innerText(), /Дубриницько/);
  await page.locator("#detail").evaluate((detail) => {
    const nodes = [...detail.querySelectorAll("*")].filter(
      (n) =>
        n.matches("button") ||
        [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()),
    );
    const sizes = nodes.map((n) => parseFloat(getComputedStyle(n).fontSize));
    nodes.forEach((n, i) => (n.style.fontSize = sizes[i] * 2 + "px"));
  });
  assert.equal(
    await page
      .locator("#detail-title")
      .evaluate((n) => getComputedStyle(n).fontSize),
    "62px",
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({ path: evidence + "candidate-text-200-detail.png" });
  await page.getByRole("button", { name: "Про дані", exact: true }).click();
  await page.screenshot({ path: evidence + "candidate-text-200-about.png" });
  return {
    method:
      "Text-bearing DOM nodes and form controls at 2x computed font size; not OS/browser zoom",
    ...layout,
  };
});
await test(
  "Reduced motion disables decorative and selection animations",
  async (page) => {
    await page.route("**/boundaries.topo.json.gz", async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });
    await page.goto(candidate, { waitUntil: "domcontentloaded" });
    assert.equal(
      await page
        .locator(".loading-mark")
        .evaluate((n) => getComputedStyle(n).animationName),
      "none",
    );
    await ready(page);
    await page.locator("#search").fill("UA63120270000028556");
    await page.locator("#suggestion-6312027").click();
    assert.equal(await page.locator(".leaflet-zoom-anim").count(), 0);
    assert.equal(
      await page
        .locator("#detail")
        .evaluate((n) => getComputedStyle(n).animationName),
      "none",
    );
  },
  { reducedMotion: "reduce" },
);
await browser.close();
await fs.writeFile(
  evidence + "resilience.json",
  JSON.stringify(
    { browser: "Chromium", version: "153.0.8010.12", results },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    PASS: results.filter((r) => r.status === "PASS").length,
    FAIL: results.filter((r) => r.status === "FAIL").length,
  }),
);
process.exitCode = results.some((r) => r.status === "FAIL") ? 1 : 0;
