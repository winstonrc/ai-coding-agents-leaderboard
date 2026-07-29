// SPDX-License-Identifier: MPL-2.0

export const SOURCE_URL = "https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json";
export const DATASET_VERSION = "v1.1";
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_ROWS = 1_000;
export const MAX_EXTERNAL_STRING_LENGTH = 200;

export class FeedValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "FeedValidationError";
  }
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new FeedValidationError(`${field} must be a non-empty string.`);
  }
  if (value.length > MAX_EXTERNAL_STRING_LENGTH) {
    throw new FeedValidationError(`${field} exceeds ${MAX_EXTERNAL_STRING_LENGTH} characters.`);
  }
  return value;
}

function requiredNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new FeedValidationError(`${field} must be a finite number.`);
  }
  return value;
}

function requiredInteger(value, field) {
  if (!Number.isInteger(value)) {
    throw new FeedValidationError(`${field} must be an integer.`);
  }
  return value;
}

function optionalNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  if (value.length > MAX_EXTERNAL_STRING_LENGTH) {
    throw new FeedValidationError(`${field} exceeds ${MAX_EXTERNAL_STRING_LENGTH} characters.`);
  }
  return value;
}

export function parseAndValidateFeed(text) {
  const responseBytes = new TextEncoder().encode(text).byteLength;
  if (responseBytes > MAX_RESPONSE_BYTES) {
    throw new FeedValidationError(`Response exceeds ${MAX_RESPONSE_BYTES} bytes.`);
  }

  let feed;
  try {
    feed = JSON.parse(text);
  } catch {
    throw new FeedValidationError("Response is not valid JSON.");
  }

  if (!feed || typeof feed !== "object" || Array.isArray(feed)) {
    throw new FeedValidationError("Response root must be an object.");
  }

  const generatedAt = requiredString(feed.generated_at, "generated_at");
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new FeedValidationError("generated_at must be an ISO-compatible date.");
  }

  const tasksInSet = requiredInteger(feed.n_tasks_in_set, "n_tasks_in_set");
  if (tasksInSet <= 0) {
    throw new FeedValidationError("n_tasks_in_set must be greater than zero.");
  }

  if (!Array.isArray(feed.rows) || feed.rows.length === 0 || feed.rows.length > MAX_ROWS) {
    throw new FeedValidationError(`rows must contain between 1 and ${MAX_ROWS} entries.`);
  }

  const identifiers = new Set();
  const configurations = feed.rows.map((row, index) => {
    const prefix = `rows[${index}]`;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new FeedValidationError(`${prefix} must be an object.`);
    }

    const config = requiredString(row.config, `${prefix}.config`);
    if (identifiers.has(config)) {
      throw new FeedValidationError(`Duplicate configuration identifier: ${config}.`);
    }
    identifiers.add(config);

    const passAt1 = requiredNumber(row.pass_at_1, `${prefix}.pass_at_1`);
    if (passAt1 < 0 || passAt1 > 1) {
      throw new FeedValidationError(`${prefix}.pass_at_1 must be between zero and one.`);
    }

    const tasksAttempted = requiredInteger(
      row.n_tasks_attempted,
      `${prefix}.n_tasks_attempted`,
    );
    const attempts = requiredInteger(row.n_attempted, `${prefix}.n_attempted`);
    const runs = requiredInteger(row.n_runs, `${prefix}.n_runs`);

    if (tasksAttempted <= 0 || tasksAttempted > tasksInSet) {
      throw new FeedValidationError(
        `${prefix}.n_tasks_attempted must be between 1 and n_tasks_in_set.`,
      );
    }
    if (attempts < tasksAttempted) {
      throw new FeedValidationError(
        `${prefix}.n_attempted must be at least n_tasks_attempted.`,
      );
    }
    if (runs < 1) {
      throw new FeedValidationError(`${prefix}.n_runs must be at least one.`);
    }

    return {
      config,
      harness: requiredString(row.harness, `${prefix}.harness`),
      model: requiredString(row.model, `${prefix}.model`),
      reasoningEffort: row.reasoning_effort === null
        || row.reasoning_effort === undefined
        ? null
        : requiredString(row.reasoning_effort, `${prefix}.reasoning_effort`),
      passAt1,
      meanCostUsd: requiredNumber(row.mean_cost_usd, `${prefix}.mean_cost_usd`),
      meanDurationSeconds: requiredNumber(
        row.mean_duration_seconds,
        `${prefix}.mean_duration_seconds`,
      ),
      tasksAttempted,
      tasksInSet,
      attempts,
      runs,
      ciHalf: optionalNumber(row.ci_half),
      ciLow: optionalNumber(row.ci_lo),
      ciHigh: optionalNumber(row.ci_hi),
      ciMethod: optionalString(row.ci_method, `${prefix}.ci_method`),
      meanOutputTokens: optionalNumber(row.mean_output_tokens),
      meanAgentSteps: optionalNumber(row.mean_agent_steps),
      medianDurationSeconds: optionalNumber(row.median_duration_seconds),
      note: optionalString(row.note ?? row.notes, `${prefix}.note`),
    };
  });

  return {
    datasetVersion: DATASET_VERSION,
    generatedAt,
    tasksInSet,
    configurations,
  };
}
