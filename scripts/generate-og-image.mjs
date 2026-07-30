// SPDX-License-Identifier: MPL-2.0

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const feed = JSON.parse(await readFile(
  path.join(root, "src", "data", "leaderboard-v1.1.json"),
  "utf8",
));
const generatedAtUtc = `${new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
}).format(new Date(feed.generated_at))} UTC`;
const port = Number(process.env.PORT ?? 4174);
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "inherit"],
});

const serverReady = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Preview server did not start.")), 10_000);
  server.stdout.on("data", (chunk) => {
    if (!chunk.toString().includes(`http://127.0.0.1:${port}`)) return;
    clearTimeout(timeout);
    resolve();
  });
  server.on("exit", (code) => {
    clearTimeout(timeout);
    reject(new Error(`Preview server exited with code ${code}.`));
  });
});

let browser;
try {
  await serverReady;
  browser = await chromium.launch();
  const page = await browser.newPage({
    colorScheme: "light",
    deviceScaleFactor: 1,
    viewport: { width: 1200, height: 630 },
  });
  await page.goto(`http://127.0.0.1:${port}/?formula=v1`);
  await page.locator("#leaderboard-body tr").first().waitFor();
  await page.evaluate((generatedAt) => {
    const updated = document.createElement("p");
    updated.className = "og-updated";
    updated.textContent = `Default ranking · Data generated ${generatedAt}`;
    document.querySelector(".site-header .page-width").append(updated);
  }, generatedAtUtc);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "./og-image.css";
    stylesheet.addEventListener("load", resolve);
    stylesheet.addEventListener("error", () => reject(new Error("Preview stylesheet failed.")));
    document.head.append(stylesheet);
  }));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(root, "dist", "og-image.png"),
  });
} finally {
  await browser?.close();
  server.kill();
}
