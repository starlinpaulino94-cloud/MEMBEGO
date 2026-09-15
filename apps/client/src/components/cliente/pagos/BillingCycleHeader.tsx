import React from 'react';
import { View, Text } from 'react-native';
import { cn } from '../../../lib/cn';

/**
 * Datos del ciclo de facturación SIN contenedores físicos (estilo Stripe
 * Billing): una fila fluida con divisores verticales ultra-delgados.
 * Port RN de `src/components/cliente/pagos/BillingCycleHeader.tsx`.
 */
export interface BillingCycleItem {
  label: string;
  value: string;
}

export interface BillingCycleHeaderProps {
  items: BillingCycleItem[];
  className?: string;
}

export function BillingCycleHeader({
  items,
  className,
}: BillingCycleHeaderProps) {
  const visibles = items.filter((i) => i.value && i.value !== '—');
  if (visibles.length === 0) return null;

  return (
    <View className={cn('flex-row flex-wrap', className)}>
      {visibles.map((item, idx) => (
        <View
          key={item.label}
          className={cn(
            'py-2',
            idx > 0 && 'border-l border-border/60 pl-4',
            idx === 0 ? 'pr-4' : 'px-4'
          )}
        >
          <Text className="text-xs text-muted-foreground">{item.label}</Text>
          <Text className="mt-0.5 text-sm font-inter-medium text-foreground">
            {item.value}
          </Text>
        </View>
      ))}
    </View>
  );
}
