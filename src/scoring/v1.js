// SPDX-License-Identifier: MPL-2.0

export const FORMULA_V1 = Object.freeze({
  id: "v1",
  anchors: Object.freeze({
    passAt1: 0.5,
    expectedCostUsd: 10,
    expectedTimeMinutes: 40,
  }),
  defaultPriorities: Object.freeze({
    passAt1: 60,
    costPerSuccess: 30,
    timePerSuccess: 10,
  }),
});

export function normalizePriorities(priorities) {
  const values = [
    priorities.passAt1,
    priorities.costPerSuccess,
    priorities.timePerSuccess,
  ];

  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new TypeError("Priorities must be finite, nonnegative numbers.");
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    throw new RangeError("At least one priority must be greater than zero.");
  }

  return {
    passAt1: priorities.passAt1 / total,
    costPerSuccess: priorities.costPerSuccess / total,
    timePerSuccess: priorities.timePerSuccess / total,
  };
}

export function expectedCostUsd(configuration) {
  if (configuration.passAt1 === 0) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(configuration.meanCostUsd) || configuration.meanCostUsd <= 0) {
    return null;
  }
  return configuration.meanCostUsd / configuration.passAt1;
}

export function expectedTimeMinutes(configuration) {
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
    && Number.isFinite(expectedCostUsd(configuration))
    && Number.isFinite(expectedTimeMinutes(configuration));
}

export function scoreV1(configuration, priorities = FORMULA_V1.defaultPriorities) {
  if (configuration.passAt1 === 0) return 0;
  if (!isRankable(configuration)) return null;

  const weights = normalizePriorities(priorities);
  const expectedCost = expectedCostUsd(configuration);
  const expectedTime = expectedTimeMinutes(configuration);

  return 100
    * Math.pow(configuration.passAt1 / FORMULA_V1.anchors.passAt1, weights.passAt1)
    * Math.pow(
      FORMULA_V1.anchors.expectedCostUsd / expectedCost,
      weights.costPerSuccess,
    )
    * Math.pow(
      FORMULA_V1.anchors.expectedTimeMinutes / expectedTime,
      weights.timePerSuccess,
    );
}

export function scoreV1Expanded(
  configuration,
  priorities = FORMULA_V1.defaultPriorities,
) {
  if (configuration.passAt1 === 0) return 0;
  if (!isRankable(configuration)) return null;

  const weights = normalizePriorities(priorities);
  const expectedCostAnchor = FORMULA_V1.anchors.expectedCostUsd;
  const expectedTimeAnchor = FORMULA_V1.anchors.expectedTimeMinutes;
  const passAnchor = FORMULA_V1.anchors.passAt1;
  const meanDurationMinutes = configuration.meanDurationSeconds / 60;

  const constant = 100
    * Math.pow(passAnchor, -weights.passAt1)
    * Math.pow(expectedCostAnchor, weights.costPerSuccess)
    * Math.pow(expectedTimeAnchor, weights.timePerSuccess);

  return constant
    * configuration.passAt1
    * Math.pow(configuration.meanCostUsd, -weights.costPerSuccess)
    * Math.pow(meanDurationMinutes, -weights.timePerSuccess);
}

export function dominates(candidate, configuration) {
  if (!isRankable(candidate) || !isRankable(configuration)) return false;

  const candidateCost = expectedCostUsd(candidate);
  const configurationCost = expectedCostUsd(configuration);
  const candidateTime = expectedTimeMinutes(candidate);
  const configurationTime = expectedTimeMinutes(configuration);

  const noWorse = candidate.passAt1 >= configuration.passAt1
    && candidateCost <= configurationCost
    && candidateTime <= configurationTime;
  const strictlyBetter = candidate.passAt1 > configuration.passAt1
    || candidateCost < configurationCost
    || candidateTime < configurationTime;

  return noWorse && strictlyBetter;
}

export function rankConfigurations(configurations, priorities) {
  const scored = configurations.map((configuration) => ({
    ...configuration,
    expectedCostUsd: expectedCostUsd(configuration),
    expectedTimeMinutes: expectedTimeMinutes(configuration),
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
