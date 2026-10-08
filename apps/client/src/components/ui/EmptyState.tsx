import React from 'react';
import { View, Text } from 'react-native';
import { cn } from '../../lib/cn';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  variant?: 'card' | 'inline';
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'card',
  className,
}: EmptyStateProps) {
  const isCard = variant === 'card';

  return (
    <View
      className={cn(
        'items-center justify-center',
        isCard
          ? 'rounded-2xl border border-border/70 bg-card px-6 py-12'
          : 'px-6 py-10',
        className
      )}
    >
      {icon && (
        <View
          className={cn(
            'mb-5 items-center justify-center',
            isCard
              ? 'h-20 w-20 rounded-2xl bg-primary/10'
              : 'h-16 w-16 rounded-2xl border border-border/60 bg-muted'
          )}
        >
          {icon}
        </View>
      )}
      <Text
        className={cn(
          'text-center text-foreground',
          isCard ? 'text-h2 font-inter-bold' : 'text-h3 font-inter-bold'
        )}
      >
        {title}
      </Text>
      {description && (
        <Text className="mt-1.5 text-center text-small text-muted-foreground">
          {description}
        </Text>
      )}
      {action && <View className="mt-6">{action}</View>}
    </View>
  );
}
