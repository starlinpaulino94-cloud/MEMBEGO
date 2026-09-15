import React from 'react';
import { View } from 'react-native';
import { cn } from '../../lib/cn';

export interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <View
      className={cn('rounded-lg bg-muted', className)}
      accessibilityLabel="Cargando..."
    />
  );
}
