'use client'

import { useActionState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { afiliarmeAEmpresa, type AfiliacionState } from '@/modules/cliente/actions'

const initial: AfiliacionState = {}

/**
 * EL BOTÓN PRINCIPAL DEL PERFIL DE UN NEGOCIO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE HACÍA ANTES
 *
 * Se decidía con `company.id === user.metadata.companyId`: si el negocio no
 * era la EMPRESA ACTIVA de la sesión, no había botón. La página quedaba
 * «informativa» — una vitrina bonita sin manera de entrar.
 *
 * Con eso, alguien que ya era cliente de ese negocio veía su perfil sin acción
 * alguna solo porque su sesión apuntaba a otro; y quien lo descubría por el
 * mapa o el buscador no tenía por dónde empezar. En una plataforma donde se
 * descubren negocios, el perfil es EL sitio donde se decide entrar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES ESTADOS, Y CADA UNO DICE LA VERDAD
 *
 *   · No es cliente        → «Unirme a X». Crea su ficha allí y le lleva a los
 *                            planes. Es el mismo alta de siempre.
 *   · Cliente, negocio ya
 *     activo               → un enlace normal a los planes. Sin rodeos.
 *   · Cliente, otro negocio
 *     activo               → «Ver planes de X», que cambia el negocio activo
 *                            antes de enseñarlos — y lo DICE, porque cambiarle
 *                            el contexto a alguien sin avisar le cambia el
 *                            menú y el QR debajo de los pies.
 *
 * Los dos formularios usan `afiliarmeAEmpresa`, que ya distinguía ambos casos:
 * si la ficha existe no crea nada, solo cambia el contexto.
 */
export function CtaEmpresa({
  companySlug,
  companyName,
  esCliente,
  esActiva,
  hrefDirecto,
  etiquetaDirecta,
}: {
  companySlug: string
  companyName: string
  /** ¿Tiene ficha en ESTE negocio? (no en el activo). */
  esCliente: boolean
  /** ¿Este negocio es además el activo de su sesión? */
  esActiva: boolean
  /** Ruta directa cuando el negocio ya es el activo (incluye el paso de vehículo). */
  hrefDirecto?: string | null
  etiquetaDirecta?: string
}) {
  const [state, formAction, pending] = useActionState(afiliarmeAEmpresa, initial)

  useEffect(() => {
    if (state.error) toast.error(state.error)
  }, [state.error])

  const clase =
    'inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground shadow-sm transition hover:bg-primary disabled:opacity-60 sm:w-auto'

  if (esCliente && esActiva && hrefDirecto) {
    return (
      <Link href={hrefDirecto} className={clase}>
        {etiquetaDirecta ?? 'Ver planes'} <ArrowRight className="h-4 w-4" />
      </Link>
    )
  }

  return (
    <form action={formAction} className="w-full sm:w-auto">
      <input type="hidden" name="companySlug" value={companySlug} />
      <button type="submit" disabled={pending} className={clase}>
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : null}
        {esCliente ? `Ver planes de ${companyName}` : `Unirme a ${companyName}`}
        {!pending && <ArrowRight className="h-4 w-4" />}
      </button>
      <p className="mt-1.5 text-caption text-muted-foreground">
        {esCliente
          ? 'Cambiaremos a este negocio para mostrarte sus planes.'
          : 'Sin registrarte de nuevo: ya tienes cuenta en Membego.'}
      </p>
    </form>
  )
}
