import React from 'react';
import { View, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { cn } from '../../lib/cn';

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function Card({
  children,
  className = '',
  onPress,
  accessibilityLabel,
  style,
}: CardProps) {
  const containerClasses = cn(
    'rounded-xl border border-border bg-card p-3 shadow-card',
    className,
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={style}
        className={cn(containerClasses, 'active:opacity-90')}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </Pressable>
    );
  }

  return <View className={containerClasses} style={style}>{children}</View>;
}
