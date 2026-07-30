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
  await expect(page.locator("#cost-priority-value")).toHaveText("50% Time · 50% Cost");
  await expect(page.locator("#cost-priority")).toHaveAttribute(
    "aria-valuetext",
    "50% Time · 50% Cost",
  );
  await expect(page.locator("#cost-priority")).toHaveAttribute("step", "5");
  await expect(page.locator(".priority-ticks i")).toHaveCount(21);
  await expect(page.locator(".priority-ticks i.major")).toHaveCount(11);
  await expect(page.locator("#performance-floor-value")).toHaveText("≥60%");
  if (test.info().project.name !== "mobile-320") {
    const sliderTops = await page.locator(".priority-grid input[type='range']").evaluateAll(
      (sliders) => sliders.map((slider) => slider.getBoundingClientRect().top),
    );
    expect(Math.max(...sliderTops) - Math.min(...sliderTops)).toBeLessThan(1);
  }
  await expect(page.getByText("Time–Cost priority", { exact: true })).toBeVisible();
  await expect(page.locator(".priority-scale span").first()).toHaveText("Time");
  await expect(page.locator(".priority-scale span").last()).toHaveText("Cost");
  await expect(page.getByText(
    "Minimum 1-run success rate",
    { exact: true },
  )).toBeVisible();
  expect(await page.locator("#sort-by option").evaluateAll(
    (options) => options.map((option) => option.textContent),
  )).toEqual([
    "Relative value",
    "1-run success",
    "4-run success",
    "Fastest amortized agent time per pass",
    "Lowest amortized cost per pass",
  ]);
  await expect(page.locator(".chart-axis-label").first())
    .toHaveText("Amortized cost per pass");
  await expect(page.locator(".chart-axis-label").last())
    .toHaveText(
      test.info().project.name === "mobile-320"
        ? "Amortized agent time per pass (minutes)"
        : "Amortized agent time per pass",
    );
  expect(await page.locator("thead th").evaluateAll(
    (headers) => headers.map((header) => header.innerText.trim()),
  )).toEqual([
    "Model",
    "Value",
    test.info().project.name === "mobile-320" ? "Time/\nPass" : "Time/pass",
    test.info().project.name === "mobile-320" ? "Cost/\nPass" : "Cost/pass",
    test.info().project.name === "mobile-320" ? "1-run\nsuccess" : "1-run success",
    test.info().project.name === "mobile-320" ? "4-run\nsuccess" : "4-run success",
  ]);
  await expect(page.locator("#leaderboard-body td").first())
    .toHaveCSS("vertical-align", "top");
  await expect(page.locator("#leaderboard-body tr").first().locator("td"))
    .toHaveCount(6);
  await expect(page.getByRole("columnheader", {
    name: "Relative value compared with the overall eligible leader",
  })).toHaveAttribute(
    "title",
    "Relative to the highest-value configuration meeting the success floor; 1.00× is the leader.",
  );
  await expect(page.getByRole("columnheader", {
    name: "Point-estimate 1-run success",
  })).toHaveAttribute(
    "title",
    "1-run success is the source Pass@1 point estimate.",
  );
  expect(await page.locator("thead th").evaluateAll((headers) => (
    headers.map((header) => header.getAttribute("title"))
  ))).toEqual([
    null,
    "Relative to the highest-value configuration meeting the success floor; 1.00× is the leader.",
    "Mean agent time per scored attempt divided by 1-run success (Pass@1).",
    "Mean cost per scored attempt divided by 1-run success (Pass@1).",
    "1-run success is the source Pass@1 point estimate.",
    "4-run success is the source Pass@4 share of tasks solved at least once across four runs. Rows with a different run count are not directly comparable.",
  ]);
  await expect(page.locator("#model-filter-summary")).toHaveText("Models (4/4)");
  await expect(page.locator("#sort-by")).toHaveValue("value");
  await expect(page.locator("#pareto-only")).not.toBeChecked();
  await expect(page.locator("#retry-button")).toBeHidden();
  await expect(page.getByRole("navigation").getByRole("link", {
    name: "AI Coding Agents Leaderboard",
  }))
    .toHaveAttribute("href", "./");
  await expect(page.getByRole("heading", { level: 1 }))
    .toHaveText("AI Coding Agents Leaderboard");
  await expect(page.getByRole("navigation").getByRole("link", {
    name: "Leaderboard",
    exact: true,
  }))
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
    "AI coding agents amortized agent time and cost per pass chart",
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
    const legendBox = await page.locator(".chart-legend").evaluate(
      (legend) => {
        const box = legend.getBoundingClientRect();
        return {
          bottom: box.bottom,
          right: box.right - Number.parseFloat(getComputedStyle(legend).paddingRight),
          top: box.top,
        };
      },
    );
    const plotBounds = await page.locator("#value-chart").evaluate(
      (chart) => {
        const lines = [...chart.querySelectorAll(".chart-grid")];
        return {
          right: Math.max(...lines.map((line) => line.getBoundingClientRect().right)),
          top: Math.min(...lines.map((line) => line.getBoundingClientRect().top)),
        };
      },
    );
    const explanationBottom = await page.locator(".chart-section > p").first().evaluate(
      (paragraph) => paragraph.getBoundingClientRect().bottom,
    );
    expect(Math.abs(legendBox.right - plotBounds.right)).toBeLessThan(2);
    expect(plotBounds.top - legendBox.bottom)
      .toBeLessThan(legendBox.top - explanationBottom);
  }
  const chartLabelStyles = await page.locator(".chart-label").evaluateAll((labels) => (
    labels.map((label) => ({
      fontWeight: getComputedStyle(label).fontWeight,
      paintOrder: getComputedStyle(label).paintOrder,
      strokeWidth: getComputedStyle(label).strokeWidth,
    }))
  ));
  expect(chartLabelStyles.every((style) => (
    style.fontWeight === "600"
      && style.paintOrder === "stroke"
      && style.strokeWidth === "4px"
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
    ...(test.info().project.name === "mobile-320"
      ? ["0", "10", "20", "30", "40"]
      : ["0 min", "10 min", "20 min", "30 min", "40 min"]),
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
  const defaultLabelBoxes = await page.locator(
    '.chart-point-label[data-default-visible="true"] text',
  ).evaluateAll((labels) => labels.map((label) => {
    const box = label.getBoundingClientRect();
    return {
      bottom: box.bottom,
      left: box.left,
      right: box.right,
      top: box.top,
    };
  }));
  for (let leftIndex = 0; leftIndex < defaultLabelBoxes.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < defaultLabelBoxes.length;
      rightIndex += 1
    ) {
      const left = defaultLabelBoxes[leftIndex];
      const right = defaultLabelBoxes[rightIndex];
      const overlaps = left.left < right.right
        && left.right > right.left
        && left.top < right.bottom
        && left.bottom > right.top;
      expect(overlaps).toBe(false);
    }
  }
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
  await expect(page.locator("#leaderboard-body tr").first().locator("td").nth(5))
    .toHaveAttribute("title", /within 4 runs/);
  await expect(page.locator("#leaderboard-body tr").first().locator(".relative-value"))
    .toHaveText("1.00×");
  await expect(page.locator("#leaderboard-body")).not.toContainText("Formula v1 index");
  const partialModelCell = page.locator("#leaderboard-body tr")
    .filter({ hasText: "model-beta" })
    .locator("td").first();
  await expect(partialModelCell).toContainText("(90/100 tasks)");
  await expect(partialModelCell).toHaveAttribute("title", /partial task coverage/);
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
  await expect(page.locator(
    '.chart-point-label[data-default-visible="true"]',
  )).toHaveCount(4);
  await expect(page.locator("#leaderboard-body tr")).toHaveCount(4);

  const hoveredConfig = test.info().project.name === "mobile-320"
    ? await page.locator(
      '.chart-point-label[data-default-visible="true"]',
    ).first().getAttribute("data-config")
    : await page.locator(".chart-point-group").first().getAttribute("data-config");
  const hoveredMarker = page.locator(
    `.chart-point-group[data-config="${hoveredConfig}"]`,
  );
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
  await hoveredMarker.hover();
  await expect(page.locator("#chart-detail"))
    .toContainText("1-run success");
  await expect(page.locator("#chart-detail")).toContainText("4-run success");
  await expect(page.locator("#chart-detail")).toContainText("amortized cost");
  await expect(page.locator("#chart-detail")).toContainText("amortized time");
  await expect(page.locator("#chart-detail")).toContainText("value");
  await expect(pointLabel).toHaveClass(/is-active/);
  await expect(pointLabel.locator("tspan").first()).not.toBeEmpty();
  await expect(pointLabel.locator("tspan").nth(1)).not.toBeEmpty();
  await expect(pointLabel.locator("text")).toHaveAttribute(
    "x",
    persistentLabelPosition.x,
  );
  await expect(pointLabel.locator("text")).toHaveAttribute(
    "y",
    persistentLabelPosition.y,
  );
  if (test.info().project.name === "desktop") {
    await expect(pointLabel.locator("text")).toHaveCSS("fill", "rgb(180, 83, 9)");
    await expect(pointLabel.locator("line")).toHaveCSS(
      "stroke",
      "rgb(180, 83, 9)",
    );
  }
  await expect(page.locator(".chart-crosshair")).toHaveAttribute("visibility", "visible");
  await expect(page.locator(".chart-crosshair-cost")).toContainText("$");
  if (test.info().project.name === "mobile-320") {
    await expect(page.locator(".chart-crosshair-time")).toHaveText(/^\d+$/);
  } else {
    await expect(page.locator(".chart-crosshair-time")).toContainText("min");
  }
  await expect(page.locator(".chart-crosshair-cost")).toHaveCSS(
    "paint-order",
    "stroke",
  );
  await expect(page.locator(".chart-crosshair-cost")).toHaveCSS(
    "stroke-width",
    "4px",
  );
  await expect(page.locator(".chart-series.is-muted")).not.toHaveCount(0);
  await expect(hoveredMarker.locator(".chart-point"))
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
  await page.locator("#chart-heading").dispatchEvent("pointerdown", {
    bubbles: true,
    pointerType: "touch",
  });
  await expect(page.locator("#chart-detail")).toBeEmpty();
  await expect(page.locator("#value-chart")).not.toHaveClass(/is-interacting/);
  await expect(page.locator(".chart-link-hit-target.is-armed")).toHaveCount(0);

  expect(await page.locator("body").evaluate((body) => (
    body.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);

  await page.locator("#cost-priority").fill("100");
  await expect(page.locator("#cost-priority-value")).toHaveText("0% Time · 100% Cost");
  await page.locator("#cost-priority").fill("0");
  await expect(page.locator("#cost-priority-value")).toHaveText("100% Time · 0% Cost");

  if (test.info().project.name === "mobile-320") {
    await expect(page.locator(".nav-content")).toHaveCSS("white-space", "nowrap");
    await expect(page.locator(".nav-content")).toHaveCSS("flex-direction", "row");
    const chartDimensions = await page.locator(".chart-wrap").evaluate((wrapper) => ({
      clientWidth: wrapper.clientWidth,
      scrollWidth: wrapper.scrollWidth,
    }));
    expect(chartDimensions.scrollWidth).toBeLessThanOrEqual(chartDimensions.clientWidth);
    const targetBox = await page.locator(".chart-hit-target").first().boundingBox();
    expect(targetBox.width).toBeGreaterThanOrEqual(24);
    expect(targetBox.height).toBeGreaterThanOrEqual(24);
    const tableDimensions = await page.locator(".table-wrap").evaluate((wrapper) => ({
      clientWidth: wrapper.clientWidth,
      scrollWidth: wrapper.scrollWidth,
    }));
    expect(tableDimensions.scrollWidth).toBeLessThanOrEqual(tableDimensions.clientWidth);
    const rowDimensions = await page.locator("#leaderboard-body tr").first()
      .evaluate((row) => ({
        clientWidth: row.clientWidth,
        scrollWidth: row.scrollWidth,
      }));
    expect(rowDimensions.scrollWidth).toBeGreaterThan(rowDimensions.clientWidth);
    await expect(page.locator("#leaderboard-body tr").first())
      .toHaveCSS("overflow-x", "auto");
    await expect(page.getByRole("table", { name: "Value table" })).toBeVisible();
    await expect(page.locator('thead[role="rowgroup"]')).toHaveCount(1);
    await expect(page.locator('th[role="columnheader"]')).toHaveCount(6);
    await expect(page.locator('#leaderboard-body tr[role="row"]')).not.toHaveCount(0);
    await expect(page.locator('#leaderboard-body td[role="cell"]')).not.toHaveCount(0);
  }
  expect(consoleErrors).toEqual([]);
});

test("wide tables fit without supplemental row details", async ({ page }) => {
  test.skip(
    test.info().project.name === "mobile-320",
    "This test controls its own desktop viewport widths.",
  );
  await page.setViewportSize({ width: 1_200, height: 800 });
  await routeFeed(page);
  await page.goto("/?formula=v1");

  const tableWrap = page.locator(".table-wrap");
  expect((await page.locator("main.page-width").boundingBox()).width)
    .toBeLessThanOrEqual(1_024);
  expect(await tableWrap.evaluate(
    (wrapper) => wrapper.scrollWidth <= wrapper.clientWidth,
  )).toBe(true);
  const wideControlLefts = await page.locator(".filter-row > *").evaluateAll(
    (controls) => controls.map((control) => control.getBoundingClientRect().left),
  );
  expect(Math.max(...wideControlLefts) - Math.min(...wideControlLefts))
    .toBeLessThan(1);
  await expect(page.locator(".select-control")).toHaveCSS("flex-direction", "row");
  await expect(tableWrap).toHaveAttribute("role", "region");
  await expect(tableWrap).toHaveAttribute("aria-labelledby", "table-heading");
  await expect(tableWrap).toHaveAttribute("tabindex", "0");
  for (const columnIndex of [1, 2, 3, 4, 5]) {
    await expect(page.locator("#leaderboard-body tr").first().locator("td").nth(columnIndex))
      .toHaveCSS("white-space", "nowrap");
  }
  const desktopBars = page.locator("#leaderboard-body .relative-value-bar");
  await expect(desktopBars.first()).toBeVisible();
  await expect(desktopBars.first()).toHaveCSS("height", "3px");
  await expect(desktopBars.first().locator(".relative-value-bar-fill"))
    .toHaveAttribute("style", "width: 100%;");
  const secondRowValue = Number.parseFloat(
    await page.locator("#leaderboard-body tr").nth(1).locator(".value-cell").innerText(),
  );
  const secondBarRatio = await desktopBars.nth(1).evaluate((bar) => (
    bar.firstElementChild.getBoundingClientRect().width
      / bar.getBoundingClientRect().width
  ));
  expect(secondBarRatio).toBeCloseTo(secondRowValue, 2);

  await page.setViewportSize({ width: 801, height: 800 });
  await expect(page.locator(".select-control")).toHaveCSS("flex-direction", "row");
  expect(await page.locator("thead th:last-child .wide-column-label").evaluate(
    (label) => label.getClientRects().length,
  )).toBe(1);
  expect(await tableWrap.evaluate(
    (wrapper) => wrapper.scrollWidth <= wrapper.clientWidth,
  )).toBe(true);
  await page.setViewportSize({ width: 799, height: 800 });
  await expect(page.locator(".select-control")).toHaveCSS("flex-direction", "column");
  await expect(page.locator("#leaderboard-body tr").first())
    .toHaveCSS("display", "grid");
});

test("stacked table scrolls only when its metrics no longer fit", async ({ page }) => {
  test.skip(
    test.info().project.name === "mobile-320",
    "This test controls its own iPhone-width viewport.",
  );
  await page.setViewportSize({ width: 402, height: 874 });
  const longModel = "claude-fable-5-withanunbrokenmodelnamesuffix";
  await routeFeed(page, feed({
    rows: [row({
      ci_half: 0.02,
      model: longModel,
    })],
  }));
  await page.goto("/?formula=v1");

  expect(await page.locator(".chart-wrap").evaluate(
    (wrapper) => wrapper.scrollWidth <= wrapper.clientWidth,
  )).toBe(true);
  const filterLeft = await page.locator(".filter-row").evaluate(
    (element) => element.getBoundingClientRect().left,
  );
  const paretoLeft = await page.locator(".switch-control").evaluate(
    (element) => element.getBoundingClientRect().left,
  );
  expect(Math.abs(paretoLeft - filterLeft)).toBeLessThan(1);
  await expect(page.locator(".nav-content")).toHaveCSS("overflow-x", "auto");
  await expect(page.locator(".nav-content")).toHaveCSS("white-space", "nowrap");
  expect(await page.locator("body").evaluate((body) => (
    body.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
  expect(await page.locator(".table-wrap").evaluate(
    (wrapper) => wrapper.scrollWidth <= wrapper.clientWidth,
  )).toBe(true);
  const modelName = page.locator("#leaderboard-body .configuration-name");
  expect(await modelName.count()).toBeGreaterThan(0);
  const firstModelName = modelName.first();
  await expect(firstModelName).toHaveText(`${longModel} [high]`);
  expect(await firstModelName.evaluate(
    (element) => element.scrollWidth <= element.clientWidth,
  )).toBe(true);
  await expect(firstModelName).toHaveCSS("text-overflow", "clip");
  await expect(page.locator("#leaderboard-body .performance-ci").first())
    .toHaveCSS("display", "inline");
  const valueBar = page.locator("#leaderboard-body .relative-value-bar-fill").first();
  await expect(valueBar).toHaveCSS("width", /.+/);
  await expect(valueBar).toHaveAttribute("style", "width: 100%;");
  const barSeriesClass = await valueBar.getAttribute("class");
  const pointSeriesClass = await page.locator(
    '.chart-point-group[data-config="agent-alpha-high"] .chart-point',
  ).getAttribute("class");
  const barSeries = barSeriesClass.match(/chart-series-\d+/)[0];
  expect(pointSeriesClass).toContain(barSeries);
  for (const selector of [
    ".cost-cell",
    ".time-cell",
    ".performance-cell",
    ".persistence-cell",
  ]) {
    const label = await page.locator(`#leaderboard-body ${selector}`).first()
      .evaluate((cell) => getComputedStyle(cell, "::before").content);
    expect(label).not.toBe("none");
    expect(label).not.toBe('""');
  }
  const metricTops = await page.locator(
    "#leaderboard-body tr:first-child > .cost-cell, "
      + "#leaderboard-body tr:first-child > .time-cell, "
      + "#leaderboard-body tr:first-child > .performance-cell, "
      + "#leaderboard-body tr:first-child > .persistence-cell",
  ).evaluateAll((cells) => cells.map(
    (cell) => cell.getBoundingClientRect().top,
  ));
  expect(Math.max(...metricTops) - Math.min(...metricTops)).toBeLessThan(2);
  for (const selector of [
    ".cost-cell",
    ".time-cell",
    ".performance-cell",
    ".persistence-cell",
  ]) {
    await expect(page.locator(`#leaderboard-body ${selector}`).first())
      .toHaveCSS("text-align", "center");
  }
  const fittingBarEdges = await page.locator("#leaderboard-body tr").first()
    .evaluate((row) => ({
      bar: row.querySelector(".relative-value-bar").getBoundingClientRect().right,
      divider: row.getBoundingClientRect().right,
    }));
  expect(Math.abs(fittingBarEdges.bar - fittingBarEdges.divider)).toBeLessThan(1);
  await expect(page.locator("#leaderboard-body .value-cell").first())
    .toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  expect(await page.locator("body").evaluate((body) => (
    body.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
  await expect(page.locator('table[role="table"]')).toHaveCount(1);
  await expect(page.locator('th[role="columnheader"]')).toHaveCount(6);
  await expect(page.locator('#leaderboard-body tr[role="row"]')).toHaveCount(1);
  await expect(page.locator('#leaderboard-body td[role="cell"]')).toHaveCount(6);
  await expect(page.locator("#leaderboard-body tr").first())
    .not.toHaveAttribute("tabindex", "0");

  await page.setViewportSize({ width: 320, height: 874 });
  await expect(page.locator("#leaderboard-body .performance-ci").first())
    .toHaveCSS("display", "inline");
  expect(await page.locator(".table-wrap").evaluate(
    (wrapper) => wrapper.scrollWidth <= wrapper.clientWidth,
  )).toBe(true);
  expect(await page.locator("#leaderboard-body tr").first().evaluate(
    (row) => row.scrollWidth > row.clientWidth,
  )).toBe(true);
  const narrowBarEdges = await page.locator("#leaderboard-body tr").first()
    .evaluate((row) => ({
      bar: row.querySelector(".relative-value-bar").getBoundingClientRect().right,
      divider: row.getBoundingClientRect().right,
    }));
  expect(Math.abs(narrowBarEdges.bar - narrowBarEdges.divider)).toBeLessThan(1);
  const rowLocator = page.locator("#leaderboard-body tr").first();
  await expect(rowLocator).toHaveAttribute("tabindex", "0");
  await rowLocator.focus();
  await rowLocator.press("ArrowRight");
  await expect.poll(
    () => rowLocator.evaluate((element) => element.scrollLeft),
  ).toBeGreaterThan(0);
  await rowLocator.evaluate((element) => {
    element.scrollLeft = 0;
  });
  const positionsBeforeScroll = await rowLocator.evaluate((element) => ({
    configuration: element.querySelector(".configuration-cell").getBoundingClientRect().x,
    model: element.querySelector(".configuration-name").getBoundingClientRect().x,
    bar: element.querySelector(".relative-value-bar").getBoundingClientRect().x,
    cost: element.querySelector(".cost-cell").getBoundingClientRect().x,
    value: element.querySelector(".value-cell").getBoundingClientRect().x,
  }));
  await rowLocator.evaluate((element) => {
    element.scrollLeft = 40;
  });
  const positionsAfterScroll = await rowLocator.evaluate((element) => ({
    configuration: element.querySelector(".configuration-cell").getBoundingClientRect().x,
    model: element.querySelector(".configuration-name").getBoundingClientRect().x,
    bar: element.querySelector(".relative-value-bar").getBoundingClientRect().x,
    cost: element.querySelector(".cost-cell").getBoundingClientRect().x,
    value: element.querySelector(".value-cell").getBoundingClientRect().x,
  }));
  expect(Math.abs(
    positionsAfterScroll.configuration - positionsBeforeScroll.configuration,
  )).toBeLessThan(1);
  expect(Math.abs(
    positionsAfterScroll.model - positionsBeforeScroll.model,
  )).toBeLessThan(1);
  expect(Math.abs(
    positionsAfterScroll.bar - positionsBeforeScroll.bar,
  )).toBeLessThan(1);
  expect(Math.abs(
    positionsAfterScroll.value - positionsBeforeScroll.value,
  )).toBeLessThan(1);
  expect(positionsAfterScroll.cost).toBeLessThan(positionsBeforeScroll.cost);
  expect(await page.locator("body").evaluate((body) => (
    body.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
});

test("methodology heading aligns with its reading column", async ({ page }) => {
  await page.goto("/methodology/v1.html");

  const heading = await page.getByRole("heading", {
    level: 1,
    name: "Formula v1 methodology",
  }).boundingBox();
  const definition = await page.getByRole("heading", {
    level: 2,
    name: "Definition",
  }).boundingBox();
  expect(Math.abs(heading.x - definition.x)).toBeLessThan(2);
  await expect(page.getByText(
    /1-run success \(the source Pass@1 point estimate\)/,
  )).toBeVisible();
  await expect(page.getByRole("heading", {
    level: 2,
    name: "4-run success (Pass@4)",
  })).toBeVisible();
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

test("point hover arms its model line and snaps to nearby effort points", async ({ page }) => {
  test.skip(
    test.info().project.name === "mobile-320",
    "The line corridor is a pointer-hover interaction.",
  );
  await routeFeed(page, feed({
    rows: [
      row({
        config: "agent-alpha-medium",
        reasoning_effort: "medium",
        mean_cost_usd: 2,
        mean_duration_seconds: 1_500,
      }),
      row(),
      row({
        config: "agent-alpha-max",
        reasoning_effort: "max",
        pass_at_1: 0.75,
        mean_cost_usd: 7,
        mean_duration_seconds: 2_700,
      }),
      row({
        config: "agent-beta-high",
        model: "model-beta",
        mean_cost_usd: 6,
        mean_duration_seconds: 2_100,
      }),
    ],
  }));
  await page.goto("/?formula=v1");

  const corridor = page.locator(".chart-link-hit-target");
  await expect(corridor).toHaveCount(1);
  const high = page.locator(
    '.chart-point-group[data-config="agent-alpha-high"]',
  );
  const max = page.locator(
    '.chart-point-group[data-config="agent-alpha-max"]',
  );
  const highBox = await high.boundingBox();
  const maxBox = await max.boundingBox();
  const nearMax = {
    x: highBox.x + highBox.width / 2
      + (maxBox.x - highBox.x) * 0.8,
    y: highBox.y + highBox.height / 2
      + (maxBox.y - highBox.y) * 0.8,
  };

  await page.mouse.move(nearMax.x, nearMax.y);
  await expect(corridor).not.toHaveClass(/is-armed/);
  await expect(page.locator("#chart-detail")).toBeEmpty();

  await high.hover();
  await expect(corridor).toHaveClass(/is-armed/);
  await page.mouse.move(nearMax.x, nearMax.y);
  await expect(page.locator("#chart-detail")).toContainText(
    "model-alpha [max]",
  );
  await expect(page.locator(
    '.chart-point-label[data-config="agent-alpha-max"]',
  )).toHaveClass(/is-active/);
  await expect(page.locator(".chart-series.is-muted")).not.toHaveCount(0);

  await page.locator("#chart-heading").hover();
  await expect(corridor).not.toHaveClass(/is-armed/);
  await expect(page.locator("#chart-detail")).toBeEmpty();
  await expect(page.locator(".chart-series.is-muted")).toHaveCount(0);
});

test("dense chart labels avoid other labels and connectors", async ({ page }) => {
  await routeFeed(page, feed({
    rows: Array.from({ length: 4 }, (_, index) => row({
      config: `dense-${index}`,
      model: `dense-model-${index}`,
      pass_at_1: 0.7,
      mean_cost_usd: 4.2 + index * 0.12,
      mean_duration_seconds: 1_000 + index * 25,
    })),
  }));
  await page.goto("/?formula=v1");

  const labels = await page.locator(
    '.chart-point-label[data-default-visible="true"] text',
  ).evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return {
      bottom: box.bottom,
      left: box.left,
      right: box.right,
      top: box.top,
    };
  }));
  for (let leftIndex = 0; leftIndex < labels.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < labels.length; rightIndex += 1) {
      expect(
        labels[leftIndex].left < labels[rightIndex].right
          && labels[leftIndex].right > labels[rightIndex].left
          && labels[leftIndex].top < labels[rightIndex].bottom
          && labels[leftIndex].bottom > labels[rightIndex].top,
      ).toBe(false);
    }
  }
  const connectorOffsets = await page.locator(
    '.chart-point-label[data-default-visible="true"] .chart-label-connector',
  ).evaluateAll((connectors) => connectors.map((connector) => ({
    x: Math.abs(
      Number(connector.getAttribute("x2")) - Number(connector.getAttribute("x1")),
    ),
    y: Math.abs(
      Number(connector.getAttribute("y2")) - Number(connector.getAttribute("y1")),
    ),
  })));
  expect(connectorOffsets.every((offset) => offset.x >= 4 && offset.y >= 4))
    .toBe(true);
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

test("repeated-run sorting places non-four-run rows last and marks them unavailable", async ({
  page,
}) => {
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
  await expect(page.locator("#leaderboard-body tr").last().locator("td").nth(5))
    .toHaveText("—");
  await expect(page.locator("#leaderboard-body tr").last().locator("td").nth(5))
    .toHaveAttribute("title", "2 published runs; not comparable");
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
  await expect(page.locator("#leaderboard-body td").first())
    .toHaveAttribute("title", /Pareto-efficient among selected models/);
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
  await expect(page.locator(".relative-value")).toHaveText(["1.00×", "1.00×"]);
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
  await expect(page.locator("#leaderboard-body td").first())
    .toHaveAttribute("title", /CI —.*output tokens —.*steps —.*median attempt —/);
  await expect(page.locator("#leaderboard-body td").first())
    .not.toHaveAttribute("title", /note/);
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
    .locator("td").first();
  const betaDetails = page.locator("#leaderboard-body tr")
    .filter({ hasText: "model-beta" })
    .locator("td").first();
  await expect(alphaDetails).not.toHaveAttribute("title", /note/);
  await expect(betaDetails)
    .toHaveAttribute("title", /note Uses an alternate tool configuration\./);
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
