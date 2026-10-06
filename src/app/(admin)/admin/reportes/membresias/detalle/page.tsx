import Link from 'next/link'
import Form from 'next/form'
import { ArrowLeft, Search } from 'lucide-react'
import type { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { normalizarBusqueda } from '@/modules/busqueda/normalizar'
import { Input } from '@/components/ui/input'
import { requireRole, requireSection } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatDateTime } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { leerRango, paramsDeRango } from '@/modules/reportes/rango'
import {
  leerOrden,
  orderByDe,
  resumenTope,
  siguienteDireccion,
  type CampoOrden,
} from '@/modules/reportes/orden-detalle'
import { ThOrden } from '@/components/reportes/ThOrden'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Detalle del ciclo de vida' }

const TIPOS = {
  ACTIVADA: 'Activaciones',
  RENOVADA: 'Renovaciones',
  CANCELADA: 'Cancelaciones',
  VENCIDA: 'Vencimientos',
  CAMBIO_PLAN: 'Cambios de plan',
  // El resto del ciclo (F3): el enum tenía siete tipos y aquí solo se
  // enseñaban cinco — CREADA y RECHAZADA existían y no se podían abrir; los
  // ajustes ni siquiera se escribían (Fase 2 los estrenó).
  AJUSTADA: 'Ajustes (vigencia y lavados)',
  CREADA: 'Creadas (pendientes)',
  RECHAZADA: 'Pagos rechazados',
} as const

/** Tipos cuya fila enseña el motivo escrito al hacerlos. */
const CON_MOTIVO = new Set<TipoDetalle>(['CANCELADA', 'AJUSTADA', 'RECHAZADA'])

/** Qué se ajustó, leído del payload del evento AJUSTADA. Nunca lanza. */
function detalleAjuste(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as { ajuste?: unknown; antes?: unknown; despues?: unknown; delta?: unknown }
  const que =
    p.ajuste === 'VENCIMIENTO' ? 'Vigencia' : p.ajuste === 'LAVADOS' ? 'Lavados' : null
  if (!que) return null
  const antes = p.antes == null ? '—' : String(p.antes)
  const despues = p.despues == null ? '—' : String(p.despues)
  return `${que}: ${antes} → ${despues}`
}

type TipoDetalle = keyof typeof TIPOS

const ORIGEN_LABEL: Record<string, string> = {
  ADMIN: 'El negocio',
  CLIENTE: 'El cliente',
  SUPERADMIN: 'Soporte',
  CRON: 'Automático',
  API: 'Integración',
  RECONSTRUIDO: 'Histórico reconstruido',
}

/** Tope de filas. Un detalle no es una exportación: lo que no cabe, se dice. */
const MAX = 300

/**
 * Por qué se puede ordenar, y qué se le pide a la base en cada caso.
 *
 * El orden va a la CONSULTA y no al navegador: con el tope de 300, ordenar aquí
 * cambia qué filas se ven, no solo en qué fila aparecen. La nota larga está en
 * `modules/reportes/orden-detalle.ts`.
 *
 * Las columnas que no son la fecha llevan `ocurridoEn` de segundo criterio: sin
 * él, dos eventos del mismo origen saldrían en el orden que le apeteciera a
 * Postgres y la lista cambiaría sola entre dos recargas iguales.
 */
const CAMPOS: readonly CampoOrden<Prisma.MembresiaEventoOrderByWithRelationInput[]>[] = [
  {
    clave: 'fecha',
    label: 'Cuándo',
    inicial: 'desc',
    tope: (d) => (d === 'desc' ? 'los más recientes' : 'los más antiguos'),
    orderBy: (d) => [{ ocurridoEn: d }],
  },
  {
    clave: 'cliente',
    label: 'Cliente',
    inicial: 'asc',
    tope: (d) => `por cliente, de la ${d === 'asc' ? 'A a la Z' : 'Z a la A'}`,
    orderBy: (d) => [{ membership: { cliente: { nombre: d } } }, { ocurridoEn: 'desc' }],
  },
  {
    clave: 'origen',
    label: 'Origen',
    inicial: 'asc',
    tope: (d) => `por origen, de la ${d === 'asc' ? 'A a la Z' : 'Z a la A'}`,
    orderBy: (d) => [{ origen: d }, { ocurridoEn: 'desc' }],
  },
]

/**
 * LAS FILAS QUE PRODUJERON LA CIFRA.
 *
 * Es la mitad que faltaba del reporte. Un panel donde «12 cancelaciones» no se
 * puede abrir obliga a creer el número o a no usarlo, y lo segundo es lo que
 * acaba pasando.
 *
 * Hereda el MISMO rango que la pantalla anterior porque lee la URL con la misma
 * función. Si lo recalculara por su cuenta, el detalle de «12» podría enseñar
 * once filas y nadie sabría cuál de las dos pantallas miente.
 */
export default async function DetalleCicloVidaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireRole(ADMIN_ROLES)
  const user = await requireSection('reportes', 'ver')
  if (!user) return <SinEmpresaActiva seccion="los reportes" />
  const companyId = await requireCompanyContext(user)

  const sp = await searchParams
  const pedido = String(Array.isArray(sp.tipo) ? sp.tipo[0] : (sp.tipo ?? ''))
  const tipo: TipoDetalle = pedido in TIPOS ? (pedido as TipoDetalle) : 'RENOVADA'

  // Filtros de verdad (F4): cliente y origen, no solo el rango. «¿Cuándo le
  // extendieron la membresía a ESTE cliente?» era imposible de responder sin
  // exportar y buscar a mano.
  const q = String(Array.isArray(sp.q) ? sp.q[0] : (sp.q ?? '')).trim()
  const origenPedido = String(Array.isArray(sp.origen) ? sp.origen[0] : (sp.origen ?? ''))
  const origen = origenPedido in ORIGEN_LABEL ? origenPedido : ''
  const orden = leerOrden(
    CAMPOS,
    String(Array.isArray(sp.o) ? sp.o[0] : (sp.o ?? '')),
    String(Array.isArray(sp.d) ? sp.d[0] : (sp.d ?? ''))
  )

  const empresa = await conEmpresa(companyId, (tx) =>
    tx.company
      .findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      .catch(() => null)
  )
  const timeZone = zonaSegura(empresa?.zonaHoraria)
  const rango = leerRango(sp, timeZone)
  const prefs = await getRegionalPrefs(companyId)

  // El mismo `where` para las filas y el total: si difirieran, el encabezado
  // diría un número y la tabla enseñaría otro.
  const where = {
    companyId,
    tipo,
    ocurridoEn: { gte: rango.desde, lt: rango.hasta },
    ...(origen ? { origen: origen as never } : {}),
    ...(q
      ? {
          membership: {
            cliente: {
              nombreBusqueda: { contains: normalizarBusqueda(q) },
            },
          },
        }
      : {}),
  }

  const [filas, total] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      tx.membresiaEvento.findMany({
        where,
        orderBy: orderByDe(CAMPOS, orden),
        take: MAX,
        select: {
          id: true,
          ocurridoEn: true,
          origen: true,
          motivo: true,
          reconstruido: true,
          membershipId: true,
          precioAnterior: true,
          precioNuevo: true,
          payload: true,
          membership: { select: { cliente: { select: { id: true, nombre: true } } } },
          actor: { select: { name: true, email: true } },
        },
      }),
      // El total sale de un `count`, no del largo de la lista recortada: si no,
      // el detalle diría 300 cuando hubo 4.000.
      tx.membresiaEvento.count({ where }),
    ])
  )

  const qs = paramsDeRango(rango)
  // El texto del tope se construye desde el orden vigente: decir «las 300 más
  // recientes» con la tabla ordenada por cliente sería mentira.
  const recorte = resumenTope(CAMPOS, orden, total, MAX)
  /** El resto de la URL, para que ordenar no pierda pestaña ni filtros. */
  const enlaceOrden = (clave: string) => {
    const params = new URLSearchParams(qs ? qs.slice(1) : '')
    params.set('tipo', tipo)
    if (q) params.set('q', q)
    if (origen) params.set('origen', origen)
    params.set('o', clave)
    params.set('d', siguienteDireccion(CAMPOS, orden, clave))
    return `/admin/reportes/membresias/detalle?${params.toString()}`
  }
  const dinero = (v: unknown) =>
    v == null ? '—' : new Intl.NumberFormat(prefs?.idioma || 'es-DO').format(Number(v))

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/admin/reportes/membresias${qs}`}>
          <ArrowLeft className="h-4 w-4" /> Volver al reporte
        </Link>
      </Button>

      <PageHeader
        title={TIPOS[tipo]}
        description={`${rango.desdeDia} a ${rango.hastaDia} · ${total} en total${
          recorte ? ` · ${recorte}` : ''
        }`}
      />

      <div className="flex flex-wrap gap-2">
        {(Object.keys(TIPOS) as TipoDetalle[]).map((t) => {
          // Cambiar de pestaña conserva el resto de filtros: quien busca a un
          // cliente en «Ajustes» y salta a «Renovaciones» sigue mirándolo a él.
          const params = new URLSearchParams(qs ? qs.slice(1) : '')
          params.set('tipo', t)
          if (q) params.set('q', q)
          if (origen) params.set('origen', origen)
          params.set('o', orden.clave)
          params.set('d', orden.direccion)
          return (
            <Button
              key={t}
              asChild
              size="sm"
              variant={t === tipo ? 'default' : 'outline'}
              className="rounded-full"
            >
              <Link href={`/admin/reportes/membresias/detalle?${params.toString()}`}>
                {TIPOS[t]}
              </Link>
            </Button>
          )
        })}
      </div>

      {/* Filtros de verdad (F4): cliente y origen. El rango viaja en campos
          ocultos para que filtrar no lo pierda. */}
      <Form
        action="/admin/reportes/membresias/detalle"
        className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-card p-3"
      >
        <input type="hidden" name="tipo" value={tipo} />
        <input type="hidden" name="o" value={orden.clave} />
        <input type="hidden" name="d" value={orden.direccion} />
        {[...new URLSearchParams(qs ? qs.slice(1) : '').entries()].map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Buscar por cliente…"
            aria-label="Buscar por cliente"
            className="pl-9"
          />
        </div>
        <select
          name="origen"
          defaultValue={origen}
          aria-label="Filtrar por origen"
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
        >
          <option value="">Cualquier origen</option>
          {Object.entries(ORIGEN_LABEL).map(([valor, label]) => (
            <option key={valor} value={valor}>
              {label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary" size="sm">
          Filtrar
        </Button>
        {(q || origen) && (
          <Button asChild variant="ghost" size="sm">
            <Link
              href={`/admin/reportes/membresias/detalle?tipo=${tipo}&o=${orden.clave}&d=${orden.direccion}${qs ? `&${qs.slice(1)}` : ''}`}
            >
              Limpiar
            </Link>
          </Button>
        )}
      </Form>

      {filas.length === 0 ? (
        <EmptyState
          title="Nada que mostrar"
          description={
            q || origen
              ? 'Ningún evento de este tipo coincide con esos filtros en el periodo.'
              : 'No hubo eventos de este tipo en el periodo elegido.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-small">
            <thead>
              <tr className="border-b border-border text-left">
                <ThOrden
                  campo="fecha"
                  activo={orden.clave}
                  direccion={orden.direccion}
                  href={enlaceOrden('fecha')}
                >
                  Cuándo
                </ThOrden>
                <ThOrden
                  campo="cliente"
                  activo={orden.clave}
                  direccion={orden.direccion}
                  href={enlaceOrden('cliente')}
                >
                  Cliente
                </ThOrden>
                <ThOrden
                  campo="origen"
                  activo={orden.clave}
                  direccion={orden.direccion}
                  href={enlaceOrden('origen')}
                >
                  Origen
                </ThOrden>
                {tipo === 'CAMBIO_PLAN' && (
                  <th className="px-3 py-2 text-right text-overline">Precio</th>
                )}
                {tipo === 'AJUSTADA' && <th className="px-3 py-2 text-overline">Qué cambió</th>}
                <th className="px-3 py-2 text-overline">Quién</th>
                {CON_MOTIVO.has(tipo) && <th className="px-3 py-2 text-overline">Motivo</th>}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b border-border/60">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {formatDateTime(f.ocurridoEn, prefs)}
                    {f.reconstruido && (
                      <span
                        className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-caption"
                        title="Fila reconstruida desde la bitácora, no escrita por el camino normal"
                      >
                        reconstruido
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {f.membership?.cliente ? (
                      <Link
                        href={`/admin/clientes/${f.membership.cliente.id}`}
                        className="text-foreground underline-offset-2 hover:underline"
                      >
                        {f.membership.cliente.nombre}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {ORIGEN_LABEL[f.origen] ?? f.origen}
                  </td>
                  {tipo === 'CAMBIO_PLAN' && (
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {dinero(f.precioAnterior)} → {dinero(f.precioNuevo)}
                    </td>
                  )}
                  {tipo === 'AJUSTADA' && (
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {detalleAjuste(f.payload) ?? '—'}
                    </td>
                  )}
                  <td className="px-3 py-2 text-muted-foreground">
                    {f.actor?.name ?? f.actor?.email ?? '—'}
                  </td>
                  {CON_MOTIVO.has(tipo) && (
                    <td className="px-3 py-2 text-muted-foreground">{f.motivo ?? '—'}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
