import fs from "node:fs/promises";
import assert from "node:assert/strict";
import {
  root,
  evidence,
  candidate,
  launch,
  ready,
  settle,
} from "./tooling.mjs";
const data = JSON.parse(
  await fs.readFile(new URL("assets/data/data.json", root)),
);
const browser = await launch();
const identity = {
  browser: browser.version(),
  viewportScale: 1,
  source:
    "Unedited native Playwright screenshots; independent ephemeral contexts; no hidden/cropped UI or mocked source data.",
  states: [],
};
for (const [device, width, height] of [
  ["desktop", 1440, 900],
  ["mobile", 390, 844],
]) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile: device === "mobile",
    hasTouch: device === "mobile",
  });
  const page = await context.newPage();
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: false,
  });
  const shot = async (suffix) => {
    await settle(page);
    await page.waitForTimeout(420);
    await page.screenshot({
      path: evidence + `candidate-${device}${suffix ? "-" + suffix : ""}.png`,
    });
    identity.states.push({
      device,
      width,
      height,
      state: suffix || "overview",
      url: page.url(),
    });
  };
  await page.goto(candidate);
  await ready(page);
  await shot("");
  await page.locator("#search").fill("Харківська");
  await page.locator("#suggestion-6312027").waitFor();
  await shot("search");
  await page.locator("#search").press("ArrowDown");
  await page.locator("#search").press("Enter");
  await page.waitForFunction(
    () => document.querySelector("#detail").dataset.record === "6312027",
  );
  await shot("detail");
  await page.locator("#compare-selected").click();
  if (device === "mobile") {
    await page.locator(".detail-show-map").tap();
    await shot("selected-map");
    await page.locator("#zoom-in").tap();
    await page.locator("#zoom-out").tap();
  }
  await page.locator("#search").fill("UA46040010000033885");
  await page.locator("#suggestion-4604001").click();
  await page.locator("#compare-selected").click();
  await page.locator("#open-compare").click();
  await shot("comparison");
  await page.keyboard.press("Escape");
  await page.locator("#clear-compare").click();
  await page.getByRole("button", { name: "Про дані", exact: true }).click();
  await shot("about");
  await page.locator("#about").evaluate((n) => (n.scrollTop = n.scrollHeight));
  await shot("sources");
  await page.keyboard.press("Escape");
  await page.locator("#search").fill(data["2110007"].code);
  await page.locator("#suggestion-2110007").click();
  await shot("long-name");
  await page.locator("#search").fill(data["0102001"].code);
  await page.locator("#suggestion-0102001").click();
  await shot("without-geometry");
  await page.locator("#search").fill("Чорнобильська");
  await page.locator("#suggestion-3200000").click();
  if (device === "mobile") await page.locator(".detail-show-map").tap();
  await shot("special");
  await page.locator("#fit-map").click();
  await page.locator("#region").selectOption("Львівська область");
  await page.locator("#list-view").click();
  await shot("list");
  await page.locator("#search").fill("яяяяяяяя");
  await page.locator("#search").press("Enter");
  await shot("empty");
  await page
    .getByRole("button", { name: "Скинути пошук і фільтри", exact: true })
    .click();
  await page.locator("#map-view").click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await context.tracing.stop({
    path: evidence + `candidate-${device}-trace.zip`,
  });
  await context.close();
  console.log("Captured", device);
}
await browser.close();
await fs.writeFile(
  evidence + "visuals.json",
  JSON.stringify(identity, null, 2) + "\n",
);
