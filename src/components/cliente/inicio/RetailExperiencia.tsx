'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowRight, Clock } from 'lucide-react'
import type { ExperienciaHero } from '@/modules/experience/engine'

/**
 * La acción protagonista que elige el motor de experiencias (MEE), dicha en
 * el lenguaje retail.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ CAMBIA RESPECTO AL RENDERIZADOR ANTERIOR
 *
 * `ExperienciaHero` traducía la misma decisión a banners con degradado, brillo
 * en bucle y botones de cristal. Esa era la pieza que más hacía que el Inicio
 * no se pareciera al resto de la app, y el rediseño retira justamente los
 * degradados decorativos y el movimiento que no dice nada.
 *
 * Lo que SÍ dice algo se queda, porque cambia lo que la persona decide:
 *
 *  · la cuenta atrás de una experiencia con fecha límite;
 *  · el color y el arte de una campaña, que NO son decoración —los configuró
 *    el administrador y son la marca del negocio, no del sistema—;
 *  · los cupos que quedan y cuánta gente ya la reclamó.
 *
 * El motor no cambia: sigue eligiendo qué mostrar y en qué orden.
 */

function restante(ms: number): string {
  const total = Math.floor(ms / 1000)
  const dias = Math.floor(total / 86_400)
  const reloj = [Math.floor((total % 86_400) / 3_600), Math.floor((total % 3_600) / 60), total % 60]
    .map((v) => String(v).padStart(2, '0'))
    .join(':')
  return dias > 0 ? `${dias}d ${reloj}` : reloj
}

function Cuenta({ hasta, color }: { hasta: string; color?: string }) {
  const fin = Date.parse(hasta)
  const [ms, setMs] = useState<number | null>(null)

  useEffect(() => {
    if (!Number.isFinite(fin)) return
    const tic = () => setMs(Math.max(0, fin - Date.now()))
    tic()
    const id = window.setInterval(tic, 1_000)
    return () => window.clearInterval(id)
  }, [fin])

  if (!Number.isFinite(fin) || ms === 0) return null

  return (
    <span
      className="inline-flex items-center gap-1.5 text-caption font-semibold text-primary"
      style={color ? { color } : undefined}
    >
      <Clock className="size-4" aria-hidden />
      {/* Sin `aria-live`: un contador que se anuncia cada segundo secuestra al
          lector de pantalla y no deja leer el resto de la tarjeta. */}
      <span className="font-mono tabular-nums" aria-live="off">
        {ms === null ? 'Por tiempo limitado' : `Termina en ${restante(ms)}`}
      </span>
    </span>
  )
}

function plural(n: number, uno: string, varios: string) {
  return n === 1 ? uno : varios
}

export function RetailExperiencia({ exp }: { exp: ExperienciaHero }) {
  const campana = exp.campana
  const marca = campana?.colorPrimario ?? null
  const arte = campana?.bannerUrl ?? campana?.imagenUrl ?? null
  const destacada = exp.urgencia === 'alta' || marca !== null

  return (
    <section className="bg-background px-4 py-4 md:px-6 md:py-5" aria-labelledby="retail-experiencia">
      <div
        data-experiencia={exp.tipo}
        className={`mx-auto flex max-w-6xl flex-col overflow-hidden rounded-xl border bg-card elevation-1 ${
          destacada && !marca ? 'border-primary' : 'border-border'
        }`}
        style={marca ? { borderColor: marca } : undefined}
      >
        {arte ? (
          <div className="relative aspect-[16/6] w-full bg-muted">
            <Image
              src={arte}
              alt=""
              fill
              sizes="(min-width: 768px) 64rem, 100vw"
              className="object-cover"
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-3 p-4">
          <div className="min-w-0">
            <p className="text-overline text-primary" style={marca ? { color: marca } : undefined}>
              {exp.eyebrow}
            </p>
            <h2 id="retail-experiencia" className="mt-1 text-h2 text-balance text-foreground">
              {exp.titulo}
            </h2>
            {exp.descripcion ? (
              <p className="mt-1 text-small text-muted-foreground">{exp.descripcion}</p>
            ) : null}

            {campana ? (
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-caption text-muted-foreground">
                {campana.cuposRestantes != null && campana.cuposRestantes <= 50 ? (
                  <span className="font-semibold text-foreground">
                    Quedan {campana.cuposRestantes}{' '}
                    {plural(campana.cuposRestantes, 'cupo', 'cupos')}
                  </span>
                ) : null}
                {campana.reclamados > 0 ? (
                  <span>
                    {campana.reclamados} {plural(campana.reclamados, 'persona', 'personas')}{' '}
                    {plural(campana.reclamados, 'ya la reclamó', 'ya la reclamaron')}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {exp.hasta ? <Cuenta hasta={exp.hasta} color={marca ?? undefined} /> : <span />}
            <Link
              href={exp.ctaHref}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-primary px-5 text-small font-semibold text-primary-foreground outline-none transition-colors duration-fast hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary active:scale-[0.98]"
              style={marca ? { backgroundColor: marca } : undefined}
            >
              {exp.ctaTexto}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
