import AsyncStorage from '@react-native-async-storage/async-storage';
export interface Point { x: number; y: number; }
export interface CharacterShape { strokes: string[]; medians: number[][][]; }
export interface Verdict { correct: boolean; deviation: number; message: string; }
const memory = new Map<string, CharacterShape>();
function validShape(value: unknown): value is CharacterShape {
  const shape = value as CharacterShape;
  return Array.isArray(shape?.strokes) && shape.strokes.length > 0 && shape.strokes.every(s => typeof s === 'string') && Array.isArray(shape.medians) && shape.medians.length === shape.strokes.length && shape.medians.every(stroke => Array.isArray(stroke) && stroke.length >= 2 && stroke.every(p => p.length === 2 && p.every(Number.isFinite)));
}
export async function loadShape(hanzi: string): Promise<CharacterShape> {
  const existing = memory.get(hanzi);
  if (existing) return existing;
  const key = `shtrikh:shape:v1:${hanzi}`;
  try {
    const stored = await AsyncStorage.getItem(key);
    if (stored) { const data = JSON.parse(stored); if (validShape(data)) { memory.set(hanzi, data); return data; } }
  } catch { /* An unavailable cache does not prevent a network request. */ }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/${encodeURIComponent(hanzi)}.json`, { signal: controller.signal });
    if (!response.ok) throw new Error('Не удалось загрузить образец. Проверьте интернет и повторите.');
    const data: unknown = await response.json();
    if (!validShape(data)) throw new Error('Образец недоступен. Повторите загрузку.');
    memory.set(hanzi, data);
    await AsyncStorage.setItem(key, JSON.stringify(data)).catch(() => undefined);
    return data;
  } catch (error) {
    throw new Error(error instanceof Error && error.name !== 'AbortError' ? error.message : 'Загрузка заняла слишком много времени. Повторите.');
  } finally { clearTimeout(timer); }
}
// Coordinates shared by the hint and input, independent of the physical screen size.
export function medianPoints(median: number[][]): Point[] { return median.map(([x, y]) => ({ x: 100 + x * 0.8, y: 100 + (900 - y) * 0.8 })); }
export function pointPath(points: Point[]): string { return points.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' '); }
function distance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }
function length(points: Point[]) { return points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0); }
function resample(points: Point[], count = 32): Point[] {
  const total = length(points);
  if (total < 1) return Array.from({ length: count }, () => points[0]);
  const result: Point[] = [points[0]];
  let index = 1; let before = 0;
  for (let i = 1; i < count; i++) {
    const target = total * i / (count - 1);
    while (index < points.length - 1 && before + distance(points[index - 1], points[index]) < target) { before += distance(points[index - 1], points[index]); index++; }
    const start = points[index - 1], end = points[index];
    const ratio = Math.min(1, Math.max(0, (target - before) / Math.max(0.001, distance(start, end))));
    result.push({ x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio });
  }
  return result;
}
export function evaluateWriting(strokes: Point[][], shape: CharacterShape): Verdict {
  if (strokes.length !== shape.medians.length) return { correct: false, deviation: 100, message: `Нужно черт: ${shape.medians.length}. У вас: ${strokes.length}.` };
  let worst = 0, worstIndex = 0;
  let sequenceError = '';
  strokes.forEach((stroke, index) => {
    const reference = medianPoints(shape.medians[index]);
    const actual = resample(stroke), expected = resample(reference);
    const meanError = actual.reduce((sum, p, i) => sum + distance(p, expected[i]), 0) / actual.length;
    const ax = actual[31].x - actual[0].x, ay = actual[31].y - actual[0].y;
    const ex = expected[31].x - expected[0].x, ey = expected[31].y - expected[0].y;
    if (ax * ex + ay * ey < 0 && Math.hypot(ax, ay) > 5 && Math.hypot(ex, ey) > 5 && !sequenceError) sequenceError = `Черта ${index + 1}: проверьте направление.`;
    shape.medians.forEach((median, otherIndex) => {
      if (otherIndex === index || sequenceError) return;
      const alternative = resample(medianPoints(median));
      const otherError = actual.reduce((sum, p, i) => sum + distance(p, alternative[i]), 0) / actual.length;
      if (otherError + 16 < meanError && meanError > 12) sequenceError = `Черта ${index + 1}: проверьте порядок черт.`;
    });
    // The strictest component determines the score; strokes are compared in the input order.
    const endpointError = Math.max(distance(actual[0], expected[0]), distance(actual[31], expected[31]));
    const lengthError = Math.abs(length(stroke) - length(reference));
    const error = Math.min(100, Math.max(meanError, endpointError, lengthError * 0.5) / 1024 * 100);
    if (error > worst) { worst = error; worstIndex = index; }
  });
  const correct = worst < 10 && !sequenceError;
  return { correct, deviation: worst, message: sequenceError || (correct ? `Верно · отклонение ${worst.toFixed(1)}%` : `Черта ${worstIndex + 1} · отклонение ${worst.toFixed(1)}%. Повторите.`) };
}
