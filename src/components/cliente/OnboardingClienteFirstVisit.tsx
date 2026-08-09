'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { OnboardingClienteCard } from './OnboardingClienteCard'
import type { OnboardingCliente } from '@/modules/social/queries'

const COOKIE_NAME = 'membego_onboarding_seen'
const SNOOZE_DIAS = 7

/**
 * Sugerencia (NO obligatoria) para terminar de configurar la cuenta.
 *
 * Mientras el checklist esté incompleto, la tarjeta se sigue mostrando en
 * cada visita — es una invitación, nunca un bloqueo. Si el cliente la cierra,
 * se pospone unos días (cookie) en vez de desaparecer para siempre; al
 * completar todos los pasos deja de mostrarse sola.
 */
export function OnboardingClienteFirstVisit({ onboarding }: { onboarding: OnboardingCliente }) {
  const [visible, setVisible] = useState(true)

  function snooze() {
    document.cookie = `${COOKIE_NAME}=1; path=/; max-age=${SNOOZE_DIAS * 24 * 60 * 60}; samesite=lax`
    setVisible(false)
  }

  if (!visible || onboarding.completados === onboarding.total) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={snooze}
        className="absolute right-3 top-3 z-10 rounded-full p-1 text-primary transition hover:bg-primary/15 hover:text-primary"
        aria-label="Recordármelo en otro momento"
        title="Recordármelo en otro momento"
      >
        <X className="h-4 w-4" />
      </button>
      <OnboardingClienteCard onboarding={onboarding} />
    </div>
  )
}
