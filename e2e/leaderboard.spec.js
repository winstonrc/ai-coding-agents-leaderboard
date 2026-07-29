// SPDX-License-Identifier: MPL-2.0

import { expect, test } from "@playwright/test";

const sourceUrl = "**/data/leaderboard-v1.1.json";

function row(overrides = {}) {
  return {
    config: "agent-alpha-high",
    harness: "agent-alpha",
    model: "model-alpha",
    reasoning_effort: "high",
    pass_at_1: 0.7,
    mean_cost_usd: 7,
    mean_duration_seconds: 1_200,
    n_tasks_attempted: 100,
    n_attempted: 100,
    n_runs: 2,
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
}

test("defaults, floor, table-only Pareto filter, and sorting are independent", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    const ignoredMetaDirective = message.text().includes(
      "The Content Security Policy directive 'frame-ancestors' is ignored",
    );
    if (message.type() === "error" && !ignoredMetaDirective) {
      consoleErrors.push(message.text());
    }
  });
  await routeFeed(page);
  await page.goto("/?formula=v1");

  await expect(page.locator("#status-title")).toHaveText("4 configurations validated");
  await expect(page.locator("#pass-priority-value")).toHaveText("60%");
  await expect(page.locator("#cost-priority-value")).toHaveText("30%");
  await expect(page.locator("#time-priority-value")).toHaveText("10%");
  await expect(page.locator("#performance-floor-value")).toHaveText("≥60%");
  await expect(page.locator("#model-filter-summary")).toHaveText("Models (4/4)");
  await expect(page.locator("#sort-by")).toHaveValue("value");
  await expect(page.locator("#pareto-only")).toBeChecked();
  await expect(page.locator("#retry-button")).toBeHidden();
  await expect(page.getByRole("navigation").getByRole("link", { name: "AI Coding Agents" }))
    .toHaveAttribute("href", "./");
  await expect(page.getByRole("navigation").getByRole("link", { name: "Methodology" }))
    .toHaveAttribute("href", "./methodology/v1.html");
  await expect(page.getByRole("navigation").getByRole("link", { name: "GitHub" }))
    .toHaveAttribute(
      "href",
      "https://github.com/winstonrc/ai-coding-agents-leaderboard",
    );
  await expect(page.locator("footer").getByRole("link", { name: "DeepSWE by DataCurve" }))
    .toHaveAttribute("href", "https://deepswe.datacurve.ai/");
  await expect(page.locator(".chart-point")).toHaveCount(3);
  expect(await page.locator(".chart-section").evaluate((chart) => (
    Boolean(chart.compareDocumentPosition(document.querySelector(".controls"))
      & Node.DOCUMENT_POSITION_FOLLOWING)
  ))).toBe(true);
  await expect(page.locator(".chart-point title")).toHaveCount(0);
  await expect(page.locator(".chart-efficiency-label")).toHaveText("most efficient ↖");
  const costTickPositions = await page.locator(".chart-tick").evaluateAll((ticks) => (
    ticks.slice(0, 6).map((tick) => Number(tick.getAttribute("x")))
  ));
  expect(costTickPositions).toEqual([...costTickPositions].sort((left, right) => left - right));
  await expect(page.locator("#leaderboard-body tr")).toHaveCount(2);
  await expect(page.getByText("Partial task coverage")).toBeVisible();
  await expect(page.locator("#content-hash")).not.toHaveText("—");

  const markerOrder = await page.locator(".chart-point").evaluateAll((markers) => (
    markers.map((marker) => marker.getAttribute("aria-label"))
  ));
  await page.locator("#sort-by").selectOption("performance");
  await expect(page.locator(".chart-point")).toHaveCount(3);
  expect(await page.locator(".chart-point").evaluateAll((markers) => (
    markers.map((marker) => marker.getAttribute("aria-label"))
  ))).toEqual(markerOrder);

  await page.locator("#pareto-only").uncheck();
  await expect(page.locator("#leaderboard-body tr")).toHaveCount(3);
  await expect(page.locator(".chart-point")).toHaveCount(3);

  await page.locator("#performance-floor").fill("50");
  await expect(page.locator("#performance-floor-value")).toHaveText("≥50%");
  await expect(page.locator(".chart-point")).toHaveCount(4);
  await expect(page.locator("#leaderboard-body tr")).toHaveCount(4);

  await page.locator(".chart-point").first().hover();
  await expect(page.locator("#chart-detail")).toContainText("expected cost per success");
  await expect(page.locator(".chart-hover-label")).toHaveAttribute("visibility", "visible");
  await expect(page.locator(".chart-hover-label-text tspan").first()).toHaveText("model-alpha");
  await expect(page.locator(".chart-hover-label-text tspan").nth(1)).toHaveText("HIGH");
  await expect(page.locator(".chart-crosshair")).toHaveAttribute("visibility", "visible");
  await expect(page.locator(".chart-series.is-muted")).not.toHaveCount(0);
  await page.locator("#chart-heading").hover();
  await expect(page.locator("#chart-detail")).toBeEmpty();
  await expect(page.locator(".chart-hover-label")).toHaveAttribute("visibility", "hidden");
  await page.locator(".chart-point").nth(1).focus();
  await expect(page.locator("#chart-detail")).toContainText("model-beta [medium]");
  await expect(page.locator(".chart-hover-label-text tspan").first()).toHaveText("model-beta");
  await expect(page.locator(".chart-hover-label-text tspan").nth(1)).toHaveText("MEDIUM");
  await expect(page.locator(".chart-point").first()).toHaveAttribute("role", "img");

  expect(await page.locator("body").evaluate((body) => (
    body.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);

  await page.locator("#pass-priority").fill("0");
  await page.locator("#cost-priority").fill("0");
  await page.locator("#time-priority").fill("0");
  await expect(page.locator("#time-priority")).toHaveValue("10");
  await expect(page.locator("#time-priority-value")).toHaveText("100%");
  expect(consoleErrors).toEqual([]);
});

test("shared model filter applies to the chart and table", async ({ page }) => {
  await routeFeed(page);
  await page.goto("/");

  await expect(page.locator(".model-option input")).toHaveCount(4);
  await page.locator("#model-filter-summary").click();
  await page.getByLabel("model-alpha", { exact: true }).uncheck();
  await expect(page.locator("#model-filter-summary")).toHaveText("Models (3/4)");
  await expect(page.locator(".chart-point")).toHaveCount(2);
  await expect(page.locator("#leaderboard-body")).not.toContainText("model-alpha");

  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.locator("#model-filter-summary")).toHaveText("Models (0/4)");
  await expect(page.locator(".chart-point")).toHaveCount(0);
  await expect(page.locator("#leaderboard-body tr")).toHaveCount(0);

  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.locator("#model-filter-summary")).toHaveText("Models (4/4)");
  await expect(page.locator(".chart-point")).toHaveCount(3);
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

  await expect(page.locator(".chart-point")).toHaveCount(1);
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
  await expect(page.locator("#leaderboard-body tr strong")).toHaveText([
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
  await expect(page.locator(".configuration-detail")).toContainText("note —");
  expect(await page.evaluate(() => window.injection)).toBeUndefined();
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
