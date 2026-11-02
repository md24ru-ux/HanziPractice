import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { categories, characters, getTopicCharacters } from '@/services/characters';
import { CharacterShape, evaluateWriting, loadShape, Point } from '@/services/strokes';
import { getMasteredCharacters } from '@/services/progress';
import { useStudy } from './useStudy';
export function usePractice() {
  const { state, ready, storageError, studyMode, review, selectMode, selectCategory, submitAttempt } = useStudy();
  const isReview = studyMode === 'review';
  const currentId = isReview ? review.currentId : state.currentId;
  const categoryId = isReview ? review.categoryId : state.categoryId;
  const character = characters.find(item => item.id === currentId) ?? null;
  const category = categories.find(item => item.id === categoryId) ?? categories[0];
  const [shape, setShape] = useState<CharacterShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [liveStroke, setLiveStroke] = useState<Point[]>([]);
  const live = useRef<Point[]>([]);
  const [hint, setHint] = useState(false);
  const [usedHint, setUsedHint] = useState(false);
  const [exampleView, setExampleView] = useState(0);
  const [checking, setChecking] = useState(false);
  const [flash, setFlash] = useState<'success' | 'error' | null>(null);
  const [feedback, setFeedback] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearInk = useCallback(() => { live.current = []; setLiveStroke([]); setStrokes([]); }, []);
  useEffect(() => {
    let active = true;
    if (timer.current) clearTimeout(timer.current);
    setChecking(false); setFlash(null); clearInk(); setHint(false); setUsedHint(false); setExampleView(0); setFeedback(''); setShape(null); setLoadError('');
    if (!ready || !character) { setLoading(!ready); return () => { active = false; }; }
    setLoading(true);
    loadShape(character.hanzi).then(data => { if (active) setShape(data); }).catch(error => { if (active) setLoadError(error instanceof Error ? error.message : 'Образец не загружен.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; if (timer.current) clearTimeout(timer.current); };
  }, [character?.id, categoryId, studyMode, ready, reload, clearInk]);
  const beginStroke = useCallback((point: Point) => {
    if (checking || !shape || loading) return;
    live.current = [point]; setLiveStroke([point]); setFeedback('');
  }, [checking, shape, loading]);
  const moveStroke = useCallback((point: Point) => {
    const previous = live.current[live.current.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) < 2) return;
    live.current = [...live.current, point]; setLiveStroke(live.current);
  }, []);
  const endStroke = useCallback(() => {
    const points = live.current;
    if (points.length) setStrokes(previous => [...previous, points.length === 1 ? [...points, { x: points[0].x + 0.1, y: points[0].y + 0.1 }] : points]);
    live.current = []; setLiveStroke([]);
  }, []);
  const toggleHint = useCallback(() => { if (!shape || checking) return; setHint(previous => !previous); setUsedHint(true); }, [shape, checking]);
  const clear = useCallback(() => { if (!checking) { clearInk(); setFeedback(''); } }, [checking, clearInk]);
  const check = useCallback(() => {
    if (!shape || checking || !strokes.length || live.current.length) return;
    const verdict = evaluateWriting(strokes, shape);
    setChecking(true); setFlash(verdict.correct ? 'success' : 'error'); setFeedback(verdict.message);
    timer.current = setTimeout(() => {
      clearInk(); setHint(false); setUsedHint(false); setExampleView(0); setFlash(null); setChecking(false);
      submitAttempt(verdict.correct, usedHint);
    }, 850);
  }, [shape, checking, strokes, usedHint, clearInk, submitAttempt]);
  const topic = useMemo(() => getTopicCharacters(categoryId), [categoryId]);
  const mastered = topic.filter(item => (state.progress[item.id]?.streak ?? 0) >= 10).length;
  const totalMastered = characters.filter(item => (state.progress[item.id]?.streak ?? 0) >= 10).length;
  const streak = character ? state.progress[character.id]?.streak ?? 0 : 0;
  const nextCategory = categories.find(item => item.id !== category.id && getTopicCharacters(item.id).some(char => (state.progress[char.id]?.streak ?? 0) < 10));
  const nextReviewCategory = categories.find(item => item.id !== category.id && getMasteredCharacters(item.id, state.progress).length > 0);
  return { character, category, categories, ready, storageError, studyMode, isReview, shape, loading, loadError, strokes, liveStroke, hint, usedHint, exampleView, checking, flash, feedback, mastered, totalMastered, streak, nextCategory, nextReviewCategory,
    beginStroke, moveStroke, endStroke, toggleHint, clear, check, retryLoad: () => setReload(value => value + 1), cycleExample: () => setExampleView(value => (value + 1) % 3), selectCategory, selectMode };
}
