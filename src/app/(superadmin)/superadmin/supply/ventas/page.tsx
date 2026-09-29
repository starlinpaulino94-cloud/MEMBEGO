import Link from 'next/link'
import type { SupplyVentaEstado } from '@prisma/client'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatDate, formatMoneyRD } from '@/lib/format'
import { NavSupply } from '@/components/supply/nav'
import { FormAccion } from '@/components/supply/form-accion'
import { FiltrosChips, FiltroProveedor } from '@/components/supply/filtros-finanzas'
import { listarVentas } from '@/modules/supply/ventas'
import { opcionesFinanzas } from '@/modules/supply/opciones'
import { cerrarVentaAction } from '@/modules/supply/actions-ventas'
import { SUPPLY_VENTA_ESTADO_LABELS } from '@/modules/supply/catalogo'
import { varianteVenta } from '@/components/supply/variantes'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ventas sin precompra' }

const BASE = '/superadmin/supply/ventas'

/**
 * MEMBEGO SUPPLY · VENTAS SIN PRECOMPRA (§14).
 *
 * Membego vende, el proveedor entrega, Membego le debe el neto. No hay lote
 * ni cubetas: la venta nace de un acuerdo a comisión, el cliente paga a
 * Membego, el comercio confirma la entrega con el código y en ese momento
 * nace la cuenta por pagar por bruto menos comisión.
 */
export default async function VentasPage({ searchParams }: { searchParams: Promise<{ estado?: string; proveedor?: string }> }) {
  await requireRole('SUPERADMIN')
  const { estado = '', proveedor = '' } = await searchParams
  const estados = Object.keys(SUPPLY_VENTA_ESTADO_LABELS) as SupplyVentaEstado[]
  const estadoValido = estados.includes(estado as SupplyVentaEstado) ? (estado as SupplyVentaEstado) : undefined

  const [ventas, opciones] = await Promise.all([
    listarVentas({ estado: estadoValido, proveedorId: proveedor || undefined }),
    opcionesFinanzas(),
  ])
  const entregadas = ventas.filter((v) => v.estado === 'ENTREGADA')
  const pagadasSinEntregar = ventas.filter((v) => v.estado === 'PAGADA')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ventas sin precompra"
        description="Membego vende a comisión, el proveedor entrega y Membego le liquida el neto. Ningún lote se mueve: la obligación nace al confirmar la entrega."
        eyebrow={
          <Link href="/superadmin/supply" className="hover:underline">
            Membego Supply
          </Link>
        }
        nav={<NavSupply activa="ventas" />}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Vendido (bruto)" value={formatMoneyRD(ventas.filter((v) => v.estado === 'PAGADA' || v.estado === 'ENTREGADA').reduce((t, v) => t + Number(v.montoBruto), 0))} sub={`${ventas.length} ventas en el filtro`} />
        <StatCard label="Comisión Membego" value={formatMoneyRD(entregadas.reduce((t, v) => t + Number(v.comisionMonto), 0))} sub="sobre lo entregado" accent="success" />
        <StatCard label="Debido a proveedores" value={formatMoneyRD(entregadas.reduce((t, v) => t + Number(v.montoProveedor), 0))} sub={`${entregadas.length} entregas`} />
        <StatCard label="Pagadas sin entregar" value={pagadasSinEntregar.length} sub="el cliente espera su producto" accent={pagadasSinEntregar.length > 0 ? 'warning' : undefined} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FiltrosChips base={BASE} parametro="estado" actual={estadoValido ?? ''} otros={{ proveedor }} opciones={estados.map((e) => ({ value: e, label: SUPPLY_VENTA_ESTADO_LABELS[e] }))} />
        <FiltroProveedor base={BASE} actual={proveedor} proveedores={opciones.proveedores} otros={{ estado: estadoValido }} />
      </div>

      <Card>
        <CardContent className="pt-6">
          <TablaReporte
            titulo="Ventas sin precompra"
            columnas={[
              { clave: 'numero', titulo: 'Venta' },
              { clave: 'cliente', titulo: 'Cliente' },
              { clave: 'producto', titulo: 'Producto' },
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'bruto', titulo: 'Bruto', alinearDerecha: true },
              { clave: 'comision', titulo: 'Comisión', alinearDerecha: true },
              { clave: 'neto', titulo: 'Al proveedor', alinearDerecha: true },
              { clave: 'pedido', titulo: 'Cobro' },
              { clave: 'entrega', titulo: 'Entrega' },
              { clave: 'cxp', titulo: 'CxP' },
              { clave: 'estado', titulo: 'Estado' },
              { clave: 'acciones', titulo: '' },
            ]}
            filas={ventas.map((v) => ({
              __clave: v.id,
              numero: <span className="font-medium">{v.numero}</span>,
              cliente: v.cliente.nombre,
              producto: `${v.itemNombre} × ${v.cantidad}`,
              proveedor: (
                <Link href={`/superadmin/supply/proveedores/${v.proveedor.id}`} className="underline-offset-4 hover:underline">
                  {v.proveedor.name}
                </Link>
              ),
              bruto: formatMoneyRD(Number(v.montoBruto)),
              comision: formatMoneyRD(Number(v.comisionMonto)),
              neto: formatMoneyRD(Number(v.montoProveedor)),
              pedido: v.pedido ? `${v.pedido.numero} · ${v.pedido.estado}` : '—',
              entrega: v.entregadaAt ? `${formatDate(v.entregadaAt)}${v.sucursal ? ` · ${v.sucursal.nombre}` : ''}${v.entregadaPor ? ` · ${v.entregadaPor.name}` : ''}` : '—',
              cxp: v.cuentaPorPagar ? (
                <Link href={`/superadmin/supply/finanzas/cuentas-por-pagar?proveedor=${v.proveedor.id}`} className="underline-offset-4 hover:underline">
                  {v.cuentaPorPagar.codigo}
                </Link>
              ) : (
                '—'
              ),
              estado: (
                <span className="flex flex-col gap-1">
                  <Badge variant={varianteVenta(v.estado)}>{SUPPLY_VENTA_ESTADO_LABELS[v.estado]}</Badge>
                  {v.canceladaMotivo && <span className="text-caption text-muted-foreground">{v.canceladaMotivo}</span>}
                </span>
              ),
              acciones:
                v.estado === 'INICIADA' || v.estado === 'PAGADA' || v.estado === 'ENTREGADA' ? (
                  <FormAccion
                    accion={cerrarVentaAction}
                    ocultos={{ ventaId: v.id }}
                    compacto
                    variant="ghost"
                    etiqueta="Aplicar"
                    confirmar="Cerrar la venta cancela su cuenta por pagar si sigue viva. ¿Continuar?"
                    campos={[
                      { name: 'hasta', label: 'Pasar a', tipo: 'select', opciones: [{ value: 'CANCELADA', label: 'Cancelar' }, { value: 'REEMBOLSADA', label: 'Reembolsar' }] },
                      { name: 'motivo', label: 'Motivo', required: true, maxLength: 500 },
                    ]}
                  />
                ) : null,
            }))}
            vacio="Ninguna venta con ese filtro. Las ventas nacen cuando un cliente compra una oferta a comisión desde la vitrina."
          />
        </CardContent>
      </Card>
    </div>
  )
}
