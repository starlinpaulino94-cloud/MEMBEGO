import React from 'react';
import { Pressable, Text, ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { cn } from '../../lib/cn';
import { colors } from '../../theme/tokens';

type ButtonVariant =
  | 'default'
  | 'outline'
  | 'destructive'
  | 'success'
  | 'gradient'
  | 'premium'
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'vibe';

type ButtonSize = 'default' | 'sm' | 'lg' | 'xl' | 'icon' | 'md';

const legacyMap: Record<string, ButtonVariant> = {
  primary: 'default',
  secondary: 'outline',
  ghost: 'outline',
  vibe: 'gradient',
};

const sizeMap: Record<string, ButtonSize> = {
  md: 'default',
};

export interface ButtonProps {
  children: React.ReactNode;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const baseClasses =
  'flex-row items-center justify-center rounded-xl active:opacity-80';

const variantClasses: Record<string, string> = {
  default: 'bg-primary active:opacity-90',
  outline: 'border border-border bg-background active:bg-muted',
  destructive: 'bg-destructive active:opacity-90',
  success: 'bg-success active:opacity-90',
  gradient: 'active:opacity-90',
  premium: 'active:opacity-95',
};

const sizeClasses: Record<string, string> = {
  default: 'h-11 px-4 min-w-[44px]',
  sm: 'h-11 rounded-lg px-3',
  lg: 'h-11 px-6',
  xl: 'h-12 px-8',
  icon: 'size-11 rounded-xl',
};

const gradientSizeStyles: Record<ButtonSize, ViewStyle> = {
  default: { height: 44, minWidth: 44, paddingHorizontal: 16 },
  sm: { height: 44, paddingHorizontal: 12 },
  lg: { height: 44, paddingHorizontal: 24 },
  xl: { height: 48, paddingHorizontal: 32 },
  icon: { height: 44, width: 44 },
  md: { height: 44, minWidth: 44, paddingHorizontal: 16 },
};

const textClasses: Record<string, string> = {
  default: 'text-primary-foreground font-inter-semibold',
  outline: 'text-foreground font-inter-medium',
  destructive: 'text-white font-inter-semibold',
  success: 'text-white font-inter-semibold',
  gradient: 'text-white font-inter-semibold',
  premium: 'text-white font-inter-bold',
};

const textSizeClasses: Record<string, string> = {
  default: 'text-sm',
  sm: 'text-caption',
  lg: 'text-base',
  xl: 'text-base',
  icon: 'text-sm',
};

type GradientColors = readonly [string, string, ...string[]]

const gradientColors: Record<string, GradientColors> = {
  gradient: colors.gradient.primary,
  premium: colors.gradient.premium,
};

export function Button({
  children,
  onPress,
  variant = 'default',
  size = 'default',
  disabled = false,
  loading = false,
  className = '',
  icon,
  style,
}: ButtonProps) {
  const resolvedVariant = legacyMap[variant] ?? variant;
  const resolvedSize = sizeMap[size] ?? size;
  const isGradient = resolvedVariant === 'gradient' || resolvedVariant === 'premium';

  const label = typeof children === 'string' || typeof children === 'number' ? (
    <Text
      className={cn(
        textClasses[resolvedVariant],
        textSizeClasses[resolvedSize],
      )}
    >
      {children}
    </Text>
  ) : (
    <View className="flex-row items-center">{children}</View>
  )

  const content = (
    <>
      {loading ? (
        <ActivityIndicator color={colors.surface.background} size="small" className="mr-2" />
      ) : icon ? (
        <View className="mr-2">{icon}</View>
      ) : null}
      {label}
    </>
  );

  if (isGradient) {
    return (
      <Pressable
        onPress={disabled || loading ? undefined : onPress}
        disabled={disabled || loading}
        className={cn(
          baseClasses,
          'overflow-hidden rounded-xl',
          resolvedVariant === 'premium' && 'shadow-glow',
          disabled && 'opacity-50',
          className,
        )}
        style={style}
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || loading }}
      >
        <LinearGradient
          colors={gradientColors[resolvedVariant]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            ...gradientSizeStyles[resolvedSize],
            flexDirection: 'row',
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {content}
        </LinearGradient>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={disabled || loading ? undefined : onPress}
      disabled={disabled || loading}
      className={cn(
        baseClasses,
        variantClasses[resolvedVariant],
        sizeClasses[resolvedSize],
        disabled && 'opacity-50',
        className,
      )}
      style={style}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
    >
      {content}
    </Pressable>
  );
}
