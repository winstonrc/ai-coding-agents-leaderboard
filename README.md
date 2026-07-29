<!-- SPDX-License-Identifier: MPL-2.0 -->

# AI Coding Agents Leaderboard

A leaderboard for AI coding agents that aims to answer, "As a developer, which model
will get me the strongest results in the shortest amount of time so that I can
iterate faster?"

The data source is the pinned v1.1 feed published at https://deepswe.datacurve.ai/.

## Formula v1

Formula v1 weights outcomes:

```text
Score_v1 = 100
  × (Pass@1 / 0.50)^w_performance
  × (10 / expected_cost_per_success)^w_cost
  × (40 / expected_time_per_success_minutes)^w_time
```

The default priorities are 60% Pass@1, 30% expected cost per success, and
10% expected time per success. Because both retry-adjusted outcomes divide by Pass@1,
the expanded formula gives Pass@1 an effective elasticity of one.

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
only synthetic fixtures; benchmark responses and tasks are not committed.
