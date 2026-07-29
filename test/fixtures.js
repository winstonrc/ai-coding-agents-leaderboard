// SPDX-License-Identifier: MPL-2.0

export function configuration(overrides = {}) {
  return {
    config: "agent-a[medium]",
    harness: "agent-a",
    model: "model-a",
    reasoningEffort: "medium",
    passAt1: 0.5,
    meanCostUsd: 5,
    meanDurationSeconds: 1_200,
    tasksAttempted: 100,
    tasksInSet: 100,
    attempts: 100,
    runs: 1,
    ciHalf: null,
    ciLow: null,
    ciHigh: null,
    ciMethod: null,
    meanOutputTokens: null,
    meanAgentSteps: null,
    medianDurationSeconds: null,
    note: null,
    ...overrides,
  };
}

export function feedRow(overrides = {}) {
  return {
    config: "agent-a[medium]",
    harness: "agent-a",
    model: "model-a",
    reasoning_effort: "medium",
    pass_at_1: 0.5,
    mean_cost_usd: 5,
    mean_duration_seconds: 1_200,
    n_tasks_attempted: 100,
    n_attempted: 100,
    n_runs: 1,
    ...overrides,
  };
}

export function feed(overrides = {}) {
  return {
    generated_at: "2026-07-25T12:00:00Z",
    n_tasks_in_set: 100,
    rows: [feedRow()],
    ...overrides,
  };
}
