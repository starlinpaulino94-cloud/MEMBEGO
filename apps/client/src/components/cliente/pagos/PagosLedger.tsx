import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, Linking, Share } from 'react-native';
import { CalendarClock, CreditCard, ExternalLink, FileText, Printer, Share2, Wallet } from 'lucide-react-native';
import { cn } from '../../../lib/cn';
import { formatMoney, formatDateTime } from '../../../lib/format';
import type { PagoHistorialItem } from '../../../lib/api';
import { EmptyState } from '../../ui/EmptyState';
import { Sheet } from '../../ui/Sheet';
import { abrirComprobante } from '../../../lib/comprobantes';

/**
 * Historial de pagos como extracto bancario digital (Revolut/Linear):
 * lista semántica ultra-limpia con micro-puntos de estado, método de pago,
 * montos en monoespaciada tabular y visor de comprobantes integrado en un
 * Sheet lateral.
 * Port RN de `src/components/cliente/pagos/PagosLedger.tsx`.
 */
export interface PagosLedgerProps {
  items: PagoHistorialItem[];
  className?: string;
}

export function PagosLedger({ items, className }: PagosLedgerProps) {
  const [abierto, setAbierto] = useState<PagoHistorialItem | null>(null);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock size={40} color="#71717a" />}
        title="Sin historial"
        description="Aquí aparecerán tus pagos aprobados y rechazados."
        className={className}
      />
    );
  }

  return (
    <View className={className}>
      <View className="overflow-hidden rounded-2xl border border-border/60 bg-card">
        {items.map((h, idx) => (
          <View
            key={h.id}
            className={cn(
              'flex-row items-center gap-3 px-4 py-3.5',
              idx < items.length - 1 && 'border-b border-border/40'
            )}
          >
            <LedgerRow item={h} onVer={() => setAbierto(h)} />
          </View>
        ))}
      </View>

      <ReceiptDrawer
        item={abierto}
        onClose={() => setAbierto(null)}
      />
    </View>
  );
}

/** Fila de transacción estilo extracto: punto semántico, datos y monto mono. */
function LedgerRow({
  item,
  onVer,
}: {
  item: PagoHistorialItem;
  onVer: () => void;
}) {
  const aprobado = item.tipo === 'APROBADO';

  return (
    <>
      {/* Micro-punto de estado semántico */}
      <View
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          aprobado ? 'bg-success' : 'bg-destructive'
        )}
      />

      {/* Izquierda: qué pasó + cuándo */}
      <View className="min-w-0 flex-1">
        <Text className="text-sm text-foreground" numberOfLines={1}>
          {aprobado ? 'Pago aprobado' : 'Pago rechazado'}
          {item.planNombre ? (
            <Text className="text-muted-foreground"> · {item.planNombre}</Text>
          ) : null}
        </Text>
        <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={1}>
          {formatDateTime(item.fecha)}
          {item.motivo ? (
            <Text className="italic"> · {item.motivo}</Text>
          ) : null}
        </Text>
      </View>

      {/* Centro: con qué se pagó (tarjeta de la app/web, o el método de la membresía) */}
      {item.formaDePago ?? item.metodoPagoNombre ? (
        <View className="hidden max-w-[12rem] shrink-0 flex-row items-center gap-1.5 sm:flex">
          {item.formaDePago ? <CreditCard size={14} color="#71717a" /> : <Wallet size={14} color="#71717a" />}
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {item.formaDePago ?? item.metodoPagoNombre}
          </Text>
        </View>
      ) : null}

      {/* Derecha: monto en mono tabular */}
      {item.monto != null ? (
        <Text
          className={cn(
            'shrink-0 font-inter-bold text-sm tabular-nums',
            aprobado ? 'text-foreground' : 'text-muted-foreground line-through'
          )}
        >
          {formatMoney(item.monto)}
        </Text>
      ) : null}

      {/* Ver detalles */}
      <Pressable
        onPress={onVer}
        className="shrink-0 rounded-lg border border-border/60 px-2.5 py-1.5 active:opacity-70"
        accessibilityRole="button"
      >
        <Text className="text-xs font-inter-semibold text-muted-foreground">
          Ver
        </Text>
      </Pressable>
    </>
  );
}

/**
 * Visor integrado del recibo: Sheet lateral con el comprobante subido y los
 * detalles de la validación.
 */
function ReceiptDrawer({
  item,
  onClose,
}: {
  item: PagoHistorialItem | null;
  onClose: () => void;
}) {
  const aprobado = item?.tipo === 'APROBADO';

  const title = aprobado ? 'Pago aprobado' : 'Pago rechazado';

  return (
    <Sheet visible={!!item} onClose={onClose} title={title}>
      {item && (
        <ScrollView className="max-h-[70vh]">
          {/* Status dot + fecha */}
          <View className="mb-4 flex-row items-center gap-2">
            <View
              className={cn(
                'h-2 w-2 rounded-full',
                aprobado ? 'bg-success' : 'bg-destructive'
              )}
            />
            <Text className="text-sm text-muted-foreground">
              {formatDateTime(item.fecha)}
            </Text>
          </View>

          {/* Monto grande */}
          {item.monto != null ? (
            <Text className="mb-5 font-inter-bold text-3xl tabular-nums text-foreground">
              {formatMoney(item.monto)}
            </Text>
          ) : null}

          {/* Detalles */}
          <View className="border-y border-border/50 py-4">
            {item.planNombre ? (
              <DetailRow label="Plan" value={item.planNombre} />
            ) : null}
            {item.formaDePago ?? item.metodoPagoNombre ? (
              <DetailRow label="Pagado con" value={(item.formaDePago ?? item.metodoPagoNombre) as string} />
            ) : null}
            {item.recibo ? <DetailRow label="Recibo Nº" value={item.recibo.ticketNumero} /> : null}
            {item.recibo?.autorizacion ? <DetailRow label="Autorización" value={item.recibo.autorizacion} /> : null}
            {item.recibo ? <DetailRow label="Negocio" value={item.recibo.empresaNombre} /> : null}
            {item.validadoPor ? (
              <DetailRow label="Validado por" value={item.validadoPor} />
            ) : null}
            {item.motivo ? (
              <View className="flex-row justify-between gap-3 py-1.5">
                <Text className="text-sm text-muted-foreground">Motivo</Text>
                <Text className="text-right text-sm font-inter-medium text-destructive">
                  {item.motivo}
                </Text>
              </View>
            ) : null}
          </View>

          {/* La factura del pago: se abre en el navegador, donde se imprime o se guarda en PDF */}
          {item.transaccionId ? (
            <Pressable
              onPress={() => {
                abrirComprobante(item.transaccionId!).catch(() => {});
              }}
              className="mt-5 flex-row items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 active:opacity-80"
              accessibilityRole="button"
            >
              <Printer size={16} color="#ffffff" />
              <Text className="text-sm font-inter-semibold text-white">
                Ver / imprimir comprobante
              </Text>
            </Pressable>
          ) : null}

          {/* Recibo de un pago con tarjeta: se comparte como texto (WhatsApp, correo, imprimir desde allí). */}
          {item.recibo ? (
            <Pressable
              onPress={() => {
                Share.share({ message: item.recibo!.texto }).catch(() => {});
              }}
              className="mt-3 flex-row items-center justify-center gap-2 rounded-xl border border-border/60 px-4 py-3 active:opacity-70"
              accessibilityRole="button"
              accessibilityLabel="Compartir recibo"
            >
              <Share2 size={16} color="#0284c7" />
              <Text className="text-sm font-inter-semibold text-primary">Compartir recibo</Text>
            </Pressable>
          ) : null}

          {/* Comprobante */}
          {item.comprobanteUrl ? (
            <View className="mt-5">
              <Text className="mb-2 text-xs font-inter-semibold uppercase tracking-wide text-muted-foreground">
                Comprobante
              </Text>
              <Pressable
                onPress={() => {
                  Linking.openURL(item.comprobanteUrl!).catch(() => {});
                }}
                className="flex-row items-center gap-2 rounded-xl border border-border/60 p-3 active:opacity-70"
                accessibilityRole="link"
              >
                <ExternalLink size={16} color="#0284c7" />
                <Text className="text-sm font-inter-medium text-primary">
                  Abrir original
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="mt-5 flex-row items-center gap-2 rounded-xl bg-muted/40 px-3.5 py-3">
              <FileText size={16} color="#71717a" />
              <Text className="text-xs text-muted-foreground">
                Esta transacción no tiene comprobante adjunto.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </Sheet>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-3 py-1.5">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="text-right text-sm font-inter-medium text-foreground">
        {value}
      </Text>
    </View>
  );
}
