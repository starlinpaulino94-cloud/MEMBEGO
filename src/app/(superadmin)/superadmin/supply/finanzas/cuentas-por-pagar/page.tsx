import Link from 'next/link'
import type { SupplyCuentaEstado } from '@prisma/client'
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
import { listarCuentasPorPagar } from '@/modules/supply/cuentas'
import { opcionesFinanzas } from '@/modules/supply/opciones'
import { crearCuentaManualAction, moverCuentaAction } from '@/modules/supply/actions-finanzas'
import { registrarPagoAction } from '@/modules/supply/actions'
import { CUENTA_VIVA, SUPPLY_CUENTA_ESTADO_LABELS, SUPPLY_CXP_ORIGEN_LABELS } from '@/modules/supply/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cuentas por pagar' }

const BASE = '/superadmin/supply/finanzas/cuentas-por-pagar'

/**
 * MEMBEGO SUPPLY · CUENTAS POR PAGAR (§15).
 *
 * Lo que Membego le debe a cada proveedor, obligación por obligación: una
 * factura, una venta entregada, un ajuste de conciliación. Se salda con un
 * pago directo, con un depósito (desde la ficha del depósito) o dentro de
 * una liquidación; nunca «a mano».
 */
export default async function CuentasPorPagarPage({ searchParams }: { searchParams: Promise<{ estado?: string; proveedor?: string }> }) {
  await requireRole('SUPERADMIN')
  const { estado = '', proveedor = '' } = await searchParams
  const estados = Object.keys(SUPPLY_CUENTA_ESTADO_LABELS) as SupplyCuentaEstado[]
  const estadoValido = estados.includes(estado as SupplyCuentaEstado) ? (estado as SupplyCuentaEstado) : undefined

  const [cuentas, opciones] = await Promise.all([
    listarCuentasPorPagar({ estado: estadoValido, proveedorId: proveedor || undefined }),
    opcionesFinanzas(),
  ])
  const ahora = new Date()
  const vivas = cuentas.filter((c) => CUENTA_VIVA.includes(c.estado))
  const pendiente = vivas.reduce((t, c) => t + Number(c.montoNeto) - Number(c.montoSaldado), 0)
  const vencidas = vivas.filter((c) => c.vencimientoAt && c.vencimientoAt < ahora)
  const acuerdoDe = (proveedorId: string) => opciones.acuerdos.find((a) => a.proveedorId === proveedorId)?.value ?? ''

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cuentas por pagar"
        description="Lo que Membego debe a los proveedores, obligación por obligación. Se saldan con un pago, un depósito o una liquidación; disputar congela, cancelar contrarresta."
        eyebrow={
          <Link href="/superadmin/supply/finanzas" className="hover:underline">
            Finanzas
          </Link>
        }
        nav={<NavFinanzas activa="cuentas-por-pagar" />}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Pendiente" value={formatMoneyRD(pendiente)} sub={`${vivas.length} cuentas vivas`} accent={pendiente > 0 ? 'warning' : undefined} />
        <StatCard label="Vencidas" value={vencidas.length} sub={formatMoneyRD(vencidas.reduce((t, c) => t + Number(c.montoNeto) - Number(c.montoSaldado), 0))} accent={vencidas.length > 0 ? 'danger' : 'success'} />
        <StatCard label="Disputadas" value={cuentas.filter((c) => c.estado === 'DISPUTADA').length} />
        <StatCard label="En liquidación" value={vivas.filter((c) => c.liquidacionId).length} sub="reclamadas por un corte" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FiltrosChips base={BASE} parametro="estado" actual={estadoValido ?? ''} otros={{ proveedor }} opciones={estados.map((e) => ({ value: e, label: SUPPLY_CUENTA_ESTADO_LABELS[e] }))} />
        <FiltroProveedor base={BASE} actual={proveedor} proveedores={opciones.proveedores} otros={{ estado: estadoValido }} />
      </div>

      <Card>
        <CardContent className="pt-6">
          <TablaReporte
            titulo="Cuentas por pagar"
            columnas={[
              { clave: 'codigo', titulo: 'Cuenta' },
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'origen', titulo: 'Origen' },
              { clave: 'descripcion', titulo: 'Descripción' },
              { clave: 'bruto', titulo: 'Bruto', alinearDerecha: true },
              { clave: 'comision', titulo: 'Comisión', alinearDerecha: true },
              { clave: 'neto', titulo: 'Neto', alinearDerecha: true },
              { clave: 'pendiente', titulo: 'Pendiente', alinearDerecha: true },
              { clave: 'vence', titulo: 'Vence' },
              { clave: 'estado', titulo: 'Estado' },
              { clave: 'acciones', titulo: '' },
            ]}
            filas={cuentas.map((c) => {
              const pend = Number(c.montoNeto) - Number(c.montoSaldado)
              const viva = CUENTA_VIVA.includes(c.estado)
              return {
                __clave: c.id,
                codigo: <span className="font-medium">{c.codigo}</span>,
                proveedor: c.proveedor.name,
                origen: SUPPLY_CXP_ORIGEN_LABELS[c.origen],
                descripcion: (
                  <span className="flex flex-col">
                    <span>{c.descripcion}</span>
                    {c.liquidacion && (
                      <Link href={`/superadmin/supply/finanzas/liquidaciones/${c.liquidacionId}`} className="text-caption underline-offset-4 hover:underline">
                        en {c.liquidacion.codigo}
                      </Link>
                    )}
                    {c.disputaMotivo && <span className="text-caption text-destructive">{c.disputaMotivo}</span>}
                  </span>
                ),
                bruto: formatMoneyRD(Number(c.montoBruto)),
                comision: formatMoneyRD(Number(c.comision)),
                neto: formatMoneyRD(Number(c.montoNeto)),
                pendiente: <strong className={pend > 0 && c.vencimientoAt && c.vencimientoAt < ahora ? 'text-destructive' : undefined}>{formatMoneyRD(pend)}</strong>,
                vence: c.vencimientoAt ? formatDate(c.vencimientoAt) : '—',
                estado: (
                  <Badge variant={c.estado === 'SALDADA' ? 'success' : c.estado === 'DISPUTADA' ? 'destructive' : c.estado === 'CANCELADA' ? 'outline' : 'secondary'}>
                    {SUPPLY_CUENTA_ESTADO_LABELS[c.estado]}
                  </Badge>
                ),
                acciones: viva ? (
                  <div className="flex flex-col gap-2">
                    {!c.liquidacionId && (
                      <FormAccion
                        accion={registrarPagoAction}
                        ocultos={{ cuentaPorPagarId: c.id, acuerdoId: c.acuerdo?.id ?? acuerdoDe(c.proveedor.id), tipo: 'LIQUIDACION_FINAL', monto: String(pend) }}
                        compacto
                        variant="secondary"
                        etiqueta="Pagar directo"
                        campos={[{ name: 'referencia', label: 'Referencia', maxLength: 200 }]}
                      />
                    )}
                    <FormAccion
                      accion={moverCuentaAction}
                      ocultos={{ lado: 'CXP', cuentaId: c.id }}
                      compacto
                      variant="ghost"
                      etiqueta="Aplicar"
                      campos={[
                        { name: 'hasta', label: 'Pasar a', tipo: 'select', opciones: [{ value: 'DISPUTADA', label: 'Disputar' }, { value: 'CANCELADA', label: 'Cancelar' }] },
                        { name: 'motivo', label: 'Motivo', required: true, maxLength: 500 },
                      ]}
                    />
                  </div>
                ) : c.estado === 'DISPUTADA' ? (
                  <FormAccion
                    accion={moverCuentaAction}
                    ocultos={{ lado: 'CXP', cuentaId: c.id, hasta: 'ABIERTA' }}
                    compacto
                    variant="ghost"
                    etiqueta="Levantar disputa"
                    campos={[{ name: 'motivo', label: 'Cómo se resolvió', required: true, maxLength: 500 }]}
                  />
                ) : null,
              }
            })}
            vacio="Ninguna cuenta por pagar con ese filtro."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cuenta manual</CardTitle>
        </CardHeader>
        <CardContent>
          <FormAccion
            accion={crearCuentaManualAction}
            etiqueta="Crear cuenta por pagar"
            nota="Para obligaciones que no nacen de un documento: un ajuste acordado, una penalización a favor del proveedor."
            campos={[
              { name: 'proveedorId', label: 'Proveedor', tipo: 'select', opciones: opciones.proveedores, required: true },
              { name: 'acuerdoId', label: 'Acuerdo (opcional)', tipo: 'select', opciones: [{ value: '', label: '—' }, ...opciones.acuerdos] },
              { name: 'origen', label: 'Origen', tipo: 'select', opciones: [{ value: 'AJUSTE', label: 'Ajuste' }, { value: 'MANUAL', label: 'Manual' }] },
              { name: 'monto', label: 'Monto', tipo: 'number', min: 0.01, required: true },
              { name: 'descripcion', label: 'Descripción', required: true, maxLength: 300 },
              { name: 'vencimientoAt', label: 'Vence', tipo: 'date' },
            ]}
            ocultos={{ lado: 'CXP' }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
