
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Point {
  x: number;
  y: number;
}

export interface CharacterShape {
  strokes: string[];
  medians: number[][][];
}

export interface Verdict {
  correct: boolean;
  deviation: number;
  message: string;
}

const memory = new Map<string, CharacterShape>();

function validShape(value: unknown): value is CharacterShape {
  const shape = value as CharacterShape;

  return (
    Array.isArray(shape?.strokes) &&
    shape.strokes.length > 0 &&
    shape.strokes.every(s => typeof s === 'string') &&
    Array.isArray(shape.medians) &&
    shape.medians.length === shape.strokes.length &&
    shape.medians.every(stroke =>
      Array.isArray(stroke) &&
      stroke.length >= 2 &&
      stroke.every(p =>
        p.length === 2 && p.every(Number.isFinite)
      )
    )
  );
}

export async function loadShape(hanzi: string): Promise<CharacterShape> {
  const existing = memory.get(hanzi);
  if (existing) return existing;

  const key = `shtrikh:shape:v1:${hanzi}`;

  try {
    const stored = await AsyncStorage.getItem(key);

    if (stored) {
      const data = JSON.parse(stored);

      if (validShape(data)) {
        memory.set(hanzi, data);
        return data;
      }
    }
  } catch {
    // An unavailable cache does not prevent a network request.
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(
      `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/${encodeURIComponent(hanzi)}.json`,
      { signal: controller.signal }
    );

    if (!response.ok) {
      throw new Error('Не удалось загрузить образец. Проверьте интернет и повторите.');
    }

    const data: unknown = await response.json();

    if (!validShape(data)) {
      throw new Error('Образец недоступен. Повторите загрузку.');
    }

    memory.set(hanzi, data);

    await AsyncStorage.setItem(key, JSON.stringify(data))
      .catch(() => undefined);

    return data;
  } catch (error) {
    throw new Error(
      error instanceof Error && error.name !== 'AbortError'
        ? error.message
        : 'Загрузка заняла слишком много времени. Повторите.'
    );
  } finally {
    clearTimeout(timer);
  }
}

// Coordinates shared by the hint and input,
// independent of the physical screen size.
export function medianPoints(median: number[][]): Point[] {
  return median.map(([x, y]) => ({
    x: 100 + x * 0.8,
    y: 100 + (900 - y) * 0.8
  }));
}

export function pointPath(points: Point[]): string {
  return points
    .map((p, i) =>
      `${i ? 'L' : 'M'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
    )
    .join(' ');
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function length(points: Point[]): number {
  return points.slice(1).reduce(
    (sum, p, i) => sum + distance(points[i], p),
    0
  );
}

function resample(points: Point[], count = 32): Point[] {
  const total = length(points);

  if (total < 1) {
    return Array.from({ length: count }, () => points[0]);
  }

  const result: Point[] = [points[0]];
  let index = 1;
  let before = 0;

  for (let i = 1; i < count; i++) {
    const target = total * i / (count - 1);

    while (
      index < points.length - 1 &&
      before + distance(points[index - 1], points[index]) < target
    ) {
      before += distance(points[index - 1], points[index]);
      index++;
    }

    const start = points[index - 1];
    const end = points[index];

    const ratio = Math.min(
      1,
      Math.max(
        0,
        (target - before) /
        Math.max(0.001, distance(start, end))
      )
    );

    result.push({
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio
    });
  }

  return result;
}

// Calculate the actual reference character size.
// All deviations are measured relative to this size.
function getReferenceScale(strokes: Point[][]): number {
  const points = strokes.flat();

  if (!points.length) return 1024;

  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));

  return Math.max(
    1,
    Math.hypot(maxX - minX, maxY - minY)
  );
}

// Align the complete user-written character to the reference using only
// one uniform scale and one translation. No rotation or independent
// per-stroke adjustment is allowed: relative proportions and stroke layout
// therefore remain part of the assessment.
function normalizeWriting(
  actualStrokes: Point[][],
  referenceStrokes: Point[][]
): Point[][] {
  const actualPoints = actualStrokes.flat();
  const referencePoints = referenceStrokes.flat();

  if (!actualPoints.length || actualPoints.length !== referencePoints.length) {
    return actualStrokes;
  }

  const actualCenter = actualPoints.reduce(
    (center, point) => ({ x: center.x + point.x / actualPoints.length, y: center.y + point.y / actualPoints.length }),
    { x: 0, y: 0 }
  );
  const referenceCenter = referencePoints.reduce(
    (center, point) => ({ x: center.x + point.x / referencePoints.length, y: center.y + point.y / referencePoints.length }),
    { x: 0, y: 0 }
  );

  // Least-squares uniform scale. A single factor is used for both axes,
  // so this cannot stretch a character horizontally or vertically.
  let numerator = 0;
  let denominator = 0;

  actualPoints.forEach((point, index) => {
    const ax = point.x - actualCenter.x;
    const ay = point.y - actualCenter.y;
    const rx = referencePoints[index].x - referenceCenter.x;
    const ry = referencePoints[index].y - referenceCenter.y;
    numerator += ax * rx + ay * ry;
    denominator += ax * ax + ay * ay;
  });

  if (denominator < 0.001 || numerator <= 0) {
    return actualStrokes;
  }

  // Allow moderate differences in overall writing size, but do not let
  // an extremely tiny or oversized drawing be normalized without limit.
  const scale = Math.min(1.6, Math.max(0.625, numerator / denominator));

  return actualStrokes.map(stroke =>
    stroke.map(point => ({
      x: (point.x - actualCenter.x) * scale + referenceCenter.x,
      y: (point.y - actualCenter.y) * scale + referenceCenter.y
    }))
  );
}

export function evaluateWriting(
  strokes: Point[][],
  shape: CharacterShape,
  tolerance = 10
): Verdict {
  if (strokes.length !== shape.medians.length) {
    return {
      correct: false,
      deviation: 100,
      message: `Нужно черт: ${shape.medians.length}. У вас: ${strokes.length}.`
    };
  }

  const referenceStrokes = shape.medians.map(medianPoints);
  const referenceScale = getReferenceScale(referenceStrokes);

  // Resample first, then compensate only for the whole character's
  // position and uniform size before measuring stroke-level accuracy.
  const expected = referenceStrokes.map(stroke => resample(stroke));
  const rawActual = strokes.map(stroke => resample(stroke));
  const actual = normalizeWriting(rawActual, expected);

  let worst = 0;
  let worstIndex = 0;
  let sequenceError = '';

  // Sequence detection thresholds are proportional to the reference
  // character size and use the globally aligned user writing.
  const sequenceMargin = referenceScale * 0.015;
  const minimumSequenceError = referenceScale * 0.01;

  actual.forEach((stroke, index) => {
    const reference = expected[index];

    // Compare the entire stroke after global size/position normalization.
    const meanError =
      stroke.reduce(
        (sum, point, pointIndex) => sum + distance(point, reference[pointIndex]),
        0
      ) / stroke.length;

    // Check the direction of the stroke.
    const ax = stroke[31].x - stroke[0].x;
    const ay = stroke[31].y - stroke[0].y;
    const ex = reference[31].x - reference[0].x;
    const ey = reference[31].y - reference[0].y;

    if (
      ax * ex + ay * ey < 0 &&
      Math.hypot(ax, ay) > referenceScale * 0.005 &&
      Math.hypot(ex, ey) > referenceScale * 0.005 &&
      !sequenceError
    ) {
      sequenceError = `Черта ${index + 1}: проверьте направление.`;
    }

    // Check whether another reference stroke was written at this step.
    if (!sequenceError) {
      expected.forEach((alternative, otherIndex) => {
        if (otherIndex === index) return;

        const otherError =
          stroke.reduce(
            (sum, point, pointIndex) => sum + distance(point, alternative[pointIndex]),
            0
          ) / stroke.length;

        if (
          otherError + sequenceMargin < meanError &&
          meanError > minimumSequenceError
        ) {
          sequenceError = `Черта ${index + 1}: проверьте порядок черт.`;
        }
      });
    }

    // Endpoint and length accuracy are measured after the same global
    // normalization, not against the user's original absolute size.
    const endpointError = Math.max(
      distance(stroke[0], reference[0]),
      distance(stroke[31], reference[31])
    );

    const lengthError = Math.abs(
      length(stroke) - length(reference)
    );

    const error = Math.min(
      100,
      Math.max(meanError, endpointError, lengthError * 0.5) / referenceScale * 100
    );

    if (error > worst) {
      worst = error;
      worstIndex = index;
    }
  });

  const correct = worst < tolerance && !sequenceError;

  return {
    correct,
    deviation: worst,
    message:
      sequenceError ||
      (
        correct
          ? `Верно · отклонение ${worst.toFixed(1)}%`
          : `Черта ${worstIndex + 1} · отклонение ${worst.toFixed(1)}%. Повторите.`
      )
  };
}
