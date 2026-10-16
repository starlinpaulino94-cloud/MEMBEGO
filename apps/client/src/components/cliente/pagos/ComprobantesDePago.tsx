import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Printer } from 'lucide-react-native';
import type { ComprobanteCliente } from '../../../lib/api';
import { formatMoney, formatDateTime } from '../../../lib/format';
import { abrirComprobante } from '../../../lib/comprobantes';

/**
 * Lista de comprobantes de pago (una venta = una factura). Cada fila abre la
 * factura en el navegador del teléfono, donde se imprime o se guarda en PDF.
 * Port RN de la sección «Comprobantes de pago» de `/cliente/pagos`.
 */
export function ComprobantesDePago({ items }: { items: ComprobanteCliente[] }) {
  const [abriendo, setAbriendo] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <View className="rounded-2xl border border-dashed border-border/60 px-4 py-6">
        <Text className="text-center text-sm text-muted-foreground">
          Cuando se confirme un pago, aquí tendrás su comprobante para imprimir o guardar en PDF.
        </Text>
      </View>
    );
  }

  return (
    <View className="overflow-hidden rounded-2xl border border-border/60 bg-card">
      {items.map((c, i) => (
        <Pressable
          key={c.id}
          onPress={async () => {
            if (abriendo) return;
            setAbriendo(c.id);
            try {
              await abrirComprobante(c.id);
            } catch {
              /* sin red o enlace caducado: el usuario puede volver a tocar */
            } finally {
              setAbriendo(null);
            }
          }}
          className={`flex-row items-center gap-3 px-4 py-3.5 active:bg-muted/40 ${i > 0 ? 'border-t border-border/40' : ''}`}
          accessibilityRole="button"
          accessibilityLabel={`Imprimir comprobante ${c.codigo}`}
        >
          <View className="min-w-0 flex-1">
            <Text className="text-sm text-foreground" numberOfLines={1}>
              {c.detalle ?? 'Pago'}
              <Text className="text-muted-foreground"> · {c.empresa}</Text>
            </Text>
            <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={1}>
              {formatDateTime(c.fecha)} · {c.codigo}
              {c.metodoPago ? ` · ${c.metodoPago}` : ''}
            </Text>
          </View>
          {c.total ? (
            <Text className="shrink-0 font-inter-semibold text-sm tabular-nums text-foreground">
              {formatMoney(Number(c.total))}
            </Text>
          ) : null}
          <View className="shrink-0 flex-row items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5">
            <Printer size={14} color="#0284c7" />
            <Text className="text-xs font-inter-semibold text-primary">
              {abriendo === c.id ? 'Abriendo…' : 'Imprimir'}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
