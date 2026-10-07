import React from 'react';
import { View, Text } from 'react-native';
import { cn } from '../../lib/cn';
import { Sparkle } from 'lucide-react-native';
import { useInicioAccent } from '../layout/InicioAccentContext';

export interface SectionHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  Icon?: typeof Sparkle;
}

export function SectionHeader({
  title,
  description,
  action,
  className,
  Icon
}: SectionHeaderProps) {
  const { accent } = useInicioAccent();

  return (
    <View className={cn('flex-row items-start justify-between gap-3', className)}>
      <View className="flex-1 flex-row items-center gap-2 min-w-0">
        {Icon && (
          <View className="mt-1 shrink-0">
            <Icon size={20} color={accent.color} />
          </View>
        )}
        <View className="flex-1 min-w-0">
          <Text className="text-lg md:text-h2 font-inter-bold text-foreground">{title}</Text>
          {description && (
            <Text className="mt-1 text-small text-muted-foreground">
              {description}
            </Text>
          )}
        </View>
      </View>
      {action && <View className="shrink-0 self-center">{action}</View>}
    </View>
  );
}
