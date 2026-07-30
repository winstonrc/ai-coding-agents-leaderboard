// SPDX-License-Identifier: MPL-2.0

export const FORMULA_V1 = Object.freeze({
  id: "v1",
  anchors: Object.freeze({
    amortizedCostPerPassUsd: 10,
    amortizedAgentTimePerPassMinutes: 40,
  }),
  defaultPriorities: Object.freeze({
    amortizedCostPerPass: 50,
    amortizedAgentTimePerPass: 50,
  }),
});

export function normalizePriorities(priorities) {
  const values = [
    priorities.amortizedCostPerPass,
    priorities.amortizedAgentTimePerPass,
  ];

  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new TypeError("Priorities must be finite, nonnegative numbers.");
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    throw new RangeError("At least one priority must be greater than zero.");
  }

  return {
    amortizedCostPerPass: priorities.amortizedCostPerPass / total,
    amortizedAgentTimePerPass: priorities.amortizedAgentTimePerPass / total,
  };
}

export function amortizedCostPerPassUsd(configuration) {
  if (configuration.passAt1 === 0) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(configuration.meanCostUsd) || configuration.meanCostUsd <= 0) {
    return null;
  }
  return configuration.meanCostUsd / configuration.passAt1;
}

export function amortizedAgentTimePerPassMinutes(configuration) {
  if (configuration.passAt1 === 0) return Number.POSITIVE_INFINITY;
  if (
    !Number.isFinite(configuration.meanDurationSeconds)
    || configuration.meanDurationSeconds <= 0
  ) {
    return null;
  }
  return configuration.meanDurationSeconds / 60 / configuration.passAt1;
}

export function isRankable(configuration) {
  return configuration.passAt1 > 0
    && Number.isFinite(amortizedCostPerPassUsd(configuration))
    && Number.isFinite(amortizedAgentTimePerPassMinutes(configuration));
}

export function scoreV1(configuration, priorities = FORMULA_V1.defaultPriorities) {
  if (configuration.passAt1 === 0) return 0;
  if (!isRankable(configuration)) return null;

  const weights = normalizePriorities(priorities);
  const amortizedCost = amortizedCostPerPassUsd(configuration);
  const amortizedAgentTime = amortizedAgentTimePerPassMinutes(configuration);

  return 100
    * Math.pow(
      FORMULA_V1.anchors.amortizedCostPerPassUsd / amortizedCost,
      weights.amortizedCostPerPass,
    )
    * Math.pow(
      FORMULA_V1.anchors.amortizedAgentTimePerPassMinutes / amortizedAgentTime,
      weights.amortizedAgentTimePerPass,
    );
}

export function scoreV1Expanded(
  configuration,
  priorities = FORMULA_V1.defaultPriorities,
) {
  if (configuration.passAt1 === 0) return 0;
  if (!isRankable(configuration)) return null;

  const weights = normalizePriorities(priorities);
  const amortizedCostAnchor = FORMULA_V1.anchors.amortizedCostPerPassUsd;
  const amortizedAgentTimeAnchor =
    FORMULA_V1.anchors.amortizedAgentTimePerPassMinutes;
  const meanDurationMinutes = configuration.meanDurationSeconds / 60;

  const constant = 100
    * Math.pow(amortizedCostAnchor, weights.amortizedCostPerPass)
    * Math.pow(amortizedAgentTimeAnchor, weights.amortizedAgentTimePerPass);

  return constant
    * configuration.passAt1
    * Math.pow(configuration.meanCostUsd, -weights.amortizedCostPerPass)
    * Math.pow(meanDurationMinutes, -weights.amortizedAgentTimePerPass);
}

export function dominates(candidate, configuration) {
  if (!isRankable(candidate) || !isRankable(configuration)) return false;

  const candidateCost = amortizedCostPerPassUsd(candidate);
  const configurationCost = amortizedCostPerPassUsd(configuration);
  const candidateTime = amortizedAgentTimePerPassMinutes(candidate);
  const configurationTime = amortizedAgentTimePerPassMinutes(configuration);

  const noWorse = candidateCost <= configurationCost
    && candidateTime <= configurationTime;
  const strictlyBetter = candidateCost < configurationCost
    || candidateTime < configurationTime;

  return noWorse && strictlyBetter;
}

export function rankConfigurations(configurations, priorities) {
  const scored = configurations.map((configuration) => ({
    ...configuration,
    amortizedCostPerPassUsd: amortizedCostPerPassUsd(configuration),
    amortizedAgentTimePerPassMinutes:
      amortizedAgentTimePerPassMinutes(configuration),
    score: scoreV1(configuration, priorities),
  }));

  return scored.map((configuration) => {
    const dominatedBy = scored
      .filter((candidate) => candidate.config !== configuration.config)
      .find((candidate) => dominates(candidate, configuration)) ?? null;

    return {
      ...configuration,
      dominatedBy,
      paretoEfficient: isRankable(configuration) && dominatedBy === null,
    };
  });
}
