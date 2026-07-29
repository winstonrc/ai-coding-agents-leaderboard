// SPDX-License-Identifier: MPL-2.0

import assert from "node:assert/strict";
import test from "node:test";

import {
  segmentIntersectsRectangle,
  segmentsIntersect,
} from "../src/chart-geometry.js";

test("segment intersection handles crossing and separated collinear segments", () => {
  assert.equal(
    segmentsIntersect(
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    ),
    true,
  );
  assert.equal(
    segmentsIntersect(
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 15, y: 0 },
    ),
    false,
  );
  assert.equal(
    segmentsIntersect(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 0 },
      { x: 15, y: 0 },
    ),
    true,
  );
});

test("segment intersection with a rectangle ignores distant aligned edges", () => {
  const rectangle = {
    bottom: 20,
    left: 10,
    right: 20,
    top: 10,
  };
  assert.equal(
    segmentIntersectsRectangle(
      { x: 0, y: 10 },
      { x: 5, y: 10 },
      rectangle,
    ),
    false,
  );
  assert.equal(
    segmentIntersectsRectangle(
      { x: 0, y: 15 },
      { x: 15, y: 15 },
      rectangle,
    ),
    true,
  );
});
