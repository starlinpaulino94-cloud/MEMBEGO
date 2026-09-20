import Link from 'next/link'
import Form from 'next/form'
import { ArrowLeft, Search } from 'lucide-react'
import type { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { normalizarBusqueda } from '@/modules/busqueda/normalizar'
import { Input } from '@/components/ui/input'
import { requireRole, requireSection, puedeFuncion } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatDateTime, TZ_PLATAFORMA } from '@/lib/format'
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

export const metadata = { title: 'Detalle de operación' }

/**
 * Cada pestaña es una cifra del reporte de Operación, con su MISMO criterio:
 * las revertidas se fechan por cuándo se revirtieron —la pregunta es «cuánto
 * se está anulando este mes»—, y las demás por la fecha de la visita.
 */
const VISTAS = {
  CANJES: 'Todos los canjes',
  DESCONTADOS: 'Descontaron un uso',
  SIN_DESCONTAR: 'Sin descontar',
  REVERTIDAS: 'Revertidas',
} as const

type VistaDetalle = keyof typeof VISTAS

/** Tope de filas. Un detalle no es una exportación: lo que no cabe, se dice. */
const MAX = 300

type OrdenVisita = CampoOrden<Prisma.VisitOrderByWithRelationInput[]>

/**
 * Por qué se puede ordenar. El orden va a la CONSULTA, no al navegador: con el
 * tope de 300, ordenar aquí cambia QUÉ filas se ven. La nota larga está en
 * `modules/reportes/orden-detalle.ts`.
 *
 * El primero de la lista es el orden por defecto, y por eso depende de la
 * pestaña: las revertidas se fechan por cuándo SE REVIRTIERON, el mismo
 * criterio con el que el reporte las contó.
 *
 * **El empleado no está, a propósito.** Esa columna la manda `ver_empleados` y
 * ni siquiera se pide a la base sin el permiso; un `?o=empleado` ordenaría por
 * un dato que quien mira no puede ver.
 *
 * Todas menos la fecha llevan `fechaVisita` de segundo criterio: sin él, dos
 * visitas del mismo servicio saldrían en el orden que le apeteciera a Postgres
 * y la lista cambiaría sola entre dos recargas iguales.
 */
function camposDe(vista: VistaDetalle): readonly OrdenVisita[] {
  const fecha: OrdenVisita = {
    clave: 'fecha',
    label: 'Cuándo',
    inicial: 'desc',
    tope: (d) => (d === 'desc' ? 'las más recientes' : 'las más antiguas'),
    orderBy: (d) => [{ fechaVisita: d }],
  }
  const revertida: OrdenVisita = {
    clave: 'revertida',
    label: 'Cuándo se revirtió',
    inicial: 'desc',
    tope: (d) => (d === 'desc' ? 'las revertidas más recientes' : 'las revertidas más antiguas'),
    orderBy: (d) => [{ revertidaAt: d }, { fechaVisita: 'desc' }],
  }
  const resto: OrdenVisita[] = [
    {
      clave: 'cliente',
      label: 'Cliente',
      inicial: 'asc',
      tope: (d) => `por cliente, de la ${d === 'asc' ? 'A a la Z' : 'Z a la A'}`,
      orderBy: (d) => [{ cliente: { nombre: d } }, { fechaVisita: 'desc' }],
    },
    {
      clave: 'servicio',
      label: 'Servicio',
      inicial: 'asc',
      tope: (d) => `por servicio, de la ${d === 'asc' ? 'A a la Z' : 'Z a la A'}`,
      orderBy: (d) => [{ servicio: d }, { fechaVisita: 'desc' }],
    },
    {
      clave: 'sucursal',
      label: 'Sucursal',
      inicial: 'asc',
      tope: (d) => `por sucursal, de la ${d === 'asc' ? 'A a la Z' : 'Z a la A'}`,
      orderBy: (d) => [{ sucursal: { nombre: d } }, { fechaVisita: 'desc' }],
    },
  ]
  return vista === 'REVERTIDAS' ? [revertida, fecha, ...resto] : [fecha, ...resto]
}

/** Forma de las filas; el `select` de abajo varía con el permiso. */
type Fila = {
  id: string
  fechaVisita: Date
  servicio: string
  descontado: boolean
  revertidaAt: Date | null
  revertidaMotivo: string | null
  revertidaPorSistema: string | null
  cliente: { id: string; nombre: string }
  sucursal: { nombre: string } | null
  empleado?: { name: string } | null
  revertidaPor?: { name: string } | null
}

/**
 * LAS VISITAS QUE PRODUJERON LA CIFRA.
 *
 * El reporte de Operación decía «418 canjes» y ahí se acababa: para saber
 * quién canjeó, cuándo y qué servicio había que exportar el CSV… que tampoco
 * baja a la fila. Un número que no se puede abrir hasta las filas que lo
 * producen no es un reporte: es una afirmación.
 *
 * Hereda el MISMO rango y el MISMO filtro de sucursal/empleado que la pantalla
 * anterior porque lee la URL con las mismas claves. Si los recalculara por su
 * cuenta, el detalle de «12» podría enseñar once filas y nadie sabría cuál de
 * las dos pantallas miente.
 *
 * El permiso `ver_empleados` manda EN LA CONSULTA: sin él, ni la columna de
 * empleado, ni su filtro, ni el nombre de quien revirtió se piden a la base.
 */
export default async function DetalleOperacionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireRole(ADMIN_ROLES)
  const user = await requireSection('reportes', 'ver')
  if (!user) return <SinEmpresaActiva seccion="los reportes" />
  const companyId = await requireCompanyContext(user)

  const sp = await searchParams
  const leerParam = (k: string) => {
    const v = Array.isArray(sp[k]) ? sp[k][0] : sp[k]
    return typeof v === 'string' ? v.trim() : ''
  }

  const pedida = leerParam('vista')
  const vista: VistaDetalle = pedida in VISTAS ? (pedida as VistaDetalle) : 'CANJES'
  const q = leerParam('q')

  const verEmpleados = await puedeFuncion('reportes', 'ver_empleados')
  const sucursalId = leerParam('sucursal')
  // Sin el permiso el parámetro NI SE LEE, igual que en el reporte.
  const empleadoId = verEmpleados ? leerParam('empleado') : ''

  const campos = camposDe(vista)
  const orden = leerOrden(campos, leerParam('o'), leerParam('d'))

  const empresa = await conEmpresa(companyId, (tx) =>
    tx.company
      .findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      .catch(() => null)
  )
  const timeZone = empresa?.zonaHoraria || TZ_PLATAFORMA
  const rango = leerRango(sp, timeZone)
  const prefs = await getRegionalPrefs(companyId)

  // El mismo `where` para las filas y el total: si difirieran, el encabezado
  // diría un número y la tabla enseñaría otro. Un id de sucursal o empleado
  // ajeno no enseña nada de otro inquilino: el `companyId` va SIEMPRE dentro.
  const where = {
    companyId,
    ...(sucursalId ? { sucursalId } : {}),
    ...(empleadoId ? { empleadoId } : {}),
    ...(q ? { cliente: { nombreBusqueda: { contains: normalizarBusqueda(q) } } } : {}),
    ...(vista === 'REVERTIDAS'
      ? // Fechadas por cuándo SE REVIRTIERON, el mismo criterio que la cifra.
        { revertidaAt: { gte: rango.desde, lt: rango.hasta } }
      : {
          fechaVisita: { gte: rango.desde, lt: rango.hasta },
          ...(vista === 'DESCONTADOS' ? { descontado: true } : {}),
          ...(vista === 'SIN_DESCONTAR' ? { descontado: false } : {}),
        }),
  }

  const [filasCrudas, total, sucursales, empleados] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      tx.visit.findMany({
        where,
        orderBy: orderByDe(campos, orden),
        take: MAX,
        select: {
          id: true,
          fechaVisita: true,
          servicio: true,
          descontado: true,
          revertidaAt: true,
          revertidaMotivo: true,
          revertidaPorSistema: true,
          cliente: { select: { id: true, nombre: true } },
          sucursal: { select: { nombre: true } },
          // Los nombres de personas SOLO se piden con el permiso: esconder la
          // columna en la vista dejaría el dato viajando igual.
          ...(verEmpleados
            ? {
                empleado: { select: { name: true } },
                revertidaPor: { select: { name: true } },
              }
            : {}),
        },
      }),
      // El total sale de un `count`, no del largo de la lista recortada: si no,
      // el detalle diría 300 cuando hubo 4.000.
      tx.visit.count({ where }),
      tx.sucursal
        .findMany({
          where: { companyId },
          select: { id: true, nombre: true },
          orderBy: { nombre: 'asc' },
        })
        .catch(() => []),
      verEmpleados
        ? tx.user
            .findMany({
              where: {
                role: { not: 'CLIENTE' },
                OR: [{ companyId }, { empresasAcceso: { some: { companyId } } }],
              },
              select: { id: true, name: true },
              orderBy: { name: 'asc' },
            })
            .catch(() => [])
        : Promise.resolve(null),
    ])
  )
  const filas = filasCrudas as unknown as Fila[]

  const qs = paramsDeRango(rango)
  // Lo que viaja pegado a pestañas y enlaces: rango + filtros vivos.
  const conFiltros = (extra?: Record<string, string>) => {
    const params = new URLSearchParams(qs ? qs.slice(1) : '')
    if (q) params.set('q', q)
    if (sucursalId) params.set('sucursal', sucursalId)
    if (empleadoId) params.set('empleado', empleadoId)
    params.set('o', orden.clave)
    params.set('d', orden.direccion)
    for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v)
    return params.toString()
  }
  // El texto del tope se construye desde el orden vigente: decir «las 300 más
  // recientes» con la tabla ordenada por cliente sería mentira.
  const recorte = resumenTope(campos, orden, total, MAX)
  const enlaceOrden = (clave: string) =>
    `/admin/reportes/operacion/detalle?${conFiltros({
      vista,
      o: clave,
      d: siguienteDireccion(campos, orden, clave),
    })}`
  const volver = new URLSearchParams(qs ? qs.slice(1) : '')
  if (sucursalId) volver.set('sucursal', sucursalId)
  if (empleadoId) volver.set('empleado', empleadoId)

  const esRevertidas = vista === 'REVERTIDAS'
  const hayFiltro = Boolean(q || sucursalId || empleadoId)

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/admin/reportes/operacion${volver.size ? `?${volver.toString()}` : ''}`}>
          <ArrowLeft className="h-4 w-4" /> Volver al reporte
        </Link>
      </Button>

      <PageHeader
        title={VISTAS[vista]}
        description={`${rango.desdeDia} a ${rango.hastaDia} · ${total} en total${
          recorte ? ` · ${recorte}` : ''
        }`}
      />

      <div className="flex flex-wrap gap-2">
        {(Object.keys(VISTAS) as VistaDetalle[]).map((v) => (
          // Cambiar de pestaña conserva el resto de filtros: quien mira una
          // sucursal en «Canjes» y salta a «Revertidas» sigue mirándola a ella.
          <Button
            key={v}
            asChild
            size="sm"
            variant={v === vista ? 'default' : 'outline'}
            className="rounded-full"
          >
            <Link href={`/admin/reportes/operacion/detalle?${conFiltros({ vista: v })}`}>
              {VISTAS[v]}
            </Link>
          </Button>
        ))}
      </div>

      <Form
        action="/admin/reportes/operacion/detalle"
        className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-card p-3"
      >
        <input type="hidden" name="vista" value={vista} />
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
        {sucursales.length > 0 && (
          <select
            name="sucursal"
            defaultValue={sucursalId}
            aria-label="Filtrar por sucursal"
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="">Todas las sucursales</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        )}
        {empleados && empleados.length > 0 && (
          <select
            name="empleado"
            defaultValue={empleadoId}
            aria-label="Filtrar por empleado"
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="">Todos los empleados</option>
            {empleados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        )}
        <Button type="submit" variant="secondary" size="sm">
          Filtrar
        </Button>
        {hayFiltro && (
          <Button asChild variant="ghost" size="sm">
            <Link
              href={`/admin/reportes/operacion/detalle?vista=${vista}&o=${orden.clave}&d=${orden.direccion}${qs ? `&${qs.slice(1)}` : ''}`}
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
            hayFiltro
              ? 'Ninguna visita coincide con esos filtros en el periodo.'
              : 'No hubo visitas de este tipo en el periodo elegido.'
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
                {esRevertidas && <ThOrden
                  campo="revertida"
                  activo={orden.clave}
                  direccion={orden.direccion}
                  href={enlaceOrden('revertida')}
                >
                  Cuándo se revirtió
                </ThOrden>}
                <ThOrden
                  campo="cliente"
                  activo={orden.clave}
                  direccion={orden.direccion}
                  href={enlaceOrden('cliente')}
                >
                  Cliente
                </ThOrden>
                <ThOrden
                  campo="servicio"
                  activo={orden.clave}
                  direccion={orden.direccion}
                  href={enlaceOrden('servicio')}
                >
                  Servicio
                </ThOrden>
                <ThOrden
                  campo="sucursal"
                  activo={orden.clave}
                  direccion={orden.direccion}
                  href={enlaceOrden('sucursal')}
                >
                  Sucursal
                </ThOrden>
                {verEmpleados && <th className="px-3 py-2 text-overline">Empleado</th>}
                {!esRevertidas && <th className="px-3 py-2 text-overline">Descontó</th>}
                {esRevertidas && <th className="px-3 py-2 text-overline">Motivo</th>}
                {esRevertidas && verEmpleados && (
                  <th className="px-3 py-2 text-overline">Quién la revirtió</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b border-border/60">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {formatDateTime(f.fechaVisita, prefs)}
                    {/* Fuera de la pestaña de revertidas, una fila revertida
                        no se disfraza de canje normal. */}
                    {!esRevertidas && f.revertidaAt && (
                      <span
                        className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-caption"
                        title="Esta visita se revirtió después; sigue contando como canje"
                      >
                        revertida
                      </span>
                    )}
                  </td>
                  {esRevertidas && (
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {f.revertidaAt ? formatDateTime(f.revertidaAt, prefs) : '—'}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/clientes/${f.cliente.id}`}
                      className="text-foreground underline-offset-2 hover:underline"
                    >
                      {f.cliente.nombre}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{f.servicio}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {f.sucursal?.nombre ?? '(sin asignar)'}
                  </td>
                  {verEmpleados && (
                    <td className="px-3 py-2 text-muted-foreground">
                      {f.empleado?.name ?? '(sin asignar)'}
                    </td>
                  )}
                  {!esRevertidas && (
                    <td className="px-3 py-2 text-muted-foreground">
                      {f.descontado ? 'Sí' : 'No'}
                    </td>
                  )}
                  {esRevertidas && (
                    <td className="px-3 py-2 text-muted-foreground">
                      {f.revertidaMotivo ?? '—'}
                    </td>
                  )}
                  {esRevertidas && verEmpleados && (
                    <td className="px-3 py-2 text-muted-foreground">
                      {f.revertidaPor?.name ?? f.revertidaPorSistema ?? '—'}
                    </td>
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
