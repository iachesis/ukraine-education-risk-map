import { chromium, firefox, webkit } from "playwright";
import fs from "node:fs";
export const root = new URL("../../", import.meta.url);
export const evidence = new URL("./evidence/", import.meta.url).pathname;
export const candidate = process.env.CANDIDATE_URL || "http://127.0.0.1:8018/";
export async function launch(engine = "chromium") {
  const path =
    engine === "firefox"
      ? new URL(
          "./.browsers/firefox-1543/firefox/Nightly.app/Contents/MacOS/firefox",
          import.meta.url,
        ).pathname
      : engine === "webkit"
        ? new URL("./.browsers/webkit-2359/pw_run.sh", import.meta.url).pathname
        : null;
  return { chromium, firefox, webkit }[engine].launch(
    path && fs.existsSync(path) ? { executablePath: path } : {},
  );
}
export async function ready(page) {
  await page.locator('#map[data-ready="true"]').waitFor({ state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}
export async function settle(page) {
  await page.waitForFunction(
    () => !document.querySelector(".leaflet-zoom-anim"),
  );
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}
