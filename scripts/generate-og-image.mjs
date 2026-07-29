// SPDX-License-Identifier: MPL-2.0

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 4174;
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
  await page.locator(".chart-point").first().waitFor();
  await page.evaluate(() => new Promise((resolve, reject) => {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "./og-image.css";
    stylesheet.addEventListener("load", resolve);
    stylesheet.addEventListener("error", () => reject(new Error("Preview stylesheet failed.")));
    document.head.append(stylesheet);
  }));
  await page.screenshot({
    path: path.join(root, "dist", "og-image.png"),
  });
} finally {
  await browser?.close();
  server.kill();
}
