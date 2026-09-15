import React from 'react';
import { View, Text } from 'react-native';
import { cn } from '../../lib/cn';

export interface SectionHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function SectionHeader({
  title,
  description,
  action,
  className,
}: SectionHeaderProps) {
  return (
    <View className={cn('flex-row items-start justify-between gap-3', className)}>
      <View className="flex-1 min-w-0">
        <Text className="text-h2 font-inter-bold text-foreground">{title}</Text>
        {description && (
          <Text className="mt-1 text-small text-muted-foreground">
            {description}
          </Text>
        )}
      </View>
      {action && <View className="shrink-0 self-start">{action}</View>}
    </View>
  );
}
