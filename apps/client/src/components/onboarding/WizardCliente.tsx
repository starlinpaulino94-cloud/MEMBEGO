import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { CheckCircle2, ArrowRight, PartyPopper } from 'lucide-react-native';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { cn } from '../../lib/cn';
import type { BienvenidaResponse } from '../../lib/api';

type OnboardingItem = BienvenidaResponse['onboarding']['items'][number];

/**
 * Asistente de bienvenida del cliente (Onboarding Fase 3C · B2C).
 * Equivalente RN de src/components/onboarding/WizardCliente.tsx.
 *
 * Guia los pasos (perfil → intereses → descubrir empresas → primera membresía)
 * con un "paso actual". NO es obligatorio: el cliente puede usar la app sin
 * completarlo. El progreso se deriva de datos reales (getOnboardingCliente).
 */

/**
 * ponytail: mapeo de hrefs web → rutas RN existentes.
 * Upgrade path: cuando se implementen las pantallas de perfil/ajustes,
 * ampliar este mapa con las rutas exactas.
 */
const HREF_MAP: Record<string, string> = {
  '/cliente/perfil': '/intereses', // ponytail: perfil no existe; redirect a intereses
  '/cliente/intereses': '/intereses',
  '/cliente/empresas': '/explorar',
  '/cliente/planes': '/planes',
  '/mis-membresias': '/mis-membresias',
};

function mapHref(href: string): string {
  return HREF_MAP[href] ?? '/mis-membresias';
}

export function WizardCliente({
  onboarding,
  nombre,
}: {
  onboarding: BienvenidaResponse['onboarding'];
  nombre: string;
}) {
  const router = useRouter();
  const pct = Math.round((onboarding.completados / onboarding.total) * 100);
  const currentIndex = onboarding.items.findIndex((i) => !i.done);
  const completo = onboarding.completados === onboarding.total;

  /* ── Estado completo ─────────────────────────────────────────────── */
  if (completo) {
    return (
      <Card className="items-center py-8 px-6">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-success/15 mb-4">
          <PartyPopper size={28} color="#00864d" />
        </View>
        <Text className="text-h2 font-inter-bold text-foreground text-center">
          ¡Todo listo, {nombre}!
        </Text>
        <Text className="mt-2 text-sm text-muted-foreground text-center">
          Completaste tu configuración. Explora empresas y aprovecha tus beneficios.
        </Text>
        <Button
          className="mt-6 gap-1.5"
          onPress={() => router.push('/mis-membresias')}
          icon={<ArrowRight size={16} color="#ffffff" />}
        >
          Ir a mis membresías
        </Button>
      </Card>
    );
  }

  /* ── Wizard activo ───────────────────────────────────────────────── */
  return (
    <View className="gap-6">
      {/* Greeting */}
      <View>
        <Text className="text-sm font-inter-semibold text-primary">
          Bienvenida
        </Text>
        <Text className="mt-1 text-h1 font-inter-bold text-foreground">
          Hola, {nombre} 👋
        </Text>
        <Text className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Personaliza tu experiencia en unos pasos. No es obligatorio: puedes
          hacerlo ahora o cuando quieras.
        </Text>
      </View>

      {/* Progress bar */}
      <Card className="p-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm font-inter-semibold text-foreground">
            {onboarding.completados} de {onboarding.total}
          </Text>
          <Text className="text-sm font-inter-semibold text-primary">
            {pct}%
          </Text>
        </View>
        <View className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
          <View
            className="h-full rounded-full bg-primary"
            style={{ width: `${pct}%` }}
          />
        </View>
      </Card>

      {/* Steps list */}
      <View className="gap-3">
        {onboarding.items.map((item, i) => {
          const isCurrent = i === currentIndex;
          return (
            <WizardStep
              key={item.key}
              item={item}
              index={i}
              isCurrent={isCurrent}
              onPress={() => router.push(mapHref(item.href))}
            />
          );
        })}
      </View>

      {/* Skip link */}
      <Pressable
        className="items-center"
        onPress={() => router.push('/mis-membresias')}
      >
        <Text className="text-sm text-muted-foreground underline">
          Saltar por ahora
        </Text>
      </Pressable>
    </View>
  );
}

/* ── WizardStep ──────────────────────────────────────────────────────── */

function WizardStep({
  item,
  index,
  isCurrent,
  onPress,
}: {
  item: OnboardingItem;
  index: number;
  isCurrent: boolean;
  onPress: () => void;
}) {
  return (
    <View
      className={cn(
        'flex-row items-center justify-between gap-3 rounded-xl border p-4',
        isCurrent
          ? 'border-primary/30 bg-primary/10'
          : 'border-border bg-card',
      )}
    >
      <View className="flex-row items-center gap-3 flex-1">
        {item.done ? (
          <CheckCircle2 size={20} color="#00864d" />
        ) : (
          <View
            className={cn(
              'h-5 w-5 items-center justify-center rounded-full',
              isCurrent
                ? 'bg-primary'
                : 'bg-muted',
            )}
          >
            <Text
              className={cn(
                'text-xs font-inter-bold',
                isCurrent ? 'text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              {index + 1}
            </Text>
          </View>
        )}
        <View className="flex-1">
          <Text
            className={cn(
              'text-sm font-inter-medium',
              item.done
                ? 'text-muted-foreground line-through'
                : 'text-foreground',
            )}
          >
            {item.label}
          </Text>
          {isCurrent && (
            <Text className="text-xs text-primary mt-0.5">Siguiente paso</Text>
          )}
        </View>
      </View>

      {!item.done && item.cta ? (
        <Button
          size="sm"
          variant={isCurrent ? 'default' : 'outline'}
          onPress={onPress}
          icon={<ArrowRight size={12} color={isCurrent ? '#ffffff' : '#0284c7'} />}
        >
          {item.cta}
        </Button>
      ) : null}
    </View>
  );
}
