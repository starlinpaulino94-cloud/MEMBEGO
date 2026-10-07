import Link from 'next/link'
import { StatusChip } from '@/components/ui/status-chip'
import type { EstadoComponente } from '@/modules/supply-v2/operations/salud-dominio'

/**
 * MEMBEGO SUPPLY · SLICE 9 · BLOQUE 4 · PIEZAS DEL CENTRO DE OPERACIONES.
 *
 * Denso y legible, no decorativo. El operador que abre esto está buscando una
 * respuesta a una pregunta concreta, probablemente con prisa: lo que manda es
 * ESTADO, SEVERIDAD, TIEMPO y ACCIÓN, en ese orden, y todo lo demás estorba.
 *
 * Nada de tarjetas gigantes con un número enorme: una fila por componente, con
 * su estado a la izquierda y su explicación al lado. Y sin desbordes
 * horizontales en móvil —un panel que hay que arrastrar de lado para leer una
 * cifra crítica no sirve de madrugada—.
 */

/**
 * El tono SEMÁNTICO de cada estado. No son colores: son significados, y por eso
 * cambian con el tema. `NOT_CONFIGURED` es neutro a propósito —algo apagado por
 * decisión no es una avería, y pintar todo en rojo es la forma más rápida de
 * que nadie mire ninguno—.
 */
const TONO_ESTADO: Record<EstadoComponente, 'success' | 'warning' | 'danger' | 'neutral'> = {
  HEALTHY: 'success',
  DEGRADED: 'warning',
  UNAVAILABLE: 'danger',
  NOT_CONFIGURED: 'neutral',
}

const TEXTO_ESTADO: Record<EstadoComponente, string> = {
  HEALTHY: 'SANO',
  DEGRADED: 'DEGRADADO',
  UNAVAILABLE: 'NO DISPONIBLE',
  NOT_CONFIGURED: 'APAGADO',
}

export function Estado({ valor, testid }: { valor: EstadoComponente; testid?: string }) {
  return (
    <StatusChip tone={TONO_ESTADO[valor]} data-testid={testid} data-estado={valor}>
      {TEXTO_ESTADO[valor]}
    </StatusChip>
  )
}

/** Severidades de alerta y de incidente, en el mismo vocabulario. */
const TONO_SEVERIDAD: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  CRITICAL: 'danger',
  HIGH: 'danger',
  WARNING: 'warning',
  MEDIUM: 'warning',
  INFO: 'info',
  LOW: 'neutral',
}

export function Severidad({ valor, testid }: { valor: string; testid?: string }) {
  return (
    <StatusChip tone={TONO_SEVERIDAD[valor] ?? 'neutral'} data-testid={testid} data-severidad={valor}>
      {valor}
    </StatusChip>
  )
}

/** El estado de una pieza de configuración: puesta, apagada, o falta. */
export function EstadoConfigChip({ valor, testid }: { valor: string; testid?: string }) {
  const tono = valor === 'CONFIGURED' ? 'success' : valor === 'DISABLED' ? 'neutral' : 'danger'
  return (
    <StatusChip tone={tono} data-testid={testid}>
      {valor}
    </StatusChip>
  )
}

/** Una cifra del resumen. Pequeña, con su enlace a donde se investiga. */
export function Cifra({
  etiqueta,
  valor,
  href,
  alerta,
  testid,
}: {
  etiqueta: string
  valor: number | string
  href?: string
  alerta?: boolean
  testid?: string
}) {
  const cuerpo = (
    <>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{etiqueta}</span>
      <span
        data-testid={testid}
        className={`text-xl font-semibold tabular-nums ${alerta ? 'text-warning' : ''}`}
      >
        {valor}
      </span>
    </>
  )
  const clases =
    'flex min-w-0 flex-col gap-0.5 rounded-lg border bg-card px-3 py-2 ' +
    (href ? 'transition-colors hover:border-primary/40 hover:bg-accent/40' : '')
  return href ? (
    <Link href={href} className={clases}>
      {cuerpo}
    </Link>
  ) : (
    <div className={clases}>{cuerpo}</div>
  )
}

/** Edad legible. «hace 3 min» dice más que una fecha ISO en una guardia. */
export function Edad({ minutos }: { minutos: number | null | undefined }) {
  if (minutos == null) return <span className="text-muted-foreground">—</span>
  if (minutos < 1) return <span className="tabular-nums">ahora</span>
  if (minutos < 60) return <span className="tabular-nums">{minutos} min</span>
  const h = Math.floor(minutos / 60)
  if (h < 48) return <span className="tabular-nums">{h} h</span>
  return <span className="tabular-nums">{Math.floor(h / 24)} d</span>
}

export function Momento({ valor }: { valor: Date | null | undefined }) {
  if (!valor) return <span className="text-muted-foreground">—</span>
  return (
    <time dateTime={valor.toISOString()} className="tabular-nums text-xs">
      {valor.toLocaleString('es-DO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
    </time>
  )
}

/**
 * La envoltura de una tabla densa.
 *
 * `overflow-x-auto` en el contenedor y no en la página: así una tabla ancha se
 * desplaza DENTRO de su caja y el resto del panel sigue leyéndose en un móvil,
 * en vez de que la página entera se vaya de lado.
 */
export function Tabla({ cabeceras, children }: { cabeceras: readonly string[]; children: React.ReactNode }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            {cabeceras.map((c) => (
              <th key={c} className="whitespace-nowrap px-2 py-1.5 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  )
}

export function FiltroChips({
  base,
  parametro,
  opciones,
  activo,
}: {
  base: string
  parametro: string
  opciones: readonly { valor: string; etiqueta: string }[]
  activo?: string
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Link
        href={base}
        data-testid={`filtro-${parametro}-todos`}
        className={`rounded-full border px-2.5 py-1 text-xs ${!activo ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-accent'}`}
      >
        Todos
      </Link>
      {opciones.map((o) => (
        <Link
          key={o.valor}
          href={`${base}?${parametro}=${encodeURIComponent(o.valor)}`}
          data-testid={`filtro-${parametro}-${o.valor}`}
          className={`rounded-full border px-2.5 py-1 text-xs ${activo === o.valor ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-accent'}`}
        >
          {o.etiqueta}
        </Link>
      ))}
    </div>
  )
}

export function Paginador({
  base,
  pagina,
  porPagina,
  total,
  extra,
}: {
  base: string
  pagina: number
  porPagina: number
  total: number
  extra?: string
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina))
  if (total === 0) return null
  const q = (p: number) => `${base}?${extra ? `${extra}&` : ''}pagina=${p}`
  return (
    <div className="flex items-center justify-between gap-2 pt-2 text-xs text-muted-foreground">
      <span data-testid="paginador-total">
        {total.toLocaleString('es-DO')} fila(s) · página {pagina} de {paginas}
      </span>
      <div className="flex gap-1">
        {pagina > 1 && (
          <Link href={q(pagina - 1)} className="rounded border px-2 py-1 hover:bg-accent" data-testid="paginador-anterior">
            ← Anterior
          </Link>
        )}
        {pagina < paginas && (
          <Link href={q(pagina + 1)} className="rounded border px-2 py-1 hover:bg-accent" data-testid="paginador-siguiente">
            Siguiente →
          </Link>
        )}
      </div>
    </div>
  )
}

/** Un dato que puede no estar. Nunca se inventa un «todo bien». */
export function Dato({ valor }: { valor: string | number | null | undefined }) {
  if (valor === null || valor === undefined || valor === '') return <span className="text-muted-foreground">—</span>
  return <span className="tabular-nums">{valor}</span>
}

/**
 * Un error guardado, recortado.
 *
 * Ya viene saneado del dominio —`sanearError` le quitó firmas y tokens— y aquí
 * solo se recorta para que una fila no se coma la tabla. El completo está en la
 * ficha.
 */
export function ErrorCorto({ texto }: { texto: string | null | undefined }) {
  if (!texto) return <span className="text-muted-foreground">—</span>
  const corto = texto.length > 70 ? `${texto.slice(0, 70)}…` : texto
  return (
    <span className="text-xs text-muted-foreground" title={corto}>
      {corto}
    </span>
  )
}
