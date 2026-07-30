<!-- SPDX-License-Identifier: MPL-2.0 -->

# AI Coding Agents Leaderboard

A leaderboard for AI coding agents that aims to answer, "Among configurations meeting
my minimum single-attempt success rate, which model produces benchmark passes with the
best aggregate agent-time and cost efficiency?"

The data source is the pinned v1.1 feed published at https://deepswe.datacurve.ai/.
The site is independent and unaffiliated.

## Formula v1

Formula v1 weights outcomes:

```text
Score_v1 = 100
  × (40 / amortized_agent_time_per_pass_minutes)^w_time
  × (10 / amortized_cost_per_pass)^w_cost
```

The default priorities are 50% amortized agent time per pass and 50% amortized cost
per pass. Each outcome divides its per-attempt average by Pass@1, so the expanded
formula gives Pass@1 an effective elasticity of one. These are aggregate benchmark
economics, not a simulation of sequential retries that stop after success. The default
eligibility floor is 60% point-estimate Pass@1.

The interface calls the source Pass@1 point estimate “1-run success.” The table also
reports “4-run success,” the source Pass@4 share of tasks solved in at least one of
four published runs. It is a persistence diagnostic and does not affect Formula v1 or
Pareto status. The site intentionally uses only the aggregate feed rather than
reconstructing retry behavior from individual trials.

See the permanent [Formula v1 methodology](src/methodology/v1.html) for definitions,
edge cases, assumptions, Pareto behavior, and interpretation limits. Formula versions
are calculation versions, not historical dataset snapshots.

## Development

Node.js 22 is required.

```sh
npm install
npm test
npm run build
npm run test:e2e
```

`npm run build` copies the self-hosted static site into `dist/`. The browser tests use
only synthetic fixtures.

The Pages workflow refreshes one rolling, validated aggregate response at 16:00 UTC
each day and on manual dispatch, and records when that upstream fetch succeeded.
Code-only pushes reuse those files, so browsers and ordinary deployments do not query
the upstream service. A failed validation leaves the previously published response in
place. Every deployment also renders the current default chart as a 1200×630 Open
Graph image.

MPL-2.0 covers this project’s original software, not third-party benchmark data or
trademarks.
