import React from 'react';
import { View, Text } from 'react-native';
import { cn } from '../../lib/cn';

export interface PageHeaderProps {
  eyebrow?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: PageHeaderProps) {
  return (
    <View className={cn('mb-6', className)}>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 min-w-0">
          {eyebrow && (
            <View className="mb-1">
              {typeof eyebrow === 'string' ? (
                <Text className="text-xs font-inter-semibold uppercase tracking-widest text-primary">
                  {eyebrow}
                </Text>
              ) : eyebrow}
            </View>
          )}
          <Text className="text-h1 font-inter-extrabold tracking-tight text-foreground">
            {title}
          </Text>
          {description && (
            <Text className="mt-1.5 text-small text-muted-foreground leading-relaxed">
              {description}
            </Text>
          )}
        </View>
        {action && <View className="shrink-0 self-start">{action}</View>}
      </View>
    </View>
  );
}
