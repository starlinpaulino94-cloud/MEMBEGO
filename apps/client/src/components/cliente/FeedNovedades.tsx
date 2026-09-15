import React from 'react';
import { View, Text, Pressable, Image } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Megaphone,
  CalendarDays,
  Newspaper,
  BadgeCheck,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { cn } from '../../lib/cn';
import { formatDate } from '../../lib/format';
import { SectionHeader } from '../ui/SectionHeader';
import { rnHref } from '../../lib/rutas';
import type { NovedadInicio } from '../../lib/api';

/**
 * FEED NOVEDADES — filas densas del contrato Stitch (paridad con web).
 *
 * Cada fila: thumbnail 88×88 (imagen o fallback con icono + overlay de tipo),
 * overline de empresa, título, resumen, dato (descuento/fecha), CTA pill.
 * La fila entera es el enlace; la pill es visual, no un botón anidado.
 */

/* ── Tipo meta ─────────────────────────────────────────────────────────── */

interface TipoMeta {
  label: string;
  icon: LucideIcon;
  cta: string;
  iconColor: string;
}

const TIPO_META: Record<string, TipoMeta> = {
  PROMOCION: {
    label: 'Promoción',
    icon: Megaphone,
    cta: 'Ver oferta',
    iconColor: '#0284c7',
  },
  EVENTO: {
    label: 'Evento',
    icon: CalendarDays,
    cta: 'Ver evento',
    iconColor: '#0284c7',
  },
  NOTICIA: {
    label: 'Noticia',
    icon: Newspaper,
    cta: 'Leer más',
    iconColor: '#0284c7',
  },
  BENEFICIO: {
    label: 'Beneficio',
    icon: BadgeCheck,
    cta: 'Ver beneficio',
    iconColor: '#0284c7',
  },
};

/* ── Date helpers ──────────────────────────────────────────────────────── */

/** "24 sept" — para el "hasta el …" de promociones. */
function fmtFechaCorta(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat('es-DO', {
      timeZone: 'America/Santo_Domingo',
      day: 'numeric',
      month: 'short',
    }).format(new Date(dateStr));
  } catch {
    return formatDate(dateStr);
  }
}

/** "lun, 24 sept, 3:00 p. m." — para eventos. */
function fmtFechaHora(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat('es-DO', {
      timeZone: 'America/Santo_Domingo',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(dateStr));
  } catch {
    return formatDate(dateStr);
  }
}

/* ── Dato (línea de dato por tipo) ─────────────────────────────────────── */

function Dato({ n }: { n: NovedadInicio }) {
  if (n.tipo === 'PROMOCION') {
    return (
      <View className="flex-row items-center flex-1 min-w-0">
        {n.descuento ? (
          <Text
            className="text-price-sm text-primary"
            style={{ fontVariant: ['tabular-nums'] }}
            numberOfLines={1}
          >
            {n.descuento}
          </Text>
        ) : null}
        {n.vence ? (
          <Text className="text-caption text-muted-foreground" numberOfLines={1}>
            {n.descuento ? ' · ' : ''}hasta el {fmtFechaCorta(n.vence)}
          </Text>
        ) : null}
      </View>
    );
  }
  if (n.tipo === 'EVENTO') {
    return (
      <Text
        className="text-label-md font-inter-semibold text-foreground flex-1"
        numberOfLines={1}
      >
        {fmtFechaHora(n.fecha)}
      </Text>
    );
  }
  return (
    <Text className="text-caption text-muted-foreground flex-1" numberOfLines={1}>
      Publicada el {fmtFechaCorta(n.fecha)}
    </Text>
  );
}

/* ── FeedNovedades ─────────────────────────────────────────────────────── */

// Rutas RN nativas que rnHref deja intactas (no vienen del BFF web).
const RN_ROUTES = new Set([
  '/historial',
  '/mis-membresias',
  '/(tabs)/inicio',
  '/(tabs)/cuenta',
  '/(tabs)/qr',
  '/(tabs)/menu',
]);

function targetHref(href: string): string | null {
  const mapped = rnHref(href);
  if (mapped !== href) return mapped;
  if (RN_ROUTES.has(href) || href.startsWith('/membresia/')) return href;
  return null;
}

export function FeedNovedades({ novedades }: { novedades: NovedadInicio[] }) {
  const router = useRouter();

  if (novedades.length === 0) return null;

  return (
    <View>
      <SectionHeader
        title="Novedades de tus empresas"
        description="Lo último de los negocios que sigues"
      />

      <View className="mt-3 gap-2.5">
        {novedades.map((n) => {
          const meta = TIPO_META[n.tipo] ?? TIPO_META.NOTICIA;
          const Icon = meta.icon;
          const href = targetHref(n.href);

          return (
            <Pressable
              key={`${n.tipo}-${n.id}`}
              onPress={() => {
                if (href) router.push(href);
              }}
              className={cn(
                'flex-row items-center gap-3 rounded-lg bg-card p-2.5',
                'border border-border active:opacity-90',
              )}
              accessibilityRole="button"
              accessibilityLabel={`${meta.label}: ${n.titulo}`}
            >
              {/* ── Thumbnail 88×88 ───────────────────────────────────── */}
              <View className="relative h-22 w-22 shrink-0 overflow-hidden rounded-lg">
                {n.imagenUrl ? (
                  <Image
                    source={{ uri: n.imagenUrl }}
                    className="h-full w-full"
                    resizeMode="cover"
                  />
                ) : (
                  <View className="h-full w-full items-center justify-center bg-brand-primary-soft">
                    <Icon size={28} color={meta.iconColor} />
                  </View>
                )}
                {/* Overlay de tipo */}
                <View className="absolute bottom-1 left-1 rounded bg-foreground/80 px-1.5 py-0.5">
                  <Text className="text-label-sm font-inter-semibold leading-none text-background">
                    {meta.label}
                  </Text>
                </View>
              </View>

              {/* ── Texto ─────────────────────────────────────────────── */}
              <View className="flex-1 min-w-0">
                <Text
                  className="text-overline text-retail-deep"
                  numberOfLines={1}
                >
                  {n.companyName}
                </Text>
                <Text
                  className="mt-0.5 text-h4 text-foreground"
                  numberOfLines={1}
                >
                  {n.titulo}
                </Text>
                {n.resumen ? (
                  <Text
                    className="text-caption text-muted-foreground"
                    numberOfLines={1}
                  >
                    {n.resumen}
                  </Text>
                ) : null}
                <View className="mt-1.5 flex-row items-center justify-between gap-2">
                  <Dato n={n} />
                  <View className="shrink-0 rounded-full bg-brand-primary-soft px-3.5 py-1.5">
                    <Text className="text-label-md font-inter-semibold text-primary">
                      {meta.cta}
                    </Text>
                  </View>
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
