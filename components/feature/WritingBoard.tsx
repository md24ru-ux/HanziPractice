import { memo, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, Path, Pattern, Rect, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { CharacterShape, medianPoints, Point, pointPath } from '@/services/strokes';
import { theme } from '@/constants/theme';
interface WritingBoardProps {
  size: number; shape: CharacterShape | null; strokes: Point[][]; liveStroke: Point[]; hint: boolean;
  loading: boolean; error: string; checking: boolean; flash: 'success' | 'error' | null;
  onBegin: (point: Point) => void; onMove: (point: Point) => void; onEnd: () => void;
  onHint: () => void; onClear: () => void; onRetry: () => void;
}
export const WritingBoard = memo(function WritingBoard({ size, shape, strokes, liveStroke, hint, loading, error, checking, flash, onBegin, onMove, onEnd, onHint, onClear, onRetry }: WritingBoardProps) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    pulse.stopAnimation(); pulse.setValue(0);
    if (flash) Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 180, useNativeDriver: true }), Animated.delay(220), Animated.timing(pulse, { toValue: 0, duration: 250, useNativeDriver: true })]).start();
    return () => pulse.stopAnimation();
  }, [flash, pulse]);
  const responder = useMemo(() => {
    const point = (x: number, y: number): Point => ({ x: Math.min(1024, Math.max(0, x / Math.max(1, size) * 1024)), y: Math.min(1024, Math.max(0, y / Math.max(1, size) * 1024)) });
    return PanResponder.create({
      onStartShouldSetPanResponder: () => Boolean(shape && !loading && !checking && !error),
      onMoveShouldSetPanResponder: () => Boolean(shape && !loading && !checking && !error),
      onPanResponderGrant: event => onBegin(point(event.nativeEvent.locationX, event.nativeEvent.locationY)),
      onPanResponderMove: event => { if (event.nativeEvent.touches.length <= 1) onMove(point(event.nativeEvent.locationX, event.nativeEvent.locationY)); },
      onPanResponderRelease: onEnd, onPanResponderTerminate: onEnd, onPanResponderTerminationRequest: () => false,
    });
  }, [size, shape, loading, checking, error, onBegin, onMove, onEnd]);
  const hintSize = Math.max(1, size / 5);
  return <View style={[styles.board, { width: size, height: size }]} accessibilityLabel="Поле для написания иероглифа">
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: flash === 'success' ? theme.colors.success : theme.colors.danger, opacity: pulse }]} />
    <View collapsable={false} style={styles.canvas} {...responder.panHandlers}>
      <Svg width="100%" height="100%" viewBox="0 0 1024 1024" pointerEvents="none">
        <Line x1={512} y1={0} x2={512} y2={1024} stroke={theme.colors.grid} strokeWidth={3} strokeDasharray="12 12" />
        <Line x1={0} y1={512} x2={1024} y2={512} stroke={theme.colors.grid} strokeWidth={3} strokeDasharray="12 12" />
        <Line x1={0} y1={0} x2={1024} y2={1024} stroke={theme.colors.grid} strokeWidth={2} strokeDasharray="9 13" />
        <Line x1={1024} y1={0} x2={0} y2={1024} stroke={theme.colors.grid} strokeWidth={2} strokeDasharray="9 13" />
        {hint && shape ? <G>
          <G transform="matrix(0.8 0 0 -0.8 100 820)">{shape.strokes.slice(0, 9).map((path, index) => <Path key={`hint-${index}`} d={path} fill={theme.strokeColors[index]} />)}</G>
          {shape.medians.slice(9).map((median, index) => <Path key={`dashed-${index}`} d={pointPath(medianPoints(median))} stroke={theme.strokeColors[index % 9]} strokeWidth={20} strokeDasharray="24 18" strokeLinecap="round" fill="none" />)}
          {shape.medians.map((median, index) => {
            const p = medianPoints(median)[0];
            return <G key={`number-${index}`}><Circle cx={p.x} cy={p.y} r={21} fill={theme.strokeColors[index % 9]} /><SvgText x={p.x} y={p.y + 8} textAnchor="middle" fontSize={23} fontWeight="700" fill={[1, 2, 3, 4].includes(index % 9) ? theme.colors.ink : theme.colors.white}>{index + 1}</SvgText></G>;
          })}
        </G> : null}
        {strokes.map((points, index) => <Path key={`ink-${index}`} d={pointPath(points)} stroke={theme.colors.strokeInk} strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
        {liveStroke.length ? <Path d={pointPath(liveStroke)} stroke={theme.colors.strokeInk} strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" fill="none" /> : null}
      </Svg>
    </View>
    {!loading && !error && !hint && !strokes.length && !liveStroke.length && !checking ? <View style={styles.empty} pointerEvents="none"><Ionicons name="pencil-outline" size={24} color={theme.colors.subtle} /><Text style={styles.emptyText}>Пишите пальцем</Text></View> : null}
    <Pressable disabled={!shape || checking} accessibilityRole="button" accessibilityState={{ selected: hint, disabled: !shape || checking }} accessibilityLabel={hint ? 'Скрыть подсказку' : 'Показать цветную подсказку порядка черт'} onPress={onHint} style={({ pressed }) => [styles.hintButton, { width: hintSize, height: hintSize }, hint ? styles.activeHint : null, pressed ? styles.pressed : null]}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" pointerEvents="none"><Defs><Pattern id="hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><Line x1="0" y1="0" x2="0" y2="12" stroke={hint ? theme.colors.primary : theme.colors.grid} strokeWidth="3" /></Pattern></Defs><Rect x="0" y="0" width="100" height="100" fill="url(#hatch)" /><Rect x="32" y="32" width="36" height="36" rx="8" fill={theme.colors.surface} /><SvgText x="50" y="58" textAnchor="middle" fontSize="27" fontWeight="600" fill={theme.colors.primary}>?</SvgText></Svg>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Очистить поле" disabled={checking || (!strokes.length && !liveStroke.length)} onPress={onClear} style={({ pressed }) => [styles.clearButton, pressed ? styles.pressed : null, !strokes.length ? styles.disabled : null]}><Ionicons name="trash-outline" color={theme.colors.subtle} size={20} /></Pressable>
    {loading ? <View style={styles.overlay}><ActivityIndicator color={theme.colors.primary} /><Text style={styles.overlayText}>Загружаем образец…</Text></View> : null}
    {error ? <View style={styles.overlay}><Ionicons name="cloud-offline-outline" color={theme.colors.dangerText} size={28} /><Text style={styles.errorText}>{error}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.retry, pressed ? styles.pressed : null]}><Text style={styles.retryText}>Повторить загрузку</Text></Pressable></View> : null}
  </View>;
});
const styles = StyleSheet.create({
  board: { backgroundColor: theme.colors.board, borderColor: theme.colors.grid, borderWidth: 1, borderRadius: theme.radius.lg, overflow: 'hidden', position: 'relative' }, canvas: { ...StyleSheet.absoluteFillObject }, empty: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', gap: theme.spacing.sm }, emptyText: { fontSize: theme.font.body, color: theme.colors.subtle }, hintButton: { position: 'absolute', top: 0, left: 0, backgroundColor: theme.colors.surfaceTint, borderRightWidth: 1, borderBottomWidth: 1, borderColor: theme.colors.grid, overflow: 'hidden' }, activeHint: { backgroundColor: theme.colors.primarySoft }, clearButton: { position: 'absolute', top: theme.spacing.sm, right: theme.spacing.sm, width: 44, height: 44, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface }, overlay: { ...StyleSheet.absoluteFillObject, padding: theme.spacing.md, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, backgroundColor: theme.colors.board }, overlayText: { color: theme.colors.subtle, fontSize: theme.font.small }, errorText: { color: theme.colors.dangerText, textAlign: 'center', fontSize: theme.font.small, lineHeight: 19 }, retry: { backgroundColor: theme.colors.primary, borderRadius: theme.radius.sm, minHeight: 44, paddingHorizontal: theme.spacing.md, justifyContent: 'center' }, retryText: { color: theme.colors.white, fontWeight: '600', fontSize: theme.font.small }, pressed: { opacity: 0.65 }, disabled: { opacity: 0.45 },
});
