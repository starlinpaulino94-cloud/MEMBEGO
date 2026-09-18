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
import { ABIERTOS } from '@/modules/reportes/citas'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { StatusBanner } from '@/components/ui/status-banner'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Detalle de citas' }

/**
 * Cada pestaña es una cifra del reporte de citas, con su MISMO criterio. Dos de
 * ellas no siguen el eje de las demás y por eso lo dicen en pantalla:
 * «Reservadas» se fecha por cuándo se pidió la cita y no por cuándo era, y
 * «Por confirmar» no depende del periodo en absoluto —es la alarma—.
 */
const VISTAS = {
  TODAS: 'Todas las citas',
  COMPLETADAS: 'Completadas',
  CANCELADAS: 'Canceladas',
  NO_ASISTIO: 'No asistió',
  ABIERTAS: 'Todavía abiertas',
  SIN_CERRAR: 'Ya pasaron sin cerrar',
  POR_CONFIRMAR: 'Pendientes de confirmar',
  RESERVADAS: 'Reservadas en el periodo',
} as const

type VistaDetalle = keyof typeof VISTAS

/** Las que no se fechan por `inicio` dentro del periodo, y por qué. */
const FUERA_DEL_EJE: Partial<Record<VistaDetalle, string>> = {
  RESERVADAS:
    'Estas se fechan por CUÁNDO SE RESERVARON, no por cuándo era la cita: por eso pueden salir citas de otro mes.',
  POR_CONFIRMAR:
    'Esta lista NO depende del periodo elegido: son todas las citas que un cliente reservó para una hora que todavía no llega y que el negocio no ha confirmado.',
}

const ESTADO_LABEL: Record<string, string> = {
  PENDIENTE: 'Por confirmar',
  CONFIRMADA: 'Confirmada',
  COMPLETADA: 'Completada',
  CANCELADA: 'Cancelada',
  NO_ASISTIO: 'No asistió',
}

const CANCELADA_POR: Record<string, string> = {
  CLIENTE: 'El cliente',
  NEGOCIO: 'El negocio',
}

/** Tope de filas. Un detalle no es una exportación: lo que no cabe, se dice. */
const MAX = 300

/**
 * LAS CITAS QUE PRODUJERON LA CIFRA.
 *
 * El reporte decía «43 canceladas» y ahí se acababa: para saber a quién se le
 * canceló, cuándo y por qué, no había dónde mirar. Un número que no se puede
 * abrir hasta las filas que lo producen no es un reporte: es una afirmación.
 *
 * Hereda el MISMO periodo y el MISMO filtro de servicio que la pantalla
 * anterior porque lee la URL con las mismas claves. Si los recalculara por su
 * cuenta, el detalle de «43» podría enseñar cuarenta filas y nadie sabría cuál
 * de las dos pantallas miente.
 *
 * El aviso de que el estado es el de HOY viaja también aquí, y no por repetir:
 * esta es la pantalla donde más fácil sería leer una fila como si dijera
 * «cancelada ese día», cuando lo único que dice es «cancelada».
 */
export default async function DetalleCitasPage({
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
  const vista: VistaDetalle = pedida in VISTAS ? (pedida as VistaDetalle) : 'TODAS'
  const q = leerParam('q')
  const servicio = leerParam('servicio')

  const verEmpleados = await puedeFuncion('reportes', 'ver_empleados')

  const empresa = await conEmpresa(companyId, (tx) =>
    tx.company
      .findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      .catch(() => null)
  )
  const timeZone = empresa?.zonaHoraria || TZ_PLATAFORMA
  const rango = leerRango(sp, timeZone)
  const prefs = await getRegionalPrefs(companyId)

  const ahora = new Date()
  // El mismo corte que el reporte: lo «ya pasado» termina donde termine antes,
  // el fin del rango o este instante.
  const yaPaso = new Date(Math.min(ahora.getTime(), rango.hasta.getTime()))
  const enPeriodo = { gte: rango.desde, lt: rango.hasta }

  // El `companyId` va SIEMPRE dentro: un servicio pegado en la URL no puede
  // enseñar nada de otro inquilino. Y el mismo `where` para las filas y el
  // total: si difirieran, el encabezado diría un número y la tabla otro.
  const base: Prisma.CitaWhereInput = {
    companyId,
    ...(q ? { cliente: { nombreBusqueda: { contains: normalizarBusqueda(q) } } } : {}),
    ...(servicio ? { servicio } : {}),
  }
  const where: Prisma.CitaWhereInput = {
    ...base,
    ...(vista === 'RESERVADAS'
      ? { createdAt: enPeriodo }
      : vista === 'POR_CONFIRMAR'
        ? { estado: 'PENDIENTE', inicio: { gte: ahora } }
        : vista === 'SIN_CERRAR'
          ? { estado: { in: ABIERTOS }, inicio: { gte: rango.desde, lt: yaPaso } }
          : {
              inicio: enPeriodo,
              ...(vista === 'COMPLETADAS' ? { estado: 'COMPLETADA' as const } : {}),
              ...(vista === 'CANCELADAS' ? { estado: 'CANCELADA' as const } : {}),
              ...(vista === 'NO_ASISTIO' ? { estado: 'NO_ASISTIO' as const } : {}),
              ...(vista === 'ABIERTAS' ? { estado: { in: ABIERTOS } } : {}),
            }),
  }

  const [filas, total, servicios] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      tx.cita.findMany({
        where,
        // «Reservadas» ordena por cuándo se reservó: una lista fechada por un
        // campo y ordenada por otro se lee como si le faltaran filas.
        orderBy: vista === 'RESERVADAS' ? { createdAt: 'desc' } : { inicio: 'desc' },
        take: MAX,
        select: {
          id: true,
          inicio: true,
          createdAt: true,
          servicio: true,
          estado: true,
          canceladaPor: true,
          motivoCancelacion: true,
          cliente: { select: { id: true, nombre: true } },
          // El nombre de quien atendió SOLO se pide con el permiso: esconder la
          // columna en la vista dejaría el dato viajando igual.
          ...(verEmpleados ? { atendidaPor: { select: { name: true } } } : {}),
        },
      }),
      // El total sale de un `count`, no del largo de la lista recortada: si no,
      // el detalle diría 300 cuando hubo 4.000.
      tx.cita.count({ where }),
      tx.cita
        .groupBy({
          by: ['servicio'],
          where: { companyId, servicio: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { servicio: 'desc' } },
          take: 50,
        })
        .catch(() => []),
    ])
  )

  const serviciosDisponibles = servicios
    .map((s) => s.servicio)
    .filter((s): s is string => typeof s === 'string' && s !== '')

  const qs = paramsDeRango(rango)
  const conFiltros = (extra?: Record<string, string>) => {
    const params = new URLSearchParams(qs ? qs.slice(1) : '')
    if (q) params.set('q', q)
    if (servicio) params.set('servicio', servicio)
    for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v)
    return params.toString()
  }
  const volver = new URLSearchParams(qs ? qs.slice(1) : '')
  if (servicio) volver.set('servicio', servicio)

  const hayFiltro = Boolean(q || servicio)
  const esCanceladas = vista === 'CANCELADAS'
  const nota = FUERA_DEL_EJE[vista]

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/admin/reportes/citas${volver.size ? `?${volver.toString()}` : ''}`}>
          <ArrowLeft className="h-4 w-4" /> Volver al reporte
        </Link>
      </Button>

      <PageHeader
        title={VISTAS[vista]}
        description={`${
          vista === 'POR_CONFIRMAR' ? 'No depende del periodo' : `${rango.desdeDia} a ${rango.hastaDia}`
        } · ${total} en total${total > MAX ? ` · se muestran las ${MAX} más recientes` : ''}`}
      />

      {/* La misma advertencia que el reporte, y aquí importa más: una fila se
          lee como si dijera «cancelada ese día», y lo único que dice es
          «cancelada». */}
      <StatusBanner variant="info" title="El estado es el de hoy, no el del día de la cita">
        La tabla de citas guarda en qué estado está cada una, pero no cuándo cambió. Una cita de
        marzo que se canceló en abril aparece aquí dentro del periodo de marzo, con su estado
        actual.
      </StatusBanner>

      {nota && (
        <p className="rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-small text-foreground">
          {nota}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {(Object.keys(VISTAS) as VistaDetalle[]).map((v) => (
          // Cambiar de pestaña conserva los filtros: quien busca a un cliente
          // en «Canceladas» y salta a «No asistió» sigue mirándolo a él.
          <Button
            key={v}
            asChild
            size="sm"
            variant={v === vista ? 'default' : 'outline'}
            className="rounded-full"
          >
            <Link href={`/admin/reportes/citas/detalle?${conFiltros({ vista: v })}`}>
              {VISTAS[v]}
            </Link>
          </Button>
        ))}
      </div>

      <Form
        action="/admin/reportes/citas/detalle"
        className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-card p-3"
      >
        <input type="hidden" name="vista" value={vista} />
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
        {serviciosDisponibles.length > 0 && (
          <select
            name="servicio"
            defaultValue={servicio}
            aria-label="Filtrar por servicio"
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="">Todos los servicios</option>
            {serviciosDisponibles.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <Button type="submit" variant="secondary" size="sm">
          Filtrar
        </Button>
        {hayFiltro && (
          <Button asChild variant="ghost" size="sm">
            <Link href={`/admin/reportes/citas/detalle?vista=${vista}${qs ? `&${qs.slice(1)}` : ''}`}>
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
              ? 'Ninguna cita coincide con esos filtros.'
              : 'No hay citas de este tipo en el periodo elegido.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-small">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-3 py-2 text-overline">Cuándo era</th>
                <th className="px-3 py-2 text-overline">Se reservó</th>
                <th className="px-3 py-2 text-overline">Cliente</th>
                <th className="px-3 py-2 text-overline">Servicio</th>
                <th className="px-3 py-2 text-overline">Estado hoy</th>
                {verEmpleados && <th className="px-3 py-2 text-overline">Atendió</th>}
                {esCanceladas && <th className="px-3 py-2 text-overline">Canceló</th>}
                {esCanceladas && <th className="px-3 py-2 text-overline">Motivo</th>}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b border-border/60">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {formatDateTime(f.inicio, prefs)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {formatDateTime(f.createdAt, prefs)}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/clientes/${f.cliente.id}`}
                      className="text-foreground underline-offset-2 hover:underline"
                    >
                      {f.cliente.nombre}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {f.servicio || '(sin especificar)'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {ESTADO_LABEL[f.estado] ?? f.estado}
                  </td>
                  {verEmpleados && (
                    <td className="px-3 py-2 text-muted-foreground">
                      {f.atendidaPor?.name ?? '(sin asignar)'}
                    </td>
                  )}
                  {esCanceladas && (
                    <td className="px-3 py-2 text-muted-foreground">
                      {f.canceladaPor ? (CANCELADA_POR[f.canceladaPor] ?? f.canceladaPor) : '—'}
                    </td>
                  )}
                  {esCanceladas && (
                    <td className="px-3 py-2 text-muted-foreground">
                      {f.motivoCancelacion ?? '—'}
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
