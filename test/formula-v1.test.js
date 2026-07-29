// SPDX-License-Identifier: MPL-2.0

import assert from "node:assert/strict";
import test from "node:test";

import {
  dominates,
  expectedCostUsd,
  expectedTimeMinutes,
  normalizePriorities,
  rankConfigurations,
  scoreV1,
  scoreV1Expanded,
} from "../src/scoring/v1.js";
import { configuration } from "./fixtures.js";

test("Formula v1 anchor produces 100", () => {
  assert.equal(scoreV1(configuration()), 100);
});

test("single-outcome priorities rank only by the selected outcome", () => {
  const fastExpensive = configuration({
    config: "fast-expensive",
    passAt1: 0.8,
    meanCostUsd: 16,
    meanDurationSeconds: 480,
  });
  const slowCheap = configuration({
    config: "slow-cheap",
    passAt1: 0.4,
    meanCostUsd: 2,
    meanDurationSeconds: 1_200,
  });

  assert.ok(
    scoreV1(slowCheap, { costPerSuccess: 100, timePerSuccess: 0 })
      > scoreV1(fastExpensive, { costPerSuccess: 100, timePerSuccess: 0 }),
  );
  assert.ok(
    scoreV1(fastExpensive, { costPerSuccess: 0, timePerSuccess: 100 })
      > scoreV1(slowCheap, { costPerSuccess: 0, timePerSuccess: 100 }),
  );
});

test("priorities normalize by ratio", () => {
  assert.deepEqual(
    normalizePriorities({ costPerSuccess: 60, timePerSuccess: 40 }),
    normalizePriorities({ costPerSuccess: 6, timePerSuccess: 4 }),
  );
  assert.throws(
    () => normalizePriorities({ costPerSuccess: 0, timePerSuccess: 0 }),
    /At least one priority/,
  );
  assert.throws(
    () => normalizePriorities({ costPerSuccess: -1, timePerSuccess: 1 }),
    /finite, nonnegative/,
  );
  assert.throws(
    () => normalizePriorities({ costPerSuccess: Infinity, timePerSuccess: 1 }),
    /finite, nonnegative/,
  );
});

test("expanded and outcome forms match", () => {
  const subject = configuration({
    passAt1: 0.69,
    meanCostUsd: 3.47,
    meanDurationSeconds: 1_080,
  });
  assert.ok(Math.abs(scoreV1(subject) - scoreV1Expanded(subject)) < 1e-12);
});

test("Formula v1 literal regression values remain frozen", () => {
  const subject = configuration({
    passAt1: 0.69,
    meanCostUsd: 3.47,
    meanDurationSeconds: 1_080,
  });
  assert.equal(scoreV1(subject).toFixed(12), "179.211716831106");
  assert.equal(expectedCostUsd(subject).toFixed(12), "5.028985507246");
  assert.equal(expectedTimeMinutes(subject).toFixed(12), "26.086956521739");
});

test("success rate improves both expected outcomes without a direct weight", () => {
  const lowerSuccess = configuration({ passAt1: 0.5 });
  const higherSuccess = configuration({ passAt1: 0.6 });

  assert.ok(scoreV1(higherSuccess) > scoreV1(lowerSuccess));
  assert.equal(
    (scoreV1(higherSuccess) / scoreV1(lowerSuccess)).toFixed(12),
    "1.200000000000",
  );
});

test("improving cost or time monotonically improves the score", () => {
  const subject = configuration();
  assert.ok(scoreV1(configuration({ meanCostUsd: 4 })) > scoreV1(subject));
  assert.ok(scoreV1(configuration({ meanDurationSeconds: 1_000 })) > scoreV1(subject));
});

test("zero-pass and unpriced policies are explicit", () => {
  const zeroPass = configuration({ passAt1: 0 });
  const unpriced = configuration({ meanCostUsd: 0 });

  assert.equal(scoreV1(zeroPass), 0);
  assert.equal(expectedCostUsd(zeroPass), Number.POSITIVE_INFINITY);
  assert.equal(expectedTimeMinutes(zeroPass), Number.POSITIVE_INFINITY);
  assert.equal(scoreV1(unpriced), null);
  assert.equal(expectedCostUsd(unpriced), null);
});

test("Pareto uses retry-adjusted cost and time point estimates", () => {
  const efficient = configuration({ config: "efficient" });
  const dominated = configuration({
    config: "dominated",
    meanCostUsd: 6,
    meanDurationSeconds: 1_500,
  });
  const tied = configuration({ config: "tied" });
  const partial = configuration({ config: "partial", tasksAttempted: 90 });
  const ranked = rankConfigurations([efficient, dominated, tied, partial]);

  assert.equal(dominates(efficient, dominated), true);
  assert.equal(ranked.find((row) => row.config === "dominated").paretoEfficient, false);
  assert.equal(ranked.find((row) => row.config === "efficient").score, 100);
  assert.equal(ranked.find((row) => row.config === "tied").score, 100);
  assert.equal(ranked.find((row) => row.config === "partial").score, 100);
});
