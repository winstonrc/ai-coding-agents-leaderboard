// SPDX-License-Identifier: MPL-2.0

export function configuration(overrides = {}) {
  return {
    config: "agent-a[medium]",
    harness: "agent-a",
    model: "model-a",
    reasoningEffort: "medium",
    passAt1: 0.5,
    passAt4: 0.8,
    meanCostUsd: 5,
    meanDurationSeconds: 1_200,
    tasksAttempted: 100,
    tasksPassedAny: 80,
    tasksInSet: 100,
    attempts: 400,
    runs: 4,
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
    pass_at_4: 0.8,
    mean_cost_usd: 5,
    mean_duration_seconds: 1_200,
    n_tasks_attempted: 100,
    n_tasks_passed_any: 80,
    n_attempted: 400,
    n_runs: 4,
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
