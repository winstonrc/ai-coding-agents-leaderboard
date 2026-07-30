// SPDX-License-Identifier: MPL-2.0

import assert from "node:assert/strict";
import test from "node:test";

import {
  createModelColorMap,
  modelFamilyColor,
  modelProvider,
} from "../src/model-colors.js";

test("model providers follow the DeepSWE family convention", () => {
  assert.equal(modelProvider("gpt-5-6-sol"), "openai");
  assert.equal(modelProvider("claude-opus-5"), "anthropic");
  assert.equal(modelProvider("gemini-3-6-flash"), "google");
  assert.equal(modelProvider("kimi-k3"), "moonshot");
  assert.equal(modelProvider("glm-5-2"), "zhipu");
  assert.equal(modelProvider("unknown-model"), "other");
  assert.equal(modelFamilyColor("gpt-5-6-sol"), "var(--family-openai)");
  assert.equal(modelFamilyColor("claude-opus-5"), "var(--family-anthropic)");
});

test("model shades are ranked by each provider's best Pass@1", () => {
  const colors = createModelColorMap([
    { model: "gpt-leading", passAt1: 0.7 },
    { model: "gpt-leading", passAt1: 0.6 },
    { model: "gpt-second", passAt1: 0.65 },
    { model: "claude-leading", passAt1: 0.8 },
    { model: "claude-second", passAt1: 0.75 },
  ]);

  assert.equal(colors.get("gpt-leading"), "var(--family-openai)");
  assert.equal(
    colors.get("gpt-second"),
    "hsl(from var(--family-openai) h s clamp(25, calc(l + (8 * var(--mark-l-dir))), 82))",
  );
  assert.equal(colors.get("claude-leading"), "var(--family-anthropic)");
  assert.equal(
    colors.get("claude-second"),
    "hsl(from var(--family-anthropic) h s clamp(25, calc(l + (11 * var(--mark-l-dir))), 82))",
  );
});
