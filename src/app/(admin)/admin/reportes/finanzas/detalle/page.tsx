import Link from 'next/link'
import Form from 'next/form'
import { ArrowLeft, Search } from 'lucide-react'
import type { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { normalizarBusqueda } from '@/modules/busqueda/normalizar'
import { whereCobrado } from '@/modules/pagos/cobrado'
import { Input } from '@/components/ui/input'
import { requireRole, requireSection } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatDateTime, formatMoney } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { leerRango, paramsDeRango } from '@/modules/reportes/rango'
import {
  leerOrden,
  resumenTope,
  siguienteDireccion,
  type MetaCampo,
  type OrdenDetalle,
} from '@/modules/reportes/orden-detalle'
import { ThOrden } from '@/components/reportes/ThOrden'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { StatusBanner } from '@/components/ui/status-banner'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Detalle de finanzas' }

/**
 * Cada pestaña es una cifra del reporte de finanzas — y cada una vive en SU
 * tabla. No hay una lista única de «dinero» porque no hay una tabla única: la
 * caja son `Transaction`, los cobros de membresía son `Membership` y la
 * pasarela es `PagoIntento`. Juntarlas en una sola lista obligaría a inventar
 * un formato común y a perder por el camino lo que distingue a cada fila.
 */
const VISTAS = {
  CAJA: 'Ingreso de caja',
  MEMBRESIAS: 'Cobros de membresías',
  DESCUENTOS: 'Descuentos aplicados',
  DESHECHAS: 'Anuladas y revertidas',
  INTENTOS: 'Intentos de pago en línea',
  RECHAZADOS: 'Pagos rechazados',
  SIN_ENTREGAR: 'Cobrado sin entregar',
} as const

type VistaDetalle = keyof typeof VISTAS

/** De qué tabla sale cada pestaña. Decide qué se puede filtrar y qué no. */
const TABLA: Record<VistaDetalle, 'caja' | 'membresias' | 'pasarela'> = {
  CAJA: 'caja',
  MEMBRESIAS: 'membresias',
  DESCUENTOS: 'membresias',
  DESHECHAS: 'caja',
  INTENTOS: 'pasarela',
  RECHAZADOS: 'pasarela',
  SIN_ENTREGAR: 'pasarela',
}

/** Las que no se fechan dentro del periodo, y por qué. */
const FUERA_DEL_EJE: Partial<Record<VistaDetalle, string>> = {
  SIN_ENTREGAR:
    'Esta lista NO depende del periodo elegido: son todos los pagos cobrados cuya entrega sigue pendiente, porque un pago atascado en marzo sigue siendo un problema hoy.',
}

const METODO: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  TARJETA: 'Tarjeta',
  TRANSFERENCIA: 'Transferencia',
  PRESENCIAL: 'En sucursal',
  OTRO: 'Otro',
}

const ESTADO_INTENTO: Record<string, string> = {
  CREADO: 'Creado',
  REDIRIGIDO: 'Redirigido a la pasarela',
  EN_VALIDACION: 'En validación',
  APROBADO: 'Aprobado',
  RECHAZADO: 'Rechazado',
  ERROR: 'Error técnico',
}

const ESTADO_CAJA: Record<string, string> = {
  APPROVED: 'Aprobada',
  APPLIED: 'Aplicada',
  CANCELLED: 'Anulada',
  REVERTED: 'Revertida',
}

/** Los únicos estados que significan que el dinero entró. Igual que el motor. */
const COBRADOS = ['APPROVED', 'APPLIED'] as const
const DESHECHOS = ['CANCELLED', 'REVERTED'] as const

/** Tope de filas. Un detalle no es una exportación: lo que no cabe, se dice. */
const MAX = 300

/**
 * POR QUÉ SE PUEDE ORDENAR, Y POR QUÉ EL ORDEN VA A LA CONSULTA.
 *
 * Con el tope de 300, ordenar en el navegador daría «las 300 más recientes,
 * ordenadas por monto» — que NO son «las 300 de mayor monto». En finanzas eso
 * es grave: el cobro más grande del trimestre podría no estar en la lista y la
 * tabla parecería estar respondiendo a la pregunta. La nota larga está en
 * `modules/reportes/orden-detalle.ts`.
 *
 * Aquí las claves se comparten pero el `orderBy` no: son TRES tablas distintas
 * —`Transaction`, `Membership` y `PagoIntento`— y cada una llama a lo mismo por
 * su nombre. «Concepto» es el método de cobro en caja, el plan en membresías y
 * el proveedor en la pasarela; la sucursal ni siquiera existe en la pasarela.
 * Por eso cada rama arma el suyo, abajo.
 *
 * Todas menos la fecha llevan la fecha de segundo criterio: sin él, dos cobros
 * del mismo método saldrían en el orden que le apeteciera a Postgres y la lista
 * cambiaría sola entre dos recargas iguales.
 */
function camposDe(
  tabla: 'caja' | 'membresias' | 'pasarela',
  /** «Descuentos» enseña y ordena el descuento, no lo pagado. */
  descuentos: boolean
): readonly MetaCampo[] {
  const alfabetico = (que: string) => (d: string) =>
    `por ${que}, de la ${d === 'asc' ? 'A a la Z' : 'Z a la A'}`
  const campos: MetaCampo[] = [
    {
      clave: 'fecha',
      label: 'Cuándo',
      inicial: 'desc',
      tope: (d) => (d === 'desc' ? 'las más recientes' : 'las más antiguas'),
    },
    {
      clave: 'monto',
      label: descuentos ? 'Descuento' : 'Monto',
      inicial: 'desc',
      tope: (d) =>
        `las de ${d === 'desc' ? 'mayor' : 'menor'} ${descuentos ? 'descuento' : 'monto'}`,
    },
    {
      clave: 'cliente',
      label: 'Cliente',
      inicial: 'asc',
      tope: alfabetico('cliente'),
    },
    {
      clave: 'concepto',
      label: tabla === 'membresias' ? 'Plan' : tabla === 'pasarela' ? 'Pasarela' : 'Método',
      inicial: 'asc',
      tope: alfabetico(tabla === 'membresias' ? 'plan' : tabla === 'pasarela' ? 'pasarela' : 'método'),
    },
  ]
  if (tabla !== 'pasarela') {
    campos.push({
      clave: 'sucursal',
      label: 'Sucursal',
      inicial: 'asc',
      tope: alfabetico('sucursal'),
    })
  }
  if (tabla !== 'membresias') {
    campos.push({ clave: 'estado', label: 'Estado', inicial: 'asc', tope: alfabetico('estado') })
  }
  return campos
}

function ordenCaja(o: OrdenDetalle): Prisma.TransactionOrderByWithRelationInput[] {
  const d = o.direccion
  const despues = { createdAt: 'desc' } as const
  switch (o.clave) {
    case 'monto':
      return [{ monto: d }, despues]
    case 'cliente':
      return [{ cliente: { nombre: d } }, despues]
    case 'concepto':
      return [{ metodoCobro: d }, despues]
    case 'sucursal':
      return [{ sucursal: { nombre: d } }, despues]
    case 'estado':
      return [{ estado: d }, despues]
    default:
      return [{ createdAt: d }]
  }
}

function ordenMembresias(
  o: OrdenDetalle,
  descuentos: boolean
): Prisma.MembershipOrderByWithRelationInput[] {
  const d = o.direccion
  // El respaldo a `updatedAt` es el mismo que usa `whereCobrado`: una membresía
  // cobrada sin `fechaPago` se fecha por ahí, y ordenarla por otro campo la
  // pondría donde no le toca.
  const porFecha = [{ fechaPago: d }, { updatedAt: d }]
  switch (o.clave) {
    case 'monto':
      // La columna enseña el descuento en esa pestaña: ordenar por lo pagado
      // daría una tabla que no sigue a su propia columna.
      return [descuentos ? { descuentoBienvenida: d } : { montoPagado: d }, ...porFecha]
    case 'cliente':
      return [{ cliente: { nombre: d } }, ...porFecha]
    case 'concepto':
      return [{ plan: { nombre: d } }, ...porFecha]
    case 'sucursal':
      return [{ sucursalPago: { nombre: d } }, ...porFecha]
    default:
      return porFecha
  }
}

function ordenPasarela(o: OrdenDetalle): Prisma.PagoIntentoOrderByWithRelationInput[] {
  const d = o.direccion
  const despues = { createdAt: 'desc' } as const
  switch (o.clave) {
    case 'monto':
      return [{ monto: d }, despues]
    case 'cliente':
      return [{ cliente: { nombre: d } }, despues]
    case 'concepto':
      return [{ proveedor: d }, despues]
    case 'estado':
      return [{ estado: d }, despues]
    default:
      return [{ createdAt: d }]
  }
}

/** Forma común de una fila, vengan de la tabla que vengan. */
interface FilaFinanzas {
  id: string
  fecha: Date
  cliente: { id: string; nombre: string } | null
  monto: number
  /** Método de cobro, plan o proveedor, según la tabla. */
  concepto: string
  /** `null` cuando la tabla no guarda sucursal (la pasarela no la tiene). */
  sucursal: string | null
  estado: string | null
  /** Motivo del rechazo o error de entrega. */
  motivo: string | null
}

/**
 * LAS FILAS QUE PRODUJERON LA CIFRA.
 *
 * El reporte decía «RD$142.300 de caja» y ahí se acababa: para cuadrar contra
 * el arqueo del día había que creer el número o exportarlo y sumarlo a mano. Un
 * número que no se puede abrir hasta las filas que lo producen no es un
 * reporte: es una afirmación.
 *
 * Exige `ver_financieros`, y a nivel de pantalla entera igual que el reporte:
 * aquí todo es dinero, y esconder columnas dejaría una página vacía y una
 * pregunta.
 *
 * El total del encabezado sale de un `aggregate`, no de sumar las filas que se
 * enseñan: con el tope de 300, sumar la lista diría una cifra más baja que el
 * reporte y no habría forma de saber cuál de las dos está mal.
 */
export default async function DetalleFinanzasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireRole(ADMIN_ROLES)
  const user = await requireSection('reportes', 'ver_financieros')
  if (!user) {
    return (
      <EmptyState
        title="No tienes permiso para ver las cifras de dinero"
        description="Este detalle es solo de finanzas. Pídeselo a quien administra el negocio."
      />
    )
  }
  const companyId = await requireCompanyContext(user)

  const sp = await searchParams
  const leerParam = (k: string) => {
    const v = Array.isArray(sp[k]) ? sp[k][0] : sp[k]
    return typeof v === 'string' ? v.trim() : ''
  }

  const pedida = leerParam('vista')
  const vista: VistaDetalle = pedida in VISTAS ? (pedida as VistaDetalle) : 'CAJA'
  const q = leerParam('q')
  const sucursalPedida = leerParam('sucursal')

  const empresa = await conEmpresa(companyId, (tx) =>
    tx.company
      .findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      .catch(() => null)
  )
  const timeZone = zonaSegura(empresa?.zonaHoraria)
  const rango = leerRango(sp, timeZone)
  const prefs = await getRegionalPrefs(companyId)

  const tabla = TABLA[vista]
  const campos = camposDe(tabla, vista === 'DESCUENTOS')
  const orden = leerOrden(campos, leerParam('o'), leerParam('d'))
  const buscado = q ? normalizarBusqueda(q) : ''
  const porCliente = q ? { cliente: { nombreBusqueda: { contains: buscado } } } : {}

  const { filas, total, suma, sucursal, sucursales } = await conEmpresa(
    companyId,
    async (tx) => {
      // La sucursal se valida contra la empresa: un id inventado o ajeno no
      // filtra en silencio, se descarta. Igual que en el reporte.
      const sucursal = sucursalPedida
        ? await tx.sucursal.findFirst({
            where: { id: sucursalPedida, companyId },
            select: { id: true, nombre: true },
          })
        : null

      const sucursales = await tx.sucursal
        .findMany({
          where: { companyId },
          select: { id: true, nombre: true },
          orderBy: { nombre: 'asc' },
        })
        .catch(() => [])

      // La pasarela NO tiene sucursal: con el filtro activo, sus pestañas no
      // se recortan a medias — se dice y no se aplica.
      const recorte = tabla === 'pasarela' ? null : sucursal

      if (tabla === 'caja') {
        const where = {
          companyId,
          estado: { in: vista === 'DESHECHAS' ? [...DESHECHOS] : [...COBRADOS] },
          createdAt: { gte: rango.desde, lt: rango.hasta },
          ...(recorte ? { sucursalId: recorte.id } : {}),
          ...porCliente,
        }
        const [rows, agg] = await Promise.all([
          tx.transaction.findMany({
            where,
            orderBy: ordenCaja(orden),
            take: MAX,
            select: {
              id: true,
              createdAt: true,
              monto: true,
              metodoCobro: true,
              estado: true,
              cliente: { select: { id: true, nombre: true } },
              sucursal: { select: { nombre: true } },
            },
          }),
          // El total sale de un agregado, no del largo de la lista recortada.
          tx.transaction.aggregate({ where, _sum: { monto: true }, _count: { _all: true } }),
        ])
        return {
          sucursal,
          sucursales,
          total: agg._count._all,
          suma: Number(agg._sum.monto ?? 0),
          filas: rows.map<FilaFinanzas>((t) => ({
            id: t.id,
            fecha: t.createdAt,
            cliente: t.cliente,
            monto: Number(t.monto ?? 0),
            concepto: t.metodoCobro ? (METODO[t.metodoCobro] ?? t.metodoCobro) : 'Sin registrar',
            sucursal: t.sucursal?.nombre ?? '(sin asignar)',
            estado: ESTADO_CAJA[t.estado] ?? t.estado,
            motivo: null,
          })),
        }
      }

      if (tabla === 'membresias') {
        // `whereCobrado` es la MISMA puerta que usa el reporte —fechar por
        // `updatedAt` movería de mes un cobro viejo al editarlo— y va DENTRO de
        // las dos consultas, como en el resto del código: lo compartido es la
        // acotación, y el criterio de «cobrado» lo aplica la misma función a
        // las dos, así que filas y total no pueden separarse.
        const acota = {
          companyId,
          ...(vista === 'DESCUENTOS' ? { descuentoBienvenida: { not: null } } : {}),
          ...(recorte ? { sucursalPagoId: recorte.id } : {}),
          ...porCliente,
        }
        const [rows, agg] = await Promise.all([
          tx.membership.findMany({
            where: whereCobrado(rango.desde, rango.hasta, acota),
            orderBy: ordenMembresias(orden, vista === 'DESCUENTOS'),
            take: MAX,
            select: {
              id: true,
              fechaPago: true,
              updatedAt: true,
              montoPagado: true,
              descuentoBienvenida: true,
              cliente: { select: { id: true, nombre: true } },
              plan: { select: { nombre: true } },
              sucursalPago: { select: { nombre: true } },
            },
          }),
          // Las dos sumas siempre: pedir una u otra según la pestaña haría que
          // el tipo del resultado cambiara con la vista, y elegir después es
          // más barato que ramificar la consulta.
          tx.membership.aggregate({
            where: whereCobrado(rango.desde, rango.hasta, acota),
            _sum: { montoPagado: true, descuentoBienvenida: true },
            _count: { _all: true },
          }),
        ])
        return {
          sucursal,
          sucursales,
          total: agg._count._all,
          suma: Number(
            (vista === 'DESCUENTOS' ? agg._sum.descuentoBienvenida : agg._sum.montoPagado) ?? 0
          ),
          filas: rows.map<FilaFinanzas>((m) => ({
            id: m.id,
            // El respaldo a `updatedAt` es el mismo que usa `whereCobrado`:
            // enseñar la fecha en blanco dejaría filas sin explicación.
            fecha: m.fechaPago ?? m.updatedAt,
            cliente: m.cliente,
            monto: Number(
              (vista === 'DESCUENTOS' ? m.descuentoBienvenida : m.montoPagado) ?? 0
            ),
            concepto: m.plan?.nombre ?? '(plan eliminado)',
            sucursal: m.sucursalPago?.nombre ?? '(no se pagó en sucursal)',
            estado: null,
            motivo: null,
          })),
        }
      }

      // Pasarela. `PagoIntento` no guarda sucursal, así que estas pestañas no
      // llevan el recorte y la pantalla lo dice.
      const where = {
        companyId,
        ...porCliente,
        ...(vista === 'SIN_ENTREGAR'
          ? // La ALARMA: no depende del periodo, igual que en el reporte.
            { estado: 'APROBADO', fulfillmentEstado: 'PENDIENTE' }
          : {
              createdAt: { gte: rango.desde, lt: rango.hasta },
              ...(vista === 'RECHAZADOS' ? { estado: 'RECHAZADO' } : {}),
            }),
      }
      const [rows, agg] = await Promise.all([
        tx.pagoIntento.findMany({
          where,
          orderBy: ordenPasarela(orden),
          take: MAX,
          select: {
            id: true,
            createdAt: true,
            monto: true,
            estado: true,
            proveedor: true,
            motivoRechazo: true,
            fulfillmentError: true,
            cliente: { select: { id: true, nombre: true } },
          },
        }),
        tx.pagoIntento.aggregate({ where, _sum: { monto: true }, _count: { _all: true } }),
      ])
      return {
        sucursal,
        sucursales,
        total: agg._count._all,
        suma: Number(agg._sum.monto ?? 0),
        filas: rows.map<FilaFinanzas>((p) => ({
          id: p.id,
          fecha: p.createdAt,
          cliente: p.cliente,
          monto: Number(p.monto),
          concepto: p.proveedor,
          sucursal: null,
          estado: ESTADO_INTENTO[p.estado] ?? p.estado,
          motivo: p.motivoRechazo ?? p.fulfillmentError,
        })),
      }
    }
  )

  const dinero = (n: number) => formatMoney(n, prefs)
  const qs = paramsDeRango(rango)
  const conFiltros = (extra?: Record<string, string>) => {
    const params = new URLSearchParams(qs ? qs.slice(1) : '')
    if (q) params.set('q', q)
    if (sucursal) params.set('sucursal', sucursal.id)
    params.set('o', orden.clave)
    params.set('d', orden.direccion)
    for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v)
    return params.toString()
  }
  // El texto del tope se construye desde el orden vigente: decir «las 300 más
  // recientes» con la tabla ordenada por monto sería mentira.
  const recorte = resumenTope(campos, orden, total, MAX)
  const enlaceOrden = (clave: string) =>
    `/admin/reportes/finanzas/detalle?${conFiltros({
      vista,
      o: clave,
      d: siguienteDireccion(campos, orden, clave),
    })}`
  const volver = new URLSearchParams(qs ? qs.slice(1) : '')
  if (sucursal) volver.set('sucursal', sucursal.id)

  const hayFiltro = Boolean(q || sucursal)
  const nota = FUERA_DEL_EJE[vista]
  const conSucursal = tabla !== 'pasarela'
  const conEstado = tabla !== 'membresias'
  const conMotivo = vista === 'RECHAZADOS' || vista === 'SIN_ENTREGAR'

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/admin/reportes/finanzas${volver.size ? `?${volver.toString()}` : ''}`}>
          <ArrowLeft className="h-4 w-4" /> Volver al reporte
        </Link>
      </Button>

      <PageHeader
        title={VISTAS[vista]}
        description={`${
          vista === 'SIN_ENTREGAR' ? 'No depende del periodo' : `${rango.desdeDia} a ${rango.hastaDia}`
        } · ${total} ${total === 1 ? 'fila' : 'filas'} · ${dinero(suma)} en total${
          recorte ? ` · ${recorte}` : ''
        }`}
      />

      {nota && (
        <p className="rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-small text-foreground">
          {nota}
        </p>
      )}

      {/* El filtro de sucursal existe pero esta tabla no la guarda: decirlo es
          lo contrario de aplicarlo a medias y dejar que el total parezca
          recortado cuando no lo está. */}
      {sucursal && !conSucursal && (
        <StatusBanner variant="info" title="Esta lista no se puede filtrar por sucursal">
          Un pago en línea no pertenece a ningún mostrador: la pasarela no guarda la sucursal. Estas
          filas son las de toda la empresa, aunque el filtro «{sucursal.nombre}» siga activo en el
          resto del reporte.
        </StatusBanner>
      )}

      <div className="flex flex-wrap gap-2">
        {(Object.keys(VISTAS) as VistaDetalle[]).map((v) => (
          // Cambiar de pestaña conserva los filtros: quien busca a un cliente
          // en «caja» y salta a «rechazados» sigue mirándolo a él.
          <Button
            key={v}
            asChild
            size="sm"
            variant={v === vista ? 'default' : 'outline'}
            className="rounded-full"
          >
            <Link href={`/admin/reportes/finanzas/detalle?${conFiltros({ vista: v })}`}>
              {VISTAS[v]}
            </Link>
          </Button>
        ))}
      </div>

      <Form
        action="/admin/reportes/finanzas/detalle"
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
            defaultValue={sucursal?.id ?? ''}
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
        <Button type="submit" variant="secondary" size="sm">
          Filtrar
        </Button>
        {hayFiltro && (
          <Button asChild variant="ghost" size="sm">
            <Link
              href={`/admin/reportes/finanzas/detalle?vista=${vista}&o=${orden.clave}&d=${orden.direccion}${qs ? `&${qs.slice(1)}` : ''}`}
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
              ? 'Ninguna fila coincide con esos filtros.'
              : 'No hubo movimiento de este tipo en el periodo elegido.'
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
                  campo="concepto"
                  activo={orden.clave}
                  direccion={orden.direccion}
                  href={enlaceOrden('concepto')}
                >
                  {tabla === 'membresias' ? 'Plan' : tabla === 'pasarela' ? 'Pasarela' : 'Método'}
                </ThOrden>
                {conSucursal && <ThOrden
                  campo="sucursal"
                  activo={orden.clave}
                  direccion={orden.direccion}
                  href={enlaceOrden('sucursal')}
                >
                  Sucursal
                </ThOrden>}
                {conEstado && <ThOrden
                  campo="estado"
                  activo={orden.clave}
                  direccion={orden.direccion}
                  href={enlaceOrden('estado')}
                >
                  Estado
                </ThOrden>}
                {conMotivo && <th className="px-3 py-2 text-overline">Motivo</th>}
                <ThOrden
                  campo="monto"
                  activo={orden.clave}
                  direccion={orden.direccion}
                  href={enlaceOrden('monto')}
                  derecha
                >
                  {vista === 'DESCUENTOS' ? 'Descuento' : 'Monto'}
                </ThOrden>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b border-border/60">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {formatDateTime(f.fecha, prefs)}
                  </td>
                  <td className="px-3 py-2">
                    {f.cliente ? (
                      <Link
                        href={`/admin/clientes/${f.cliente.id}`}
                        className="text-foreground underline-offset-2 hover:underline"
                      >
                        {f.cliente.nombre}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{f.concepto}</td>
                  {conSucursal && (
                    <td className="px-3 py-2 text-muted-foreground">{f.sucursal ?? '—'}</td>
                  )}
                  {conEstado && (
                    <td className="px-3 py-2 text-muted-foreground">{f.estado ?? '—'}</td>
                  )}
                  {conMotivo && (
                    <td className="px-3 py-2 text-muted-foreground">{f.motivo ?? '—'}</td>
                  )}
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground">
                    {dinero(f.monto)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
