// SPDX-License-Identifier: MPL-2.0

import { expect, test } from "@playwright/test";

const sourceUrl = "**/data/leaderboard-v1.1.json";
const metadataUrl = "**/data/feed-metadata.json";

function row(overrides = {}) {
  const tasksAttempted = overrides.n_tasks_attempted ?? 100;
  const runs = overrides.n_runs ?? 4;
  const tasksPassedAny = overrides.n_tasks_passed_any
    ?? Math.round(tasksAttempted * 0.8);
  return {
    config: "agent-alpha-high",
    harness: "agent-alpha",
    model: "model-alpha",
    reasoning_effort: "high",
    pass_at_1: 0.7,
    pass_at_4: overrides.pass_at_4 ?? tasksPassedAny / tasksAttempted,
    mean_cost_usd: 7,
    mean_duration_seconds: 1_200,
    n_tasks_attempted: tasksAttempted,
    n_tasks_passed_any: tasksPassedAny,
    n_attempted: overrides.n_attempted ?? tasksAttempted * runs,
    n_runs: runs,
    ...overrides,
  };
}

function feed(overrides = {}) {
  return {
    generated_at: "2026-07-25T12:00:00Z",
    n_tasks_in_set: 100,
    rows: [
      row(),
      row({
        config: "agent-beta-medium",
        harness: "agent-beta",
        model: "model-beta",
        reasoning_effort: "medium",
        pass_at_1: 0.65,
        mean_cost_usd: 2,
        mean_duration_seconds: 600,
        n_tasks_attempted: 90,
        n_attempted: 95,
      }),
      row({
        config: "agent-gamma-low",
        harness: "agent-gamma",
        model: "model-gamma",
        reasoning_effort: "low",
        pass_at_1: 0.6,
        mean_cost_usd: 6,
        mean_duration_seconds: 1_200,
      }),
      row({
        config: "agent-delta",
        harness: "agent-delta",
        model: "model-delta",
        reasoning_effort: null,
        pass_at_1: 0.5,
        mean_cost_usd: 3,
        mean_duration_seconds: 900,
      }),
    ],
    ...overrides,
  };
}

async function routeFeed(page, body = feed()) {
  await page.route(sourceUrl, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  }));
  await page.route(metadataUrl, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ fetched_at: "2026-07-29T16:00:00Z" }),
  }));
}

test("defaults, floor, table-only Pareto filter, and sorting are independent", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  await routeFeed(page);
  await page.goto("/?formula=v1");

  await expect(page.locator("#status-title")).toHaveText("4 configurations validated");
  await expect(page.locator("#cost-priority-value")).toHaveText("60% cost · 40% time");
  await expect(page.locator("#cost-priority")).toHaveAttribute(
    "aria-valuetext",
    "60% cost · 40% time",
  );
  await expect(page.locator("#performance-floor-value")).toHaveText("≥60%");
  await expect(page.getByText("Cost priority", { exact: true })).toBeVisible();
  await expect(page.getByText(
    "Minimum point-estimate single-attempt success rate",
    { exact: true },
  )).toBeVisible();
  await expect(page.locator(".chart-axis-label").first())
    .toHaveText("Amortized cost per pass");
  await expect(page.locator(".chart-axis-label").last())
    .toHaveText("Amortized agent time per pass");
  await expect(page.locator("thead th")).toHaveText([
    "Rank",
    "Configuration",
    "Relative value",
    "Success rate",
    "Repeated-run success",
    "Amortized cost",
    "Amortized time",
    "Task coverage",
  ]);
  await expect(page.getByRole("columnheader", {
    name: "Relative value compared with the overall eligible leader",
  })).toHaveAttribute(
    "title",
    "Relative to the highest-value configuration meeting the success floor; 1.00× is the leader.",
  );
  await expect(page.getByRole("columnheader", {
    name: "Point-estimate single-attempt success rate",
  })).toHaveAttribute(
    "title",
    "Point-estimate single-attempt success rate (Pass@1).",
  );
  expect(await page.locator("thead th").evaluateAll((headers) => (
    headers.map((header) => header.getAttribute("title"))
  ))).toEqual([
    "Rank among currently shown configurations.",
    null,
    "Relative to the highest-value configuration meeting the success floor; 1.00× is the leader.",
    "Point-estimate single-attempt success rate (Pass@1).",
    "Share of attempted tasks solved in at least one of four published runs. Rows with a different run count are not directly comparable.",
    "Mean cost per scored attempt divided by the point-estimate single-attempt success rate.",
    "Mean agent time per scored attempt divided by the point-estimate single-attempt success rate.",
    "Tasks attempted divided by the complete task set.",
  ]);
  await expect(page.locator("#model-filter-summary")).toHaveText("Models (4/4)");
  await expect(page.locator("#sort-by")).toHaveValue("value");
  await expect(page.locator("#pareto-only")).not.toBeChecked();
  await expect(page.locator("#retry-button")).toBeHidden();
  await expect(page.getByRole("navigation").getByRole("link", { name: "AI Coding Agents" }))
    .toHaveAttribute("href", "./");
  await expect(page.getByRole("navigation").getByRole("link", { name: "Leaderboard" }))
    .toHaveCount(0);
  await expect(page.getByRole("navigation").getByRole("link", { name: "Methodology" }))
    .toHaveAttribute("href", "./methodology/v1.html");
  await expect(page.getByRole("navigation").getByRole("link", { name: "Source" }))
    .toHaveAttribute(
      "href",
      "https://github.com/winstonrc/ai-coding-agents-leaderboard",
    );
  await expect(page.getByRole("navigation").getByRole("link", { name: "Source" }))
    .toHaveAttribute("rel", "noreferrer");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://winstonrc.github.io/ai-coding-agents-leaderboard/og-image.png",
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute(
    "content",
    "AI coding agents amortized cost and agent time per pass chart",
  );
  await expect(page.locator(".chart-point-group")).toHaveCount(3);
  expect(await page.locator(".chart-section").evaluate((chart) => (
    Boolean(chart.compareDocumentPosition(document.querySelector(".controls"))
      & Node.DOCUMENT_POSITION_FOLLOWING)
  ))).toBe(true);
  await expect(page.locator(".chart-point-group title")).toHaveCount(0);
  await expect(page.locator("#value-chart")).toHaveAttribute("role", "group");
  await expect(page.locator(".chart-efficiency-label")).toHaveCount(0);
  await expect(page.locator(".chart-section > p").first()).toContainText(
    "The bottom-left is more efficient.",
  );
  await expect(page.locator(".chart-legend")).not.toContainText("Points:");
  await expect(page.locator(".chart-legend .legend-item")).toHaveText([
    "Pareto-efficient",
    "Not Pareto-efficient",
  ]);
  expect(await page.locator(".chart-section").evaluate((section) => {
    const explanation = section.querySelector(":scope > p");
    const legend = section.querySelector(".chart-legend");
    const chart = section.querySelector(".chart-wrap");
    return Boolean(
      explanation.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING,
    ) && Boolean(
      legend.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  })).toBe(true);
  await expect(page.locator(".chart-legend")).toHaveCSS(
    "justify-content",
    test.info().project.name === "mobile-320" ? "flex-start" : "flex-end",
  );
  if (test.info().project.name === "desktop") {
    const legendRight = await page.locator(".chart-legend").evaluate(
      (legend) => legend.getBoundingClientRect().right
        - Number.parseFloat(getComputedStyle(legend).paddingRight),
    );
    const plotRight = await page.locator("#value-chart").evaluate(
      (chart) => {
        const lines = [...chart.querySelectorAll(".chart-grid")];
        return Math.max(...lines.map((line) => line.getBoundingClientRect().right));
      },
    );
    expect(Math.abs(legendRight - plotRight)).toBeLessThan(2);
  }
  const chartLabelStyles = await page.locator(".chart-label").evaluateAll((labels) => (
    labels.map((label) => ({
      paintOrder: getComputedStyle(label).paintOrder,
      strokeWidth: getComputedStyle(label).strokeWidth,
    }))
  ));
  expect(chartLabelStyles.every((style) => (
    style.paintOrder === "stroke" && style.strokeWidth === "4px"
  ))).toBe(true);
  await expect(page.locator(".chart-cost-tick")).toHaveText([
    "$0",
    "$2",
    "$4",
    "$6",
    "$8",
    "$10",
  ]);
  await expect(page.locator(".chart-time-tick")).toHaveText([
    "0 min",
    "10 min",
    "20 min",
    "30 min",
    "40 min",
  ]);
  const chartBottom = Number(
    await page.locator(".chart-time-tick").first().getAttribute("y"),
  ) - 4;
  const defaultLabelYPositions = await page.locator(
    '.chart-point-label[data-default-visible="true"] text',
  ).evaluateAll((labels) => labels.map((label) => Number(label.getAttribute("y"))));
  expect(Math.max(...defaultLabelYPositions)).toBeLessThanOrEqual(chartBottom - 16);
  const plotTop = Math.min(...await page.locator(".chart-grid").evaluateAll(
    (lines) => lines.map((line) => line.getBoundingClientRect().top),
  ));
  const defaultLabelTopPositions = await page.locator(
    '.chart-point-label[data-default-visible="true"] text',
  ).evaluateAll((labels) => labels.map((label) => label.getBoundingClientRect().top));
  expect(Math.min(...defaultLabelTopPositions)).toBeGreaterThanOrEqual(plotTop);
  const defaultConnectorLengths = await page.locator(
    '.chart-point-label[data-default-visible="true"] .chart-label-connector',
  ).evaluateAll((connectors) => connectors.map((connector) => Math.hypot(
    Number(connector.getAttribute("x2")) - Number(connector.getAttribute("x1")),
    Number(connector.getAttribute("y2")) - Number(connector.getAttribute("y1")),
  )));
  expect(Math.min(...defaultConnectorLengths)).toBeGreaterThanOrEqual(12);
  const verticalAxisLabelBox = await page.locator(".chart-axis-label").last().boundingBox();
  const timeTickBoxes = await page.locator(".chart-time-tick").evaluateAll((ticks) => (
    ticks.map((tick) => {
      const box = tick.getBoundingClientRect();
      return { left: box.left, right: box.right };
    })
  ));
  expect(verticalAxisLabelBox.x + verticalAxisLabelBox.width).toBeLessThan(
    Math.min(...timeTickBoxes.map((box) => box.left)),
  );
  const costTickPositions = await page.locator(".chart-cost-tick").evaluateAll((ticks) => (
    ticks.map((tick) => Number(tick.getAttribute("x")))
  ));
  expect(costTickPositions).toEqual(
    [...costTickPositions].sort((left, right) => left - right),
  );
  await expect(page.locator("#leaderboard-body tr")).toHaveCount(3);
  await expect(page.locator("#leaderboard-body tr").first())
    .toContainText("80.0%");
  await expect(page.locator("#leaderboard-body tr").first())
    .toContainText("within 4 runs");
  await expect(page.locator("#leaderboard-body tr").first().locator(".relative-value"))
    .toHaveText("1.00×");
  await expect(page.locator("#leaderboard-body")).not.toContainText("Formula v1 index");
  await expect(page.getByText("Partial task coverage")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Data and methodology" })).toBeVisible();
  await expect(page.locator(".provenance dt").filter({ hasText: "Source" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Published aggregate feed (v1.1)" }))
    .toHaveAttribute(
      "href",
      "https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json",
    );
  await expect(page.locator("#generated-at")).not.toHaveText("—");
  await expect(page.locator("#fetched-at")).not.toHaveText("—");
  await expect(page.getByRole("link", { name: "Formula v1 methodology" }))
    .toHaveAttribute("href", "./methodology/v1.html");
  await expect(page.getByRole("link", { name: "DeepSWE by DataCurve" }))
    .toHaveAttribute("href", "https://deepswe.datacurve.ai/");
  await expect(page.getByRole("link", { name: "DeepSWE by DataCurve" }))
    .toHaveAttribute("rel", "noreferrer");
  await expect(page.locator("footer")).toHaveCount(0);
  await expect(page.locator("#content-hash")).toHaveCount(0);

  const markerOrder = await page.locator(".chart-point-group").evaluateAll((markers) => (
    markers.map((marker) => marker.getAttribute("aria-label"))
  ));
  await page.locator("#sort-by").selectOption("performance");
  await expect(page.locator(".chart-point-group")).toHaveCount(3);
  expect(await page.locator(".chart-point-group").evaluateAll((markers) => (
    markers.map((marker) => marker.getAttribute("aria-label"))
  ))).toEqual(markerOrder);

  await page.locator("#pareto-only").check();
  await expect(page.locator("#leaderboard-body tr")).toHaveCount(1);
  await expect(page.locator(".chart-point-group")).toHaveCount(3);
  await page.locator("#pareto-only").uncheck();

  await page.locator("#performance-floor").fill("50");
  await expect(page.locator("#performance-floor-value")).toHaveText("≥50%");
  await expect(page.locator(".chart-point-group")).toHaveCount(4);
  await expect(page.locator("#leaderboard-body tr")).toHaveCount(4);

  const hoveredConfig = await page.locator(".chart-point-group").first()
    .getAttribute("data-config");
  const pointLabel = page.locator(
    `.chart-point-label[data-config="${hoveredConfig}"]`,
  );
  await expect(pointLabel).toHaveCount(1);
  await expect(pointLabel).toHaveAttribute("data-default-visible", "true");
  const persistentLabelPosition = await pointLabel.locator("text").evaluate((label) => ({
    x: label.getAttribute("x"),
    y: label.getAttribute("y"),
  }));
  const controlsTopBeforeHover = await page.locator(".controls").evaluate(
    (controls) => controls.getBoundingClientRect().top + window.scrollY,
  );
  await page.locator(".chart-point-group").first().hover();
  await expect(page.locator("#chart-detail"))
    .toContainText("single-attempt");
  await expect(page.locator("#chart-detail")).toContainText("over 4 runs");
  await expect(page.locator("#chart-detail")).toContainText("amortized cost");
  await expect(page.locator("#chart-detail")).toContainText("amortized time");
  await expect(page.locator("#chart-detail")).toContainText("value");
  await expect(pointLabel).toHaveClass(/is-active/);
  await expect(pointLabel.locator("tspan").first()).toHaveText("model-alpha");
  await expect(pointLabel.locator("tspan").nth(1)).toHaveText("HIGH");
  await expect(pointLabel.locator("text")).toHaveAttribute(
    "x",
    persistentLabelPosition.x,
  );
  await expect(pointLabel.locator("text")).toHaveAttribute(
    "y",
    persistentLabelPosition.y,
  );
  await expect(pointLabel.locator("text")).toHaveCSS("fill", "rgb(180, 83, 9)");
  await expect(pointLabel.locator("line")).toHaveCSS(
    "stroke",
    "rgb(180, 83, 9)",
  );
  await expect(page.locator(".chart-crosshair")).toHaveAttribute("visibility", "visible");
  await expect(page.locator(".chart-crosshair-cost")).toContainText("$");
  await expect(page.locator(".chart-crosshair-time")).toContainText("min");
  await expect(page.locator(".chart-series.is-muted")).not.toHaveCount(0);
  await expect(page.locator(".chart-point-group").first().locator(".chart-point"))
    .not.toHaveClass(/is-muted/);
  expect(await page.locator(".controls").evaluate(
    (controls) => controls.getBoundingClientRect().top + window.scrollY,
  )).toBe(controlsTopBeforeHover);
  await page.locator("#chart-heading").hover();
  await expect(page.locator("#chart-detail")).toBeEmpty();
  await expect(pointLabel).not.toHaveClass(/is-active/);
  await page.locator(".chart-point-group").nth(1).focus();
  await expect(page.locator("#chart-detail")).toContainText("model-beta [medium]");
  const focusedConfig = await page.locator(".chart-point-group").nth(1)
    .getAttribute("data-config");
  const focusedLabel = page.locator(
    `.chart-point-label[data-config="${focusedConfig}"]`,
  );
  await expect(focusedLabel.locator("tspan").first()).toHaveText("model-beta");
  await expect(focusedLabel.locator("tspan").nth(1)).toHaveText("MEDIUM");
  await expect(page.locator(".chart-point-group").first()).toHaveAttribute("role", "img");
  await expect(page.locator(".chart-point-group").first().locator(".chart-hit-target"))
    .toHaveAttribute("r", "16");

  expect(await page.locator("body").evaluate((body) => (
    body.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);

  await page.locator("#cost-priority").fill("100");
  await expect(page.locator("#cost-priority-value")).toHaveText("100% cost · 0% time");
  await page.locator("#cost-priority").fill("0");
  await expect(page.locator("#cost-priority-value")).toHaveText("0% cost · 100% time");

  if (test.info().project.name === "mobile-320") {
    const chartDimensions = await page.locator(".chart-wrap").evaluate((wrapper) => ({
      clientWidth: wrapper.clientWidth,
      scrollWidth: wrapper.scrollWidth,
    }));
    expect(chartDimensions.scrollWidth).toBeGreaterThan(chartDimensions.clientWidth);
    const targetBox = await page.locator(".chart-hit-target").first().boundingBox();
    expect(targetBox.width).toBeGreaterThanOrEqual(24);
    expect(targetBox.height).toBeGreaterThanOrEqual(24);
  }
  expect(consoleErrors).toEqual([]);
});

test("each family labels its highest-value effort and interactions keep positions fixed", async ({ page }) => {
  await routeFeed(page, feed({
    rows: [
      row(),
      row({
        config: "agent-alpha-max",
        reasoning_effort: "max",
        pass_at_1: 0.75,
        mean_cost_usd: 2,
        mean_duration_seconds: 3_000,
      }),
    ],
  }));
  await page.goto("/?formula=v1");

  await expect(page.locator(".chart-point-group")).toHaveCount(2);
  await expect(page.locator(".chart-point-label")).toHaveCount(2);
  await expect(page.locator(
    '.chart-point-label[data-default-visible="true"]',
  )).toHaveCount(1);
  await expect(page.locator(
    '.chart-point-label[data-default-visible="true"]',
  )).toHaveAttribute("data-config", "agent-alpha-max");

  for (const config of ["agent-alpha-high", "agent-alpha-max"]) {
    const marker = page.locator(`.chart-point-group[data-config="${config}"]`);
    const label = page.locator(`.chart-point-label[data-config="${config}"]`);
    const before = await label.locator("text").evaluate((element) => ({
      x: element.getAttribute("x"),
      y: element.getAttribute("y"),
    }));

    await marker.hover();
    await expect(label).toHaveClass(/is-active/);
    await expect(label.locator("text")).toHaveAttribute("x", before.x);
    await expect(label.locator("text")).toHaveAttribute("y", before.y);
    await page.locator("#chart-heading").hover();
    await expect(label).not.toHaveClass(/is-active/);
  }

  await page.locator("#cost-priority").fill("0");
  await expect(page.locator(
    '.chart-point-label[data-default-visible="true"]',
  )).toHaveAttribute("data-config", "agent-alpha-high");
});

test("shared model filter applies to the chart and table", async ({ page }) => {
  await routeFeed(page);
  await page.goto("/");

  await expect(page.locator(".model-option input")).toHaveCount(4);
  const alphaRelativeValue = page.locator("#leaderboard-body tr")
    .filter({ hasText: "model-alpha" })
    .locator(".relative-value");
  const relativeValueBeforeFiltering = (await alphaRelativeValue.textContent()) ?? "";
  await page.locator("#model-filter-summary").click();
  await page.getByLabel("model-beta", { exact: true }).uncheck();
  await expect(page.locator("#model-filter-summary")).toHaveText("Models (3/4)");
  await expect(page.locator(".chart-point-group")).toHaveCount(2);
  await expect(page.locator("#leaderboard-body")).not.toContainText("model-beta");
  await expect(alphaRelativeValue).toHaveText(relativeValueBeforeFiltering);
  await expect(alphaRelativeValue).not.toHaveText("1.00×");

  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.locator("#model-filter-summary")).toHaveText("Models (0/4)");
  await expect(page.locator(".chart-point-group")).toHaveCount(0);
  await expect(page.locator("#leaderboard-body tr")).toHaveCount(0);

  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.locator("#model-filter-summary")).toHaveText("Models (4/4)");
  await expect(page.locator(".chart-point-group")).toHaveCount(3);
});

test("repeated-run sorting leaves non-four-run rows unranked", async ({ page }) => {
  await routeFeed(page, feed({
    rows: [
      row({
        config: "four-run-lower",
        model: "four-run-lower",
        pass_at_4: 0.7,
        n_tasks_passed_any: 70,
      }),
      row({
        config: "four-run-higher",
        model: "four-run-higher",
        pass_at_4: 0.9,
        n_tasks_passed_any: 90,
      }),
      row({
        config: "two-run",
        model: "two-run",
        pass_at_4: 0.95,
        n_tasks_passed_any: 95,
        n_attempted: 200,
        n_runs: 2,
      }),
    ],
  }));
  await page.goto("/");
  await page.locator("#sort-by").selectOption("persistence");

  await expect(page.locator("#leaderboard-body .configuration-name")).toHaveText([
    "four-run-higher [high]",
    "four-run-lower [high]",
    "two-run [high]",
  ]);
  await expect(page.locator(".rank-cell")).toHaveText(["1", "2", "—"]);
  await expect(page.locator("#leaderboard-body tr").last())
    .toContainText("2 published runs; not comparable");
});

test("Pareto status ignores configurations below the success floor", async ({ page }) => {
  await routeFeed(page, feed({
    rows: [
      row({
        config: "eligible",
        model: "eligible",
        pass_at_1: 0.6,
        mean_cost_usd: 6,
        mean_duration_seconds: 1_200,
      }),
      row({
        config: "below-floor",
        model: "below-floor",
        pass_at_1: 0.5,
        mean_cost_usd: 4,
        mean_duration_seconds: 900,
      }),
    ],
  }));
  await page.goto("/");

  await expect(page.locator(".chart-point-group")).toHaveCount(1);
  await expect(page.locator(".chart-point-pareto")).toHaveCount(1);
  await expect(page.locator("#leaderboard-body"))
    .toContainText("Pareto-efficient among selected models");
});

test("chart count excludes zero-pass configurations omitted from the plot", async ({ page }) => {
  await routeFeed(page, feed({
    rows: [
      row(),
      row({
        config: "zero-pass",
        model: "zero-pass",
        pass_at_1: 0,
      }),
    ],
  }));
  await page.goto("/");
  await page.locator("#performance-floor").fill("0");

  await expect(page.locator(".chart-point-group")).toHaveCount(1);
  await expect(page.locator("#visible-count")).toContainText("Chart 1");
});

test("equal scores remain tied with configuration ID as fallback", async ({ page }) => {
  await routeFeed(page, feed({
    rows: [
      row({ config: "configuration-b", model: "model-b" }),
      row({ config: "configuration-a", model: "model-a" }),
    ],
  }));
  await page.goto("/");

  await expect(page.locator("#leaderboard-body tr")).toHaveCount(2);
  await expect(page.locator(".rank-cell")).toHaveText(["1", "1"]);
  await expect(page.locator("#leaderboard-body .configuration-name")).toHaveText([
    "model-a [high]",
    "model-b [high]",
  ]);
});

test("external labels are inserted as text and optional metrics show unavailable", async ({ page }) => {
  await routeFeed(page, feed({
    rows: [row({
      model: "<img src=x onerror=window.injection=true>",
      ci_half: undefined,
      mean_output_tokens: undefined,
      mean_agent_steps: undefined,
      median_duration_seconds: undefined,
    })],
  }));
  await page.goto("/");

  await expect(page.locator("#leaderboard-body")).toContainText("<img src=x");
  await expect(page.locator("#leaderboard-body img")).toHaveCount(0);
  await expect(page.locator(".configuration-detail")).toContainText("CI —");
  await expect(page.locator(".configuration-detail")).toContainText("output tokens —");
  await expect(page.locator(".configuration-detail")).toContainText("steps —");
  await expect(page.locator(".configuration-detail")).toContainText("median attempt —");
  await expect(page.locator(".configuration-detail")).not.toContainText("note");
  expect(await page.evaluate(() => window.injection)).toBeUndefined();
});

test("notes render only when supplied by the source", async ({ page }) => {
  await routeFeed(page, feed({
    rows: [
      row(),
      row({
        config: "agent-beta-high",
        harness: "agent-beta",
        model: "model-beta",
        note: "Uses an alternate tool configuration.",
      }),
    ],
  }));
  await page.goto("/");

  const alphaDetails = page.locator("#leaderboard-body tr")
    .filter({ hasText: "model-alpha" })
    .locator(".configuration-detail");
  const betaDetails = page.locator("#leaderboard-body tr")
    .filter({ hasText: "model-beta" })
    .locator(".configuration-detail");
  await expect(alphaDetails).not.toContainText("note");
  await expect(betaDetails).toContainText("note Uses an alternate tool configuration.");
});

test("unsupported formulas fail without contacting the source", async ({ page }) => {
  let requests = 0;
  await page.route(sourceUrl, (route) => {
    requests += 1;
    return route.abort();
  });
  await page.goto("/?formula=v2");

  await expect(page.locator("#status-title")).toHaveText("Unsupported formula: rankings unavailable");
  await expect(page.locator("#leaderboard")).toBeHidden();
  expect(requests).toBe(0);
});

test("invalid responses fail closed and retry can recover", async ({ page }) => {
  let valid = false;
  await page.route(sourceUrl, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: valid ? JSON.stringify(feed()) : JSON.stringify({ generated_at: "bad" }),
  }));
  await page.goto("/");

  await expect(page.locator("#status-title")).toHaveText("Validation failure: rankings unavailable");
  await expect(page.locator("#leaderboard")).toBeHidden();
  await expect(page.locator(".status-source-link")).toBeVisible();

  valid = true;
  await page.locator("#retry-button").click();
  await expect(page.locator("#status-title")).toHaveText("4 configurations validated");
  await expect(page.locator("#leaderboard")).toBeVisible();
});

test("invalid or missing feed metadata fails closed", async ({ browser }) => {
  const cases = [
    {
      status: 404,
      contentType: "application/json",
      body: "{}",
    },
    {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetched_at: "2026-07-29T16:00:00Z",
        extra: true,
      }),
    },
    {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetched_at: "2026-07-29T16:00:00Z",
        padding: "x".repeat(1_024),
      }),
    },
    {
      status: 200,
      contentType: "text/plain",
      body: JSON.stringify({ fetched_at: "2026-07-29T16:00:00Z" }),
    },
  ];

  for (const metadata of cases) {
    const page = await browser.newPage();
    await page.route(sourceUrl, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(feed()),
    }));
    await page.route(metadataUrl, (route) => route.fulfill(metadata));
    await page.goto("/");

    await expect(page.locator("#status-title"))
      .toHaveText("Validation failure: rankings unavailable");
    await expect(page.locator("#leaderboard")).toBeHidden();
    await page.close();
  }
});

test("source timeout fails closed", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout;
    window.setTimeout = (callback, delay, ...arguments_) => (
      nativeSetTimeout(callback, Math.min(delay, 50), ...arguments_)
    );
  });
  await page.route(sourceUrl, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(feed()),
    });
  });
  await page.goto("/");

  await expect(page.locator("#status-title")).toHaveText("Source timeout: rankings unavailable");
  await expect(page.locator("#leaderboard")).toBeHidden();
  await expect(page.locator("#retry-button")).toBeVisible();
});
