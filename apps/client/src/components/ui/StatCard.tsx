import React from 'react';
import { View, Text } from 'react-native';
import { cn } from '../../lib/cn';

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  accent?: 'brand' | 'success' | 'warning' | 'danger';
  className?: string;
}

const ACCENT = {
  brand: { bar: 'bg-primary', orb: 'bg-primary', iconBg: 'bg-primary/10' },
  success: { bar: 'bg-success', orb: 'bg-success', iconBg: 'bg-success/10' },
  warning: { bar: 'bg-warning', orb: 'bg-warning', iconBg: 'bg-warning/10' },
  danger: { bar: 'bg-destructive', orb: 'bg-destructive', iconBg: 'bg-destructive/10' },
};

export function StatCard({
  label,
  value,
  icon,
  accent,
  className,
}: StatCardProps) {
  const a = accent ? ACCENT[accent] : null;

  return (
    <View
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border/60 bg-card p-5',
        className
      )}
    >
      {a && <View className={cn('absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl', a.bar)} />}
      {a && (
        <View
          className={cn('absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-20', a.orb)}
          style={{ filter: 'blur(24px)' }}
        />
      )}
      <View className="relative flex-row items-start justify-between gap-3">
        <View className="flex-1 min-w-0">
          <Text className="text-sm font-inter-medium text-muted-foreground">{label}</Text>
          <Text className="mt-1.5 text-3xl font-inter-bold tabular-nums text-foreground">
            {value}
          </Text>
        </View>
        {icon && a && (
          <View className={cn('shrink-0 rounded-xl p-2.5', a.iconBg)}>
            {icon}
          </View>
        )}
      </View>
    </View>
  );
}
