// SPDX-License-Identifier: MPL-2.0

import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  parseAndValidateFeed,
  parseAndValidateFeedMetadata,
} from "../src/data/validate-feed.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src");
const destination = path.join(root, "dist");
const publishedFeed = path.join(source, "data", "leaderboard-v1.1.json");
const publishedFeedMetadata = path.join(source, "data", "feed-metadata.json");

parseAndValidateFeed(await readFile(publishedFeed, "utf8"));
parseAndValidateFeedMetadata(await readFile(publishedFeedMetadata, "utf8"));
await rm(destination, { force: true, recursive: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
