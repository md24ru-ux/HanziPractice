
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
  orderCorrect: boolean;
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

function smoothPoints(points: Point[]): Point[] {
  if (points.length <= 2) return points;

  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) {
      return point;
    }

    return {
      x: (points[index - 1].x + point.x + points[index + 1].x) / 3,
      y: (points[index - 1].y + point.y + points[index + 1].y) / 3
    };
  });
}

function getBounds(strokes: Point[][]) {
  const points = strokes.flat();

  if (!points.length) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  return {
    minX: Math.min(...points.map(p => p.x)),
    maxX: Math.max(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)),
    maxY: Math.max(...points.map(p => p.y))
  };
}

function normalizeGlyph(
  strokes: Point[][],
  referenceStrokes: Point[][]
): Point[][] {
  const actualBounds = getBounds(strokes);
  const referenceBounds = getBounds(referenceStrokes);

  const actualWidth = actualBounds.maxX - actualBounds.minX;
  const actualHeight = actualBounds.maxY - actualBounds.minY;
  const referenceWidth = referenceBounds.maxX - referenceBounds.minX;
  const referenceHeight = referenceBounds.maxY - referenceBounds.minY;

  const actualScale = Math.hypot(actualWidth, actualHeight);
  const referenceScale = Math.hypot(referenceWidth, referenceHeight);

  const scale = actualScale > 0.001
    ? referenceScale / actualScale
    : 1;

  const actualCenterX = (actualBounds.minX + actualBounds.maxX) / 2;
  const actualCenterY = (actualBounds.minY + actualBounds.maxY) / 2;
  const referenceCenterX = (referenceBounds.minX + referenceBounds.maxX) / 2;
  const referenceCenterY = (referenceBounds.minY + referenceBounds.maxY) / 2;

  return strokes.map(stroke =>
    stroke.map(point => ({
      x: (point.x - actualCenterX) * scale + referenceCenterX,
      y: (point.y - actualCenterY) * scale + referenceCenterY
    }))
  );
}

function trajectoryError(actual: Point[], expected: Point[]): number {
  const count = actual.length;

  const forward = actual.reduce(
    (sum, point, index) => sum + distance(point, expected[index]),
    0
  ) / count;

  const reverse = actual.reduce(
    (sum, point, index) => sum + distance(point, expected[count - 1 - index]),
    0
  ) / count;

  return Math.min(forward, reverse);
}

function endpointError(actual: Point[], expected: Point[]): number {
  const forward =
    distance(actual[0], expected[0]) +
    distance(actual[actual.length - 1], expected[expected.length - 1]);

  const reverse =
    distance(actual[0], expected[expected.length - 1]) +
    distance(actual[actual.length - 1], expected[0]);

  return Math.min(forward, reverse) / 2;
}

function minimumAssignment(costs: number[][]): number[] {
  const n = costs.length;

  if (n === 0) return [];

  const u = Array(n + 1).fill(0);
  const v = Array(n + 1).fill(0);
  const p = Array(n + 1).fill(0);
  const way = Array(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;

    let j0 = 0;
    const minValues = Array(n + 1).fill(Infinity);
    const used = Array(n + 1).fill(false);

    do {
      used[j0] = true;

      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;

      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;

        const current = costs[i0 - 1][j - 1] - u[i0] - v[j];

        if (current < minValues[j]) {
          minValues[j] = current;
          way[j] = j0;
        }

        if (minValues[j] < delta) {
          delta = minValues[j];
          j1 = j;
        }
      }

      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minValues[j] -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = Array(n).fill(0);

  for (let j = 1; j <= n; j++) {
    assignment[p[j] - 1] = j - 1;
  }

  return assignment;
}

interface PairResult {
  error: number;
  pathError: number;
  endsError: number;
  lengthError: number;
}

export function evaluateWriting(
  strokes: Point[][],
  shape: CharacterShape,
  tolerance = 12
): Verdict {
  if (strokes.length !== shape.medians.length) {
    return {
      correct: false,
      orderCorrect: false,
      deviation: 100,
      message: `Нужно штрихов: ${shape.medians.length}. У вас: ${strokes.length}.`
    };
  }

  const rawReference = shape.medians.map(medianPoints);
  const referenceScale = getReferenceScale(rawReference);

  const safeStrokes = strokes.map(stroke =>
    stroke.length > 0 ? stroke : [{ x: 0, y: 0 }]
  );

  const normalizedStrokes = normalizeGlyph(safeStrokes, rawReference);

  const actualStrokes = normalizedStrokes.map(stroke =>
    smoothPoints(stroke)
  );

  const referenceStrokes = rawReference.map(stroke =>
    smoothPoints(stroke)
  );

  const actualSamples = actualStrokes.map(stroke => resample(stroke, 48));
  const referenceSamples = referenceStrokes.map(stroke => resample(stroke, 48));

  // Calculate and retain every component of every possible stroke match.
  const pairResults: PairResult[][] = actualStrokes.map(
    (actualStroke, actualIndex) =>
      referenceStrokes.map((expectedStroke, expectedIndex) => {
        const actual = actualSamples[actualIndex];
        const expected = referenceSamples[expectedIndex];

        const pathError =
          trajectoryError(actual, expected) / referenceScale * 100;

        const endsError =
          endpointError(actual, expected) / referenceScale * 100;

        const actualLength = length(actualStroke);
        const expectedLength = length(expectedStroke);

        const lengthError =
          Math.abs(actualLength - expectedLength) / referenceScale * 100;

        const error = Math.max(
          pathError,
          endsError,
          lengthError
        );

        return {
          error,
          pathError,
          endsError,
          lengthError
        };
      })
  );

  const assignment = minimumAssignment(
    pairResults.map(row => row.map(pair => pair.error))
  );

  let worst = 0;
  let worstIndex = 0;

  const diagnostics: string[] = [];

  assignment.forEach((referenceIndex, actualIndex) => {
    const result = pairResults[actualIndex][referenceIndex];

    if (result.error > worst) {
      worst = result.error;
      worstIndex = actualIndex;
    }

    diagnostics.push(
      `Штрих ${actualIndex + 1} → эталон ${referenceIndex + 1}: ` +
      `форма ${result.pathError.toFixed(1)}%, ` +
      `концы ${result.endsError.toFixed(1)}%, ` +
      `длина ${result.lengthError.toFixed(1)}%, ` +
      `итог ${result.error.toFixed(1)}%.`
    );
  });

  const orderCorrect = assignment.every(
    (referenceIndex, actualIndex) => referenceIndex === actualIndex
  );

  const correct = worst < tolerance;

  const mainMessage = !correct
    ? `Штрих ${worstIndex + 1} · отклонение ${worst.toFixed(1)}%. Повторите.`
    : !orderCorrect
      ? 'Геометрически верно, но нарушен порядок написания штрихов.'
      : `Верно · отклонение ${worst.toFixed(1)}%`;

  return {
    correct,
    orderCorrect,
    deviation: worst,
    message: `${mainMessage}\n${diagnostics.join('\n')}`
  };
}
