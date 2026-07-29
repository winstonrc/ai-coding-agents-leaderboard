// SPDX-License-Identifier: MPL-2.0

import {
  DATASET_VERSION,
  FeedValidationError,
  MAX_RESPONSE_BYTES,
  SOURCE_URL,
  parseAndValidateFeed,
  readBoundedResponseText,
} from "./data/validate-feed.js";
import {
  FORMULA_V1,
  normalizePriorities,
  rankConfigurations,
} from "./scoring/v1.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const FETCH_TIMEOUT_MS = 10_000;
const EFFORT_ORDER = new Map([
  ["low", 0],
  ["medium", 1],
  ["high", 2],
  ["xhigh", 3],
  ["max", 4],
  [null, 5],
]);

const elements = {
  statusPanel: document.querySelector("#status-panel"),
  statusTitle: document.querySelector("#status-title"),
  statusDetail: document.querySelector("#status-detail"),
  retryButton: document.querySelector("#retry-button"),
  leaderboard: document.querySelector("#leaderboard"),
  passPriority: document.querySelector("#pass-priority"),
  costPriority: document.querySelector("#cost-priority"),
  timePriority: document.querySelector("#time-priority"),
  passPriorityValue: document.querySelector("#pass-priority-value"),
  costPriorityValue: document.querySelector("#cost-priority-value"),
  timePriorityValue: document.querySelector("#time-priority-value"),
  performanceFloor: document.querySelector("#performance-floor"),
  performanceFloorValue: document.querySelector("#performance-floor-value"),
  sortBy: document.querySelector("#sort-by"),
  paretoOnly: document.querySelector("#pareto-only"),
  visibleCount: document.querySelector("#visible-count"),
  chart: document.querySelector("#value-chart"),
  chartTooltip: document.querySelector("#chart-tooltip"),
  chartDetail: document.querySelector("#chart-detail"),
  tableBody: document.querySelector("#leaderboard-body"),
  emptyState: document.querySelector("#empty-state"),
  datasetVersion: document.querySelector("#dataset-version"),
  generatedAt: document.querySelector("#generated-at"),
  fetchedAt: document.querySelector("#fetched-at"),
  contentHash: document.querySelector("#content-hash"),
  sourceLink: document.querySelector("#source-link"),
};

const state = {
  feed: null,
  fetchedAt: null,
  contentHash: null,
  priorities: { ...FORMULA_V1.defaultPriorities },
  lastValidPriorities: { ...FORMULA_V1.defaultPriorities },
  performanceFloor: 0.6,
  sortBy: "value",
  paretoOnly: true,
};

function appendText(parent, tagName, text, className) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function createSvgElement(tagName, attributes = {}) {
  const element = document.createElementNS(SVG_NAMESPACE, tagName);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
}

function formatPercent(value, digits = 1) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatCurrency(value) {
  if (value === Number.POSITIVE_INFINITY) return "∞";
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDuration(value) {
  if (value === Number.POSITIVE_INFINITY) return "∞";
  if (!Number.isFinite(value)) return "—";
  if (value < 1) return `${Math.round(value * 60)} sec`;
  return `${value.toFixed(value < 10 ? 1 : 0)} min`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function formatNumber(value, maximumFractionDigits = 0) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function configurationName(configuration) {
  return configuration.reasoningEffort
    ? `${configuration.model} [${configuration.reasoningEffort}]`
    : configuration.model;
}

function setLoadingStatus() {
  elements.statusPanel.classList.remove("is-error");
  elements.statusTitle.textContent = "Loading published results…";
  elements.statusDetail.textContent = "Validating the complete source before calculating rankings.";
  elements.retryButton.hidden = true;
  elements.leaderboard.hidden = true;
}

function setErrorStatus(category, message, attemptedAt) {
  elements.statusPanel.classList.add("is-error");
  elements.statusTitle.textContent = `${category}: rankings unavailable`;
  elements.statusDetail.textContent = `${message} Last attempted ${formatDate(attemptedAt)}.`;
  elements.retryButton.hidden = false;
  elements.leaderboard.hidden = true;
  elements.tableBody.replaceChildren();
  clearChart();
}

function setSuccessStatus(rowCount) {
  elements.statusPanel.classList.remove("is-error");
  elements.statusTitle.textContent = `${formatNumber(rowCount)} configurations validated`;
  elements.statusDetail.textContent = "Rankings are calculated locally from the complete published response.";
  elements.retryButton.hidden = true;
  elements.leaderboard.hidden = false;
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchFeed(attemptedAt) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(SOURCE_URL, {
      cache: "no-cache",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Source returned HTTP ${response.status}.`);
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new FeedValidationError(`Response exceeds ${MAX_RESPONSE_BYTES} bytes.`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new FeedValidationError("Response content type is not JSON.");
    }

    const text = await readBoundedResponseText(response);
    const feed = parseAndValidateFeed(text);
    return {
      feed,
      attemptedAt,
      contentHash: await sha256(text),
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

async function loadFeed() {
  setLoadingStatus();
  const attemptedAt = new Date();

  try {
    const result = await fetchFeed(attemptedAt);
    state.feed = result.feed;
    state.fetchedAt = result.attemptedAt;
    state.contentHash = result.contentHash;
    renderProvenance();
    render();
    setSuccessStatus(state.feed.configurations.length);
  } catch (error) {
    state.feed = null;
    if (error instanceof FeedValidationError) {
      setErrorStatus("Validation failure", error.message, attemptedAt);
    } else if (error.name === "AbortError") {
      setErrorStatus("Source timeout", "The source did not respond within 10 seconds.", attemptedAt);
    } else {
      setErrorStatus("Source outage", error.message || "The source could not be loaded.", attemptedAt);
    }
  }
}

function readPriorities(changedKey) {
  const values = {
    passAt1: Number(elements.passPriority.value),
    costPerSuccess: Number(elements.costPriority.value),
    timePerSuccess: Number(elements.timePriority.value),
  };

  if (Object.values(values).every((value) => value === 0)) {
    const restored = state.lastValidPriorities[changedKey];
    values[changedKey] = restored > 0 ? restored : 1;
    const input = {
      passAt1: elements.passPriority,
      costPerSuccess: elements.costPriority,
      timePerSuccess: elements.timePriority,
    }[changedKey];
    input.value = String(values[changedKey]);
  }

  state.priorities = values;
  state.lastValidPriorities = { ...values };
  renderPriorityOutputs();
  render();
}

function renderPriorityOutputs() {
  const normalized = normalizePriorities(state.priorities);
  elements.passPriorityValue.textContent = formatPercent(normalized.passAt1, 0);
  elements.costPriorityValue.textContent = formatPercent(normalized.costPerSuccess, 0);
  elements.timePriorityValue.textContent = formatPercent(normalized.timePerSuccess, 0);
}

function primaryValue(configuration) {
  if (state.sortBy === "performance") return configuration.passAt1;
  if (state.sortBy === "cost") return configuration.expectedCostUsd;
  if (state.sortBy === "speed") return configuration.expectedTimeMinutes;
  return configuration.score;
}

function compareConfigurations(left, right) {
  const leftValue = primaryValue(left);
  const rightValue = primaryValue(right);
  const leftFinite = Number.isFinite(leftValue);
  const rightFinite = Number.isFinite(rightValue);

  if (leftFinite !== rightFinite) return leftFinite ? -1 : 1;
  if (leftFinite && leftValue !== rightValue) {
    const ascending = state.sortBy === "cost" || state.sortBy === "speed";
    return ascending ? leftValue - rightValue : rightValue - leftValue;
  }
  return left.config.localeCompare(right.config);
}

function isTied(left, right) {
  if (!left || !right) return false;
  return Object.is(primaryValue(left), primaryValue(right));
}

function renderTable(configurations) {
  const tableConfigurations = configurations
    .filter((configuration) => !state.paretoOnly || configuration.paretoEfficient)
    .sort(compareConfigurations);

  elements.tableBody.replaceChildren();
  let displayedRank = 0;

  tableConfigurations.forEach((configuration, index) => {
    if (!isTied(configuration, tableConfigurations[index - 1])) {
      displayedRank = index + 1;
    }

    const row = document.createElement("tr");
    if (!configuration.paretoEfficient) row.classList.add("is-dominated");
    if (configuration.tasksAttempted < configuration.tasksInSet) {
      row.classList.add("is-partial");
    }

    appendText(row, "td", String(displayedRank), "rank-cell");

    const nameCell = document.createElement("td");
    appendText(nameCell, "strong", configurationName(configuration));
    const effort = configuration.reasoningEffort ?? "default";
    const details = [
      configuration.harness,
      `${effort} effort`,
      `${formatNumber(configuration.attempts)} attempts`,
      `${formatNumber(configuration.runs)} runs`,
      `CI ${Number.isFinite(configuration.ciHalf) ? `±${formatPercent(configuration.ciHalf)}` : "—"}`,
      `output tokens ${Number.isFinite(configuration.meanOutputTokens) ? formatNumber(configuration.meanOutputTokens) : "—"}`,
      `steps ${Number.isFinite(configuration.meanAgentSteps) ? formatNumber(configuration.meanAgentSteps, 1) : "—"}`,
      `median attempt ${Number.isFinite(configuration.medianDurationSeconds) ? formatDuration(configuration.medianDurationSeconds / 60) : "—"}`,
      `note ${configuration.note ?? "—"}`,
    ];
    appendText(nameCell, "span", details.join(" · "), "configuration-detail");
    if (configuration.tasksAttempted < configuration.tasksInSet) {
      appendText(nameCell, "span", "Partial task coverage", "coverage-warning");
    }
    row.append(nameCell);

    appendText(
      row,
      "td",
      Number.isFinite(configuration.score) ? configuration.score.toFixed(1) : "Unpriced",
      "numeric",
    );

    const performanceText = Number.isFinite(configuration.ciHalf)
      ? `${formatPercent(configuration.passAt1)} ±${formatPercent(configuration.ciHalf)}`
      : formatPercent(configuration.passAt1);
    appendText(row, "td", performanceText, "numeric");
    appendText(row, "td", formatCurrency(configuration.expectedCostUsd), "numeric");
    appendText(row, "td", formatDuration(configuration.expectedTimeMinutes), "numeric");
    appendText(
      row,
      "td",
      `${configuration.tasksAttempted}/${configuration.tasksInSet}`,
      "numeric",
    );

    elements.tableBody.append(row);
  });

  elements.emptyState.hidden = tableConfigurations.length > 0;
  return tableConfigurations.length;
}

function clearChart() {
  elements.chart
    .querySelectorAll(":scope > :not(title):not(desc)")
    .forEach((element) => element.remove());
  elements.chartTooltip.hidden = true;
}

function niceMaximum(value) {
  if (value <= 10) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const multiplier = normalized <= 2 ? 2 : normalized <= 4 ? 4 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

function markerDetails(configuration) {
  const status = configuration.paretoEfficient ? "Pareto-efficient" : "Not Pareto-efficient";
  return `${configurationName(configuration)} — ${formatPercent(configuration.passAt1)} Pass@1, ${formatCurrency(configuration.expectedCostUsd)} expected cost per success, ${formatDuration(configuration.expectedTimeMinutes)} expected time per success, value index ${configuration.score.toFixed(1)}. ${status}.`;
}

function showChartDetails(configuration, marker) {
  const details = markerDetails(configuration);
  elements.chartDetail.textContent = details;
  elements.chartTooltip.textContent = details;
  elements.chartTooltip.hidden = false;

  const chartRect = elements.chart.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const left = markerRect.left - chartRect.left + markerRect.width / 2;
  const top = markerRect.top - chartRect.top;
  elements.chartTooltip.style.left = `${Math.max(8, Math.min(left, chartRect.width - 180))}px`;
  elements.chartTooltip.style.top = `${Math.max(8, top - 12)}px`;
}

function hideChartTooltip() {
  elements.chartTooltip.hidden = true;
}

function isFiniteChartConfiguration(configuration) {
  return Number.isFinite(configuration.expectedCostUsd)
    && Number.isFinite(configuration.expectedTimeMinutes)
    && Number.isFinite(configuration.score);
}

function renderChart(configurations) {
  clearChart();
  const finite = configurations.filter(isFiniteChartConfiguration);
  if (finite.length === 0) {
    const message = createSvgElement("text", {
      x: 480,
      y: 215,
      "text-anchor": "middle",
      class: "chart-note",
    });
    message.textContent = "No finite configurations meet the current floor.";
    elements.chart.append(message);
    return;
  }

  const margin = { top: 28, right: 34, bottom: 62, left: 68 };
  const width = 960 - margin.left - margin.right;
  const height = 430 - margin.top - margin.bottom;
  const maximumCost = niceMaximum(
    Math.max(...finite.map((configuration) => configuration.expectedCostUsd)) * 1.05,
  );
  const maximumPass = Math.min(
    1,
    Math.max(0.8, Math.ceil(Math.max(...finite.map((configuration) => configuration.passAt1)) * 10) / 10),
  );
  const x = (cost) => margin.left + width * (1 - cost / maximumCost);
  const y = (passAt1) => margin.top + height * (1 - passAt1 / maximumPass);

  const grid = createSvgElement("g");
  for (let index = 0; index <= 5; index += 1) {
    const cost = maximumCost * index / 5;
    const xPosition = x(cost);
    grid.append(createSvgElement("line", {
      x1: xPosition,
      x2: xPosition,
      y1: margin.top,
      y2: margin.top + height,
      class: "chart-grid",
    }));
    const label = createSvgElement("text", {
      x: xPosition,
      y: margin.top + height + 25,
      "text-anchor": "middle",
      class: "chart-tick",
    });
    label.textContent = formatCurrency(cost);
    grid.append(label);
  }
  for (let index = 0; index <= 4; index += 1) {
    const passAt1 = maximumPass * index / 4;
    const yPosition = y(passAt1);
    grid.append(createSvgElement("line", {
      x1: margin.left,
      x2: margin.left + width,
      y1: yPosition,
      y2: yPosition,
      class: "chart-grid",
    }));
    const label = createSvgElement("text", {
      x: margin.left - 12,
      y: yPosition + 4,
      "text-anchor": "end",
      class: "chart-tick",
    });
    label.textContent = formatPercent(passAt1, 0);
    grid.append(label);
  }
  elements.chart.append(grid);

  const xLabel = createSvgElement("text", {
    x: margin.left + width / 2,
    y: 420,
    "text-anchor": "middle",
    class: "chart-axis-label",
  });
  xLabel.textContent = "Expected cost per success → lower is better";
  elements.chart.append(xLabel);

  const yLabel = createSvgElement("text", {
    x: 18,
    y: margin.top + height / 2,
    transform: `rotate(-90 18 ${margin.top + height / 2})`,
    "text-anchor": "middle",
    class: "chart-axis-label",
  });
  yLabel.textContent = "Pass@1 → higher is better";
  elements.chart.append(yLabel);

  const groups = new Map();
  for (const configuration of finite) {
    const key = `${configuration.harness}\u0000${configuration.model}`;
    const group = groups.get(key) ?? [];
    group.push(configuration);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const sorted = group.sort((left, right) => {
      const leftOrder = EFFORT_ORDER.get(left.reasoningEffort) ?? 6;
      const rightOrder = EFFORT_ORDER.get(right.reasoningEffort) ?? 6;
      return leftOrder - rightOrder || left.config.localeCompare(right.config);
    });
    if (sorted.length < 2) continue;
    const path = sorted
      .map((configuration, index) => {
        const command = index === 0 ? "M" : "L";
        return `${command}${x(configuration.expectedCostUsd)},${y(configuration.passAt1)}`;
      })
      .join(" ");
    elements.chart.append(createSvgElement("path", { d: path, class: "chart-link" }));
  }

  const valueLeader = [...finite].sort((left, right) => right.score - left.score)[0];
  const performanceLeader = [...finite].sort(
    (left, right) => right.passAt1 - left.passAt1 || left.config.localeCompare(right.config),
  )[0];

  for (const configuration of finite) {
    const xPosition = x(configuration.expectedCostUsd);
    const yPosition = y(configuration.passAt1);
    const marker = configuration.paretoEfficient
      ? createSvgElement("rect", {
        x: xPosition - 5,
        y: yPosition - 5,
        width: 10,
        height: 10,
        transform: `rotate(45 ${xPosition} ${yPosition})`,
      })
      : createSvgElement("circle", {
        cx: xPosition,
        cy: yPosition,
        r: 5,
      });

    marker.setAttribute(
      "class",
      configuration.paretoEfficient ? "chart-point chart-point-pareto" : "chart-point",
    );
    marker.setAttribute("tabindex", "0");
    marker.setAttribute("role", "img");
    marker.setAttribute("aria-label", markerDetails(configuration));
    marker.addEventListener("mouseenter", () => showChartDetails(configuration, marker));
    marker.addEventListener("mouseleave", hideChartTooltip);
    marker.addEventListener("focus", () => showChartDetails(configuration, marker));
    marker.addEventListener("blur", hideChartTooltip);
    elements.chart.append(marker);

    if (configuration === valueLeader || configuration === performanceLeader) {
      const isValueLeader = configuration === valueLeader;
      const label = createSvgElement("text", {
        x: xPosition > 760 ? xPosition - 10 : xPosition + 10,
        y: yPosition + (isValueLeader ? 24 : -10),
        "text-anchor": xPosition > 760 ? "end" : "start",
        class: "chart-label",
      });
      label.textContent = configurationName(configuration);
      elements.chart.append(label);
    }
  }
}

function renderProvenance() {
  elements.datasetVersion.textContent = state.feed.datasetVersion;
  elements.generatedAt.textContent = formatDate(state.feed.generatedAt);
  elements.fetchedAt.textContent = formatDate(state.fetchedAt);
  elements.contentHash.textContent = state.contentHash;
  elements.sourceLink.href = SOURCE_URL;
  elements.sourceLink.textContent = `Published aggregate feed (${DATASET_VERSION})`;
}

function render() {
  if (!state.feed) return;
  const scored = rankConfigurations(state.feed.configurations, state.priorities);
  const floorEligible = scored.filter(
    (configuration) => configuration.passAt1 >= state.performanceFloor,
  );
  const paretoCount = floorEligible.filter(
    (configuration) => configuration.paretoEfficient,
  ).length;

  renderChart(floorEligible);
  const tableCount = renderTable(floorEligible);
  elements.visibleCount.textContent = `Chart ${floorEligible.filter(isFiniteChartConfiguration).length} · table ${tableCount} · ${paretoCount} Pareto-efficient`;
}

function validateFormulaSelector() {
  const formula = new URLSearchParams(window.location.search).get("formula");
  if (formula === null || formula === FORMULA_V1.id) return true;

  setErrorStatus(
    "Unsupported formula",
    `Formula "${formula}" is not available. Use ?formula=v1.`,
    new Date(),
  );
  return false;
}

elements.passPriority.addEventListener("input", () => readPriorities("passAt1"));
elements.costPriority.addEventListener("input", () => readPriorities("costPerSuccess"));
elements.timePriority.addEventListener("input", () => readPriorities("timePerSuccess"));
elements.performanceFloor.addEventListener("input", () => {
  state.performanceFloor = Number(elements.performanceFloor.value) / 100;
  elements.performanceFloorValue.textContent = `≥${elements.performanceFloor.value}%`;
  render();
});
elements.sortBy.addEventListener("change", () => {
  state.sortBy = elements.sortBy.value;
  render();
});
elements.paretoOnly.addEventListener("change", () => {
  state.paretoOnly = elements.paretoOnly.checked;
  render();
});
elements.retryButton.addEventListener("click", loadFeed);

renderPriorityOutputs();
if (validateFormulaSelector()) {
  loadFeed();
}
