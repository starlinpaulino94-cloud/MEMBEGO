import Link from 'next/link'
import Form from 'next/form'
import { BarChart3, CalendarDays, GitCompareArrows, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  COMPARACIONES,
  GRANULARIDADES,
  MAX_DIAS_SERIE,
  COMPARACION_POR_DEFECTO,
  PRESET_POR_DEFECTO,
  PRESETS,
  type Rango,
} from '@/modules/reportes/rango'

/**
 * BARRA DE PERIODO DE UN REPORTE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE PLEGÓ
 *
 * Antes enseñaba los CATORCE presets a la vez, siempre, en todos los reportes:
 * una pared de botones que ocupaba media pantalla por encima de las cifras y
 * que había que saltar con la vista cada vez. El periodo es un ajuste que se
 * cambia de vez en cuando, no el contenido de la pantalla — y lo que de verdad
 * hay que ver sin pulsar nada es **cuál está puesto ahora**.
 *
 * Ahora la barra dice el periodo activo y guarda las opciones detrás de un
 * desplegable, agrupadas como se piensan: los RÁPIDOS (los últimos N días), el
 * CALENDARIO (esta semana, este mes, este trimestre) y el personalizado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SIGUE FUNCIONANDO SIN JAVASCRIPT
 *
 * Es un `<details>`, no un menú de React, y los presets son ENLACES. Eso
 * conserva el principio de la casa —cada combinación de filtros es una URL, se
 * comparte y se guarda en marcadores— y mantiene el teclado gratis: se abre con
 * Enter y se recorre con Tab.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA COMPARACIÓN TENÍA MOTOR Y NO TENÍA MANDO
 *
 * `rango.ts` sabe comparar contra el periodo anterior o contra el mismo tramo
 * del año pasado, y la exportación ya arrastraba ese parámetro. Pero no había
 * ningún sitio donde elegirlo: se podía escribir a mano en la URL y nada más.
 * Ahora es un control.
 *
 * `extra` son los parámetros que NO son el periodo (búsqueda, sucursal,
 * servicio). Viajan escondidos en los formularios y pegados a los enlaces para
 * que cambiar de periodo no borre lo demás.
 */
export function RangoFechas({
  rango,
  accion,
  extra,
}: {
  rango: Rango
  /** Ruta a la que apuntan los presets y el formulario. */
  accion: string
  extra?: URLSearchParams
}) {
  /** Una URL de este reporte con el periodo pedido y el resto de filtros intactos. */
  const con = (cambios: Record<string, string>) => {
    const sp = new URLSearchParams()
    for (const [k, v] of extra ?? []) sp.set(k, v)
    // La comparación sobrevive al cambio de preset: quien estaba mirando
    // «contra el año pasado» no vuelve solo al periodo anterior.
    if (rango.comparacion !== COMPARACION_POR_DEFECTO) sp.set('comparar', rango.comparacion)
    // Y la granularidad elegida a mano: cambiar de periodo no debe devolver la
    // serie a la automática sin que nadie lo haya pedido.
    if (rango.granularidadPedida) sp.set('g', rango.granularidad)
    for (const [k, v] of Object.entries(cambios)) sp.set(k, v)
    return `${accion}?${sp.toString()}`
  }

  const comparacionActual =
    COMPARACIONES.find((c) => c.clave === rango.comparacion) ?? COMPARACIONES[0]
  const granularidadActual =
    GRANULARIDADES.find((g) => g.clave === rango.granularidad) ?? GRANULARIDADES[0]

  // Los presets, agrupados como se piensan. «Rápidos» son ventanas móviles que
  // terminan hoy; «calendario» son periodos cerrados con nombre propio.
  const RAPIDOS = ['hoy', 'ayer', '7d', '30d', '90d', '365d']
  const rapidos = PRESETS.filter((p) => RAPIDOS.includes(p.clave))
  const calendario = PRESETS.filter((p) => !RAPIDOS.includes(p.clave))

  const hayFiltros =
    rango.preset !== PRESET_POR_DEFECTO ||
    rango.comparacion !== COMPARACION_POR_DEFECTO ||
    rango.granularidadPedida

  return (
    <>
      {/* El recorte de la serie se DICE. Antes se hacía en silencio: la gráfica
          enseñaba los primeros 370 días de un rango más largo y nada avisaba de
          que el final faltaba. Este aviso sí se imprime: en papel, una serie
          corta sin nota es indistinguible de un periodo sin datos. */}
      {rango.serieRecortada && (
        <p className="mb-2 rounded-lg border border-dashed border-border px-3 py-2 text-caption">
          El periodo es más largo de lo que cabe en una serie: la gráfica y la tabla del día a día
          enseñan los primeros {MAX_DIAS_SERIE} días. Las cifras del resumen sí cubren el periodo
          entero.
        </p>
      )}
      <div className="print:hidden flex flex-wrap items-center gap-2">
      {/* ── Periodo ─────────────────────────────────────────────────────── */}
      <details className="group relative">
        <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-card px-3 text-small font-semibold text-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span>{rango.etiqueta}</span>
          <span className="text-caption font-normal tabular-nums">
            {rango.desdeDia} → {rango.hastaDia}
          </span>
        </summary>

        <div className="absolute left-0 z-dropdown mt-2 w-[min(92vw,30rem)] rounded-xl border border-border bg-popover p-4 elevation-2">
          <Grupo titulo="Rápidos">
            {rapidos.map((p) => (
              <Chip key={p.clave} href={con({ rango: p.clave })} activo={rango.preset === p.clave}>
                {p.label}
              </Chip>
            ))}
          </Grupo>

          <Grupo titulo="Calendario">
            {calendario.map((p) => (
              <Chip key={p.clave} href={con({ rango: p.clave })} activo={rango.preset === p.clave}>
                {p.label}
              </Chip>
            ))}
          </Grupo>

          <div className="mt-4 border-t border-border/60 pt-3">
            <p className="text-overline">Personalizado</p>
            <Form action={accion} className="mt-2 flex flex-wrap items-end gap-2">
              {[...(extra ?? [])].map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              {rango.comparacion !== COMPARACION_POR_DEFECTO && (
                <input type="hidden" name="comparar" value={rango.comparacion} />
              )}
              <label className="text-caption">
                Desde
                <Input type="date" name="desde" defaultValue={rango.desdeDia} className="mt-1" />
              </label>
              <label className="text-caption">
                Hasta
                <Input type="date" name="hasta" defaultValue={rango.hastaDia} className="mt-1" />
              </label>
              <Button type="submit" variant="secondary">
                Aplicar
              </Button>
            </Form>
          </div>
        </div>
      </details>

      {/* ── Comparar contra ─────────────────────────────────────────────── */}
      <details className="group relative">
        <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-card px-3 text-small text-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <GitCompareArrows className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span>
            vs. <span className="font-semibold">{comparacionActual.label.toLowerCase()}</span>
          </span>
        </summary>
        <div className="absolute left-0 z-dropdown mt-2 w-[min(92vw,22rem)] rounded-xl border border-border bg-popover p-3 elevation-2">
          <p className="text-overline">Comparar contra</p>
          <div className="mt-2 flex flex-col gap-1">
            {COMPARACIONES.map((c) => (
              <Chip
                key={c.clave}
                href={con(
                  rango.preset === 'personalizado'
                    ? { desde: rango.desdeDia, hasta: rango.hastaDia, comparar: c.clave }
                    : { rango: rango.preset, comparar: c.clave }
                )}
                activo={rango.comparacion === c.clave}
                bloque
              >
                {c.label}
              </Chip>
            ))}
          </div>
          <p className="mt-2 text-caption">
            El periodo anterior tiene siempre los mismos días, para que comparar 30 días contra un
            mes de 31 no invente una caída.
          </p>
        </div>
      </details>

      {/* ── Cada cuánto ─────────────────────────────────────────────────── */}
      <details className="group relative">
        <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-card px-3 text-small text-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <BarChart3 className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="font-semibold">{granularidadActual.label.toLowerCase()}</span>
          {!rango.granularidadPedida && <span className="text-caption font-normal">(auto)</span>}
        </summary>
        <div className="absolute left-0 z-dropdown mt-2 w-[min(92vw,22rem)] rounded-xl border border-border bg-popover p-3 elevation-2">
          <p className="text-overline">Agrupar la serie</p>
          <div className="mt-2 flex flex-col gap-1">
            {GRANULARIDADES.map((g) => (
              <Chip
                key={g.clave}
                href={con(
                  rango.preset === 'personalizado'
                    ? { desde: rango.desdeDia, hasta: rango.hastaDia, g: g.clave }
                    : { rango: rango.preset, g: g.clave }
                )}
                activo={rango.granularidad === g.clave}
                bloque
              >
                {g.label}
              </Chip>
            ))}
          </div>
          <p className="mt-2 text-caption">
            Sin elegir nada se ajusta sola al periodo: un año en días son 365 barras y no se lee
            ninguna. Solo cambia cómo se AGRUPA la gráfica, nunca las cifras del resumen.
          </p>
        </div>
      </details>

      {hayFiltros && (
        <Button asChild variant="ghost" size="sm">
          <Link href={accion}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restablecer
          </Link>
        </Button>
      )}
      </div>
    </>
  )
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="text-overline">{titulo}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Chip({
  href,
  activo,
  bloque = false,
  children,
}: {
  href: string
  activo: boolean
  bloque?: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={activo ? 'page' : undefined}
      className={`inline-flex min-h-9 items-center rounded-lg px-3 text-small font-medium transition-colors ${
        bloque ? 'w-full' : ''
      } ${
        activo
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {children}
    </Link>
  )
}
