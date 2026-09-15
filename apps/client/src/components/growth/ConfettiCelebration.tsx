import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const COLORES = ['#A855F7', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899'];
const PIEZAS_COUNT = 60;
const { height: VH } = Dimensions.get('window');

interface Pieza {
  left: number;
  delay: number;
  dur: number;
  color: string;
  width: number;
  height: number;
  rot: number;
}

/**
 * Growth Engine 3.0 · Confeti animado con react-native-reanimated.
 * 60 piezas con caída + rotación en loop. Equivalente RN del CSS keyframes web.
 */
export function ConfettiCelebration() {
  const piezas = useMemo<Pieza[]>(
    () =>
      Array.from({ length: PIEZAS_COUNT }, (_, i) => ({
        left: (i * 37) % 100,
        delay: (i % 12) * 0.25,
        dur: 2.6 + ((i * 7) % 20) / 10,
        color: COLORES[i % COLORES.length],
        width: 6 + (i % 4) * 2,
        height: (6 + (i % 4) * 2) * 1.6,
        rot: (i * 47) % 360,
      })),
    []
  );

  return (
    <View style={styles.container} pointerEvents="none">
      {piezas.map((p, i) => (
        <ConfettiPiece key={i} pieza={p} />
      ))}
    </View>
  );
}

function ConfettiPiece({ pieza }: { pieza: Pieza }) {
  const translateY = useSharedValue(-VH * 0.1);
  const rotate = useSharedValue(0);

  useEffect(() => {
    const totalTravel = VH * 1.2; // -10vh to 110vh
    translateY.value = withRepeat(
      withTiming(totalTravel, {
        duration: pieza.dur * 1000,
      }),
      -1,
      false
    );
    rotate.value = withRepeat(
      withTiming(540, {
        duration: pieza.dur * 1000,
      }),
      -1,
      false
    );
  }, [pieza.dur, translateY, rotate]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { rotate: `${rotate.value}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.piece,
        {
          left: `${pieza.left}%`,
          width: pieza.width,
          height: pieza.height,
          backgroundColor: pieza.color,
        },
        animatedStyle,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  piece: {
    position: 'absolute',
    top: 0,
    borderRadius: 2,
  },
});
