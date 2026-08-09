import { requireRole } from '@/lib/auth/guards'
import { SCANNER_ROLES } from '@/types'
import { prisma } from '@/lib/prisma'
import {
  buscarOrdenesPendientes,
  getResumenSesion,
  getSucursalesActivas,
  getCierresRecientes,
  getMovimientosSesion,
} from '@/modules/caja/queries'
import { CierreCajaDialog } from '@/components/caja/CierreCajaDialog'
import { ReporteDiaDialog } from '@/components/caja/ReporteDiaDialog'
import { MovimientosCaja } from '@/components/caja/MovimientosCaja'
import {
  AbrirCajaForm,
  BuscadorOrdenes,
  CerrarCajaForm,
  OrdenCobroCard,
} from '@/components/caja/CajaForms'
import { FacturaPrintDialog } from '@/components/facturas/FacturaPrintDialog'
import { ensureSucursalPrincipal } from '@/modules/empresas/sucursalPrincipal'
import { Banknote, Clock, Store, User as UserIcon } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Caja' }

const fmtHora = (d: Date) =>
  new Intl.DateTimeFormat('es-DO', {
    timeZone: 'America/Santo_Domingo',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)

const fmtRD = (n: number) =>
  `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`

const fmtFechaCorta = (d: Date) =>
  new Intl.DateTimeFormat('es-DO', {
    timeZone: 'America/Santo_Domingo',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)

/**
 * Caja (POS) de la sucursal: abrir/cerrar turno, buscar órdenes pendientes y
 * cobrarlas en pocos pasos. Sin caja abierta no se puede cobrar.
 */
export default async function CajaPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const user = await requireRole(SCANNER_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  if (!companyId) {
    return (
      <main className="container max-w-2xl py-8">
        <p className="text-muted-foreground">Tu usuario no está vinculado a una empresa.</p>
      </main>
    )
  }

  // E4: si el superadmin apagó la capacidad POS_CAJA para esta empresa, la
  // caja no está disponible (las acciones también lo rechazan en servidor).
  const { tieneCapacidad } = await import('@/modules/capacidades/resolver')
  if (!(await tieneCapacidad(companyId, 'POS_CAJA'))) {
    return (
      <main className="container max-w-2xl py-8">
        <p className="text-muted-foreground">
          La caja no está activada para este negocio. Si crees que es un error,
          contacta al administrador.
        </p>
      </main>
    )
  }

  const { q = '' } = await searchParams
  let sucursales = await getSucursalesActivas(companyId)

  // Self-heal para empresas creadas antes de la sucursal automática: sin
  // sucursal la caja no puede abrir, así que se crea la principal con los
  // datos de la empresa la primera vez que el staff entra aquí.
  if (sucursales.length === 0) {
    await ensureSucursalPrincipal(companyId)
    sucursales = await getSucursalesActivas(companyId)
  }

  // Cierres recientes para imprimir/reimprimir (Control de comprobantes · F2).
  const cierres = await getCierresRecientes(companyId).catch(() => [])
  const cierresRecientes =
    cierres.length === 0 ? null : (
      <section className="rounded-3xl border border-border/70 bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Cierres recientes</h2>
        <ul className="divide-y divide-border/60">
          {cierres.map((c) => {
            const dif = c.diferencia ?? 0
            const difLabel =
              c.diferencia == null
                ? ''
                : dif === 0
                  ? 'Cuadrada'
                  : dif > 0
                    ? `Sobrante ${fmtRD(dif)}`
                    : `Faltante ${fmtRD(Math.abs(dif))}`
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {c.sucursal}
                    {c.turno ? ` · ${c.turno}` : ''}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {c.cerradaAt ? fmtFechaCorta(c.cerradaAt) : '—'}
                    {c.cerradaPor ? ` · ${c.cerradaPor}` : ''}
                    {difLabel ? ` · ${difLabel}` : ''}
                  </p>
                </div>
                <CierreCajaDialog cajaSesionId={c.id} />
              </li>
            )
          })}
        </ul>
      </section>
    )

  // Sesión abierta de la empresa (la primera entre sus sucursales).
  const sesion = await prisma.cajaSesion.findFirst({
    where: { companyId, estado: 'ABIERTA' },
    include: {
      sucursal: { select: { nombre: true } },
      abiertaPor: { select: { name: true } },
    },
    orderBy: { abiertaAt: 'desc' },
  })

  if (!sesion) {
    return (
      <main className="container max-w-lg py-8">
        <header className="mb-6">
          <h1 className="text-h2 text-foreground">Caja</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Abre la caja de tu sucursal para empezar a cobrar.
          </p>
        </header>
        {sucursales.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-6 text-sm text-muted-foreground">
            Tu empresa aún no tiene sucursales activas. Pídele al administrador
            que cree una en Admin → Sucursales.
          </p>
        ) : (
          <div className="rounded-3xl border border-border/70 bg-card p-6 shadow-card">
            <AbrirCajaForm sucursales={sucursales} />
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <ReporteDiaDialog />
        </div>
        {cierresRecientes && <div className="mt-6">{cierresRecientes}</div>}
      </main>
    )
  }

  const [resumen, ordenes, movimientos] = await Promise.all([
    getResumenSesion(sesion.id),
    buscarOrdenesPendientes(companyId, q),
    getMovimientosSesion(sesion.id),
  ])
  const esperado = Number(sesion.balanceInicial) + resumen.totalEfectivo + movimientos.neto

  return (
    <main className="container max-w-3xl space-y-6 py-8">
      {/* Estado de la caja */}
      <header className="rounded-3xl border border-success/25 bg-success/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-success">
              <span className="h-2 w-2 animate-pulse rounded-full bg-success" /> Caja abierta
            </p>
            <h1 className="mt-1 flex items-center gap-2 text-h3 text-foreground">
              <Store className="h-5 w-5 text-muted-foreground" aria-hidden />
              {sesion.sucursal.nombre}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <UserIcon className="h-3 w-3" /> {sesion.abiertaPor.name}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" /> desde las {fmtHora(sesion.abiertaAt)}
              </span>
              {sesion.turno && <span>Turno: {sesion.turno}</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-caption text-muted-foreground">Efectivo en caja (esperado)</p>
            <p className="text-h2 tabular-nums text-foreground">{fmtRD(esperado)}</p>
          </div>
        </div>

        {/* Ventas del turno */}
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Cobros', valor: String(resumen.cobros) },
            { label: 'Efectivo', valor: fmtRD(resumen.totalEfectivo) },
            { label: 'Transferencia', valor: fmtRD(resumen.totalTransferencia) },
            { label: 'Total del turno', valor: fmtRD(resumen.total) },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl bg-card/70 p-3">
              <dt className="text-caption text-muted-foreground">{s.label}</dt>
              <dd className="mt-0.5 truncate text-sm font-bold tabular-nums text-foreground">
                {s.valor}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      {/* Herramientas del turno: cuadre del día del empleado (incluye
          transferencias confirmadas en el panel, fuera de la caja). */}
      <div className="flex flex-wrap justify-end gap-2">
        <ReporteDiaDialog />
      </div>

      {/* Movimientos de efectivo intra-turno (fondo, retiros, gastos). */}
      <MovimientosCaja cajaSesionId={sesion.id} movimientos={movimientos} />

      {/* Cobrar */}
      <section className="space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-h2 text-foreground">
            <Banknote className="h-5 w-5 text-primary" aria-hidden /> Cobrar una orden
          </h2>
          <p className="text-sm text-muted-foreground">
            Busca por la referencia que muestra el cliente, o por su nombre,
            teléfono o correo.
          </p>
        </div>

        <BuscadorOrdenes q={q} />

        {ordenes.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            {q
              ? `Sin órdenes pendientes para “${q}”.`
              : 'No hay órdenes pendientes de pago ahora mismo.'}
          </p>
        ) : (
          <div className="space-y-3">
            {ordenes.map((o) => (
              <OrdenCobroCard key={`${o.tipo}-${o.id}`} orden={o} cajaSesionId={sesion.id} />
            ))}
          </div>
        )}
      </section>

      {/* Últimos cobros del turno · cada cobro imprime su comprobante aquí
          mismo (58/80 mm, Carta o A4), sin pasar por el panel admin. */}
      {resumen.ultimos.length > 0 && (
        <section className="rounded-3xl border border-border/70 bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Últimos cobros del turno</h2>
          <div className="divide-y divide-border/50">
            {resumen.ultimos.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{c.clienteNombre}</p>
                  <p className="truncate text-caption text-muted-foreground">
                    {c.detalle} · <code className="font-mono">{c.codigo}</code>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <p className="font-semibold tabular-nums text-foreground">{fmtRD(c.monto)}</p>
                    <p className="text-overline text-muted-foreground">
                      {c.metodoCobro ?? ''} · {fmtHora(c.createdAt)}
                    </p>
                  </div>
                  <FacturaPrintDialog
                    transactionId={c.id}
                    yaImpresa={c.impresa}
                    triggerLabel={c.impresa ? 'Reimprimir' : 'Imprimir'}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Cierre */}
      <CerrarCajaForm cajaSesionId={sesion.id} esperado={esperado} />

      {cierresRecientes}
    </main>
  )
}
