import Link from 'next/link'
import { Gift } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { misClienteIds } from '@/modules/cliente/afiliacion'
import { sinEmpresa } from '@/lib/tenant'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { beneficiosDelCliente } from '@/modules/supply/pool'
import { TarjetaBeneficio } from '@/components/supply/tarjeta-beneficio'
import { MisPedidos } from '@/components/supply/mis-pedidos'
import { MisVentas } from '@/components/supply/mis-ventas'
import { ventasDelCliente } from '@/modules/supply/ventas'
import { cuentasDeCobro, pedidosDelCliente } from '@/modules/supply/cobro'
import type { EstadoPedido } from '@/modules/supply/cobro-nucleo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Beneficios Membego' }

/**
 * MEMBEGO SUPPLY · MIS BENEFICIOS (Fase 16).
 *
 * Lo que Membego compró y le entregó a esta persona, en toda la red. No es «mis
 * promociones» —eso es lo que compró ella misma en una empresa concreta—: son
 * unidades que Membego ya pagó y que un comercio está obligado a entregarle.
 *
 * Lo que el cliente NO ve, nunca: el costo de la unidad, el contrato, el lote y
 * lo que Membego le liquida al proveedor. Ve su beneficio, dónde vale, hasta
 * cuándo y cómo usarlo (Fase 55).
 */
export default async function BeneficiosPage() {
  const user = await requireRole('CLIENTE')
  const clienteIds = await misClienteIds(user.supabaseId)

  const [beneficios, sucursalesPorProveedor] = await Promise.all([
    beneficiosDelCliente(clienteIds),
    sinEmpresa('Membego Supply: sucursales donde el cliente puede canjear', async (tx) => {
      const sucursales = await tx.sucursal.findMany({
        where: { activa: true },
        select: { id: true, nombre: true, direccion: true, companyId: true },
      })
      const mapa = new Map<string, { id: string; nombre: string; direccion: string | null }[]>()
      for (const s of sucursales) {
        const lista = mapa.get(s.companyId) ?? []
        lista.push({ id: s.id, nombre: s.nombre, direccion: s.direccion })
        mapa.set(s.companyId, lista)
      }
      return mapa
    }).catch(() => new Map<string, { id: string; nombre: string; direccion: string | null }[]>()),
  ])

  // El `clienteId` del derecho es el de la empresa que lo cumple; para abrir el
  // QR hay que mandar el mismo con el que se emitió, así que se resuelve aquí.
  const derechos = await sinEmpresa('Membego Supply: titulares de los beneficios', (tx) =>
    tx.supplyDerecho.findMany({
      where: { clienteId: { in: clienteIds }, estado: 'ACTIVO' },
      select: { id: true, clienteId: true, proveedorId: true },
    })
  ).catch(() => [])
  const titular = new Map(derechos.map((d) => [d.id, d]))

  // Los pedidos vivos y las cuentas a las que transferir. Van juntos porque de
  // nada sirve decirle a alguien que debe transferir si no se le dice adónde.
  // `.catch` en los dos: un fallo leyendo pedidos no puede dejar sin ver los
  // beneficios que la persona YA tiene, que es para lo que abrió la pantalla.
  const [pedidos, cuentas, ventas] = await Promise.all([
    clienteIds.length > 0 ? pedidosDelCliente(clienteIds[0]!, 20).catch(() => []) : [],
    cuentasDeCobro().catch(() => []),
    ventasDelCliente(clienteIds, 20).catch(() => []),
  ])
  const pedidosVivos = pedidos.filter(
    (p) => p.estado === 'INICIADO' || p.estado === 'EN_REVISION' || p.estado === 'RECHAZADO'
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Beneficios Membego"
        description="Lo que Membego ya pagó por ti. Enséñalo en el negocio y te lo entregan."
        action={
          <Link
            href="/cliente/beneficios/disponibles"
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Ver disponibles
          </Link>
        }
      />

      <MisPedidos
        pedidos={pedidosVivos.map((p) => ({
          id: p.id,
          numero: p.numero,
          estado: p.estado as EstadoPedido,
          producto: p.derecho?.lote.snapshotItemNombre ?? p.venta?.itemNombre ?? '—',
          monto: Number(p.monto),
          motivoRechazo: p.motivoRechazo,
          expiraAt: p.expiraAt.toISOString(),
        }))}
        cuentas={cuentas}
        clienteId={clienteIds[0] ?? ''}
      />

      <MisVentas
        ventas={ventas
          .filter((v) => v.estado === 'PAGADA' || v.estado === 'ENTREGADA' || v.estado === 'INICIADA')
          .map((v) => ({
            id: v.id,
            numero: v.numero,
            estado: v.estado,
            producto: v.varianteEtiqueta ? `${v.itemNombre} · ${v.varianteEtiqueta}` : v.itemNombre,
            cantidad: v.cantidad,
            proveedor: v.proveedor.name,
            sucursal: v.sucursal?.nombre ?? null,
            montoBruto: Number(v.montoBruto),
            codigoEntrega: v.estado === 'PAGADA' ? v.codigoEntrega : null,
            entregadaAt: v.entregadaAt?.toISOString() ?? null,
          }))}
      />

      {beneficios.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<Gift className="size-6" />}
          title="Todavía no tienes beneficios de Membego"
          description="Cuando participes en una campaña, invites a un amigo o consigas una recompensa, tus beneficios aparecen aquí listos para usar."
          action={
            <Link
              href="/cliente/beneficios/disponibles"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Ver lo que hay disponible
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {beneficios.map((b) => {
            const info = titular.get(b.derechoId)
            const todas = info ? (sucursalesPorProveedor.get(info.proveedorId) ?? []) : []
            // Lista vacía en el lote = vale en TODAS las del proveedor.
            const sucursales =
              b.sucursalIds.length > 0 ? todas.filter((s) => b.sucursalIds.includes(s.id)) : todas
            return (
              <TarjetaBeneficio
                key={b.derechoId}
                beneficio={b}
                clienteId={info?.clienteId ?? ''}
                sucursales={sucursales}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
