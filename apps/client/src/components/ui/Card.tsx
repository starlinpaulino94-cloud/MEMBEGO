import React from 'react';
import { View, Pressable } from 'react-native';
import { cn } from '../../lib/cn';

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  onPress?: () => void;
}

export function Card({ children, className = '', onPress }: CardProps) {
  const containerClasses = cn(
    'rounded-2xl border border-border bg-card p-4 shadow-card',
    className,
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        className={cn(containerClasses, 'active:opacity-90')}
        accessibilityRole="button"
      >
        {children}
      </Pressable>
    );
  }

  return <View className={containerClasses}>{children}</View>;
}
