// SPDX-License-Identifier: MPL-2.0

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_METADATA_BYTES,
  MAX_RESPONSE_BYTES,
  parseAndValidateFeed,
  parseAndValidateFeedMetadata,
  readBoundedResponseText,
} from "../src/data/validate-feed.js";
import { feed, feedRow } from "./fixtures.js";

function parse(value) {
  return parseAndValidateFeed(JSON.stringify(value));
}

test("unrecognized model and effort labels require no registry changes", () => {
  const parsed = parse(feed({
    rows: [feedRow({
      model: "future-model-9",
      reasoning_effort: "ultra",
    })],
  }));
  assert.equal(parsed.configurations[0].model, "future-model-9");
  assert.equal(parsed.configurations[0].reasoningEffort, "ultra");
});

test("duplicate identifiers fail closed", () => {
  assert.throws(
    () => parse(feed({ rows: [feedRow(), feedRow()] })),
    /Duplicate configuration identifier/,
  );
});

test("impossible coverage fails closed", () => {
  assert.throws(
    () => parse(feed({ rows: [feedRow({ n_tasks_attempted: 101 })] })),
    /n_tasks_attempted/,
  );
  assert.throws(
    () => parse(feed({ rows: [feedRow({ n_attempted: 99 })] })),
    /n_attempted/,
  );
  assert.throws(
    () => parse(feed({ rows: [feedRow({ n_runs: 0 })] })),
    /n_runs/,
  );
  assert.throws(
    () => parse(feed({ rows: [feedRow({ n_attempted: 401 })] })),
    /must not exceed/,
  );
  assert.throws(
    () => parse(feed({ rows: [feedRow({ n_tasks_passed_any: 101 })] })),
    /n_tasks_passed_any/,
  );
});

test("malformed critical values fail closed", () => {
  for (const mutation of [
    { pass_at_1: 2 },
    { pass_at_4: 2 },
    { pass_at_4: undefined },
    { n_tasks_passed_any: undefined },
    { mean_cost_usd: "5" },
    { mean_duration_seconds: null },
    { model: "" },
  ]) {
    assert.throws(() => parse(feed({ rows: [feedRow(mutation)] })));
  }
});

test("repeated-run fields must describe the same task count", () => {
  assert.throws(
    () => parse(feed({ rows: [feedRow({ pass_at_4: 0.81 })] })),
    /must equal n_tasks_passed_any/,
  );
});

test("malformed present optional values fail closed", () => {
  for (const mutation of [
    { ci_half: "invalid" },
    { mean_output_tokens: "invalid" },
    { note: 123 },
  ]) {
    assert.throws(() => parse(feed({ rows: [feedRow(mutation)] })));
  }
});

test("generated_at must be a valid ISO 8601 timestamp", () => {
  for (const generatedAt of ["0", "July 25, 2026", "2026-02-30T12:00:00Z"]) {
    assert.throws(
      () => parse(feed({ generated_at: generatedAt })),
      /generated_at/,
    );
  }
  assert.equal(
    parse(feed({ generated_at: "2026-07-25T12:00:00.123456+00:00" })).generatedAt,
    "2026-07-25T12:00:00.123456+00:00",
  );
});

test("feed metadata requires exactly one valid retrieval timestamp", () => {
  assert.deepEqual(
    parseAndValidateFeedMetadata('{"fetched_at":"2026-07-29T16:00:00Z"}'),
    { fetchedAt: "2026-07-29T16:00:00Z" },
  );
  for (const text of [
    "{}",
    '{"fetched_at":"July 29, 2026"}',
    '{"fetched_at":"2026-07-29T16:00:00Z","extra":true}',
    "[]",
    "not json",
  ]) {
    assert.throws(() => parseAndValidateFeedMetadata(text));
  }
  assert.throws(
    () => parseAndValidateFeedMetadata(
      JSON.stringify({ fetched_at: "2026-07-29T16:00:00Z", padding: "x".repeat(1_024) }),
    ),
    new RegExp(`exceeds ${MAX_METADATA_BYTES}`),
  );
});

test("response streaming stops after the byte limit", async () => {
  let cancelled = false;
  const chunk = new Uint8Array(MAX_RESPONSE_BYTES / 2 + 1);
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });

  await assert.rejects(
    () => readBoundedResponseText(new Response(body)),
    /Response exceeds/,
  );
  assert.equal(cancelled, true);
});

test("response streaming accepts a smaller explicit byte limit", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_METADATA_BYTES + 1));
      controller.close();
    },
  });

  await assert.rejects(
    () => readBoundedResponseText(new Response(body), MAX_METADATA_BYTES),
    new RegExp(`exceeds ${MAX_METADATA_BYTES}`),
  );
});

test("oversized responses and excessive rows fail closed", () => {
  const oversized = JSON.stringify(feed({ padding: "x".repeat(MAX_RESPONSE_BYTES) }));
  assert.throws(() => parseAndValidateFeed(oversized), /Response exceeds/);

  const rows = Array.from({ length: 1_001 }, (_, index) => (
    feedRow({ config: `agent-${index}` })
  ));
  assert.throws(() => parse(feed({ rows })), /between 1 and 1000/);
});

test("long external strings fail closed", () => {
  assert.throws(
    () => parse(feed({ rows: [feedRow({ model: "x".repeat(201) })] })),
    /exceeds 200/,
  );
  assert.throws(
    () => parse(feed({ rows: [feedRow({ ci_method: "x".repeat(201) })] })),
    /exceeds 200/,
  );
});

test("optional values are nullable and missing values stay unavailable", () => {
  const parsed = parse(feed());
  assert.equal(parsed.configurations[0].ciHalf, null);
  assert.equal(parsed.configurations[0].meanOutputTokens, null);
  assert.equal(parsed.configurations[0].meanAgentSteps, null);
  assert.equal(parsed.configurations[0].note, null);
});

test("unequal valid coverage remains rankable and visible to callers", () => {
  const parsed = parse(feed({
    rows: [feedRow({
      pass_at_4: 0.8,
      n_tasks_attempted: 90,
      n_tasks_passed_any: 72,
      n_attempted: 95,
    })],
  }));
  assert.equal(parsed.configurations[0].tasksAttempted, 90);
  assert.equal(parsed.configurations[0].tasksInSet, 100);
});

test("non-four-run rows remain valid and expose their published run count", () => {
  const parsed = parse(feed({
    rows: [feedRow({
      pass_at_4: 0.75,
      n_tasks_passed_any: 75,
      n_attempted: 190,
      n_runs: 2,
    })],
  }));
  assert.equal(parsed.configurations[0].passAt4, 0.75);
  assert.equal(parsed.configurations[0].tasksPassedAny, 75);
  assert.equal(parsed.configurations[0].runs, 2);
});
