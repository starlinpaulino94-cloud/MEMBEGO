'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import {
  Check,
  Gift,
  Sparkles,
  ArrowUpCircle,
  ArrowDownCircle,
  Loader2,
  Zap,
  Calendar,
} from 'lucide-react'
import { seleccionarPlan, type SeleccionState } from '@/modules/membresia/actions'
import { cn } from '@/lib/utils'
import { formatMoney, type RegionalPrefs } from '@/lib/format'
import { calcularDescuentoBienvenida } from '@/lib/bienvenida'
import {
  planRecomendadoPara,
  beneficiosSinRedundancia,
  type VehiculoLite,
} from '@/lib/vehiculoPlan'
import { VehicleSelector } from '@/components/cliente/VehicleSelector'
import { MobilePlanTabs } from '@/components/cliente/MobilePlanTabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export interface PlanItem {
  id: string
  nombre: string
  precio: number
  esIlimitado: boolean
  descripcion: string | null
  lavadosIncluidos: number
  beneficios: string[]
  vigenciaDias: number
  condiciones: string | null
  /** Imagen que sube el negocio. `null` = la tarjeta va como hasta ahora. */
  imagenUrl?: string | null
  /** Onboarding v2 · decisión del motor de elegibilidad (default: comprable). */
  comprable?: boolean
  /** El vehículo elegido excede el nivel del plan (§12: se explica, no se esconde). */
  nivelSuperior?: boolean
  /** El precio mostrado es el de la categoría del vehículo (no el base). */
  precioDeCategoria?: boolean
}

interface Props {
  planes: PlanItem[]
  currentPlanId: string | null
  requestedPlanId: string | null
  hasActive: boolean
  activeMembershipId: string | null
  currentPlanPrecio: number | null
  prefs?: RegionalPrefs | null
  bienvenida?: { tipo: string; valor: number } | null
  /** Vehículos registrados del cliente: activan la recomendación automática. */
  vehiculos?: VehiculoLite[]
  /** Vehículo con el que el SERVIDOR calculó los precios (onboarding v2). */
  vehiculoSeleccionadoId?: string | null
  /** Modo vitrina: precios base visibles, compra en línea deshabilitada. */
  vitrina?: boolean
  /** Fase 4 · contexto de ubicación: se encadena al detalle de membresía. */
  retorno?: string
}

/**
 * "PLAN SILVER (SUV PEQ)" → título "Plan Silver" + variante "SUV PEQ".
 * Los nombres con paréntesis se truncaban feo; la variante ahora es un chip.
 */
function parseNombre(nombre: string): { base: string; variante: string | null } {
  const m = nombre.match(/^(.*?)\s*[([](.+?)[)\]]\s*$/)
  if (!m) return { base: titleCase(nombre), variante: null }
  return { base: titleCase(m[1].trim()), variante: m[2].trim() }
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())
}

/** Escalonado de entrada por posición de la tarjeta. */
const DELAYS = ['', 'delay-100', 'delay-200', 'delay-300'] as const

function SubmitButton({
  children,
  variant,
  className,
}: {
  children: React.ReactNode
  variant?: 'default' | 'outline'
  className?: string
}) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} variant={variant} className={className}>
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </Button>
  )
}

/** Micro-etiqueta de sección: estructura editorial, sin color. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    // 10px y encima `/70`: medido daba 3,11:1, por debajo del 4,5:1 de AA.
    // `.text-overline` es el token del sistema para justo esto —12px,
    // mayúsculas, tracking y `muted-foreground` a plena opacidad— y arregla el
    // tamaño y el contraste de una vez.
    <p className="mb-2.5 text-overline">
      {children}
    </p>
  )
}

/**
 * Grid de planes — rediseño premium sobrio (Apple/Stripe):
 * - UNA sola paleta: neutros de la tarjeta + el foreground como único acento.
 *   Nada de degradados, verdes ni amarillos compitiendo por atención.
 * - Ficha COMPLETA del plan: precio, usos y vigencia, beneficios íntegros,
 *   descripción sin recortar y condiciones/restricciones. Las tarjetas crecen
 *   lo que haga falta (items-stretch iguala alturas por fila en desktop).
 * - Recomendación por vehículo: se señala con un anillo y una pastilla
 *   monocroma; el resto baja sutilmente de opacidad (siguen comprables).
 * - Tabs móviles: en teléfono se ve una tarjeta a la vez.
 */
export function PlanesGrid({
  planes,
  currentPlanId,
  requestedPlanId,
  hasActive,
  activeMembershipId,
  currentPlanPrecio,
  prefs,
  bienvenida = null,
  vehiculos = [],
  vehiculoSeleccionadoId = null,
  vitrina = false,
  retorno,
}: Props) {
  const router = useRouter()
  const init: SeleccionState = {}
  const [selectState, selectAction] = useActionState(seleccionarPlan, init)

  // Fase 4 · contexto de ubicación: el detalle de la membresía devuelve al
  // detalle de la empresa del mapa. `?retorno=` viaja sanitizado desde la URL.
  const retornoQs = retorno ? `?retorno=${encodeURIComponent(retorno)}` : ''
  const vehiculoNext = retorno
    ? `/cliente/vehiculos/nuevo?next=${encodeURIComponent(`/cliente/planes${retornoQs}`)}`
    : '/cliente/vehiculos/nuevo?next=/cliente/planes'

  // Vehículo activo → plan recomendado (null si ningún plan lo menciona).
  // Arranca en el que usó el SERVIDOR para calcular precios; al cambiarlo se
  // navega con ?vehiculo= para que el backend recalcule planes y precios (§10:
  // el recálculo no es cosa del cliente).
  const [vehiculoId, setVehiculoId] = useState(
    vehiculoSeleccionadoId ?? vehiculos[0]?.id ?? ''
  )
  const vehiculo = vehiculos.find((v) => v.id === vehiculoId) ?? null

  function elegirVehiculo(id: string) {
    setVehiculoId(id)
    const q = new URLSearchParams({ vehiculo: id })
    if (retorno) q.set('retorno', retorno)
    router.replace(`/cliente/planes?${q.toString()}`, { scroll: false })
  }
  const recomendadoId = useMemo(
    () => (vehiculo ? planRecomendadoPara(vehiculo, planes) : null),
    [vehiculo, planes]
  )

  // Tab móvil activa: el recomendado > el plan actual > el primero.
  const [tabId, setTabId] = useState(
    () => recomendadoId ?? currentPlanId ?? planes[0]?.id ?? ''
  )
  // Al cambiar de vehículo, la tab salta al nuevo recomendado (ajuste de
  // estado durante el render, patrón recomendado por React para derivar de props).
  const [prevRecomendado, setPrevRecomendado] = useState(recomendadoId)
  if (recomendadoId !== prevRecomendado) {
    setPrevRecomendado(recomendadoId)
    if (recomendadoId) setTabId(recomendadoId)
  }

  useEffect(() => {
    if (selectState.success && selectState.membershipId) {
      toast.success('Plan seleccionado. Sube tu comprobante.')
      router.push(`/membresia/${selectState.membershipId}${retornoQs}`)
    }
    if (selectState.error) toast.error(selectState.error)
  }, [selectState, router, retornoQs])

  const tabs = planes.map((p) => {
    const { base, variante } = parseNombre(p.nombre)
    return { id: p.id, label: variante ?? base }
  })

  return (
    <div>
      {/* Contexto inteligente: para qué vehículo estamos recomendando */}
      {vehiculo && (
        <div className="animate-fade-up mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted-foreground">
          <span>Planes para tu</span>
          <VehicleSelector
            vehiculos={vehiculos}
            selectedId={vehiculoId}
            onSelect={elegirVehiculo}
            className="text-small"
          />
          {recomendadoId ? (
            <span>· te sugerimos el plan compatible</span>
          ) : (
            <span>· elige el plan según el tamaño de tu vehículo</span>
          )}
        </div>
      )}

      {/* Tabs solo en móvil: una tarjeta a la vez, menos scroll */}
      <MobilePlanTabs tabs={tabs} activeId={tabId} onChange={setTabId} />

      <div className="grid items-stretch gap-5 md:grid-cols-2 lg:grid-cols-3">
        {planes.map((plan, idx) => {
          const isCurrent = plan.id === currentPlanId
          const isRequested = plan.id === requestedPlanId
          // Recomendación: por vehículo si hay match; sin vehículos, cae al
          // destacado de marketing clásico (tarjeta central).
          const isRecommended =
            recomendadoId != null
              ? plan.id === recomendadoId && !isCurrent
              : vehiculos.length === 0 && !isCurrent && idx === 1
          // Smart dimming: solo cuando HAY un recomendado real por vehículo.
          const isDimmed = recomendadoId != null && plan.id !== recomendadoId && !isCurrent
          const isUpgrade = currentPlanPrecio != null && plan.precio > currentPlanPrecio
          const isDowngrade = currentPlanPrecio != null && plan.precio < currentPlanPrecio
          const descuento =
            !hasActive && bienvenida
              ? calcularDescuentoBienvenida(
                  {
                    bienvenidaActiva: true,
                    bienvenidaTipo: bienvenida.tipo,
                    bienvenidaValor: bienvenida.valor,
                  },
                  plan.precio
                )
              : 0
          const precioFinal = Math.max(0, plan.precio - descuento)
          const { base, variante } = parseNombre(plan.nombre)
          // Ancla de valor: cuánto sale cada uso (fuerte motivador de compra).
          const precioPorUso =
            !plan.esIlimitado && plan.lavadosIncluidos > 0
              ? Math.round(precioFinal / plan.lavadosIncluidos)
              : null
          const beneficios = beneficiosSinRedundancia(plan.beneficios)

          return (
            <div
              key={plan.id}
              className={cn(
                'group relative flex-col overflow-hidden rounded-lg border bg-card elevation-1 transition-all duration-slow',
                'animate-fade-up',
                DELAYS[idx % DELAYS.length],
                // Tabs móviles: solo la tarjeta activa es visible en teléfono.
                tabId === plan.id ? 'flex' : 'hidden md:flex',
                isCurrent
                  ? 'border-primary ring-1 ring-primary/25'
                  : isRecommended
                    ? 'z-10 border-primary ring-1 ring-primary/25 lg:-translate-y-1.5'
                    : 'border-border hover:-translate-y-1 hover:border-primary/40',
                isDimmed && 'opacity-70 hover:opacity-100'
              )}
            >
              {/* Badges de estado — monocromos, sin gritar */}
              {isCurrent && (
                <div className="absolute right-4 top-4 z-20">
                  <Badge variant="outline" className="gap-1 rounded-full border-primary/40 bg-card text-primary">
                    <Check className="h-3 w-3" /> Tu plan
                  </Badge>
                </div>
              )}
              {isRecommended && (
                <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-b-lg bg-retail-deep px-4 py-1.5 text-label-sm font-bold uppercase tracking-wider text-white">
                    <Sparkles className="h-3 w-3" />
                    {vehiculo && recomendadoId
                      ? `Para tu ${titleCase(vehiculo.modelo)}`
                      : 'Recomendado'}
                  </span>
                </div>
              )}

              {/* Imagen del plan, si el negocio subió una. Va sobre la
                  cabecera y no detrás del texto: de fondo obligaría a teñirla
                  para que el contenido siguiera leyéndose, y entonces la foto
                  que eligió el negocio ya no es la que ve el cliente. */}
              {plan.imagenUrl && (
                <div className="relative aspect-[16/9] w-full max-w-full overflow-hidden bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={plan.imagenUrl}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
              )}

              <div className={cn('relative flex flex-1 flex-col p-6 sm:p-7', isRecommended && !plan.imagenUrl && 'pt-10')}>
                {/* 1 · Cabecera: nombre + variante + precio */}
                <div className="mb-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-h3 text-foreground">{base}</h3>
                    {variante && (
                      <span className="inline-flex rounded-full border border-border bg-card px-2 py-0.5 text-label-sm font-semibold text-muted-foreground">
                        {variante}
                      </span>
                    )}
                    {plan.esIlimitado && (
                      <span className="inline-flex rounded-full border border-border bg-card px-2 py-0.5 text-label-sm font-semibold text-muted-foreground">
                        Ilimitado
                      </span>
                    )}
                  </div>

                  <div className="mt-3">
                    {descuento > 0 && (
                      <p className="text-small text-muted-foreground line-through">
                        {formatMoney(plan.precio, prefs)}
                      </p>
                    )}
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-h1 leading-none tabular-nums text-foreground">
                        {formatMoney(precioFinal, prefs)}
                      </span>
                      <span className="text-small font-medium text-muted-foreground">/mes</span>
                    </div>
                    {precioPorUso != null && (
                      <p className="mt-1.5 text-caption">
                        Equivale a {formatMoney(precioPorUso, prefs)} por uso
                      </p>
                    )}
                    {plan.precioDeCategoria && vehiculo && (
                      <p className="mt-1 text-caption text-primary">
                        Precio para tu {titleCase(vehiculo.modelo)}
                      </p>
                    )}
                    {descuento > 0 && (
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-primary-soft px-2.5 py-1 text-label-sm font-semibold text-primary">
                        <Gift className="h-3.5 w-3.5" aria-hidden />
                        −{formatMoney(descuento, prefs)} de bienvenida
                      </div>
                    )}
                  </div>
                </div>

                {/* 2 · Incluye: usos y vigencia, en limpio */}
                <div className="mb-6 grid grid-cols-2 gap-2 rounded-lg bg-retail-mist p-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-card">
                      <Zap className="h-4 w-4 text-primary" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="text-small font-bold leading-tight text-foreground">
                        {plan.esIlimitado ? 'Ilimitados' : plan.lavadosIncluidos}
                      </p>
                      <p className="text-caption">usos incluidos</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-card">
                      <Calendar className="h-4 w-4 text-primary" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="text-small font-bold leading-tight text-foreground">
                        {plan.vigenciaDias} días
                      </p>
                      <p className="text-caption">de vigencia</p>
                    </div>
                  </div>
                </div>

                {/* 3 · Descripción COMPLETA (antes se cortaba a 2 líneas) */}
                {plan.descripcion && (
                  <div className="mb-6">
                    <SectionLabel>Descripción</SectionLabel>
                    <p className="whitespace-pre-line text-small leading-relaxed text-foreground/75">
                      {plan.descripcion}
                    </p>
                  </div>
                )}

                {/* 4 · Beneficios íntegros */}
                {beneficios.length > 0 && (
                  <div className="mb-6">
                    <SectionLabel>Beneficios</SectionLabel>
                    <ul className="space-y-2.5">
                      {beneficios.map((b) => (
                        <li key={b} className="flex items-start gap-2.5 text-small leading-relaxed text-foreground/80">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                          {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 5 · Condiciones y restricciones del plan, sin esconder nada */}
                {plan.condiciones && (
                  <div className="mb-6">
                    <SectionLabel>Condiciones</SectionLabel>
                    <p className="whitespace-pre-line text-caption leading-relaxed">
                      {plan.condiciones}
                    </p>
                  </div>
                )}

                {/* Aviso explícito de compatibilidad (a11y: visible y legible,
                    la tarjeta sigue siendo comprable) */}
                {isDimmed && (
                  <p className="mb-3 text-label-sm font-medium text-muted-foreground">
                    Pensado para otro tamaño de vehículo — también puedes elegirlo.
                  </p>
                )}

                {/* CTA — anclado abajo, targets ≥48px */}
                <div className="mt-auto pt-1">
                  {isCurrent ? (
                    <Button disabled variant="outline" className="min-h-12 w-full rounded-full">
                      <Check className="mr-2 h-4 w-4" />
                      Este es tu plan
                    </Button>
                  ) : isRequested ? (
                    <Button
                      variant="outline"
                      className="min-h-12 w-full rounded-full border-warning/30 text-warning"
                      onClick={() =>
                        activeMembershipId && router.push(`/membresia/${activeMembershipId}`)
                      }
                    >
                      Cambio solicitado
                    </Button>
                  ) : hasActive ? (
                    /* Política: con una membresía activa, el cambio de plan lo
                       realiza ÚNICAMENTE el negocio desde su panel. Aquí el
                       plan se muestra informativo, sin acción de cambio. */
                    <div className="space-y-1.5">
                      <Button disabled variant="outline" className="min-h-12 w-full rounded-full">
                        {isUpgrade && <ArrowUpCircle className="mr-2 h-4 w-4" />}
                        {isDowngrade && <ArrowDownCircle className="mr-2 h-4 w-4" />}
                        Disponible en el negocio
                      </Button>
                      <p className="text-center text-label-sm text-muted-foreground">
                        Para cambiar a este plan, solicítalo en el local: el equipo lo aplica por ti.
                      </p>
                    </div>
                  ) : vitrina ? (
                    /* Vitrina (miembro sin vehículo): la compra en línea pide
                       registrar el vehículo — el precio exacto depende de él. */
                    <div className="space-y-1.5">
                      <Button asChild variant="outline" className="min-h-12 w-full rounded-full">
                        <a href={vehiculoNext}>
                          Registra tu vehículo para comprar
                        </a>
                      </Button>
                      <p className="text-center text-label-sm text-muted-foreground">
                        Precio base referencial: con tu vehículo verás el de tu categoría.
                      </p>
                    </div>
                  ) : plan.comprable === false && plan.nivelSuperior ? (
                    /* §12: nivel superior — se explica y se ofrecen salidas,
                       nunca un botón muerto sin motivo. */
                    <div className="space-y-1.5">
                      <Button disabled variant="outline" className="min-h-12 w-full rounded-full">
                        Para vehículos de otra categoría
                      </Button>
                      <p className="text-center text-label-sm text-muted-foreground">
                        Tu vehículo excede este plan. Elige un plan de tu categoría o
                        consulta en el local para actualizarlo.
                      </p>
                    </div>
                  ) : (
                    <form action={selectAction}>
                      <input type="hidden" name="planId" value={plan.id} />
                      {vehiculoId && <input type="hidden" name="vehiculoId" value={vehiculoId} />}
                      <SubmitButton
                        variant={isRecommended ? 'default' : 'outline'}
                        className={cn(
                          'min-h-12 w-full rounded-full text-label-lg transition-colors duration-fast',
                          isRecommended
                            ? 'bg-primary text-primary-foreground hover:bg-brand-primary-hover'
                            : 'border-primary/40 text-primary hover:bg-brand-primary-soft'
                        )}
                      >
                        Seleccionar este plan
                      </SubmitButton>
                    </form>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
