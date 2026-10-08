import React, { useState } from 'react'
import { Pressable } from 'react-native'
import { Heart, Loader2 } from 'lucide-react-native'
import { cn } from '../../lib/cn'
import { colors } from '../../theme/tokens'

/**
 * SAVE PROMO BUTTON — RN port de src/components/cliente/SavePromoButton.tsx.
 *
 * Corazón de guardar/quitar promoción; se superpone a la tarjeta de promoción
 * en la esquina superior derecha.
 *
 * ponytail: el BFF aún no expone un endpoint para toggle guardar promoción
 * (la web usa la server action `toggleGuardarPromocion`). Por ahora el botón
 * es un toggle de estado local. Agregar el endpoint BFF y wire it here.
 */

interface SavePromoButtonProps {
  promocionId: string
  guardada?: boolean
  onToggle?: (promocionId: string, nueva: boolean) => void
  className?: string
}

export function SavePromoButton({
  promocionId,
  guardada = false,
  onToggle,
  className,
}: SavePromoButtonProps) {
  const [saved, setSaved] = useState(guardada)
  const [pending, setPending] = useState(false)

  function handleToggle() {
    if (pending) return
    setPending(true)

    // ponytail: toggle local hasta que el BFF exponga el endpoint.
    const nueva = !saved
    setSaved(nueva)
    onToggle?.(promocionId, nueva)

    // Simular latencia mínima para feedback visual
    setTimeout(() => setPending(false), 300)
  }

  return (
    <Pressable
      onPress={handleToggle}
      disabled={pending}
      className={cn(
        'absolute right-2 top-2 z-10 h-11 w-11 items-center justify-center rounded-full border',
        'active:opacity-80',
        saved
          ? 'border-destructive/25 bg-card/95'
          : 'border-border bg-card/95',
        className,
      )}
      accessibilityRole="button"
      accessibilityLabel={saved ? 'Quitar de guardadas' : 'Guardar promoción'}
      accessibilityState={{ selected: saved, disabled: pending }}
    >
      {pending ? (
        <Loader2 size={18} color={colors.surface.mutedForeground} />
      ) : (
        <Heart
          size={18}
          color={saved ? colors.state.danger : colors.surface.mutedForeground}
          fill={saved ? colors.state.danger : 'transparent'}
        />
      )}
    </Pressable>
  )
}
