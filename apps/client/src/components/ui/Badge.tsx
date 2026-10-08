import React from 'react';
import { View, Text, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import { cn } from '../../lib/cn';

type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'success'
  | 'warning'
  | 'info'
  | 'danger'
  | 'vibe'
  | 'custom';

const legacyMap: Record<string, BadgeVariant> = {
  danger: 'destructive',
  vibe: 'secondary',
};

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  textClassName?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

const variantClasses: Record<string, string> = {
  default: 'bg-primary border-transparent',
  secondary: 'bg-secondary border-border',
  destructive: 'bg-destructive/10 border-destructive/20',
  success: 'bg-success/10 border-success/20',
  warning: 'bg-warning/15 border-warning/30',
  info: 'bg-info/10 border-info/20',
  custom: 'border-none'
};

const textClasses: Record<string, string> = {
  default: 'text-primary-foreground',
  secondary: 'text-secondary-foreground',
  destructive: 'text-destructive',
  success: 'text-success',
  warning: 'text-warning',
  info: 'text-info',
  custom: ''
};

export function Badge({
  children,
  variant = 'default',
  className = '',
  textClassName = '',
  style,
  textStyle,
}: BadgeProps) {
  const resolved = legacyMap[variant] ?? variant;

  return (
    <View
      className={cn(
        'self-start flex-row items-center rounded-lg border px-2.5 py-0.5',
        variantClasses[resolved],
        className,
      )}
      style={style}
    >
      <Text
        className={cn(
          'text-xs font-inter-medium',
          textClasses[resolved],
          textClassName,
        )}
        style={textStyle}
      >
        {children}
      </Text>
    </View>
  );
}
