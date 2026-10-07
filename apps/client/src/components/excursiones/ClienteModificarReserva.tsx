import React, { useState } from 'react';
import { View, Text, Pressable, Alert } from 'react-native';
import { Minus, Plus, Users, AlertCircle, CheckCircle2 } from 'lucide-react-native';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { formatMoney } from '../../lib/format';
import { cn } from '../../lib/cn';
import {
  calcularModificacion,
  type PoliticaReembolso,
} from '../../lib/reservas-nucleo';

interface ClienteModificarReservaProps {
  reservaId: string;
  adultos: number;
  ninos: number;
  precioAdulto: number;
  precioNino: number | null;
  impuestoPct: number | null;
  descuento: number;
  pagado: number;
  moneda: string;
  politica: PoliticaReembolso;
  horasRestantes: number;
  modificable: boolean;
}

export function ClienteModificarReserva({
  reservaId,
  adultos,
  ninos,
  precioAdulto,
  precioNino,
  impuestoPct,
  descuento,
  pagado,
  moneda,
  politica,
  horasRestantes,
  modificable,
}: ClienteModificarReservaProps) {
  const [abierto, setAbierto] = useState(false);
  const [nuevosAdultos, setNuevosAdultos] = useState(adultos);
  const [nuevosNinos, setNuevosNinos] = useState(ninos);

  // Si no permite reducción, no mostrar nada
  if (!politica.permitirReduccionPasajeros) {
    return null;
  }

  const maxAdultos = adultos;
  const maxNinos = ninos;
  const totalOriginal = adultos + ninos;
  const totalNuevo = nuevosAdultos + nuevosNinos;

  // Cálculo en vivo del nuevo total y reembolso
  const preview = calcularModificacion({
    adultosOriginales: adultos,
    ninosOriginales: ninos,
    adultosNuevos: nuevosAdultos,
    ninosNuevos: nuevosNinos,
    precioAdulto,
    precioNino,
    impuestoPct,
    descuentoActual: descuento,
    pagado,
    politica,
    horasRestantes,
  });

  const haCambiado = nuevosAdultos !== adultos || nuevosNinos !== ninos;

  const handleConfirm = () => {
    // ponytail: no-op — el BFF no tiene endpoint de modificación de reserva.
    // Agregar POST /api/v1/cliente/mis-excursiones/[id]/modificar cuando F4 lo priorice.
    Alert.alert(
      'Próximamente',
      'La modificación de reservas estará disponible en una próxima actualización.'
    );
  };

  const handleClose = () => {
    setAbierto(false);
    setNuevosAdultos(adultos);
    setNuevosNinos(ninos);
  };

  return (
    <Card className="p-4">
      {/* Header */}
      <View className="flex-row items-center justify-between flex-wrap gap-2">
        <View className="flex-row items-center gap-2.5 flex-1">
          <View className="h-9 w-9 rounded-xl bg-primary/10 items-center justify-center">
            <Users size={20} color="#0284c7" />
          </View>
          <View className="flex-1">
            <Text className="text-sm font-inter-bold text-foreground">
              Modificar Pasajeros
            </Text>
            <Text className="text-xs text-muted-foreground">
              {modificable
                ? `Puedes reducir pasajeros hasta ${politica.anticipacionMinimaHoras}h antes (quedan ${horasRestantes}h).`
                : `Tiempo límite vencido (${horasRestantes}h restantes, mínimo requerido: ${politica.anticipacionMinimaHoras}h).`}
            </Text>
          </View>
        </View>

        {!abierto ? (
          <Button
            variant="outline"
            size="sm"
            onPress={() => setAbierto(true)}
            disabled={!modificable}
          >
            Modificar reserva
          </Button>
        ) : (
          <Button variant="outline" size="sm" onPress={handleClose}>
            Cerrar
          </Button>
        )}
      </View>

      {/* Steppers */}
      {abierto && (
        <View className="mt-4 pt-4 border-t border-border/60 gap-4">
          {/* Adultos */}
          <View className="flex-row items-center justify-between rounded-xl bg-muted/40 p-3.5">
            <View>
              <Text className="text-xs font-inter-bold text-foreground">Adultos</Text>
              <Text className="text-xs text-muted-foreground">Original: {adultos}</Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={() => setNuevosAdultos((prev) => Math.max(0, prev - 1))}
                disabled={nuevosAdultos <= 0 || (nuevosAdultos === 1 && nuevosNinos === 0)}
                className={cn(
                  'h-8 w-8 rounded-lg border border-border items-center justify-center',
                  (nuevosAdultos <= 0 || (nuevosAdultos === 1 && nuevosNinos === 0)) &&
                    'opacity-50'
                )}
              >
                <Minus size={14} color="#0284c7" />
              </Pressable>
              <Text className="w-8 text-center font-mono font-inter-bold text-sm">
                {nuevosAdultos}
              </Text>
              <Pressable
                onPress={() => setNuevosAdultos((prev) => Math.min(maxAdultos, prev + 1))}
                disabled={nuevosAdultos >= maxAdultos}
                className={cn(
                  'h-8 w-8 rounded-lg border border-border items-center justify-center',
                  nuevosAdultos >= maxAdultos && 'opacity-50'
                )}
              >
                <Plus size={14} color="#0284c7" />
              </Pressable>
            </View>
          </View>

          {/* Niños */}
          <View className="flex-row items-center justify-between rounded-xl bg-muted/40 p-3.5">
            <View>
              <Text className="text-xs font-inter-bold text-foreground">Niños</Text>
              <Text className="text-xs text-muted-foreground">Original: {ninos}</Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={() => setNuevosNinos((prev) => Math.max(0, prev - 1))}
                disabled={nuevosNinos <= 0 || (nuevosNinos === 1 && nuevosAdultos === 0)}
                className={cn(
                  'h-8 w-8 rounded-lg border border-border items-center justify-center',
                  (nuevosNinos <= 0 || (nuevosNinos === 1 && nuevosAdultos === 0)) &&
                    'opacity-50'
                )}
              >
                <Minus size={14} color="#0284c7" />
              </Pressable>
              <Text className="w-8 text-center font-mono font-inter-bold text-sm">
                {nuevosNinos}
              </Text>
              <Pressable
                onPress={() => setNuevosNinos((prev) => Math.min(maxNinos, prev + 1))}
                disabled={nuevosNinos >= maxNinos}
                className={cn(
                  'h-8 w-8 rounded-lg border border-border items-center justify-center',
                  nuevosNinos >= maxNinos && 'opacity-50'
                )}
              >
                <Plus size={14} color="#0284c7" />
              </Pressable>
            </View>
          </View>

          {/* Preview dinámico */}
          {haCambiado && (
            <View className="rounded-xl bg-primary/5 border border-primary/20 p-3.5 gap-2">
              <View className="flex-row justify-between">
                <Text className="text-xs font-inter-medium text-muted-foreground">
                  Pasajeros seleccionados:
                </Text>
                <Text className="text-xs font-inter-bold text-foreground">
                  {totalNuevo} de {totalOriginal} originales
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-xs font-inter-medium text-muted-foreground">
                  Nuevo total de la reserva:
                </Text>
                <Text className="text-xs font-inter-bold text-foreground">
                  {formatMoney(preview.nuevoTotal, { moneda })}
                </Text>
              </View>
              {preview.montoReembolso > 0 && (
                <View className="flex-row justify-between pt-1.5 border-t border-border/40">
                  <Text className="text-xs font-inter-bold text-success">
                    Reembolso estimado a procesar:
                  </Text>
                  <Text
                    className="text-xs font-inter-bold text-success"
                    style={{ fontVariant: ['tabular-nums'] }}
                  >
                    +{formatMoney(preview.montoReembolso, { moneda })}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Warning si total = 0 */}
          {totalNuevo === 0 && (
            <View className="flex-row items-center gap-2 rounded-xl bg-destructive/10 p-3">
              <AlertCircle size={16} color="#e7000b" />
              <Text className="text-xs text-destructive flex-1">
                La reserva necesita al menos 1 pasajero. Si deseas cancelar toda la reserva,
                contacta directamente con soporte.
              </Text>
            </View>
          )}

          {/* Botones de acción */}
          <View className="flex-row items-center justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onPress={handleClose}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onPress={handleConfirm}
              disabled={!haCambiado || totalNuevo === 0 || !modificable}
            >
              Confirmar cambios
            </Button>
          </View>
        </View>
      )}
    </Card>
  );
}
