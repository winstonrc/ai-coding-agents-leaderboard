// SPDX-License-Identifier: MPL-2.0

import {
  DATASET_VERSION,
  FeedValidationError,
  MAX_RESPONSE_BYTES,
  PUBLISHED_FEED_URL,
  UPSTREAM_SOURCE_URL,
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
const PUBLISHED_FEED_METADATA_URL = "./data/feed-metadata.json";
const CHART_SERIES_COUNT = 10;
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
  modelFilterSummary: document.querySelector("#model-filter-summary"),
  modelOptions: document.querySelector("#model-options"),
  selectAllModels: document.querySelector("#select-all-models"),
  clearModels: document.querySelector("#clear-models"),
  sortBy: document.querySelector("#sort-by"),
  paretoOnly: document.querySelector("#pareto-only"),
  visibleCount: document.querySelector("#visible-count"),
  chart: document.querySelector("#value-chart"),
  chartDetail: document.querySelector("#chart-detail"),
  tableBody: document.querySelector("#leaderboard-body"),
  emptyState: document.querySelector("#empty-state"),
  generatedAt: document.querySelector("#generated-at"),
  fetchedAt: document.querySelector("#fetched-at"),
  sourceLink: document.querySelector("#source-link"),
};

const state = {
  feed: null,
  fetchedAt: null,
  priorities: { ...FORMULA_V1.defaultPriorities },
  lastValidPriorities: { ...FORMULA_V1.defaultPriorities },
  performanceFloor: 0.6,
  selectedModelKeys: new Set(),
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

function formatRelativeValue(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}×` : "—";
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
  elements.statusPanel.hidden = false;
  elements.statusPanel.classList.remove("is-error");
  elements.statusTitle.textContent = "Loading published results…";
  elements.statusDetail.textContent = "Validating the complete source before calculating rankings.";
  elements.retryButton.hidden = true;
  elements.leaderboard.hidden = true;
}

function setErrorStatus(category, message, attemptedAt) {
  elements.statusPanel.hidden = false;
  elements.statusPanel.classList.add("is-error");
  elements.statusTitle.textContent = `${category}: rankings unavailable`;
  elements.statusDetail.textContent = `${message} Last attempted ${formatDate(attemptedAt)}.`;
  elements.retryButton.hidden = false;
  elements.leaderboard.hidden = true;
  elements.tableBody.replaceChildren();
  clearChart();
}

function setSuccessStatus(rowCount) {
  elements.statusPanel.hidden = true;
  elements.statusPanel.classList.remove("is-error");
  elements.statusTitle.textContent = `${formatNumber(rowCount)} configurations validated`;
  elements.statusDetail.textContent = "Rankings are calculated locally from the complete published response.";
  elements.retryButton.hidden = true;
  elements.leaderboard.hidden = false;
}

async function fetchFeed() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(PUBLISHED_FEED_URL, {
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
    const metadataResponse = await fetch(PUBLISHED_FEED_METADATA_URL, {
      cache: "no-cache",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!metadataResponse.ok) {
      throw new Error(`Feed metadata returned HTTP ${metadataResponse.status}.`);
    }
    const metadata = await metadataResponse.json();
    if (
      !metadata
      || typeof metadata.fetched_at !== "string"
      || Number.isNaN(new Date(metadata.fetched_at).getTime())
    ) {
      throw new FeedValidationError("Feed metadata has an invalid fetched_at timestamp.");
    }
    return { feed, fetchedAt: metadata.fetched_at };
  } finally {
    window.clearTimeout(timeout);
  }
}

async function loadFeed() {
  setLoadingStatus();
  const attemptedAt = new Date();

  try {
    const result = await fetchFeed();
    state.feed = result.feed;
    state.fetchedAt = result.fetchedAt;
    renderModelFilter();
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

function modelKey(configuration) {
  return JSON.stringify([configuration.harness, configuration.model]);
}

function updateModelFilterSummary(total) {
  elements.modelFilterSummary.textContent = `Models (${state.selectedModelKeys.size}/${total})`;
}

function setAllModels(selected) {
  const inputs = elements.modelOptions.querySelectorAll("input[type=checkbox]");
  state.selectedModelKeys = new Set(
    selected ? [...inputs].map((input) => input.dataset.modelKey) : [],
  );
  inputs.forEach((input) => {
    input.checked = selected;
  });
  updateModelFilterSummary(inputs.length);
  render();
}

function renderModelFilter() {
  const models = new Map();
  for (const configuration of state.feed.configurations) {
    const key = modelKey(configuration);
    if (!models.has(key)) {
      models.set(key, {
        key,
        model: configuration.model,
        harness: configuration.harness,
      });
    }
  }

  const modelNameCounts = new Map();
  for (const { model } of models.values()) {
    modelNameCounts.set(model, (modelNameCounts.get(model) ?? 0) + 1);
  }

  const options = [...models.values()]
    .map((option) => ({
      ...option,
      label: modelNameCounts.get(option.model) > 1
        ? `${option.model} (${option.harness})`
        : option.model,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));

  state.selectedModelKeys = new Set(options.map(({ key }) => key));
  elements.modelOptions.replaceChildren();
  for (const option of options) {
    const label = document.createElement("label");
    label.className = "model-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = true;
    input.dataset.modelKey = option.key;
    input.addEventListener("change", () => {
      if (input.checked) {
        state.selectedModelKeys.add(option.key);
      } else {
        state.selectedModelKeys.delete(option.key);
      }
      updateModelFilterSummary(options.length);
      render();
    });
    label.append(input, document.createTextNode(option.label));
    elements.modelOptions.append(label);
  }
  updateModelFilterSummary(options.length);
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
    appendText(nameCell, "strong", configurationName(configuration), "configuration-name");
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

    const valueCell = document.createElement("td");
    valueCell.className = "numeric";
    appendText(
      valueCell,
      "strong",
      Number.isFinite(configuration.relativeValue)
        ? formatRelativeValue(configuration.relativeValue)
        : "Unpriced",
      "relative-value",
    );
    appendText(
      valueCell,
      "span",
      Number.isFinite(configuration.score)
        ? `Formula v1 index ${configuration.score.toFixed(1)}`
        : "Formula v1 index —",
      "secondary-metric",
    );
    row.append(valueCell);

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
}

function markerDetails(configuration) {
  const status = configuration.paretoEfficient ? "Pareto-efficient" : "Not Pareto-efficient";
  return `${configurationName(configuration)} — ${formatRelativeValue(configuration.relativeValue)} relative value, ${formatPercent(configuration.passAt1)} first-attempt success, ${formatCurrency(configuration.expectedCostUsd)} expected cost per success, ${formatDuration(configuration.expectedTimeMinutes)} expected time per success, Formula v1 index ${configuration.score.toFixed(1)}. ${status}.`;
}

function showChartDetails(configuration, marker, groupId) {
  elements.chartDetail.textContent = markerDetails(configuration);
  elements.chart.classList.add("is-interacting");
  elements.chart.querySelectorAll(".chart-series").forEach((element) => {
    element.classList.toggle("is-muted", element.dataset.chartGroup !== groupId);
  });

  const crosshair = elements.chart.querySelector(".chart-crosshair");
  crosshair.setAttribute("visibility", "visible");
  const xPosition = marker.dataset.chartX;
  const yPosition = marker.dataset.chartY;
  const vertical = crosshair.querySelector(".chart-crosshair-vertical");
  vertical.setAttribute("x1", xPosition);
  vertical.setAttribute("x2", xPosition);
  const horizontal = crosshair.querySelector(".chart-crosshair-horizontal");
  horizontal.setAttribute("y1", yPosition);
  horizontal.setAttribute("y2", yPosition);
  const successLabel = crosshair.querySelector(".chart-crosshair-success");
  successLabel.setAttribute("x", xPosition);
  successLabel.textContent = formatPercent(configuration.passAt1);
  const valueLabel = crosshair.querySelector(".chart-crosshair-value");
  valueLabel.setAttribute("y", String(Number(yPosition) + 4));
  valueLabel.textContent = formatRelativeValue(configuration.relativeValue);

  const callout = elements.chart.querySelector(".chart-hover-label");
  const connector = callout.querySelector("line");
  const label = callout.querySelector("text");
  const xNumber = Number(xPosition);
  const yNumber = Number(yPosition);
  const seriesIndex = Number(groupId) % CHART_SERIES_COUNT;
  const anchor = xNumber > 480 ? "end" : "start";
  const labelX = anchor === "end" ? xNumber - 18 : xNumber + 18;
  const labelBelowPoint = yNumber < 70;
  const labelY = labelBelowPoint ? yNumber + 24 : yNumber - 22;
  callout.setAttribute(
    "class",
    `chart-hover-label chart-series-${seriesIndex}`,
  );
  connector.setAttribute("x1", xPosition);
  connector.setAttribute("y1", yPosition);
  connector.setAttribute("x2", String(anchor === "end" ? labelX + 4 : labelX - 4));
  connector.setAttribute("y2", String(labelBelowPoint ? labelY - 12 : labelY + 5));
  label.setAttribute("x", String(labelX));
  label.setAttribute("y", String(labelY));
  label.setAttribute("text-anchor", anchor);
  const [modelName, effort] = label.querySelectorAll("tspan");
  modelName.setAttribute("x", String(labelX));
  modelName.textContent = configuration.model;
  effort.setAttribute("x", String(labelX));
  effort.textContent = (configuration.reasoningEffort ?? "default").toUpperCase();
  callout.setAttribute("visibility", "visible");
}

function hideChartDetails() {
  elements.chartDetail.textContent = "";
  elements.chart.classList.remove("is-interacting");
  elements.chart.querySelector(".chart-crosshair")?.setAttribute("visibility", "hidden");
  elements.chart.querySelector(".chart-hover-label")?.setAttribute("visibility", "hidden");
  elements.chart.querySelectorAll(".chart-series").forEach((element) => {
    element.classList.remove("is-muted");
  });
}

function isFiniteChartConfiguration(configuration) {
  return Number.isFinite(configuration.expectedCostUsd)
    && Number.isFinite(configuration.expectedTimeMinutes)
    && Number.isFinite(configuration.score)
    && Number.isFinite(configuration.relativeValue);
}

function distributeChartLabels(labels, minimumY, maximumY, gap) {
  const sorted = labels.sort((left, right) => left.desiredY - right.desiredY);
  let nextY = minimumY;
  for (const label of sorted) {
    label.y = Math.max(label.desiredY, nextY);
    nextY = label.y + gap;
  }

  const overflow = Math.max(0, nextY - gap - maximumY);
  for (const label of sorted) {
    label.y -= overflow;
  }

  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    sorted[index].y = Math.min(sorted[index].y, sorted[index + 1].y - gap);
  }
  return sorted;
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
  const successInterval = 0.1;
  let minimumSuccess = Math.max(
    0,
    Math.floor(
      (
        Math.min(...finite.map((configuration) => configuration.passAt1))
        + 1e-9
      )
        / successInterval,
    ) * successInterval,
  );
  const maximumSuccess = Math.min(
    1,
    Math.max(
      minimumSuccess + 0.2,
      Math.ceil(
        (
          Math.max(...finite.map((configuration) => configuration.passAt1))
          - 1e-9
        )
          / successInterval,
      ) * successInterval,
    ),
  );
  if (minimumSuccess >= maximumSuccess) {
    minimumSuccess = Math.max(0, maximumSuccess - successInterval);
  }
  const successTickCount = Math.round(
    (maximumSuccess - minimumSuccess) / successInterval,
  );
  const relativeValueInterval = 0.1;
  const relativeValueTickCount = 1 / relativeValueInterval;
  const x = (passAt1) => margin.left
    + width * (passAt1 - minimumSuccess) / (maximumSuccess - minimumSuccess);
  const y = (relativeValue) => margin.top + height * (1 - relativeValue);

  const grid = createSvgElement("g");
  for (let index = 0; index <= successTickCount; index += 1) {
    const successRate = minimumSuccess + successInterval * index;
    const xPosition = x(successRate);
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
      class: "chart-tick chart-success-tick",
    });
    label.textContent = formatPercent(successRate, 0);
    grid.append(label);
  }
  for (let index = 0; index <= relativeValueTickCount; index += 1) {
    const relativeValue = relativeValueInterval * index;
    const yPosition = y(relativeValue);
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
      class: "chart-tick chart-value-tick",
    });
    label.textContent = `${relativeValue.toFixed(1)}×`;
    grid.append(label);
  }
  elements.chart.append(grid);

  const xLabel = createSvgElement("text", {
    x: margin.left + width / 2,
    y: 420,
    "text-anchor": "middle",
    class: "chart-axis-label",
  });
  xLabel.textContent = "First-attempt success rate";
  elements.chart.append(xLabel);

  const yLabel = createSvgElement("text", {
    x: 18,
    y: margin.top + height / 2,
    transform: `rotate(-90 18 ${margin.top + height / 2})`,
    "text-anchor": "middle",
    class: "chart-axis-label",
  });
  yLabel.textContent = "Relative value (leader = 1.00×)";
  elements.chart.append(yLabel);

  const efficiencyLabel = createSvgElement("text", {
    x: margin.left + width - 8,
    y: margin.top + 18,
    "text-anchor": "end",
    class: "chart-efficiency-label",
  });
  efficiencyLabel.textContent = "higher overall value ↑";
  elements.chart.append(efficiencyLabel);

  const groups = new Map();
  for (const configuration of finite) {
    const key = `${configuration.harness}\u0000${configuration.model}`;
    const group = groups.get(key) ?? [];
    group.push(configuration);
    groups.set(key, group);
  }
  const sortedGroups = [...groups.entries()].sort(([left], [right]) => (
    left.localeCompare(right)
  ));
  const groupIdentifiers = new Map(
    sortedGroups.map(([key], index) => [key, String(index)]),
  );

  const crosshair = createSvgElement("g", {
    class: "chart-crosshair",
    visibility: "hidden",
  });
  crosshair.append(
    createSvgElement("line", {
      y1: margin.top,
      y2: margin.top + height,
      class: "chart-crosshair-line chart-crosshair-vertical",
    }),
    createSvgElement("line", {
      x1: margin.left,
      x2: margin.left + width,
      class: "chart-crosshair-line chart-crosshair-horizontal",
    }),
    createSvgElement("text", {
      y: margin.top + height + 25,
      "text-anchor": "middle",
      class: "chart-crosshair-label chart-crosshair-success",
    }),
    createSvgElement("text", {
      x: margin.left - 12,
      "text-anchor": "end",
      class: "chart-crosshair-label chart-crosshair-value",
    }),
  );
  elements.chart.append(crosshair);

  for (const [key, group] of sortedGroups) {
    const sorted = group.sort((left, right) => {
      const leftOrder = EFFORT_ORDER.get(left.reasoningEffort) ?? 6;
      const rightOrder = EFFORT_ORDER.get(right.reasoningEffort) ?? 6;
      return leftOrder - rightOrder || left.config.localeCompare(right.config);
    });
    if (sorted.length >= 2) {
      const path = sorted
        .map((configuration, index) => {
          const command = index === 0 ? "M" : "L";
          return `${command}${x(configuration.passAt1)},${y(configuration.relativeValue)}`;
        })
        .join(" ");
      const seriesIndex = Number(groupIdentifiers.get(key)) % CHART_SERIES_COUNT;
      elements.chart.append(createSvgElement("path", {
        d: path,
        class: `chart-link chart-series chart-series-${seriesIndex}`,
        "data-chart-group": groupIdentifiers.get(key),
      }));
    }
  }

  for (const configuration of finite) {
    const key = `${configuration.harness}\u0000${configuration.model}`;
    const groupId = groupIdentifiers.get(key);
    const seriesIndex = Number(groupId) % CHART_SERIES_COUNT;
    const xPosition = x(configuration.passAt1);
    const yPosition = y(configuration.relativeValue);
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
      configuration.paretoEfficient
        ? `chart-point chart-point-pareto chart-series chart-series-${seriesIndex}`
        : `chart-point chart-series chart-series-${seriesIndex}`,
    );
    marker.setAttribute("data-chart-group", groupId);
    marker.setAttribute("data-chart-x", String(xPosition));
    marker.setAttribute("data-chart-y", String(yPosition));
    marker.setAttribute("data-config", configuration.config);
    marker.setAttribute("tabindex", "0");
    marker.setAttribute("role", "img");
    marker.setAttribute("aria-label", markerDetails(configuration));
    marker.addEventListener(
      "mouseenter",
      () => showChartDetails(configuration, marker, groupId),
    );
    marker.addEventListener("mouseleave", hideChartDetails);
    marker.addEventListener(
      "focus",
      () => showChartDetails(configuration, marker, groupId),
    );
    marker.addEventListener("blur", hideChartDetails);
    elements.chart.append(marker);
  }

  const labelGroups = { start: [], end: [] };
  for (const [key, group] of sortedGroups) {
    const representative = group[Math.floor((group.length - 1) / 2)];
    const xPosition = x(representative.passAt1);
    const yPosition = y(representative.relativeValue);
    const anchor = xPosition > margin.left + width * 0.5 ? "end" : "start";
    labelGroups[anchor].push({
      key,
      representative,
      xPosition,
      yPosition,
      desiredY: yPosition - 7,
      anchor,
    });
  }

  const labels = [
    ...distributeChartLabels(
      labelGroups.start,
      margin.top + 10,
      margin.top + height - 10,
      25,
    ),
    ...distributeChartLabels(
      labelGroups.end,
      margin.top + 10,
      margin.top + height - 10,
      25,
    ),
  ];

  for (const entry of labels) {
    const {
      key,
      representative,
      xPosition,
      yPosition,
      anchor,
    } = entry;
    const groupId = groupIdentifiers.get(key);
    const seriesIndex = Number(groupId) % CHART_SERIES_COUNT;
    const labelX = anchor === "end" ? xPosition - 12 : xPosition + 12;
    elements.chart.append(createSvgElement("line", {
      x1: xPosition,
      y1: yPosition,
      x2: anchor === "end" ? labelX + 3 : labelX - 3,
      y2: entry.y - 4,
      class: `chart-label-connector chart-series chart-series-${seriesIndex}`,
      "data-chart-group": groupId,
    }));
    const label = createSvgElement("text", {
      x: labelX,
      y: entry.y,
      "text-anchor": anchor,
      class: `chart-label chart-series chart-series-${seriesIndex}`,
      "data-chart-group": groupId,
    });
    const modelName = createSvgElement("tspan", { x: label.getAttribute("x") });
    modelName.textContent = representative.model;
    const effort = createSvgElement("tspan", {
      x: label.getAttribute("x"),
      dy: 12,
      class: "chart-effort-label",
    });
    effort.textContent = (representative.reasoningEffort ?? "default").toUpperCase();
    label.append(modelName, effort);
    elements.chart.append(label);
  }

  const hoverLabel = createSvgElement("g", {
    class: "chart-hover-label",
    visibility: "hidden",
  });
  const hoverText = createSvgElement("text", {
    class: "chart-label chart-hover-label-text",
  });
  hoverText.append(
    createSvgElement("tspan"),
    createSvgElement("tspan", {
      dy: 12,
      class: "chart-effort-label",
    }),
  );
  hoverLabel.append(
    createSvgElement("line", {
      class: "chart-label-connector chart-hover-label-connector",
    }),
    hoverText,
  );
  elements.chart.append(hoverLabel);
}

function renderProvenance() {
  elements.generatedAt.textContent = formatDate(state.feed.generatedAt);
  elements.fetchedAt.textContent = formatDate(state.fetchedAt);
  elements.sourceLink.href = UPSTREAM_SOURCE_URL;
  elements.sourceLink.textContent = `Published aggregate feed (${DATASET_VERSION})`;
}

function render() {
  if (!state.feed) return;
  const allScored = rankConfigurations(
    state.feed.configurations,
    state.priorities,
  );
  const floorReference = allScored.filter(
    (configuration) => configuration.passAt1 >= state.performanceFloor
      && Number.isFinite(configuration.score),
  );
  const highestScore = floorReference.length > 0
    ? Math.max(...floorReference.map((configuration) => configuration.score))
    : null;
  const selectedConfigurations = state.feed.configurations.filter(
    (configuration) => state.selectedModelKeys.has(modelKey(configuration)),
  );
  const scored = rankConfigurations(selectedConfigurations, state.priorities);
  const floorEligible = scored
    .filter((configuration) => configuration.passAt1 >= state.performanceFloor)
    .map((configuration) => ({
      ...configuration,
      relativeValue: Number.isFinite(highestScore) && highestScore > 0
        && Number.isFinite(configuration.score)
        ? configuration.score / highestScore
        : null,
    }));
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
elements.selectAllModels.addEventListener("click", () => setAllModels(true));
elements.clearModels.addEventListener("click", () => setAllModels(false));
elements.retryButton.addEventListener("click", loadFeed);

renderPriorityOutputs();
if (validateFormulaSelector()) {
  loadFeed();
}
