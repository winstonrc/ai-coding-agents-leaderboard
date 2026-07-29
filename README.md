<!-- SPDX-License-Identifier: MPL-2.0 -->

# AI Coding Agents Leaderboard

A leaderboard for AI coding agents that aims to answer, "As a developer, which model
will reach a correct result cheapest and quickest among configurations meeting my
minimum single-attempt success rate?"

The data source is the pinned v1.1 feed published at https://deepswe.datacurve.ai/.
The site is independent and unaffiliated.

## Formula v1

Formula v1 weights outcomes:

```text
Score_v1 = 100
  × (10 / expected_cost_per_success)^w_cost
  × (40 / expected_cumulative_time_per_success_minutes)^w_time
```

The default priorities are 60% expected cost per success and 40% expected
cumulative agent time per success. Because both retry-adjusted outcomes divide by
Pass@1 and the priorities sum to one, the expanded formula gives Pass@1 an effective
elasticity of one. The default eligibility floor is 60% point-estimate Pass@1.

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
