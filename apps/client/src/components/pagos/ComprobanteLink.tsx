import React from 'react';
import { Pressable, Text, Linking } from 'react-native';
import { FileText, ExternalLink } from 'lucide-react-native';
import { cn } from '../../lib/cn';

/**
 * Enlace para ver un comprobante firmado.
 * Port RN de `src/components/pagos/ComprobanteLink.tsx`.
 *
 * La URL ya viene firmada del BFF (vigencia 5 min). Solo la abrimos
 * con Linking.openURL(). Si la URL es null/undefined, no se renderiza.
 */
export interface ComprobanteLinkProps {
  url: string | null | undefined;
  label?: string;
  className?: string;
}

export function ComprobanteLink({
  url,
  label = 'Ver comprobante',
  className,
}: ComprobanteLinkProps) {
  if (!url) return null;

  const handlePress = () => {
    Linking.openURL(url).catch(() => {
      // Silencio: si no se puede abrir, no mostramos error.
      // El usuario puede reintentar refrescando la pantalla.
    });
  };

  return (
    <Pressable
      onPress={handlePress}
      className={cn(
        'flex-row items-center gap-2 rounded-xl border border-border/70 px-3.5 py-2 active:opacity-70',
        className
      )}
      accessibilityRole="link"
    >
      <FileText size={16} color="#0284c7" />
      <Text className="text-sm font-inter-medium text-primary">{label}</Text>
      <ExternalLink size={12} color="#0284c7" />
    </Pressable>
  );
}
