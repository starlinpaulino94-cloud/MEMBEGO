import React from 'react';
import { View, Text } from 'react-native';
import { QrCode, Check, Shield } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { formatDateTime } from '../../lib/format';
import { cn } from '../../lib/cn';

interface ReservaCheckinQrDisplayProps {
  checkinToken: string | null;
  checkinAt: string | null;
  checkinPorId: string | null;
  numero: string;
}

export function ReservaCheckinQrDisplay({
  checkinToken,
  checkinAt,
  numero,
}: ReservaCheckinQrDisplayProps) {
  if (!checkinToken) return null;

  // Strip "EXC:" prefix if present (same logic as web codigoDeCheckin)
  const tokenLimpio = checkinToken.startsWith('EXC:')
    ? checkinToken.slice(4)
    : checkinToken;

  const embarcado = !!checkinAt;

  return (
    <Card className="p-5">
      {/* Header */}
      <View className="flex-row items-center justify-between gap-4">
        <View className="flex-row items-center gap-2 flex-1">
          <View className="h-10 w-10 rounded-lg bg-primary/10 items-center justify-center">
            <QrCode size={20} color="#0284c7" />
          </View>
          <View className="flex-1">
            <Text className="text-base font-inter-semibold text-foreground">
              QR de embarque
            </Text>
            <Text className="text-xs text-muted-foreground">
              El cliente lo enseña el día de la salida. Sirve para marcar quién se subió.
            </Text>
          </View>
        </View>
        {embarcado && (
          <Badge variant="success" className="flex-row items-center gap-1">
            <Check size={14} color="#00864d" />
            <Text className="text-xs font-inter-semibold text-success">Embarcado</Text>
          </Badge>
        )}
      </View>

      {/* QR Code */}
      <View className="mt-4 items-center">
        <View className="bg-white p-3 rounded-xl">
          <QRCode value={tokenLimpio} size={200} />
        </View>
      </View>

      {/* Número de reserva */}
      <Text className="mt-2 text-center font-mono font-inter-semibold text-foreground">
        {numero}
      </Text>

      {/* Fecha de embarque */}
      {checkinAt && (
        <View className="mt-4 flex-row items-center justify-center gap-1.5">
          <Shield size={16} color="#71717a" />
          <Text className="text-sm text-muted-foreground">
            Embarcado el {formatDateTime(checkinAt)}
          </Text>
        </View>
      )}
    </Card>
  );
}
