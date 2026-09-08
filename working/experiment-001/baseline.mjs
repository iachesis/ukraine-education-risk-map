import { chromium } from "playwright";
import fs from "node:fs/promises";

const out = new URL("./evidence/", import.meta.url).pathname;
const browser = await chromium.launch();
const report = {
  browser: browser.version(),
  conditions:
    "Python static server; loopback; unthrottled; deviceScaleFactor 1; new contexts; no cache priming",
  views: [],
};
for (const [name, width, height] of [
  ["desktop", 1440, 900],
  ["mobile", 390, 844],
]) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile: name === "mobile",
    hasTouch: name === "mobile",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (["warning", "error"].includes(m.type()))
      errors.push(m.type() + ": " + m.text().split("\n")[0]);
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: false,
  });
  await page.goto("http://127.0.0.1:8017/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".leaflet-overlay-pane path").length >= 1796,
  );
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const mapMs = await page.evaluate(() => performance.now());
  await page.screenshot({ path: out + `baseline-${name}.png` });
  await page.locator("#search").fill("Харківська");
  await page
    .locator("#search-results button")
    .first()
    .waitFor({ state: "visible" });
  const searchMs = await page.evaluate(() => performance.now());
  await page.screenshot({ path: out + `baseline-${name}-search.png` });
  let pointerSelection = "PASS";
  try {
    await page
      .locator("#search-results button")
      .first()
      .click({ timeout: 2500 });
  } catch (e) {
    pointerSelection =
      "FAIL: result intercepted by overlapping baseline panels";
    await page.locator("#search").press("Enter");
  }
  report.views.push({
    name,
    width,
    height,
    mapMs,
    searchMs,
    pointerSelection,
    layout: await page.evaluate(() => ({
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      visibleInfo: document.querySelector(".info")?.innerText,
    })),
    errors,
  });
  await context.tracing.stop({ path: out + `baseline-${name}-trace.zip` });
  await context.close();
}
await fs.writeFile(
  out + "baseline-inspection.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
await browser.close();
