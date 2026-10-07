import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Compass, Sparkles } from 'lucide-react-native';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';

/**
 * EL ESTADO «TODAVÍA NO ERES CLIENTE DE NINGÚN NEGOCIO».
 *
 * Equivalente RN de src/components/cliente/SinEmpresaTodavia.tsx
 *
 * Alguien que acaba de crear su cuenta no ha hecho nada mal. La pantalla tiene
 * que decirle qué hay y cómo empezar — nunca dejarle una página en blanco ni
 * un mensaje que suene a que le han cerrado la puerta.
 */
export function SinEmpresaTodavia({
  que,
  detalle,
}: {
  /** Qué es lo que no tiene, en plural y en su idioma: «beneficios», «citas». */
  que: string;
  /** Frase extra para explicar cómo se consigue lo de esta pantalla. */
  detalle?: string;
}) {
  const router = useRouter();

  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <EmptyState
        icon={<Sparkles size={40} color="#0284c7" />}
        title={`Aún no tienes ${que}`}
        description={
          detalle ??
          'Cuando adquieras una recompensa o te unas a un negocio, lo verás aquí. ' +
            'Explora lo que hay disponible cerca de ti para empezar.'
        }
        action={
          <View className="flex-row flex-wrap justify-center gap-2">
            <Button
              onPress={() => router.push('/promociones')}
              size="lg"
              icon={<Sparkles size={16} color="#ffffff" />}
            >
              Ver ofertas
            </Button>
            <Button
              onPress={() => router.push('/cerca')}
              size="lg"
              variant="outline"
              icon={<Compass size={16} color="#111827" />}
            >
              Negocios cerca de mí
            </Button>
          </View>
        }
      />
    </View>
  );
}
