import { chromium } from "playwright";
import fs from "node:fs/promises";
const out = new URL("./evidence/", import.meta.url).pathname;
const browser = await chromium.launch();
for (const [name, width, height] of [
  ["desktop", 1440, 900],
  ["mobile", 390, 844],
]) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    hasTouch: name === "mobile",
    isMobile: name === "mobile",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("ERROR", e.message));
  await page.goto("http://127.0.0.1:8018/");
  await page.locator("#map[data-ready]").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out + `iteration-1-${name}.png` });
  await page.locator("#search").fill("Харківська");
  await page.locator("[role=option]").first().click();
  await page.screenshot({ path: out + `iteration-1-${name}-detail.png` });
  console.log(
    name,
    await page.evaluate(() => ({
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      height: innerHeight,
      detail: document.querySelector("#detail").innerText,
    })),
  );
  await page
    .getByRole("button", { name: "Джерела та пояснення ↗", exact: true })
    .click();
  await page.screenshot({ path: out + `iteration-1-${name}-about.png` });
  await page.addScriptTag({
    path: new URL("./node_modules/axe-core/axe.min.js", import.meta.url)
      .pathname,
  });
  const audit = await page.evaluate(() =>
    axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    }),
  );
  await fs.writeFile(
    out + `iteration-1-${name}-axe.json`,
    JSON.stringify(
      {
        violations: audit.violations,
        incomplete: audit.incomplete.map((x) => ({
          id: x.id,
          nodes: x.nodes.length,
        })),
      },
      null,
      2,
    ),
  );
  console.log(
    "axe",
    name,
    audit.violations.map((x) => ({
      id: x.id,
      nodes: x.nodes.map((n) => n.target),
    })),
  );
  await context.close();
}
await browser.close();
