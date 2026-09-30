import React from 'react';
import { View, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { cn } from '../../lib/cn';

type CardGradient = readonly [string, string, ...string[]];

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  gradient?: CardGradient;
  onPress?: () => void;
  onHoverIn?: () => void;
  onHoverOut?: () => void;
  accessibilityLabel?: string;
  accessibilityElementsHidden?: boolean;
  importantForAccessibility?: 'auto' | 'yes' | 'no' | 'no-hide-descendants';
  'aria-hidden'?: boolean;
  tabIndex?: 0 | -1;
  style?: StyleProp<ViewStyle>;
}

export function Card({
  children,
  className = '',
  gradient,
  onPress,
  onHoverIn,
  onHoverOut,
  accessibilityLabel,
  accessibilityElementsHidden,
  importantForAccessibility,
  'aria-hidden': ariaHidden,
  tabIndex,
  style,
}: CardProps) {
  const containerClasses = cn(
    'rounded-xl border border-border p-3 shadow-card',
    !gradient && 'bg-card',
    className,
    gradient && 'bg-transparent',
  );
  const content = (
    <>
      {gradient ? (
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { top: 1, right: 1, bottom: 1, left: 1, borderRadius: 11, zIndex: -1 }]}
        />
      ) : null}
      {children}
    </>
  );

  if (onPress || onHoverIn || onHoverOut) {
    return (
      <Pressable
        onPress={onPress}
        onHoverIn={onHoverIn}
        onHoverOut={onHoverOut}
        style={style}
        className={cn(containerClasses, onPress && 'active:opacity-90')}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={accessibilityLabel}
        accessibilityElementsHidden={accessibilityElementsHidden}
        importantForAccessibility={importantForAccessibility}
        aria-hidden={ariaHidden}
        tabIndex={tabIndex}
      >
        {content}
      </Pressable>
    );
  }

  return <View className={containerClasses} style={style}>{content}</View>;
}
