import React from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { PartyPopper, Gift, ArrowRight } from 'lucide-react-native';
import { useCelebracion } from '../src/hooks/useCelebracion';
import { ConfettiCelebration } from '../src/components/growth/ConfettiCelebration';
import { SinEmpresaTodavia } from '../src/components/cliente/SinEmpresaTodavia';
import { Button } from '../src/components/ui/Button';
import { cn } from '../src/lib/cn';

/**
 * Growth Engine 3.0 · Pantalla de celebración tras registrarse por invitación.
 * Muestra confeti y el beneficio recién desbloqueado.
 * Equivalente RN de src/app/(cliente)/cliente/celebracion/page.tsx
 */
export default function CelebracionScreen() {
  const router = useRouter();
  const { data, isLoading, isError } = useCelebracion();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#0284c7" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-center text-foreground font-inter-bold text-h3">
          Error al cargar
        </Text>
        <Text className="mt-2 text-center text-small text-muted-foreground">
          No pudimos cargar tu celebración. Intenta de nuevo.
        </Text>
      </View>
    );
  }

  const { beneficio, compraId } = data ?? { beneficio: null, compraId: null };

  // Sin ficha de cliente → empty state
  if (!beneficio && !compraId) {
    return <SinEmpresaTodavia que="nada que celebrar todavía" />;
  }

  // CTA logic: compraId → detalle, beneficio → lista, fallback → membresía
  const handleCta = () => {
    if (compraId) {
      router.push(`/mis-promociones/${compraId}`);
    } else if (beneficio) {
      router.push('/mis-promociones');
    } else {
      router.push('/mis-membresias');
    }
  };

  const ctaLabel = beneficio
    ? `Reclamar mi ${beneficio} ahora`
    : 'Ir a mi cuenta';

  return (
    <LinearGradient
      colors={['rgba(2,132,199,0.15)', '#ffffff', '#ffffff']}
      locations={[0, 0.4, 1]}
      className="flex-1"
    >
      <ScrollView
        contentContainerClassName="flex-grow items-center justify-center px-4 py-12"
        showsVerticalScrollIndicator={false}
      >
        {/* Confetti layer */}
        <ConfettiCelebration />

        {/* Content */}
        <View className="relative z-10 w-full max-w-md items-center">
          {/* Icon circle */}
          <View className="mb-5 h-20 w-20 items-center justify-center rounded-full bg-primary/15">
            <PartyPopper size={40} color="#0284c7" />
          </View>

          {/* Title */}
          <Text className="text-center text-h1 font-inter-bold text-foreground">
            🎉 ¡Felicidades!
          </Text>

          {/* Subtitle */}
          <Text className="mt-2 text-center text-lg text-muted-foreground">
            Ya formas parte de MembeGo.
          </Text>

          {/* Benefit card */}
          {beneficio && (
            <View className="mt-6 w-full rounded-2xl border border-success/25 bg-success/10 p-5">
              <Text className="text-center text-sm font-inter-semibold text-success">
                Has desbloqueado
              </Text>
              <View className="mt-2 flex-row items-center justify-center gap-2">
                <Gift size={24} color="#00864d" />
                <Text className="text-h2 font-inter-bold text-foreground">
                  {beneficio}
                </Text>
              </View>
            </View>
          )}

          {/* CTA button */}
          <Button
            onPress={handleCta}
            size="xl"
            className="mt-8 w-full rounded-2xl"
            icon={<ArrowRight size={20} color="#ffffff" />}
          >
            {ctaLabel}
          </Button>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}
