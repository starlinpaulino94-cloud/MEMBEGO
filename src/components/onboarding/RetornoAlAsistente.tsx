'use client'

import { useEffect, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft, X } from 'lucide-react'
import { PARAM_DESDE_ONBOARDING, VALOR_DESDE_ONBOARDING } from '@/modules/empresas/onboarding-retorno'

/**
 * EL CAMINO DE VUELTA AL ASISTENTE (auditoría admin · fase 7, 7.5; 01 · §5: «sin enlace de retorno»).
 *
 * Cada paso del asistente de configuración manda a una pantalla del panel (perfil, sucursales, métodos de pago…) y esa pantalla no sabe
 * de dónde vienes: terminabas de guardar el logo y no había forma de volver a la lista salvo adivinar la dirección. Los enlaces del
 * asistente ahora llevan `?desde=onboarding`; esta franja lo recoge y, mientras sigas dentro del panel, ofrece «Volver a configurar tu
 * empresa».
 *
 * Se recuerda en la pestaña (`sessionStorage`) y no solo en la dirección porque casi todas esas pantallas, al guardar, te llevan a otra
 * (de «Nueva sucursal» a la lista) y la marca de la dirección se perdería justo cuando haría falta. Se va al volver al asistente o al
 * pulsar la X, y no sobrevive a cerrar la pestaña: no es una preferencia, es «vengo de ahí ahora». Si el almacenamiento está bloqueado,
 * la franja funciona mientras la dirección conserve la marca.
 */

const CLAVE = 'membego.desdeOnboarding'
const oyentes = new Set<() => void>()

function leer(): boolean {
  try {
    return window.sessionStorage.getItem(CLAVE) === '1'
  } catch {
    return false
  }
}

function escribir(v: boolean): void {
  try {
    if (v) window.sessionStorage.setItem(CLAVE, '1')
    else window.sessionStorage.removeItem(CLAVE)
  } catch {
    // Almacenamiento bloqueado: la franja sigue por la dirección mientras la lleve.
  }
  for (const avisar of oyentes) avisar()
}

function suscribir(avisar: () => void): () => void {
  oyentes.add(avisar)
  return () => {
    oyentes.delete(avisar)
  }
}

export function RetornoAlAsistente() {
  const pathname = usePathname()
  const recordado = useSyncExternalStore(suscribir, leer, () => false)

  // La marca llega por la dirección: se recuerda para que sobreviva a la siguiente pantalla.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get(PARAM_DESDE_ONBOARDING) === VALOR_DESDE_ONBOARDING) escribir(true)
  }, [pathname])

  if (!recordado || pathname === '/onboarding') return null

  return (
    <div role="region" aria-label="Configuración de tu empresa" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/10 px-4 py-2.5 text-small">
      <Link href="/onboarding" onClick={() => escribir(false)} className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Volver a configurar tu empresa
      </Link>
      <button type="button" onClick={() => escribir(false)} aria-label="Ocultar este aviso" className="rounded-lg p-1 text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}
