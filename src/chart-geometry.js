// SPDX-License-Identifier: MPL-2.0

const EPSILON = 1e-9;

export function rectangleOverlapArea(left, right, padding = 0) {
  const width = Math.max(
    0,
    Math.min(left.right, right.right + padding)
      - Math.max(left.left, right.left - padding),
  );
  const height = Math.max(
    0,
    Math.min(left.bottom, right.bottom + padding)
      - Math.max(left.top, right.top - padding),
  );
  return width * height;
}

export function pointInsideRectangle(point, rectangle, padding = 0) {
  return point.x >= rectangle.left - padding
    && point.x <= rectangle.right + padding
    && point.y >= rectangle.top - padding
    && point.y <= rectangle.bottom + padding;
}

function orientation(start, end, point) {
  return (point.x - start.x) * (end.y - start.y)
    - (point.y - start.y) * (end.x - start.x);
}

function pointOnSegment(start, end, point) {
  return point.x >= Math.min(start.x, end.x) - EPSILON
    && point.x <= Math.max(start.x, end.x) + EPSILON
    && point.y >= Math.min(start.y, end.y) - EPSILON
    && point.y <= Math.max(start.y, end.y) + EPSILON;
}

export function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const firstDirection = orientation(firstStart, firstEnd, secondStart);
  const secondDirection = orientation(firstStart, firstEnd, secondEnd);
  const thirdDirection = orientation(secondStart, secondEnd, firstStart);
  const fourthDirection = orientation(secondStart, secondEnd, firstEnd);

  if (
    Math.abs(firstDirection) <= EPSILON
    && pointOnSegment(firstStart, firstEnd, secondStart)
  ) return true;
  if (
    Math.abs(secondDirection) <= EPSILON
    && pointOnSegment(firstStart, firstEnd, secondEnd)
  ) return true;
  if (
    Math.abs(thirdDirection) <= EPSILON
    && pointOnSegment(secondStart, secondEnd, firstStart)
  ) return true;
  if (
    Math.abs(fourthDirection) <= EPSILON
    && pointOnSegment(secondStart, secondEnd, firstEnd)
  ) return true;

  return (
    (firstDirection > EPSILON && secondDirection < -EPSILON)
      || (firstDirection < -EPSILON && secondDirection > EPSILON)
  ) && (
    (thirdDirection > EPSILON && fourthDirection < -EPSILON)
      || (thirdDirection < -EPSILON && fourthDirection > EPSILON)
  );
}

export function segmentIntersectsRectangle(start, end, rectangle, padding = 0) {
  const expanded = {
    bottom: rectangle.bottom + padding,
    left: rectangle.left - padding,
    right: rectangle.right + padding,
    top: rectangle.top - padding,
  };
  if (
    pointInsideRectangle(start, expanded)
    || pointInsideRectangle(end, expanded)
  ) {
    return true;
  }
  const topLeft = { x: expanded.left, y: expanded.top };
  const topRight = { x: expanded.right, y: expanded.top };
  const bottomLeft = { x: expanded.left, y: expanded.bottom };
  const bottomRight = { x: expanded.right, y: expanded.bottom };
  return segmentsIntersect(start, end, topLeft, topRight)
    || segmentsIntersect(start, end, topRight, bottomRight)
    || segmentsIntersect(start, end, bottomRight, bottomLeft)
    || segmentsIntersect(start, end, bottomLeft, topLeft);
}
