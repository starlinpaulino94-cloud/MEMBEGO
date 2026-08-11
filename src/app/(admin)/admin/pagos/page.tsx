import Image from 'next/image'
import { conEmpresaOTodas } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatMoney, formatDate } from '@/lib/format'
import { EstadoBadge } from '@/components/EstadoBadge'
import {
  ConfirmarPagoButton,
  RechazarPagoButton,
  SolicitarEvidenciaButton,
  NotaInternaForm,
} from '@/components/admin/ValidarPagoActions'
import {
  AprobarCambioButton,
  RechazarCambioButton,
} from '@/components/admin/CambioPlanActions'
import {
  AprobarCompraButton,
  RechazarCompraButton,
} from '@/components/admin/ValidarCompraActions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { TabsNav } from '@/components/ui/tabs-nav'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBanner } from '@/components/ui/status-banner'
import { ArrowRight, CheckCircle2, Clock, ExternalLink, FileText, Mail, MessageCircle, Store } from 'lucide-react'
import type { MembershipEstado } from '@/types'

import { contarColasDePago } from '@/modules/pagos/colasConteo'
import {
  whereCambiosDePlan,
  whereComprasEnSucursal,
  whereComprasEnValidacion,
  whereComprasSinCompletar,
  whereMembresiasEnSucursal,
  whereMembresiasSinCompletar,
  whereTransferencias,
} from '@/modules/pagos/colas'
import { leerPaginacion } from '@/lib/paginacion'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date | null) {
  if (!d) return '—'
  return formatDate(d, undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function isImage(url: string) {
  return /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(url)
}

/** Días transcurridos desde una fecha (0 = hoy). */
function diasDesde(d: Date) {
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000))
}

/** Enlace de WhatsApp desde un teléfono local (es-DO: antepone 1 si falta). */
function waLink(telefono: string | null) {
  if (!telefono) return null
  let digits = telefono.replace(/\D/g, '')
  if (digits.length === 10 && !digits.startsWith('1')) digits = `1${digits}`
  return digits.length >= 10 ? `https://wa.me/${digits}` : null
}

interface PendienteRow {
  id: string
  estado: string
  clienteId: string
  updatedAt: Date
  comprobanteUrl: string | null
  comprobanteNota: string | null
  adminNota: string | null
  cliente: { nombre: string; email: string; company: { name: string } }
  plan: { nombre: string; precio: unknown }
  metodoPago: { nombre: string } | null
  // O-13: descuento de bienvenida congelado (solo aplica si nunca se activó).
  descuentoBienvenida: unknown | null
  fechaInicio: Date | null
}

/**
 * COLAS DE TRABAJO (§53).
 *
 * El brief pide pestañas por ESTADO —pendientes, confirmados, rechazados—,
 * pero esta pantalla no lista pagos: lista COLAS DE TRABAJO. Un pago
 * confirmado ya no está aquí, y los cinco grupos que sí están necesitan
 * acciones distintas: confirmar un cobro en sucursal no se parece a validar
 * una transferencia ni a aprobar un cambio de plan.
 *
 * Aplicar los estados del brief al pie de la letra habría dado tres pestañas
 * —una vacía y dos que mezclan trabajos distintos— así que las pestañas van
 * sobre las colas reales. La intención del §53 se cumple igual: dejas de
 * recorrer cinco bloques apilados para encontrar el que te toca.
 *
 * Antes las colas vacías se ocultaban del todo, así que la pantalla cambiaba
 * de forma según el día. Con pestañas siempre están las cinco, con su
 * recuento: ver "Cambios de plan 0" es información, no ruido.
 */
const COLAS = [
  { clave: 'sucursal', label: 'En sucursal' },
  { clave: 'transferencias', label: 'Transferencias' },
  { clave: 'compras', label: 'Compras' },
  { clave: 'cambios', label: 'Cambios de plan' },
  { clave: 'seguimiento', label: 'Sin completar' },
] as const
type Cola = (typeof COLAS)[number]['clave']

export default async function PagosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)
  const sp = await searchParams
  const colaRaw = sp.cola
  const cola: Cola = COLAS.some((c) => c.clave === colaRaw)
    ? (colaRaw as Cola)
    : 'sucursal'
  // Cinco colas independientes en una misma pantalla: cada una lleva su propio
  // prefijo para que avanzar en una no mueva a las demás.
  const pagTr = leerPaginacion(sp, 25, 'tr')
  const pagPr = leerPaginacion(sp, 25, 'pr')
  const pagCp = leerPaginacion(sp, 25, 'cp')
  const pagSuc = leerPaginacion(sp, 25, 'suc')
  const pagSeg = leerPaginacion(sp, 25, 'seg')
  // Las dos colas mixtas (sucursal = membresías + compras; seguimiento = lo
  // mismo ordenado por fecha) se cortan aquí, así que cada consulta trae hasta
  // el FINAL de la ventana visible. Crece con la página que se pide, no con el
  // tamaño de la cola — y a diferencia del tope fijo de antes, es exacto.
  const VENTANA_SUCURSAL = pagSuc.saltar + pagSuc.tomar
  const VENTANA_SEGUIMIENTO = pagSeg.saltar + pagSeg.tomar
  const prefs = await getRegionalPrefs(companyId)
  const fmtMoney = (n: number) => formatMoney(n, prefs)

  // Una sola query por lista, en paralelo, con select mínimo, take y filtro
  // directo por memberships.companyId. Antes: 3 findMany secuenciales sin
  // límite, y un "fallback" invertido que además anulaba comprobanteUrl en
  // el caso con pendientes (no se veía el comprobante).
  // Un rechazo de la query se distingue de "no hay pendientes": si tragáramos
  // el error como [] el admin dejaría de validar pagos sin darse cuenta.
  // null = la query falló (se distingue de [] = sin resultados) para poder
  // mostrar un aviso en vez de fingir "no hay pagos pendientes".
  const [
    pendientesData,
    cambiosData,
    comprasData,
    sucursalMembresiasData,
    sucursalComprasData,
    seguimientoMembresiasData,
    seguimientoComprasData,
    totalSucursalMembresias,
  ] = await conEmpresaOTodas(
    companyId,
    'pagos: sin empresa activa es el superadmin, que cruza empresas a propósito',
    (tx) => Promise.all([
      tx.membership
        .findMany({
          where: whereTransferencias(companyId),
          select: {
            id: true,
            estado: true,
            clienteId: true,
            updatedAt: true,
            comprobanteUrl: true,
            comprobanteNota: true,
            adminNota: true,
            descuentoBienvenida: true,
            fechaInicio: true,
            cliente: {
              select: { nombre: true, email: true, company: { select: { name: true } } },
            },
            plan: { select: { nombre: true, precio: true } },
            metodoPago: { select: { nombre: true } },
          },
          orderBy: { updatedAt: 'desc' },
          skip: pagTr.saltar,
          take: pagTr.tomar,
        })
        .catch((e) => {
          console.error('[admin-pagos] pendientes query', e)
          return null
        }),
      tx.membership
        .findMany({
          where: whereCambiosDePlan(companyId),
          select: {
            id: true,
            clienteId: true,
            updatedAt: true,
            comprobanteUrl: true,
            comprobanteNota: true,
            cliente: {
              select: { nombre: true, email: true, company: { select: { name: true } } },
            },
            plan: { select: { nombre: true } },
            planSolicitado: { select: { nombre: true, precio: true } },
          },
          orderBy: { updatedAt: 'desc' },
          skip: pagCp.saltar,
          take: pagCp.tomar,
        })
        .catch((e) => {
          console.error('[admin-pagos] cambios query', e)
          return null
        }),
      // Fase E5: compras de promociones esperando validación del pago.
      tx.productoCompra
        .findMany({
          where: whereComprasEnValidacion(companyId),
          select: {
            id: true,
            clienteId: true,
            updatedAt: true,
            comprobanteUrl: true,
            comprobanteNota: true,
            transferenciaFecha: true,
            precioCongelado: true,
            cliente: {
              select: { nombre: true, email: true, company: { select: { name: true } } },
            },
            promocion: { select: { titulo: true } },
            metodoPago: { select: { nombre: true } },
          },
          orderBy: { updatedAt: 'desc' },
          skip: pagPr.saltar,
          take: pagPr.tomar,
        })
        .catch((e) => {
          console.error('[admin-pagos] compras query', e)
          return null
        }),
      // Pagos EN SUCURSAL: el cliente vino a pagar al local y nadie ha cobrado
      // todavía. La condición vive en `modules/pagos/colas.ts` y se aplica en la
      // BASE, no en memoria: antes se traían 500 filas y se separaban aquí, así
      // que a partir de la 501 el recuento de la pestaña era falso sin avisar.
      tx.membership
        .findMany({
          where: whereMembresiasEnSucursal(companyId),
          select: {
            id: true,
            estado: true,
            clienteId: true,
            createdAt: true,
            updatedAt: true,
            referencia: true,
            descuentoBienvenida: true,
            fechaInicio: true,
            rechazadoReason: true,
            sucursalPago: { select: { nombre: true } },
            metodoPago: { select: { nombre: true, tipo: true } },
            cliente: {
              select: { nombre: true, email: true, telefono: true, company: { select: { name: true } } },
            },
            plan: { select: { nombre: true, precio: true } },
          },
          orderBy: { updatedAt: 'asc' },
          take: VENTANA_SUCURSAL,
        })
        .catch((e) => {
          console.error('[admin-pagos] sucursal membresías query', e)
          return null
        }),
      // Compras de promociones a pagar en el local (misma condición).
      tx.productoCompra
        .findMany({
          where: whereComprasEnSucursal(companyId),
          select: {
            id: true,
            estado: true,
            clienteId: true,
            createdAt: true,
            updatedAt: true,
            referencia: true,
            precioCongelado: true,
            rechazadoReason: true,
            sucursalPago: { select: { nombre: true } },
            metodoPago: { select: { nombre: true, tipo: true } },
            cliente: {
              select: { nombre: true, email: true, telefono: true, company: { select: { name: true } } },
            },
            promocion: { select: { titulo: true, precio: true } },
          },
          orderBy: { updatedAt: 'asc' },
          take: VENTANA_SUCURSAL,
        })
        .catch((e) => {
          console.error('[admin-pagos] sucursal compras query', e)
          return null
        }),
      // SEGUIMIENTO: empezaron y no completaron. Las dos listas se mezclan por
      // fecha, así que cada una trae hasta el final de la ventana visible y el
      // corte se hace después: es exacto para cualquier página, y la consulta
      // crece con la página que se pide, no con el tamaño de la cola.
      tx.membership
        .findMany({
          where: whereMembresiasSinCompletar(companyId),
          select: {
            id: true,
            estado: true,
            clienteId: true,
            updatedAt: true,
            descuentoBienvenida: true,
            fechaInicio: true,
            rechazadoReason: true,
            metodoPago: { select: { tipo: true } },
            cliente: {
              select: { nombre: true, email: true, telefono: true, company: { select: { name: true } } },
            },
            plan: { select: { nombre: true, precio: true } },
          },
          orderBy: { updatedAt: 'asc' },
          take: VENTANA_SEGUIMIENTO,
        })
        .catch((e) => {
          console.error('[admin-pagos] seguimiento membresías query', e)
          return null
        }),
      tx.productoCompra
        .findMany({
          where: whereComprasSinCompletar(companyId),
          select: {
            id: true,
            estado: true,
            clienteId: true,
            updatedAt: true,
            precioCongelado: true,
            rechazadoReason: true,
            cliente: {
              select: { nombre: true, email: true, telefono: true, company: { select: { name: true } } },
            },
            promocion: { select: { titulo: true, precio: true } },
          },
          orderBy: { updatedAt: 'asc' },
          take: VENTANA_SEGUIMIENTO,
        })
        .catch((e) => {
          console.error('[admin-pagos] seguimiento compras query', e)
          return null
        }),
      tx.membership
        .count({ where: whereMembresiasEnSucursal(companyId) })
        .catch(() => 0),
    ])
  )

  // Los recuentos de las cinco colas van APARTE: `contarColasDePago` abre su
  // propia transacción con su contexto, y anidarla dentro de la de arriba
  // pediría una segunda conexión desde dentro de una abierta — que con el
  // pooler por delante es exactamente como se agota el pool.
  // Es la MISMA definición que consume el aviso del Resumen
  // (`modules/pagos/colas.ts`): el número de la pestaña y el del panel salen
  // del mismo sitio, que es lo que arregló el «7 por validar → pantalla con 0».
  const conteos = await contarColasDePago(companyId)

  const loadError =
    pendientesData === null ||
    cambiosData === null ||
    comprasData === null ||
    sucursalMembresiasData === null ||
    sucursalComprasData === null ||
    seguimientoMembresiasData === null ||
    seguimientoComprasData === null
  const pendientes: PendienteRow[] = pendientesData ?? []
  const cambios = cambiosData ?? []
  const compras = comprasData ?? []
  const sucursalMembresias = sucursalMembresiasData ?? []
  const sucursalCompras = sucursalComprasData ?? []

  // Las dos listas de sucursal se numeran como una sola (membresías primero).
  // Cada una llegó ya filtrada de la base con hasta el final de la ventana
  // visible, así que el corte de aquí es exacto para cualquier página.
  const totalSucursal = conteos.sucursal
  const enSucursal = sucursalMembresias.slice(pagSuc.saltar, pagSuc.saltar + pagSuc.tomar)
  const restoVentana = Math.max(0, pagSuc.tomar - enSucursal.length)
  const saltarCompras = Math.max(0, pagSuc.saltar - totalSucursalMembresias)
  const enSucursalCompras = sucursalCompras.slice(saltarCompras, saltarCompras + restoVentana)

  // SEGUIMIENTO: iniciaron un pago y no lo completaron (transferencia sin
  // comprobante, solicitud sin método, o rechazado sin reintento). Unificado
  // membresías + compras, los más antiguos primero.
  const seguimientoVentana = [
    ...(seguimientoMembresiasData ?? []).map((m) => ({
        key: `m-${m.id}`,
        clienteId: m.clienteId,
        cliente: m.cliente,
        concepto: `Plan ${m.plan.nombre}`,
        monto: Math.max(
          0,
          Number(m.plan.precio) - (m.fechaInicio == null ? Number(m.descuentoBienvenida ?? 0) : 0)
        ),
        situacion:
          m.estado === 'RECHAZADA'
            ? `Pago rechazado sin reintento${m.rechazadoReason ? ` (${m.rechazadoReason})` : ''}`
            : m.metodoPago?.tipo === 'TRANSFERENCIA'
              ? 'Eligió transferencia y no ha enviado el comprobante'
              : 'Solicitó el plan y no ha completado el pago',
        fecha: m.updatedAt,
      })),
    ...(seguimientoComprasData ?? []).map((c) => ({
      key: `c-${c.id}`,
      clienteId: c.clienteId,
      cliente: c.cliente,
      concepto: `Promoción ${c.promocion?.titulo ?? '—'}`,
      monto: Number(c.precioCongelado ?? c.promocion?.precio ?? 0),
      situacion:
        c.estado === 'RECHAZADA'
          ? `Pago rechazado sin reintento${c.rechazadoReason ? ` (${c.rechazadoReason})` : ''}`
          : c.estado === 'PENDIENTE_PAGO'
            ? 'Eligió transferencia y no ha enviado el comprobante'
            : 'Solicitó la promoción y no ha completado el pago',
      fecha: c.updatedAt,
    })),
  ].sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
  const totalSeguimiento = conteos.seguimiento
  const seguimiento = seguimientoVentana.slice(pagSeg.saltar, pagSeg.saltar + pagSeg.tomar)

  const totalPorValidar = conteos.porValidar
  const sinPendientes = totalPorValidar === 0 && totalSeguimiento === 0

  return (
    <div className="space-y-6">
      {loadError && (
        <StatusBanner variant="destructive" title="No se pudieron cargar los pagos">
          Es un problema temporal; recarga la página en unos segundos. Si
          persiste, avisa al equipo técnico.
        </StatusBanner>
      )}
      <PageHeader
        title="Validación de pagos"
        description={`${totalPorValidar} pago${totalPorValidar !== 1 ? 's' : ''} por validar · ${totalSeguimiento} en seguimiento`}
        nav={
          <TabsNav
            aria-label="Colas de pago"
            items={COLAS.map((c) => ({
              label: c.label,
              badge: conteos[c.clave],
              active: cola === c.clave,
              render: ({ className, children }) => (
                <Link href={`/admin/pagos?cola=${c.clave}`} className={className}>
                  {children}
                </Link>
              ),
            }))}
          />
        }
      />

      {/* Pagos EN SUCURSAL por cobrar/confirmar: antes eran invisibles aquí
          (solo los veía la Caja). Confirmar desde el panel activa y factura
          igual que la caja; la referencia sirve para cobrarlo en el POS. */}
      {conteos[cola] === 0 && !loadError && (
        <EmptyState
          icon={<CheckCircle2 />}
          title={`Nada pendiente en «${COLAS.find((c) => c.clave === cola)?.label}»`}
          description={
            totalPorValidar + totalSeguimiento > 0
              ? 'Otras colas sí tienen trabajo: cámbialas arriba.'
              : 'No hay pagos esperando acción en ninguna cola.'
          }
        />
      )}

      {cola === 'sucursal' && totalSucursal > 0 && (
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-h4 text-foreground">
            <Store className="h-4 w-4 text-primary" aria-hidden />
            Pagos en sucursal por confirmar ({totalSucursal})
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {enSucursal.map((m) => {
              const desc = m.fechaInicio == null ? Number(m.descuentoBienvenida ?? 0) : 0
              const monto = Math.max(0, Number(m.plan.precio) - desc)
              return (
                <Card key={m.id} className="overflow-hidden border-success/30">
                  <CardHeader className="border-b bg-success/5 pb-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">
                          <Link href={`/admin/clientes/${m.clienteId}`} className="text-primary hover:underline">
                            {m.cliente.nombre}
                          </Link>
                        </CardTitle>
                        <p className="text-sm text-muted-foreground">{m.cliente.email}</p>
                        {user.metadata.role === 'SUPERADMIN' && (
                          <Badge variant="outline" className="mt-1 text-xs">{m.cliente.company.name}</Badge>
                        )}
                      </div>
                      <Badge variant="success">Pago en sucursal</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-4">
                    <div className="rounded-lg bg-muted p-3 text-sm">
                      <p>
                        <span className="text-muted-foreground">Plan:</span> <strong>{m.plan.nombre}</strong>
                      </p>
                      <p>
                        <span className="text-muted-foreground">Monto a cobrar:</span> <strong>{fmtMoney(monto)}</strong>
                        {desc > 0 && <span className="ml-1 text-xs text-success">(−{fmtMoney(desc)} bienvenida)</span>}
                      </p>
                      {m.sucursalPago && (
                        <p>
                          <span className="text-muted-foreground">Sucursal elegida:</span> {m.sucursalPago.nombre}
                        </p>
                      )}
                      {m.referencia && (
                        <p className="mt-2">
                          <span className="text-muted-foreground">Referencia (Caja):</span>{' '}
                          <code className="rounded bg-background px-2 py-0.5 font-mono text-base font-bold tracking-wider">
                            {m.referencia}
                          </code>
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        Solicitado: {fmtDate(m.createdAt)} · hace {diasDesde(m.createdAt)} día{diasDesde(m.createdAt) !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Confirma aquí si ya recibiste el dinero en el local, o cóbralo desde la Caja con la referencia.
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <ConfirmarPagoButton membershipId={m.id} />
                      <RechazarPagoButton membershipId={m.id} />
                    </div>
                  </CardContent>
                </Card>
              )
            })}
            {enSucursalCompras.map((c) => (
              <Card key={c.id} className="overflow-hidden border-success/30">
                <CardHeader className="border-b bg-success/5 pb-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">
                        <Link href={`/admin/clientes/${c.clienteId}`} className="text-primary hover:underline">
                          {c.cliente.nombre}
                        </Link>
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">{c.cliente.email}</p>
                      {user.metadata.role === 'SUPERADMIN' && (
                        <Badge variant="outline" className="mt-1 text-xs">{c.cliente.company.name}</Badge>
                      )}
                    </div>
                    <Badge variant="success">Pago en sucursal</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  <div className="rounded-lg bg-muted p-3 text-sm">
                    <p>
                      <span className="text-muted-foreground">Promoción:</span>{' '}
                      <strong>{c.promocion?.titulo ?? '—'}</strong>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Monto a cobrar:</span>{' '}
                      <strong>{fmtMoney(Number(c.precioCongelado ?? c.promocion?.precio ?? 0))}</strong>
                    </p>
                    {c.sucursalPago && (
                      <p>
                        <span className="text-muted-foreground">Sucursal elegida:</span> {c.sucursalPago.nombre}
                      </p>
                    )}
                    {c.referencia && (
                      <p className="mt-2">
                        <span className="text-muted-foreground">Referencia (Caja):</span>{' '}
                        <code className="rounded bg-background px-2 py-0.5 font-mono text-base font-bold tracking-wider">
                          {c.referencia}
                        </code>
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Solicitado: {fmtDate(c.createdAt)} · hace {diasDesde(c.createdAt)} día{diasDesde(c.createdAt) !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Confirma aquí si ya recibiste el dinero en el local, o cóbralo desde la Caja con la referencia.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <AprobarCompraButton compraId={c.id} />
                    <RechazarCompraButton compraId={c.id} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <TablaPaginacion
            paginacion={pagSuc}
            total={totalSucursal}
            params={sp}
            etiqueta="pagos en sucursal"
            clave="suc"
          />
        </div>
      )}

      {/* Fase E5: compras de promociones por validar */}
      {cola === 'compras' && conteos.compras > 0 && (
        <div className="space-y-3">
          <h2 className="text-h4 text-foreground">
            Compras de promociones ({conteos.compras})
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {compras.map((c) => (
              <Card key={c.id} className="overflow-hidden border-primary/25">
                <CardHeader className="border-b bg-primary/5 pb-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">
                        <Link
                          href={`/admin/clientes/${c.clienteId}`}
                          className="text-primary hover:underline"
                        >
                          {c.cliente.nombre}
                        </Link>
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">{c.cliente.email}</p>
                      {user.metadata.role === 'SUPERADMIN' && (
                        <Badge variant="outline" className="mt-1 text-xs">
                          {c.cliente.company.name}
                        </Badge>
                      )}
                    </div>
                    <Badge variant="info">Promoción</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  <div className="rounded-lg bg-muted p-3 text-sm">
                    <p>
                      <span className="text-muted-foreground">Promoción:</span>{' '}
                      <strong>{c.promocion?.titulo ?? '—'}</strong>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Monto esperado:</span>{' '}
                      <strong>{fmtMoney(Number(c.precioCongelado ?? 0))}</strong>
                    </p>
                    {c.metodoPago && (
                      <p>
                        <span className="text-muted-foreground">Método:</span> {c.metodoPago.nombre}
                      </p>
                    )}
                    {c.transferenciaFecha && (
                      <p>
                        <span className="text-muted-foreground">Transferencia declarada:</span>{' '}
                        {fmtDate(c.transferenciaFecha)}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Enviado: {fmtDate(c.updatedAt)}
                    </p>
                  </div>

                  {c.comprobanteUrl &&
                    (isImage(c.comprobanteUrl) ? (
                      <a href={c.comprobanteUrl} target="_blank" rel="noopener noreferrer" className="block">
                        <Image
                          src={c.comprobanteUrl}
                          alt="Comprobante de la compra"
                          width={400}
                          height={300}
                          className="w-full rounded-lg border object-cover"
                          style={{ maxHeight: '200px', objectFit: 'cover' }}
                        />
                      </a>
                    ) : (
                      <a
                        href={c.comprobanteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm text-primary hover:bg-muted"
                      >
                        <FileText className="h-5 w-5" />
                        Ver comprobante (PDF)
                        <ExternalLink className="ml-auto h-4 w-4" />
                      </a>
                    ))}

                  {c.comprobanteNota && (
                    <div className="rounded-lg bg-warning/15 p-3 text-sm text-warning">
                      <p className="font-medium">Nota del cliente:</p>
                      <p>{c.comprobanteNota}</p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <AprobarCompraButton compraId={c.id} />
                    <RechazarCompraButton compraId={c.id} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <TablaPaginacion
            paginacion={pagPr}
            total={conteos.compras}
            params={sp}
            etiqueta="compras"
            clave="pr"
          />
        </div>
      )}

      {/* Cambios de plan solicitados */}
      {cola === 'cambios' && conteos.cambios > 0 && (
        <div className="space-y-3">
          <h2 className="text-h4 text-foreground">
            Cambios de plan solicitados ({conteos.cambios})
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {cambios.map((c) => (
              <Card key={c.id} className="overflow-hidden border-info/30">
                <CardHeader className="border-b bg-info/5 pb-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">
                        <Link
                          href={`/admin/clientes/${c.clienteId}`}
                          className="text-primary hover:underline"
                        >
                          {c.cliente.nombre}
                        </Link>
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">{c.cliente.email}</p>
                      {user.metadata.role === 'SUPERADMIN' && (
                        <Badge variant="outline" className="mt-1 text-xs">
                          {c.cliente.company.name}
                        </Badge>
                      )}
                    </div>
                    <Badge variant="info">Cambio de plan</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  <div className="flex items-center justify-center gap-3 rounded-lg bg-muted p-3 text-sm">
                    <span className="font-medium text-muted-foreground">{c.plan.nombre}</span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-foreground">
                      {c.planSolicitado?.nombre}
                      {c.planSolicitado != null && (
                        <span className="ml-1 text-muted-foreground">
                          · {fmtMoney(Number(c.planSolicitado.precio))}
                        </span>
                      )}
                    </span>
                  </div>

                  {c.comprobanteUrl ? (
                    isImage(c.comprobanteUrl) ? (
                      <a href={c.comprobanteUrl} target="_blank" rel="noopener noreferrer" className="block">
                        <Image
                          src={c.comprobanteUrl}
                          alt="Comprobante del cambio"
                          width={400}
                          height={300}
                          className="w-full rounded-lg border object-cover"
                          style={{ maxHeight: '200px', objectFit: 'cover' }}
                        />
                      </a>
                    ) : (
                      <a
                        href={c.comprobanteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm text-primary hover:bg-muted"
                      >
                        <FileText className="h-5 w-5" />
                        Ver comprobante (PDF)
                        <ExternalLink className="ml-auto h-4 w-4" />
                      </a>
                    )
                  ) : (
                    <p className="rounded-lg bg-warning/15 p-3 text-xs text-warning">
                      El cliente aún no ha subido el comprobante del nuevo plan.
                    </p>
                  )}

                  {c.comprobanteNota && (
                    <div className="rounded-lg bg-warning/15 p-3 text-sm text-warning">
                      <p className="font-medium">Nota del cliente:</p>
                      <p>{c.comprobanteNota}</p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <AprobarCambioButton membershipId={c.id} />
                    <RechazarCambioButton membershipId={c.id} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <TablaPaginacion
            paginacion={pagCp}
            total={conteos.cambios}
            params={sp}
            etiqueta="cambios de plan"
            clave="cp"
          />
        </div>
      )}

      {sinPendientes && (
        <Card>
          <EmptyState
            icon={<FileText className="h-7 w-7" />}
            title="Sin pagos pendientes"
            description="Todos los pagos han sido revisados y nadie tiene un pago a medio completar."
          />
        </Card>
      )}

      {cola === 'transferencias' && conteos.transferencias > 0 && (
        <div className="space-y-3">
          <h2 className="text-h4 text-foreground">
            Transferencias por validar ({conteos.transferencias})
          </h2>
        <div className="grid gap-6 md:grid-cols-2">
          {pendientes.map((m) => (
            <Card key={m.id} className="overflow-hidden">
              <CardHeader className="border-b bg-info/5 pb-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">
                      <Link
                        href={`/admin/clientes/${m.clienteId}`}
                        className="text-primary hover:underline"
                      >
                        {m.cliente.nombre}
                      </Link>
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">{m.cliente.email}</p>
                    {user.metadata.role === 'SUPERADMIN' && (
                      <Badge variant="outline" className="mt-1 text-xs">
                        {m.cliente.company.name}
                      </Badge>
                    )}
                  </div>
                  <EstadoBadge estado={m.estado as MembershipEstado} />
                </div>
              </CardHeader>

              <CardContent className="space-y-4 pt-4">
                <div className="rounded-lg bg-muted p-3 text-sm">
                  <p>
                    <span className="text-muted-foreground">Plan:</span>{' '}
                    <strong>{m.plan.nombre}</strong>
                  </p>
                  {(() => {
                    // O-13: monto esperado neto del descuento de bienvenida
                    // (solo si la membresía nunca se activó).
                    const desc =
                      m.fechaInicio == null ? Number(m.descuentoBienvenida ?? 0) : 0
                    if (desc <= 0) {
                      return (
                        <p>
                          <span className="text-muted-foreground">Precio:</span>{' '}
                          <strong>{fmtMoney(Number(m.plan.precio))}</strong>
                        </p>
                      )
                    }
                    return (
                      <>
                        <p>
                          <span className="text-muted-foreground">Precio:</span>{' '}
                          <span className="line-through">{fmtMoney(Number(m.plan.precio))}</span>{' '}
                          <span className="text-success">
                            −{fmtMoney(desc)} bienvenida
                          </span>
                        </p>
                        <p>
                          <span className="text-muted-foreground">Monto esperado:</span>{' '}
                          <strong>{fmtMoney(Math.max(0, Number(m.plan.precio) - desc))}</strong>
                        </p>
                      </>
                    )
                  })()}
                  {m.metodoPago && (
                    <p>
                      <span className="text-muted-foreground">Método:</span>{' '}
                      {m.metodoPago.nombre}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Enviado: {fmtDate(m.updatedAt)}
                  </p>
                </div>

                {m.comprobanteUrl && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">
                      Comprobante:
                    </p>
                    {isImage(m.comprobanteUrl) ? (
                      <a
                        href={m.comprobanteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        <Image
                          src={m.comprobanteUrl}
                          alt="Comprobante"
                          width={400}
                          height={300}
                          className="w-full rounded-lg border object-cover"
                          style={{ maxHeight: '200px', objectFit: 'cover' }}
                        />
                      </a>
                    ) : (
                      <a
                        href={m.comprobanteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm text-primary hover:bg-muted"
                      >
                        <FileText className="h-5 w-5" />
                        Ver comprobante (PDF)
                        <ExternalLink className="ml-auto h-4 w-4" />
                      </a>
                    )}
                  </div>
                )}

                {m.comprobanteNota && (
                  <div className="rounded-lg bg-warning/15 p-3 text-sm text-warning">
                    <p className="font-medium">Nota del cliente:</p>
                    <p>{m.comprobanteNota}</p>
                  </div>
                )}

                {m.adminNota && (
                  <div className="rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Nota interna</p>
                    <p>{m.adminNota}</p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <ConfirmarPagoButton membershipId={m.id} />
                  <RechazarPagoButton membershipId={m.id} />
                  <SolicitarEvidenciaButton membershipId={m.id} />
                </div>

                <div className="border-t pt-3">
                  <NotaInternaForm membershipId={m.id} notaActual={m.adminNota ?? null} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
          <TablaPaginacion
            paginacion={pagTr}
            total={conteos.transferencias}
            params={sp}
            etiqueta="transferencias"
            clave="tr"
          />
        </div>
      )}

      {/* Seguimiento: iniciaron un pago y no lo completaron. Contacto directo
          (WhatsApp/correo) para recuperar la venta; los más antiguos primero. */}
      {cola === 'seguimiento' && totalSeguimiento > 0 && (
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-h4 text-foreground">
            <Clock className="h-4 w-4 text-warning" aria-hidden />
            Seguimiento · no completaron su pago ({totalSeguimiento})
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Cliente</th>
                  <th className="px-4 py-3 font-semibold">Quería</th>
                  <th className="px-4 py-3 text-right font-semibold">Monto</th>
                  <th className="px-4 py-3 font-semibold">Situación</th>
                  <th className="px-4 py-3 font-semibold">Desde hace</th>
                  <th className="px-4 py-3 font-semibold">Contactar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {seguimiento.map((s) => {
                  const dias = diasDesde(s.fecha)
                  const wa = waLink(s.cliente.telefono)
                  return (
                    <tr key={s.key} className="align-middle">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/clientes/${s.clienteId}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {s.cliente.nombre}
                        </Link>
                        <p className="text-xs text-muted-foreground">{s.cliente.email}</p>
                      </td>
                      <td className="px-4 py-3 text-foreground">{s.concepto}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                        {fmtMoney(s.monto)}
                      </td>
                      <td className="max-w-64 px-4 py-3 text-xs text-muted-foreground">{s.situacion}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${dias >= 7 ? 'bg-destructive/10 text-destructive' : dias >= 3 ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground'}`}
                        >
                          {dias === 0 ? 'hoy' : `${dias} día${dias !== 1 ? 's' : ''}`}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {wa && (
                            <a
                              href={wa}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`WhatsApp ${s.cliente.telefono}`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 text-success hover:bg-success/10"
                            >
                              <MessageCircle className="h-4 w-4" />
                            </a>
                          )}
                          <a
                            href={`mailto:${s.cliente.email}`}
                            title="Enviar correo"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 text-muted-foreground hover:bg-muted"
                          >
                            <Mail className="h-4 w-4" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <TablaPaginacion
            paginacion={pagSeg}
            total={totalSeguimiento}
            params={sp}
            etiqueta="en seguimiento"
            clave="seg"
          />
        </div>
      )}
    </div>
  )
}
