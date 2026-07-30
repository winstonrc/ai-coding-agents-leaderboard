// SPDX-License-Identifier: MPL-2.0

import {
  DATASET_VERSION,
  FeedValidationError,
  MAX_METADATA_BYTES,
  MAX_RESPONSE_BYTES,
  PUBLISHED_FEED_URL,
  UPSTREAM_SOURCE_URL,
  parseAndValidateFeed,
  parseAndValidateFeedMetadata,
  readBoundedResponseText,
} from "./data/validate-feed.js";
import {
  FORMULA_V1,
  normalizePriorities,
  rankConfigurations,
} from "./scoring/v1.js";
import {
  pointInsideRectangle,
  rectangleOverlapArea,
  segmentIntersectsRectangle,
  segmentsIntersect,
} from "./chart-geometry.js";

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
  costPriority: document.querySelector("#cost-priority"),
  costPriorityValue: document.querySelector("#cost-priority-value"),
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
  performanceFloor: 0.6,
  selectedModelKeys: new Set(),
  sortBy: "value",
  paretoOnly: false,
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
      throw new FeedValidationError(
        `Feed metadata returned HTTP ${metadataResponse.status}.`,
      );
    }
    const metadataContentLength = Number(metadataResponse.headers.get("content-length"));
    if (
      Number.isFinite(metadataContentLength)
      && metadataContentLength > MAX_METADATA_BYTES
    ) {
      throw new FeedValidationError(`Response exceeds ${MAX_METADATA_BYTES} bytes.`);
    }
    const metadataContentType = metadataResponse.headers.get("content-type") ?? "";
    if (!metadataContentType.toLowerCase().includes("application/json")) {
      throw new FeedValidationError("Feed metadata content type is not JSON.");
    }
    const metadataText = await readBoundedResponseText(
      metadataResponse,
      MAX_METADATA_BYTES,
    );
    const metadata = parseAndValidateFeedMetadata(metadataText);
    return { feed, fetchedAt: metadata.fetchedAt };
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
    setSuccessStatus(state.feed.configurations.length);
    render();
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

function configurationGroupKey(configuration) {
  return `${configuration.harness}\u0000${configuration.model}`;
}

function createSeriesMap(configurations) {
  const keys = new Set(configurations.map(configurationGroupKey));
  return new Map(
    [...keys]
      .sort((left, right) => left.localeCompare(right))
      .map((key, index) => [key, String(index)]),
  );
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

function readPriorities() {
  const amortizedCostPerPass = Number(elements.costPriority.value);
  state.priorities = {
    amortizedCostPerPass,
    amortizedAgentTimePerPass: 100 - amortizedCostPerPass,
  };
  renderPriorityOutputs();
  render();
}

function renderPriorityOutputs() {
  const normalized = normalizePriorities(state.priorities);
  elements.costPriorityValue.textContent = `${
    formatPercent(normalized.amortizedAgentTimePerPass, 0)
  } Time · ${formatPercent(normalized.amortizedCostPerPass, 0)} Cost`;
  elements.costPriority.setAttribute(
    "aria-valuetext",
    elements.costPriorityValue.textContent,
  );
}

function primaryValue(configuration) {
  if (state.sortBy === "performance") return configuration.passAt1;
  if (state.sortBy === "persistence") {
    return configuration.runs === 4 ? configuration.passAt4 : null;
  }
  if (state.sortBy === "cost") return configuration.amortizedCostPerPassUsd;
  if (state.sortBy === "speed") {
    return configuration.amortizedAgentTimePerPassMinutes;
  }
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

function renderTable(configurations, seriesMap) {
  const tableConfigurations = configurations
    .filter((configuration) => !state.paretoOnly || configuration.paretoEfficient)
    .sort(compareConfigurations);

  elements.tableBody.replaceChildren();

  tableConfigurations.forEach((configuration) => {
    const row = document.createElement("tr");
    row.setAttribute("role", "row");
    row.dataset.config = configuration.config;
    if (!configuration.paretoEfficient) row.classList.add("is-dominated");
    if (configuration.tasksAttempted < configuration.tasksInSet) {
      row.classList.add("is-partial");
    }

    const nameCell = document.createElement("td");
    nameCell.className = "configuration-cell";
    nameCell.setAttribute("role", "cell");
    const displayName = configuration.tasksAttempted < configuration.tasksInSet
      ? `${configurationName(configuration)} (${configuration.tasksAttempted}/${configuration.tasksInSet} tasks)`
      : configurationName(configuration);
    appendText(nameCell, "strong", displayName, "configuration-name");
    const valueBar = appendText(nameCell, "span", "", "relative-value-bar");
    valueBar.setAttribute("aria-hidden", "true");
    const seriesId = seriesMap.get(configurationGroupKey(configuration));
    const barClass = Number.isFinite(Number(seriesId))
      ? `relative-value-bar-fill chart-series-${Number(seriesId) % CHART_SERIES_COUNT}`
      : "relative-value-bar-fill";
    const valueBarFill = appendText(valueBar, "span", "", barClass);
    const relativeValue = Number.isFinite(configuration.relativeValue)
      ? Math.max(0, Math.min(1, configuration.relativeValue))
      : 0;
    valueBarFill.style.width = `${relativeValue * 100}%`;
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
    ];
    if (configuration.note) details.push(`note ${configuration.note}`);
    if (configuration.paretoEfficient) {
      details.push("Pareto-efficient among selected models");
    }
    if (configuration.tasksAttempted < configuration.tasksInSet) {
      details.push(
        `partial task coverage ${configuration.tasksAttempted}/${configuration.tasksInSet}`,
      );
    }
    nameCell.title = `${configurationName(configuration)} · ${details.join(" · ")}`;
    nameCell.setAttribute(
      "aria-label",
      `${configurationName(configuration)}. ${details.join(" · ")}`,
    );
    row.append(nameCell);

    const valueCell = document.createElement("td");
    valueCell.className = "numeric value-cell";
    valueCell.setAttribute("role", "cell");
    appendText(
      valueCell,
      "strong",
      Number.isFinite(configuration.relativeValue)
        ? formatRelativeValue(configuration.relativeValue)
        : "Unpriced",
      "relative-value",
    );
    row.append(valueCell);

    const timeCell = appendText(
      row,
      "td",
      formatDuration(configuration.amortizedAgentTimePerPassMinutes),
      "numeric time-cell",
    );
    timeCell.dataset.label = "Time/pass";
    timeCell.setAttribute("role", "cell");
    const costCell = appendText(
      row,
      "td",
      formatCurrency(configuration.amortizedCostPerPassUsd),
      "numeric cost-cell",
    );
    costCell.dataset.label = "Cost/pass";
    costCell.setAttribute("role", "cell");
    const performanceCell = document.createElement("td");
    performanceCell.className = "numeric performance-cell";
    performanceCell.dataset.label = "1-run success";
    performanceCell.setAttribute("role", "cell");
    appendText(
      performanceCell,
      "span",
      formatPercent(configuration.passAt1),
      "performance-value",
    );
    if (Number.isFinite(configuration.ciHalf)) {
      appendText(
        performanceCell,
        "span",
        `±${formatPercent(configuration.ciHalf)}`,
        "performance-ci",
      );
    }
    row.append(performanceCell);
    const persistenceCell = document.createElement("td");
    persistenceCell.className = "numeric persistence-cell";
    persistenceCell.dataset.label = "4-run success";
    persistenceCell.setAttribute("role", "cell");
    persistenceCell.textContent = configuration.runs === 4
      ? formatPercent(configuration.passAt4)
      : "—";
    persistenceCell.title = configuration.runs === 4
      ? `${configuration.tasksPassedAny}/${configuration.tasksAttempted} tasks within 4 runs`
      : `${configuration.runs} published runs; not comparable`;
    persistenceCell.setAttribute(
      "aria-label",
      `${persistenceCell.textContent}. ${persistenceCell.title}`,
    );
    row.append(persistenceCell);
    elements.tableBody.append(row);
    if (row.scrollWidth > row.clientWidth + 1) {
      row.tabIndex = 0;
    }
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
  const status = configuration.paretoEfficient
    ? "Pareto-efficient"
    : "Not Pareto-efficient";
  return `${configurationName(configuration)} — ${
    formatPercent(configuration.passAt1)
  } 1-run success · ${
    formatPercent(configuration.passAt4)
  } ${configuration.runs}-run success · ${
    formatCurrency(configuration.amortizedCostPerPassUsd)
  } amortized cost · ${
    formatDuration(configuration.amortizedAgentTimePerPassMinutes)
  } amortized time · ${
    formatRelativeValue(configuration.relativeValue)
  } value · ${status}.`;
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
  const costLabel = crosshair.querySelector(".chart-crosshair-cost");
  costLabel.setAttribute("x", xPosition);
  costLabel.textContent = formatCurrency(configuration.amortizedCostPerPassUsd);
  const timeLabel = crosshair.querySelector(".chart-crosshair-time");
  timeLabel.setAttribute("y", String(Number(yPosition) + 4));
  timeLabel.textContent = elements.chart.classList.contains("is-compact")
    ? formatNumber(configuration.amortizedAgentTimePerPassMinutes)
    : formatDuration(configuration.amortizedAgentTimePerPassMinutes);

  elements.chart.querySelectorAll(".chart-point-label.is-active").forEach((label) => {
    label.classList.remove("is-active");
  });
  [...elements.chart.querySelectorAll(".chart-point-label")]
    .find((label) => label.dataset.config === configuration.config)
    ?.classList.add("is-active");
}

function hideChartDetails() {
  elements.chartDetail.textContent = "";
  elements.chart.classList.remove("is-interacting");
  elements.chart.querySelector(".chart-crosshair")?.setAttribute("visibility", "hidden");
  elements.chart.querySelectorAll(".chart-point-label.is-active").forEach((label) => {
    label.classList.remove("is-active");
  });
  elements.chart.querySelectorAll(".chart-series").forEach((element) => {
    element.classList.remove("is-muted");
  });
}

let resetChartInteraction = hideChartDetails;

function isFiniteChartConfiguration(configuration) {
  return Number.isFinite(configuration.amortizedCostPerPassUsd)
    && Number.isFinite(configuration.amortizedAgentTimePerPassMinutes)
    && Number.isFinite(configuration.score)
    && Number.isFinite(configuration.relativeValue);
}

function connectorEnd(point, rectangle) {
  const edge = {
    x: Math.max(rectangle.left, Math.min(point.x, rectangle.right)),
    y: Math.max(rectangle.top, Math.min(point.y, rectangle.bottom)),
  };
  const center = {
    x: (rectangle.left + rectangle.right) / 2,
    y: (rectangle.top + rectangle.bottom) / 2,
  };
  const distance = Math.hypot(center.x - edge.x, center.y - edge.y);
  if (distance === 0) return edge;
  const inset = Math.min(5, distance);
  return {
    x: edge.x + (center.x - edge.x) / distance * inset,
    y: edge.y + (center.y - edge.y) / distance * inset,
  };
}

function labelRectangles(point, width, height, bounds, offsets, diagonalOnly) {
  const positions = offsets.flatMap((offset) => {
    const diagonalPositions = [
      { left: point.x + offset, top: point.y - offset - height },
      { left: point.x + offset, top: point.y + offset },
      { left: point.x - offset - width, top: point.y + offset },
      { left: point.x - offset - width, top: point.y - offset - height },
    ];
    if (diagonalOnly) return diagonalPositions;
    return [
      diagonalPositions[0],
      { left: point.x + offset, top: point.y - height / 2 },
      diagonalPositions[1],
      { left: point.x - width / 2, top: point.y + offset },
      diagonalPositions[2],
      { left: point.x - offset - width, top: point.y - height / 2 },
      diagonalPositions[3],
      { left: point.x - width / 2, top: point.y - offset - height },
    ];
  });
  return positions.map((position, index) => {
    const left = Math.max(
      bounds.left,
      Math.min(position.left, bounds.right - width),
    );
    const top = Math.max(
      bounds.top,
      Math.min(position.top, bounds.bottom - height),
    );
    return {
      bottom: top + height,
      index,
      left,
      right: left + width,
      top,
    };
  });
}

function chooseLabelRectangle({
  bounds,
  height,
  occupiedConnectors,
  occupiedLabels,
  point,
  points,
  segments,
  width,
  offsets = [16, 28, 40, 52],
  diagonalOnly = false,
}) {
  return labelRectangles(point, width, height, bounds, offsets, diagonalOnly)
    .map((rectangle) => {
      const connector = connectorEnd(point, rectangle);
      const connectorSegment = { start: point, end: connector };
      const coversTarget = pointInsideRectangle(point, rectangle, 4) ? 1 : 0;
      const labelOverlap = occupiedLabels.reduce(
        (total, placed) => total + rectangleOverlapArea(rectangle, placed, 8),
        0,
      );
      const pointOverlaps = points.filter(
        (candidate) => candidate !== point
          && pointInsideRectangle(candidate, rectangle, 7),
      ).length;
      const lineIntersections = segments.filter(
        (segment) => segmentIntersectsRectangle(
          segment.start,
          segment.end,
          rectangle,
          2,
        ),
      ).length;
      const labelConnectorIntersections = occupiedConnectors.filter(
        (placed) => segmentIntersectsRectangle(
          placed.start,
          placed.end,
          rectangle,
          2,
        ),
      ).length;
      const connectorLabelIntersections = occupiedLabels.filter(
        (placed) => segmentIntersectsRectangle(
          connectorSegment.start,
          connectorSegment.end,
          placed,
          2,
        ),
      ).length;
      const connectorIntersections = occupiedConnectors.filter(
        (placed) => segmentsIntersect(
          connectorSegment.start,
          connectorSegment.end,
          placed.start,
          placed.end,
        ),
      ).length;
      const connectorObstructions = labelConnectorIntersections
        + connectorLabelIntersections
        + connectorIntersections;
      const axisAlignedConnector = (
        Math.abs(connector.x - point.x) < 4
        || Math.abs(connector.y - point.y) < 4
      ) ? 1 : 0;
      const connectorDistance = Math.hypot(
        connector.x - point.x,
        connector.y - point.y,
      );
      return {
        connector,
        connectorSegment,
        rectangle,
        score: [
          diagonalOnly ? axisAlignedConnector : 0,
          coversTarget,
          labelOverlap,
          pointOverlaps,
          diagonalOnly ? Math.floor(connectorDistance / 24) : 0,
          lineIntersections,
          connectorObstructions,
          diagonalOnly ? 0 : axisAlignedConnector,
          connectorDistance,
          rectangle.index,
        ],
      };
    })
    .sort((left, right) => {
      for (let index = 0; index < left.score.length; index += 1) {
        if (left.score[index] !== right.score[index]) {
          return left.score[index] - right.score[index];
        }
      }
      return 0;
    })[0];
}

function niceStep(maximum, targetIntervals = 6) {
  if (!Number.isFinite(maximum) || maximum <= 0) return 1;
  const rawStep = maximum / targetIntervals;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function renderChart(configurations, groupIdentifiers) {
  clearChart();
  const renderedWidth = elements.chart.getBoundingClientRect().width || 960;
  const compact = renderedWidth < 800;
  const chartWidth = compact ? Math.max(280, Math.round(renderedWidth)) : 960;
  const chartHeight = compact ? 500 : 600;
  elements.chart.setAttribute("viewBox", `0 0 ${chartWidth} ${chartHeight}`);
  elements.chart.classList.toggle("is-compact", compact);

  const finite = configurations.filter(isFiniteChartConfiguration);
  if (finite.length === 0) {
    const message = createSvgElement("text", {
      x: chartWidth / 2,
      y: chartHeight / 2,
      "text-anchor": "middle",
      class: "chart-note",
    });
    message.textContent = "No finite configurations meet the current floor.";
    elements.chart.append(message);
    return;
  }

  const margin = compact
    ? { top: 24, right: 24, bottom: 52, left: 58 }
    : { top: 28, right: 34, bottom: 62, left: 92 };
  const width = chartWidth - margin.left - margin.right;
  const height = chartHeight - margin.top - margin.bottom;
  const maximumCost = Math.max(
    ...finite.map((configuration) => configuration.amortizedCostPerPassUsd),
  );
  const maximumTime = Math.max(
    ...finite.map(
      (configuration) => configuration.amortizedAgentTimePerPassMinutes,
    ),
  );
  const costStep = niceStep(maximumCost);
  const timeStep = niceStep(maximumTime);
  const costMaximum = Math.ceil(maximumCost / costStep) * costStep;
  const timeMaximum = Math.ceil(maximumTime / timeStep) * timeStep;
  const costTickCount = Math.round(costMaximum / costStep);
  const timeTickCount = Math.round(timeMaximum / timeStep);
  const x = (cost) => margin.left + width * cost / costMaximum;
  const y = (time) => margin.top + height * (1 - time / timeMaximum);

  const grid = createSvgElement("g");
  for (let index = 0; index <= costTickCount; index += 1) {
    const cost = costStep * index;
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
      class: "chart-tick chart-cost-tick",
    });
    label.textContent = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: costStep < 1 ? 1 : 0,
    }).format(cost);
    grid.append(label);
  }
  for (let index = 0; index <= timeTickCount; index += 1) {
    const time = timeStep * index;
    const yPosition = y(time);
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
      class: "chart-tick chart-time-tick",
    });
    label.textContent = compact ? formatNumber(time) : `${formatNumber(time)} min`;
    grid.append(label);
  }
  elements.chart.append(grid);

  const xLabel = createSvgElement("text", {
    x: margin.left + width / 2,
    y: chartHeight - 10,
    "text-anchor": "middle",
    class: "chart-axis-label",
  });
  xLabel.textContent = "Amortized cost per pass";
  elements.chart.append(xLabel);

  const yLabel = createSvgElement("text", {
    x: compact ? 20 : 18,
    y: margin.top + height / 2,
    transform: `rotate(-90 ${compact ? 20 : 18} ${margin.top + height / 2})`,
    "text-anchor": "middle",
    class: "chart-axis-label",
  });
  yLabel.textContent = compact
    ? "Amortized agent time per pass (minutes)"
    : "Amortized agent time per pass";
  elements.chart.append(yLabel);

  const groups = new Map();
  for (const configuration of finite) {
    const key = configurationGroupKey(configuration);
    const group = groups.get(key) ?? [];
    group.push(configuration);
    groups.set(key, group);
  }
  const sortedGroups = [...groups.entries()].sort(([left], [right]) => (
    left.localeCompare(right)
  ));
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
      class: "chart-crosshair-label chart-crosshair-cost",
    }),
    createSvgElement("text", {
      x: margin.left - 12,
      "text-anchor": "end",
      class: "chart-crosshair-label chart-crosshair-time",
    }),
  );
  elements.chart.append(crosshair);

  const seriesSegments = [];
  const seriesHitTargets = new Map();
  const markersByConfig = new Map();
  let pointerExitFrame = null;
  let armedGroupId = null;
  const cancelPointerExit = () => {
    if (pointerExitFrame === null) return;
    cancelAnimationFrame(pointerExitFrame);
    pointerExitFrame = null;
  };
  const armSeries = (groupId) => {
    armedGroupId = groupId;
    seriesHitTargets.forEach((target, candidateGroupId) => {
      target.classList.toggle("is-armed", candidateGroupId === groupId);
    });
  };
  const clearPointerInteraction = () => {
    pointerExitFrame = null;
    armSeries(null);
    if (!elements.chart.contains(document.activeElement)) {
      hideChartDetails();
    }
  };
  const schedulePointerExit = () => {
    cancelPointerExit();
    pointerExitFrame = requestAnimationFrame(clearPointerInteraction);
  };
  const activatePointerPoint = (configuration, marker, groupId) => {
    cancelPointerExit();
    armSeries(groupId);
    showChartDetails(configuration, marker, groupId);
  };
  resetChartInteraction = () => {
    cancelPointerExit();
    armSeries(null);
    hideChartDetails();
  };
  for (const [key, group] of sortedGroups) {
    const sorted = group.sort((left, right) => {
      const leftOrder = EFFORT_ORDER.get(left.reasoningEffort) ?? 6;
      const rightOrder = EFFORT_ORDER.get(right.reasoningEffort) ?? 6;
      return leftOrder - rightOrder || left.config.localeCompare(right.config);
    });
    if (sorted.length >= 2) {
      for (let index = 1; index < sorted.length; index += 1) {
        seriesSegments.push({
          start: {
            x: x(sorted[index - 1].amortizedCostPerPassUsd),
            y: y(sorted[index - 1].amortizedAgentTimePerPassMinutes),
          },
          end: {
            x: x(sorted[index].amortizedCostPerPassUsd),
            y: y(sorted[index].amortizedAgentTimePerPassMinutes),
          },
        });
      }
      const path = sorted
        .map((configuration, index) => {
          const command = index === 0 ? "M" : "L";
          return `${command}${x(configuration.amortizedCostPerPassUsd)},${
            y(configuration.amortizedAgentTimePerPassMinutes)
          }`;
        })
        .join(" ");
      const seriesIndex = Number(groupIdentifiers.get(key)) % CHART_SERIES_COUNT;
      elements.chart.append(createSvgElement("path", {
        d: path,
        class: `chart-link chart-series chart-series-${seriesIndex}`,
        "data-chart-group": groupIdentifiers.get(key),
      }));
      const hitTarget = createSvgElement("path", {
        d: path,
        class: "chart-link-hit-target",
        "data-chart-group": groupIdentifiers.get(key),
        "aria-hidden": "true",
      });
      seriesHitTargets.set(groupIdentifiers.get(key), hitTarget);
      elements.chart.append(hitTarget);
    }
  }

  for (const configuration of finite) {
    const key = configurationGroupKey(configuration);
    const groupId = groupIdentifiers.get(key);
    const seriesIndex = Number(groupId) % CHART_SERIES_COUNT;
    const xPosition = x(configuration.amortizedCostPerPassUsd);
    const yPosition = y(configuration.amortizedAgentTimePerPassMinutes);
    const visibleMarker = configuration.paretoEfficient
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

    visibleMarker.setAttribute(
      "class",
      configuration.paretoEfficient
        ? `chart-point chart-point-pareto chart-series chart-series-${seriesIndex}`
        : `chart-point chart-series chart-series-${seriesIndex}`,
    );
    visibleMarker.dataset.chartGroup = groupId;
    visibleMarker.setAttribute("aria-hidden", "true");
    visibleMarker.setAttribute("pointer-events", "none");

    const markerGroup = createSvgElement("g", {
      class: "chart-point-group",
      "data-chart-group": groupId,
      "data-chart-x": xPosition,
      "data-chart-y": yPosition,
      "data-config": configuration.config,
      tabindex: 0,
      role: "img",
      "aria-label": markerDetails(configuration),
    });
    markerGroup.append(
      createSvgElement("circle", {
        cx: xPosition,
        cy: yPosition,
        r: 16,
        class: "chart-hit-target",
        "aria-hidden": "true",
      }),
      visibleMarker,
    );
    markerGroup.addEventListener(
      "mouseenter",
      () => activatePointerPoint(configuration, markerGroup, groupId),
    );
    markerGroup.addEventListener("mouseleave", schedulePointerExit);
    markerGroup.addEventListener(
      "focus",
      () => showChartDetails(configuration, markerGroup, groupId),
    );
    markerGroup.addEventListener("blur", hideChartDetails);
    markersByConfig.set(configuration.config, markerGroup);
    elements.chart.append(markerGroup);
  }

  for (const [key, group] of sortedGroups) {
    const groupId = groupIdentifiers.get(key);
    const hitTarget = seriesHitTargets.get(groupId);
    if (!hitTarget) continue;
    hitTarget.addEventListener("mouseenter", cancelPointerExit);
    hitTarget.addEventListener("mousemove", (event) => {
      if (armedGroupId !== groupId) return;
      const matrix = elements.chart.getScreenCTM();
      if (!matrix) return;
      const cursor = new DOMPoint(event.clientX, event.clientY)
        .matrixTransform(matrix.inverse());
      const nearest = group.reduce((best, configuration) => {
        const marker = markersByConfig.get(configuration.config);
        const distance = Math.hypot(
          Number(marker.dataset.chartX) - cursor.x,
          Number(marker.dataset.chartY) - cursor.y,
        );
        return best === null || distance < best.distance
          ? { configuration, distance, marker }
          : best;
      }, null);
      if (nearest) {
        showChartDetails(nearest.configuration, nearest.marker, groupId);
      }
    });
    hitTarget.addEventListener("mouseleave", schedulePointerExit);
  }

  const representatives = sortedGroups
    .map(([, group]) => group.reduce((best, candidate) => {
      if (candidate.score !== best.score) {
        return candidate.score > best.score ? candidate : best;
      }
      return candidate.config.localeCompare(best.config) < 0 ? candidate : best;
    }))
    .sort((left, right) => (
      right.score - left.score || left.config.localeCompare(right.config)
    ));
  const representativeConfigs = new Set(
    representatives.map((configuration) => configuration.config),
  );
  const labelConfigurations = [
    ...representatives,
    ...finite
      .filter((configuration) => !representativeConfigs.has(configuration.config))
      .sort((left, right) => left.config.localeCompare(right.config)),
  ];
  const points = finite.map((configuration) => ({
    config: configuration.config,
    x: x(configuration.amortizedCostPerPassUsd),
    y: y(configuration.amortizedAgentTimePerPassMinutes),
  }));
  const pointsByConfig = new Map(points.map((point) => [point.config, point]));
  const occupiedConnectors = [];
  const occupiedLabels = [];
  const labelBounds = {
    bottom: margin.top + height,
    left: margin.left,
    right: margin.left + width,
    top: margin.top,
  };

  for (const configuration of labelConfigurations) {
    const key = configurationGroupKey(configuration);
    const groupId = groupIdentifiers.get(key);
    const seriesIndex = Number(groupId) % CHART_SERIES_COUNT;
    const point = pointsByConfig.get(configuration.config);
    const defaultVisible = representativeConfigs.has(configuration.config);
    const pointLabel = createSvgElement("g", {
      class: `chart-point-label chart-series chart-series-${seriesIndex}`,
      "data-chart-group": groupId,
      "data-config": configuration.config,
      "data-default-visible": defaultVisible,
      "aria-hidden": "true",
    });
    const label = createSvgElement("text", {
      x: 0,
      y: 0,
      class: "chart-label",
    });
    const modelName = createSvgElement("tspan", { x: 0 });
    modelName.textContent = configuration.model;
    const effort = createSvgElement("tspan", {
      x: 0,
      dy: 12,
      class: "chart-effort-label",
    });
    effort.textContent = (configuration.reasoningEffort ?? "default").toUpperCase();
    label.append(modelName, effort);
    label.style.opacity = "0";
    elements.chart.append(label);
    const textBounds = label.getBBox();
    label.remove();
    label.style.removeProperty("opacity");
    pointLabel.append(label);
    elements.chart.append(pointLabel);
    const placement = chooseLabelRectangle({
      bounds: labelBounds,
      height: textBounds.height,
      occupiedConnectors: defaultVisible ? occupiedConnectors : [],
      occupiedLabels: defaultVisible ? occupiedLabels : [],
      point,
      points,
      segments: seriesSegments,
      width: textBounds.width,
      offsets: compact ? [16, 28, 40, 52, 64, 76, 88] : undefined,
      diagonalOnly: compact,
    });
    const textX = placement.rectangle.left - textBounds.x;
    const textY = placement.rectangle.top - textBounds.y;
    label.setAttribute("x", textX);
    label.setAttribute("y", textY);
    modelName.setAttribute("x", textX);
    effort.setAttribute("x", textX);
    pointLabel.prepend(createSvgElement("line", {
      x1: point.x,
      y1: point.y,
      x2: placement.connector.x,
      y2: placement.connector.y,
      class: "chart-label-connector",
    }));
    if (defaultVisible) {
      occupiedConnectors.push(placement.connectorSegment);
      occupiedLabels.push(placement.rectangle);
    }
  }
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
    (configuration) => state.selectedModelKeys.has(modelKey(configuration))
      && configuration.passAt1 >= state.performanceFloor,
  );
  const scored = rankConfigurations(selectedConfigurations, state.priorities);
  const floorEligible = scored
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

  const seriesMap = createSeriesMap(
    floorEligible.filter(isFiniteChartConfiguration),
  );
  renderChart(floorEligible, seriesMap);
  const tableCount = renderTable(floorEligible, seriesMap);
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

elements.costPriority.addEventListener("input", readPriorities);
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
let resizeFrame = null;
window.addEventListener("resize", () => {
  if (!state.feed) return;
  if (resizeFrame !== null) {
    cancelAnimationFrame(resizeFrame);
  }
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    render();
  });
});
document.addEventListener("pointerdown", (event) => {
  if (!elements.chart.classList.contains("is-interacting")) return;
  if (event.target instanceof Element && event.target.closest(".chart-point-group")) {
    return;
  }
  elements.chart.querySelector(".chart-point-group:focus")?.blur();
  resetChartInteraction();
});

renderPriorityOutputs();
if (validateFormulaSelector()) {
  loadFeed();
}
