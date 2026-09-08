import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  root,
  evidence,
  candidate,
  launch,
  ready,
  settle,
} from "./tooling.mjs";
import {
  LEVELS,
  createRecords,
  searchRecords,
  normalize,
  exportCsv,
} from "../../assets/js/atlas-domain.js";

const raw = JSON.parse(
  await fs.readFile(new URL("assets/data/data.json", root)),
);
const manifest = JSON.parse(
  await fs.readFile(new URL("assets/derived/geography.json", root)),
);
const records = createRecords(raw, manifest),
  results = [];
const sourceFiles = [
  "index.html",
  "assets/styles/atlas.css",
  "assets/js/atlas.js",
  "assets/js/atlas-map.js",
  "assets/js/atlas-domain.js",
];
const codeHash = createHash("sha256");
for (const file of sourceFiles)
  codeHash.update(await fs.readFile(new URL(file, root)));
const report = {
  started: new Date().toISOString(),
  sourceFiles,
  sourceDigest: codeHash.digest("hex"),
  engines: {},
  results,
};
const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, status: "PASS", ...(detail ? { detail } : {}) });
    console.log("PASS", name);
  } catch (e) {
    results.push({
      name,
      status: "FAIL",
      error: e.message.split("\n").slice(0, 5).join("\n"),
    });
    console.log("FAIL", name, e.message.split("\n")[0]);
  }
};
const pick = async (page, id) => {
  await page.locator("#search").fill(raw[id]?.code || id);
  await page.locator("#suggestion-" + id).click();
  await page.waitForFunction(
    (id) => document.querySelector("#detail").dataset.record === id,
    id,
  );
  await settle(page);
};
const noOverflow = async (page) =>
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Horizontal page overflow",
  );

await check("Complete domain join and classification parity", () => {
  assert.equal(records.length, 1775);
  assert.equal(records.filter((r) => r.mapped).length, 1769);
  for (const [id, d] of Object.entries(raw)) {
    const r = records.find((r) => r.id === id);
    assert.equal(r.risk, d.risk);
    assert.equal(r.code, d.code);
    assert.equal(r.classification.label, d.risk);
  }
  assert.equal(
    records.filter((r) => r.classification.kind === "special").length,
    1,
  );
  assert.equal(records.filter((r) => !r.mapped).length, 6);
});
await check("All 1774 codes searchable, with exact-code priority", () => {
  for (const [id, d] of Object.entries(raw))
    assert.equal(
      searchRecords(records, d.code.toLowerCase()).records[0]?.id,
      id,
    );
});
await check(
  "Separate domain fixtures never coerce unknown into a valid class",
  () => {
    for (const risk of [undefined, null, "", "bogus", 0]) {
      const r = createRecords(
        { "0000001": { name: "FIXTURE", risk } },
        { geometryIds: ["0000001"], regions: {} },
      )[0];
      assert.notEqual(r.classification.kind, "valid");
    }
    const missing = createRecords(
      {},
      { geometryIds: ["0000001"], regions: {} },
    )[0];
    assert.equal(missing.classification.kind, "missing-record");
  },
);

for (const engine of (process.env.ENGINES || "chromium,firefox,webkit").split(
  ",",
)) {
  let browser;
  try {
    browser = await launch(engine);
    report.engines[engine] = { version: browser.version() };
  } catch (e) {
    report.engines[engine] = {
      status: "UNRUN",
      reason: e.message.split("\n")[0],
    };
    results.push({ name: engine + " launch", status: "UNRUN" });
    continue;
  }
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type()))
      errors.push(m.type() + ": " + m.text());
  });
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(candidate);
  await ready(page);
  await check(
    engine + ": opening, all 1769 mapped classifications, no overflow",
    async () => {
      await noOverflow(page);
      assert.equal(await page.locator("[data-community]").count(), 1769);
      const paths = await page
        .locator("[data-community]")
        .evaluateAll((nodes) =>
          nodes.map((n) => [n.dataset.community, n.getAttribute("fill")]),
        );
      for (const [id, fill] of paths) {
        const record = records.find((r) => r.id === id);
        assert.equal(
          fill,
          record.id === "3200000"
            ? "url(#zone-hatch)"
            : record.classification.color,
          id,
        );
      }
      assert.match(await page.locator("#record-total").innerText(), /1\s*774/);
    },
  );
  for (const level of LEVELS) {
    const id = Object.keys(raw).find(
      (id) => raw[id].risk === level.name && manifest.geometryIds.includes(id),
    );
    await check(
      engine + ": real " + level.name + " name, code and persistent selection",
      async () => {
        await page.locator("#search").fill(raw[id].name);
        assert.ok(
          (await page.locator("#suggestions").innerText()).includes(
            raw[id].code,
          ),
        );
        await pick(page, id);
        assert.equal(
          await page.locator(".risk-card strong").innerText(),
          level.name,
        );
        await page.mouse.move(1400, 850);
        assert.equal(
          await page.locator("#detail").getAttribute("data-record"),
          id,
        );
      },
    );
  }
  await check(
    engine + ": name priority, ambiguity, keyboard, focus, Escape",
    async () => {
      await page.locator("#search").fill("Харківська");
      assert.match(
        await page.locator("[role=option]").first().innerText(),
        /Харківська міська/,
      );
      await page.locator("#search").fill("Миколаївська");
      const texts = await page.locator("[role=option]").allTextContents();
      assert.ok(texts.length >= 5);
      assert.ok(texts.every((t) => t.includes("UA")));
      await page.locator("#search").press("ArrowDown");
      assert.ok(
        await page.locator("#search").getAttribute("aria-activedescendant"),
      );
      await page.locator("#search").press("Enter");
      assert.equal(await page.locator("#suggestion-panel").isVisible(), false);
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "detail-title",
      );
      await page.locator("#search").fill("Львівська");
      await page.locator("#search").press("Escape");
      assert.equal(
        await page.locator("#search").getAttribute("aria-expanded"),
        "false",
      );
    },
  );
  await check(
    engine + ": apostrophe variants, partial code and long Ukrainian name",
    async () => {
      const r = records.find((r) => r.name.includes("’"));
      await page.locator("#search").fill(r.name.replaceAll("’", "'"));
      assert.ok(
        (await page.locator("#suggestions").innerText()).includes(r.code),
      );
      await page.locator("#search").fill("6312027");
      assert.match(
        await page.locator("[role=option]").first().innerText(),
        /Харківська/,
      );
      await pick(page, "2110007");
      await noOverflow(page);
      assert.match(
        await page.locator("#detail-title").innerText(),
        /Дубриницько-Малоберезнянська/,
      );
    },
  );
  await check(
    engine + ": all six absent-boundary records and special territory",
    async () => {
      for (const id of manifest.unmappedIds) {
        await pick(page, id);
        assert.match(
          await page.locator(".detail-note").innerText(),
          /відсутні/,
        );
        assert.match(
          await page.locator("#map-instructions").innerText(),
          /відсутні/,
        );
      }
      await page.locator("#search").fill("Чорнобильська");
      await page.locator("#suggestion-3200000").click();
      assert.equal(
        await page.locator(".risk-card strong").innerText(),
        "Особлива територія",
      );
      assert.match(
        await page.locator(".detail-meta").innerText(),
        /Не зазначено/,
      );
    },
  );
  await check(
    engine + ": region and class filters, reset, list pagination and CSV",
    async () => {
      await page.locator("#fit-map").click();
      await page.locator("#region").selectOption("Львівська область");
      assert.equal(
        (await page.locator("#record-total").innerText()).replace(/\s/g, ""),
        "73",
      );
      const riskButton = page
        .locator("#distribution .risk-row")
        .filter({ hasText: "Задовільний" });
      await riskButton.focus();
      await riskButton.press("Enter");
      assert.ok(
        await page.evaluate(() =>
          document.activeElement.classList.contains("risk-row"),
        ),
      );
      await page.locator("#list-view").click();
      const expected = records.filter(
        (r) => r.region === "Львівська область" && r.risk === "Задовільний",
      );
      assert.equal(
        await page.locator(".community-row").count(),
        Math.min(40, expected.length),
      );
      const downloadPromise = page.waitForEvent("download");
      await page.locator("#download").click();
      const download = await downloadPromise;
      const bytes = await fs.readFile(await download.path(), "utf8");
      assert.equal(bytes, exportCsv(expected));
      await page.locator("#reset-filters").click();
      assert.equal(await page.locator(".community-row").count(), 40);
      await page.locator("#load-more").click();
      assert.equal(await page.locator(".community-row").count(), 80);
    },
  );
  await check(
    engine + ": empty result, comparison limit/removal and accessible dialog",
    async () => {
      await page.locator("#search").fill("яяяяяяяяяя");
      await page.locator("#search").press("Enter");
      assert.match(
        await page.locator(".empty-state").innerText(),
        /Громаду не знайдено/,
      );
      await page
        .getByRole("button", { name: "Скинути пошук і фільтри", exact: true })
        .click();
      const ids = ["4604001", "7104011", "4804021"];
      for (const id of ids) {
        await pick(page, id);
        await page.locator("#compare-selected").click();
      }
      assert.match(await page.locator("#compare-count").innerText(), /3 із 3/);
      await pick(page, "5608005");
      await page.locator("#compare-selected").click();
      assert.match(await page.locator("#toast").innerText(), /до трьох/);
      await page.locator("#open-compare").click();
      assert.equal(
        await page.locator("#comparison .comparison-card").count(),
        3,
      );
      for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
      assert.ok(
        await page.evaluate(() =>
          document
            .querySelector("#comparison")
            .contains(document.activeElement),
        ),
      );
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#comparison").isVisible(), false);
      await page.locator("#clear-compare").click();
      assert.equal(await page.locator("#compare-tray").isVisible(), false);
    },
  );
  await check(
    engine + ": URL restore, clipboard request, sources and focus return",
    async () => {
      await pick(page, "6312027");
      const url = page.url();
      assert.ok(url.includes("UA63120270000028556"));
      await page.reload();
      await ready(page);
      assert.equal(
        await page.locator("#detail").getAttribute("data-record"),
        "6312027",
      );
      await page
        .getByRole("button", { name: "Копіювати посилання ↗", exact: true })
        .click();
      await page.locator("#toast").waitFor({ state: "visible", timeout: 5000 });
      const opener = page.getByRole("button", {
        name: "Про дані",
        exact: true,
      });
      await opener.click();
      assert.ok(await page.locator("#about").isVisible());
      assert.match(
        await page.locator("#about").innerText(),
        /Офіційну дату чинності/,
      );
      await page.keyboard.press("Escape");
      assert.equal(
        await opener.evaluate((e) => e === document.activeElement),
        true,
      );
    },
  );
  await check(
    engine + ": no runtime errors or third-party requests on the normal path",
    () => {
      assert.deepEqual(errors, []);
      assert.ok(
        requests.every(
          (url) => url.startsWith(candidate) || url.startsWith("blob:"),
        ),
      );
      return { requests: requests.length };
    },
  );
  await check(
    engine + ": browser Back and Forward restore community selection",
    async () => {
      await pick(page, "4604001");
      await pick(page, "6312027");
      await page.goBack();
      await page.waitForFunction(
        () => document.querySelector("#detail").dataset.record === "4604001",
      );
      await page.goForward();
      await page.waitForFunction(
        () => document.querySelector("#detail").dataset.record === "6312027",
      );
    },
  );
  if (engine === "chromium") {
    for (const [viewport, width, height] of [
      ["desktop", 1440, 900],
      ["mobile", 390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      for (const surface of [
        "overview",
        "detail",
        "list",
        "about",
        "comparison",
      ])
        await check(
          "axe WCAG 2.2 tags: " + viewport + " " + surface,
          async () => {
            await page.goto(candidate);
            await ready(page);
            if (surface === "detail") await pick(page, "2110007");
            if (surface === "list") await page.locator("#list-view").click();
            if (surface === "about")
              await page
                .getByRole("button", { name: "Про дані", exact: true })
                .click();
            if (surface === "comparison") {
              for (const id of ["4604001", "6312027"]) {
                await pick(page, id);
                await page.locator("#compare-selected").click();
              }
              await page.locator("#open-compare").click();
            }
            await page.addScriptTag({
              path: new URL(
                "./node_modules/axe-core/axe.min.js",
                import.meta.url,
              ).pathname,
            });
            const audit = await page.evaluate(() =>
              axe.run(document, {
                runOnly: {
                  type: "tag",
                  values: [
                    "wcag2a",
                    "wcag2aa",
                    "wcag21a",
                    "wcag21aa",
                    "wcag22aa",
                  ],
                },
              }),
            );
            await fs.writeFile(
              evidence + `axe-${viewport}-${surface}.json`,
              JSON.stringify(
                {
                  violations: audit.violations,
                  incomplete: audit.incomplete.map((x) => ({
                    id: x.id,
                    targets: x.nodes.map((n) => n.target),
                  })),
                },
                null,
                2,
              ),
            );
            assert.deepEqual(
              audit.violations.map((x) => ({
                id: x.id,
                targets: x.nodes.map((n) => n.target),
              })),
              [],
            );
            return {
              passes: audit.passes.length,
              incomplete: audit.incomplete.map((x) => x.id),
            };
          },
        );
    }
  }
  await context.close();
  await browser.close();
}

await fs.writeFile(
  evidence + "verification.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    PASS: results.filter((x) => x.status === "PASS").length,
    FAIL: results.filter((x) => x.status === "FAIL").length,
    UNRUN: results.filter((x) => x.status === "UNRUN").length,
  }),
);
process.exitCode = results.some((x) => x.status !== "PASS") ? 1 : 0;
