import fs from "node:fs/promises";
import { launch, evidence, candidate } from "./tooling.mjs";
const browser = await launch();
const baseline = process.env.BASELINE_URL || "http://127.0.0.1:8017/";
const runs = [];
const conditions = {
  host: "Apple M4, 16 GiB RAM, macOS 26.6.2",
  browser: browser.version(),
  server:
    "Python 3.12.12 http.server on loopback; no server compression; source files as committed",
  deviceScaleFactor: 1,
  replicates: 3,
  cold: "New isolated browser context and cleared browser HTTP cache",
  warm: "Reload same context immediately after cold run; default HTTP caching and application storage retained",
  profiles: {
    local: {
      downloadBytesPerSecond: null,
      uploadBytesPerSecond: null,
      latencyMs: 0,
      cpuSlowdown: 1,
    },
    constrained: {
      downloadBytesPerSecond: 500000,
      uploadBytesPerSecond: 125000,
      latencyMs: 80,
      cpuSlowdown: 4,
    },
  },
  readiness:
    "Search: actual query result visible after the input is wired. Map: all classified community geometry attached and two animation frames elapsed; task usability verified separately. Baseline mobile is not claimed usable despite a rendered-map timestamp.",
  externalRequests:
    "Default external requests allowed; baseline Google Fonts is included. Cross-origin Resource Timing sizes may be unavailable; CDP transfer total is recorded.",
  limitations:
    "Emulated network/CPU on desktop hardware, not a physical phone. Background OS load is not controlled. No concurrent test runner during measurement.",
};
for (const profile of ["local", "constrained"])
  for (const [device, width, height] of [
    ["desktop", 1440, 900],
    ["mobile", 390, 844],
  ])
    for (let replicate = 1; replicate <= 3; replicate++)
      for (const [version, url] of [
        ["baseline", baseline],
        ["candidate", candidate],
      ]) {
        const context = await browser.newContext({
          viewport: { width, height },
          deviceScaleFactor: 1,
          isMobile: device === "mobile",
          hasTouch: device === "mobile",
        });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.clearBrowserCache");
        if (profile === "constrained") {
          await cdp.send("Network.emulateNetworkConditions", {
            offline: false,
            latency: 80,
            downloadThroughput: 500000,
            uploadThroughput: 125000,
            connectionType: "cellular4g",
          });
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        }
        await context.addInitScript(
          ({ version }) => {
            window.__measured = {};
            let mapPending = false;
            const poll = () => {
              const ready =
                version === "baseline"
                  ? document.querySelector("#search-status")
                  : document.querySelector("#search[data-ready]");
              if (ready && window.__measured.searchReady == null)
                window.__measured.searchReady = performance.now();
              const count = document.querySelectorAll(
                version === "baseline"
                  ? ".leaflet-overlay-pane path"
                  : "[data-community]",
              ).length;
              if (
                count >= (version === "baseline" ? 1796 : 1769) &&
                !mapPending
              ) {
                mapPending = true;
                requestAnimationFrame(() =>
                  requestAnimationFrame(
                    () => (window.__measured.mapRendered = performance.now()),
                  ),
                );
              }
              if (
                window.__measured.mapRendered == null ||
                window.__measured.searchReady == null
              )
                requestAnimationFrame(poll);
            };
            requestAnimationFrame(poll);
          },
          { version },
        );
        let bytes = 0;
        const logs = [],
          failed = [];
        cdp.on(
          "Network.loadingFinished",
          (e) => (bytes += e.encodedDataLength),
        );
        page.on("console", (m) => {
          if (["warning", "error"].includes(m.type()))
            logs.push(m.text().split("\n")[0]);
        });
        page.on("requestfailed", (r) =>
          failed.push({ url: r.url(), reason: r.failure()?.errorText }),
        );
        for (const cache of ["cold", "warm"]) {
          bytes = 0;
          logs.length = 0;
          failed.length = 0;
          try {
            if (cache === "cold")
              await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 60000,
              });
            else
              await page.reload({
                waitUntil: "domcontentloaded",
                timeout: 60000,
              });
            await page.waitForFunction(
              () => window.__measured?.searchReady != null,
              {},
              { timeout: 60000 },
            );
            const input = page.locator("#search");
            await input.fill("Харківська");
            const result = page
              .locator(
                version === "baseline"
                  ? "#search-results button"
                  : "#suggestions [role=option]",
              )
              .first();
            await result.waitFor({ timeout: 60000 });
            const searchUsefulMs = await page.evaluate(() => performance.now());
            await page.waitForFunction(
              () => window.__measured?.mapRendered != null,
              {},
              { timeout: 60000 },
            );
            const ready = await page.evaluate(() => window.__measured);
            const start = await page.evaluate(() => performance.now());
            await input.fill("UA46040010000033885");
            await result.waitFor();
            await page.waitForFunction(
              (version) =>
                document
                  .querySelector(
                    version === "baseline" ? "#search-results" : "#suggestions",
                  )
                  ?.textContent.includes("UA46040010000033885"),
              version,
              { timeout: 10000 },
            );
            const lookupMs = await page.evaluate(
              (start) => performance.now() - start,
              start,
            );
            // Both versions are probed using the same real community. Phone baseline pointer use was separately observed to fail.
            const row = {
              profile,
              device,
              replicate,
              version,
              cache,
              ...ready,
              searchUsefulMs,
              lookupMs,
              transferredBytes: bytes,
              console: [...new Set(logs)],
              failedRequests: [...failed],
              mapUsability:
                version === "baseline" && device === "mobile"
                  ? "FAIL: overlapping panels and missing persistent touch detail"
                  : "Verified by separate interaction tests",
            };
            runs.push(row);
            console.log(
              [
                profile,
                device,
                replicate,
                version,
                cache,
                "map",
                ready.mapRendered.toFixed(0),
                "search",
                searchUsefulMs.toFixed(0),
                "lookup",
                lookupMs.toFixed(0),
              ].join(" "),
            );
          } catch (e) {
            runs.push({
              profile,
              device,
              replicate,
              version,
              cache,
              status: "FAIL",
              error: e.message.split("\n")[0],
              console: [...new Set(logs)],
              failedRequests: [...failed],
            });
            console.log(
              "FAIL",
              profile,
              device,
              version,
              cache,
              e.message.split("\n")[0],
            );
          }
          await fs.writeFile(
            evidence + "performance.json",
            JSON.stringify({ conditions, runs }, null, 2) + "\n",
          );
        }
        await context.close();
      }
await browser.close();
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const summary = [];
for (const profile of ["local", "constrained"])
  for (const device of ["desktop", "mobile"])
    for (const version of ["baseline", "candidate"])
      for (const cache of ["cold", "warm"]) {
        const rows = runs.filter(
          (r) =>
            r.profile === profile &&
            r.device === device &&
            r.version === version &&
            r.cache === cache &&
            !r.status,
        );
        summary.push({
          profile,
          device,
          version,
          cache,
          n: rows.length,
          ...Object.fromEntries(
            [
              "mapRendered",
              "searchUsefulMs",
              "lookupMs",
              "transferredBytes",
            ].map((k) => [
              k,
              {
                median: median(rows.map((r) => r[k])),
                min: Math.min(...rows.map((r) => r[k])),
                max: Math.max(...rows.map((r) => r[k])),
              },
            ]),
          ),
        });
      }
await fs.writeFile(
  evidence + "performance-summary.json",
  JSON.stringify(summary, null, 2) + "\n",
);
console.log("Finished", runs.length, "runs");
process.exitCode = runs.some((r) => r.status === "FAIL") ? 1 : 0;
