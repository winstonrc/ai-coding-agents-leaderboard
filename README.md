<!-- SPDX-License-Identifier: MPL-2.0 -->

# AI Coding Agents Leaderboard

An independent, interactive leaderboard for comparing AI coding-agent configurations
by performance, expected cost per successful result, and expected time per successful
result.

The static site loads the latest aggregate results from the pinned v1.1 feed published
at [deepswe.datacurve.ai](https://deepswe.datacurve.ai/), validates the entire response,
and calculates rankings locally in the browser. It does not copy benchmark results into
this repository.

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

## Data availability and attribution

The application fetches only:

```text
https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json
```

There is no historical replay, cached fallback, scheduled import, or manually
maintained model lifecycle classification. If the upstream source is unavailable or
invalid, the site renders no rankings.

The benchmark data is provided by its publisher and remains subject to the publisher's
terms. This project is independent and unaffiliated. Product and company names belong
to their respective owners.

## Security headers

The document defines a restrictive meta Content Security Policy. Browsers do not
enforce `frame-ancestors` from a meta policy, and GitHub Pages does not support custom
response headers. That directive is included to keep the intended policy explicit, but
clickjacking protection requires hosting the same static build on a service that can
send `Content-Security-Policy: frame-ancestors 'none'` as an HTTP response header.

## License

This project's original software is available under the
[Mozilla Public License 2.0](LICENSE). That license does not cover third-party
benchmark data or trademarks.
