import Link from 'next/link'
import type { SupplyFacturaEstado } from '@prisma/client'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatDate, formatMoneyRD } from '@/lib/format'
import { NavFinanzas } from '@/components/supply/nav'
import { FormAccion } from '@/components/supply/form-accion'
import { FiltrosChips, FiltroProveedor } from '@/components/supply/filtros-finanzas'
import { listarFacturas } from '@/modules/supply/facturas'
import { opcionesFinanzas } from '@/modules/supply/opciones'
import { moverFacturaAction, registrarFacturaAction } from '@/modules/supply/actions-finanzas'
import { SUPPLY_FACTURA_ESTADO_LABELS, SUPPLY_FACTURA_TIPO_LABELS } from '@/modules/supply/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Facturas de proveedor' }

const BASE = '/superadmin/supply/finanzas/facturas'

/**
 * MEMBEGO SUPPLY · FACTURAS DE PROVEEDOR (§21).
 *
 * La factura es el DOCUMENTO; la obligación vive en la cuenta por pagar que
 * nace con ella (o por cobrar, si es nota de crédito). Se salda con un pago
 * directo, con un depósito o dentro de una liquidación; y su estado refleja
 * el de la cuenta.
 */
export default async function FacturasPage({ searchParams }: { searchParams: Promise<{ estado?: string; proveedor?: string }> }) {
  await requireRole('SUPERADMIN')
  const { estado = '', proveedor = '' } = await searchParams
  const estados = Object.keys(SUPPLY_FACTURA_ESTADO_LABELS) as SupplyFacturaEstado[]
  const estadoValido = estados.includes(estado as SupplyFacturaEstado) ? (estado as SupplyFacturaEstado) : undefined

  const [facturas, opciones] = await Promise.all([
    listarFacturas({ estado: estadoValido, proveedorId: proveedor || undefined }),
    opcionesFinanzas(),
  ])
  const abiertas = facturas.filter((f) => f.estado === 'REGISTRADA' || f.estado === 'PARCIALMENTE_PAGADA')
  const pendiente = abiertas.reduce((t, f) => t + Number(f.total) - Number(f.montoSaldado), 0)
  const vencidas = abiertas.filter((f) => f.fechaVencimiento && f.fechaVencimiento < new Date())

  return (
    <div className="space-y-6">
      <PageHeader
        title="Facturas de proveedor"
        description="Facturas, notas de crédito y notas de débito que emiten los proveedores. Cada una abre su cuenta; la cuenta es lo que se salda."
        eyebrow={
          <Link href="/superadmin/supply/finanzas" className="hover:underline">
            Finanzas
          </Link>
        }
        nav={<NavFinanzas activa="facturas" />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Pendiente de pago" value={formatMoneyRD(pendiente)} sub={`${abiertas.length} facturas abiertas`} accent={pendiente > 0 ? 'warning' : undefined} />
        <StatCard label="Vencidas" value={vencidas.length} sub={formatMoneyRD(vencidas.reduce((t, f) => t + Number(f.total) - Number(f.montoSaldado), 0))} accent={vencidas.length > 0 ? 'danger' : 'success'} />
        <StatCard label="Disputadas" value={facturas.filter((f) => f.estado === 'DISPUTADA').length} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registrar un documento</CardTitle>
        </CardHeader>
        <CardContent>
          {opciones.proveedores.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay proveedores registrados.</p>
          ) : (
            <FormAccion
              accion={registrarFacturaAction}
              etiqueta="Registrar"
              etiquetaPendiente="Registrando…"
              nota="Una factura abre una cuenta por pagar por su total; una nota de crédito, una cuenta por cobrar."
              campos={[
                { name: 'proveedorId', label: 'Proveedor', tipo: 'select', opciones: opciones.proveedores, required: true },
                { name: 'acuerdoId', label: 'Acuerdo (opcional)', tipo: 'select', opciones: [{ value: '', label: '—' }, ...opciones.acuerdos] },
                { name: 'tipo', label: 'Tipo', tipo: 'select', opciones: Object.entries(SUPPLY_FACTURA_TIPO_LABELS).map(([value, label]) => ({ value, label })) },
                { name: 'numero', label: 'Número (NCF / del proveedor)', required: true, maxLength: 60 },
                { name: 'fechaEmision', label: 'Emitida', tipo: 'date', required: true },
                { name: 'fechaVencimiento', label: 'Vence', tipo: 'date' },
                { name: 'subtotal', label: 'Subtotal', tipo: 'number', min: 0, required: true },
                { name: 'impuestos', label: 'Impuestos', tipo: 'number', min: 0 },
                { name: 'documentoPath', label: 'Documento (ruta)', maxLength: 500 },
                { name: 'notas', label: 'Notas', tipo: 'textarea' },
              ]}
            />
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FiltrosChips base={BASE} parametro="estado" actual={estadoValido ?? ''} otros={{ proveedor }} opciones={estados.map((e) => ({ value: e, label: SUPPLY_FACTURA_ESTADO_LABELS[e] }))} />
        <FiltroProveedor base={BASE} actual={proveedor} proveedores={opciones.proveedores} otros={{ estado: estadoValido }} />
      </div>

      <Card>
        <CardContent className="pt-6">
          <TablaReporte
            titulo="Facturas de proveedor"
            columnas={[
              { clave: 'codigo', titulo: 'Código' },
              { clave: 'numero', titulo: 'Número' },
              { clave: 'tipo', titulo: 'Tipo' },
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'emitida', titulo: 'Emitida' },
              { clave: 'vence', titulo: 'Vence' },
              { clave: 'total', titulo: 'Total', alinearDerecha: true },
              { clave: 'saldado', titulo: 'Saldado', alinearDerecha: true },
              { clave: 'cuenta', titulo: 'Cuenta' },
              { clave: 'estado', titulo: 'Estado' },
              { clave: 'acciones', titulo: '' },
            ]}
            filas={facturas.map((f) => ({
              __clave: f.id,
              codigo: <span className="font-medium">{f.codigo}</span>,
              numero: f.documentoPath ? (
                <a href={f.documentoPath} target="_blank" rel="noreferrer" className="underline">
                  {f.numero}
                </a>
              ) : (
                f.numero
              ),
              tipo: SUPPLY_FACTURA_TIPO_LABELS[f.tipo],
              proveedor: f.proveedor.name,
              emitida: formatDate(f.fechaEmision),
              vence: f.fechaVencimiento ? formatDate(f.fechaVencimiento) : '—',
              total: formatMoneyRD(Number(f.total)),
              saldado: formatMoneyRD(Number(f.montoSaldado)),
              cuenta: f.cuentaPorPagar ? (
                <Link href={`/superadmin/supply/finanzas/cuentas-por-pagar?proveedor=${f.proveedor.id}`} className="underline-offset-4 hover:underline">
                  {f.cuentaPorPagar.codigo}
                </Link>
              ) : f.cuentaPorCobrar ? (
                <Link href={`/superadmin/supply/finanzas/cuentas-por-cobrar?proveedor=${f.proveedor.id}`} className="underline-offset-4 hover:underline">
                  {f.cuentaPorCobrar.codigo}
                </Link>
              ) : (
                '—'
              ),
              estado: (
                <Badge variant={f.estado === 'PAGADA' ? 'success' : f.estado === 'DISPUTADA' ? 'destructive' : f.estado === 'ANULADA' ? 'outline' : 'secondary'}>
                  {SUPPLY_FACTURA_ESTADO_LABELS[f.estado]}
                </Badge>
              ),
              acciones:
                f.estado === 'REGISTRADA' || f.estado === 'PARCIALMENTE_PAGADA' ? (
                  <FormAccion
                    accion={moverFacturaAction}
                    ocultos={{ facturaId: f.id }}
                    compacto
                    variant="ghost"
                    etiqueta="Aplicar"
                    campos={[
                      { name: 'hasta', label: 'Pasar a', tipo: 'select', opciones: [{ value: 'DISPUTADA', label: 'Disputar' }, { value: 'ANULADA', label: 'Anular' }] },
                      { name: 'motivo', label: 'Motivo', required: true, maxLength: 500 },
                    ]}
                  />
                ) : f.estado === 'DISPUTADA' ? (
                  <FormAccion
                    accion={moverFacturaAction}
                    ocultos={{ facturaId: f.id, hasta: 'REGISTRADA' }}
                    compacto
                    variant="ghost"
                    etiqueta="Levantar disputa"
                    campos={[{ name: 'motivo', label: 'Cómo se resolvió', required: true, maxLength: 500 }]}
                  />
                ) : null,
            }))}
            vacio="Ninguna factura con ese filtro."
          />
        </CardContent>
      </Card>
    </div>
  )
}
