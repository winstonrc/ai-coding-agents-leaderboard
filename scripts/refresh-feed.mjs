// SPDX-License-Identifier: MPL-2.0

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  MAX_RESPONSE_BYTES,
  UPSTREAM_SOURCE_URL,
  parseAndValidateFeed,
  readBoundedResponseText,
} from "../src/data/validate-feed.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(root, "src", "data", "leaderboard-v1.1.json");

const response = await fetch(UPSTREAM_SOURCE_URL, {
  headers: { accept: "application/json" },
  signal: AbortSignal.timeout(10_000),
});
if (!response.ok) {
  throw new Error(`Source returned HTTP ${response.status}.`);
}

const contentLength = Number(response.headers.get("content-length"));
if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
  throw new Error(`Response exceeds ${MAX_RESPONSE_BYTES} bytes.`);
}

const contentType = response.headers.get("content-type") ?? "";
if (!contentType.toLowerCase().includes("application/json")) {
  throw new Error("Response content type is not JSON.");
}

const text = await readBoundedResponseText(response);
parseAndValidateFeed(text);
const publishedText = text.endsWith("\n") ? text : `${text}\n`;

await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, publishedText);
