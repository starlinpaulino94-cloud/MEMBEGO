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
import { listarCuentasPorCobrar } from '@/modules/supply/cuentas'
import { opcionesFinanzas } from '@/modules/supply/opciones'
import { crearCuentaManualAction, moverCuentaAction } from '@/modules/supply/actions-finanzas'
import { CUENTA_VIVA, SUPPLY_CUENTA_ESTADO_LABELS, SUPPLY_CXC_ORIGEN_LABELS } from '@/modules/supply/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cuentas por cobrar' }

const BASE = '/superadmin/supply/finanzas/cuentas-por-cobrar'

/**
 * MEMBEGO SUPPLY · CUENTAS POR COBRAR (§16).
 *
 * Lo que un proveedor le debe a Membego: un reembolso, una nota de crédito,
 * una penalización, una diferencia de conciliación. Se netean en la siguiente
 * liquidación del proveedor; si el neto sale negativo, es él quien paga.
 */
export default async function CuentasPorCobrarPage({ searchParams }: { searchParams: Promise<{ estado?: string; proveedor?: string }> }) {
  await requireRole('SUPERADMIN')
  const { estado = '', proveedor = '' } = await searchParams
  const estados = Object.keys(SUPPLY_CUENTA_ESTADO_LABELS) as SupplyCuentaEstado[]
  const estadoValido = estados.includes(estado as SupplyCuentaEstado) ? (estado as SupplyCuentaEstado) : undefined

  const [cuentas, opciones] = await Promise.all([
    listarCuentasPorCobrar({ estado: estadoValido, proveedorId: proveedor || undefined }),
    opcionesFinanzas(),
  ])
  const ahora = new Date()
  const vivas = cuentas.filter((c) => CUENTA_VIVA.includes(c.estado))
  const pendiente = vivas.reduce((t, c) => t + Number(c.montoNeto) - Number(c.montoSaldado), 0)
  const vencidas = vivas.filter((c) => c.vencimientoAt && c.vencimientoAt < ahora)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cuentas por cobrar"
        description="Lo que los proveedores le deben a Membego. Se netean en su siguiente liquidación; si el neto queda a favor de Membego, el proveedor paga."
        eyebrow={
          <Link href="/superadmin/supply/finanzas" className="hover:underline">
            Finanzas
          </Link>
        }
        nav={<NavFinanzas activa="cuentas-por-cobrar" />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Por cobrar" value={formatMoneyRD(pendiente)} sub={`${vivas.length} cuentas vivas`} accent={pendiente > 0 ? 'brand' : undefined} />
        <StatCard label="Vencidas" value={vencidas.length} accent={vencidas.length > 0 ? 'warning' : 'success'} />
        <StatCard label="Disputadas" value={cuentas.filter((c) => c.estado === 'DISPUTADA').length} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FiltrosChips base={BASE} parametro="estado" actual={estadoValido ?? ''} otros={{ proveedor }} opciones={estados.map((e) => ({ value: e, label: SUPPLY_CUENTA_ESTADO_LABELS[e] }))} />
        <FiltroProveedor base={BASE} actual={proveedor} proveedores={opciones.proveedores} otros={{ estado: estadoValido }} />
      </div>

      <Card>
        <CardContent className="pt-6">
          <TablaReporte
            titulo="Cuentas por cobrar"
            columnas={[
              { clave: 'codigo', titulo: 'Cuenta' },
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'origen', titulo: 'Origen' },
              { clave: 'descripcion', titulo: 'Descripción' },
              { clave: 'monto', titulo: 'Monto', alinearDerecha: true },
              { clave: 'pendiente', titulo: 'Pendiente', alinearDerecha: true },
              { clave: 'vence', titulo: 'Vence' },
              { clave: 'estado', titulo: 'Estado' },
              { clave: 'acciones', titulo: '' },
            ]}
            filas={cuentas.map((c) => {
              const pend = Number(c.montoNeto) - Number(c.montoSaldado)
              return {
                __clave: c.id,
                codigo: <span className="font-medium">{c.codigo}</span>,
                proveedor: c.proveedor.name,
                origen: SUPPLY_CXC_ORIGEN_LABELS[c.origen],
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
                monto: formatMoneyRD(Number(c.montoNeto)),
                pendiente: <strong>{formatMoneyRD(pend)}</strong>,
                vence: c.vencimientoAt ? formatDate(c.vencimientoAt) : '—',
                estado: (
                  <Badge variant={c.estado === 'SALDADA' ? 'success' : c.estado === 'DISPUTADA' ? 'destructive' : c.estado === 'CANCELADA' ? 'outline' : 'secondary'}>
                    {SUPPLY_CUENTA_ESTADO_LABELS[c.estado]}
                  </Badge>
                ),
                acciones: CUENTA_VIVA.includes(c.estado) ? (
                  <FormAccion
                    accion={moverCuentaAction}
                    ocultos={{ lado: 'CXC', cuentaId: c.id }}
                    compacto
                    variant="ghost"
                    etiqueta="Aplicar"
                    campos={[
                      { name: 'hasta', label: 'Pasar a', tipo: 'select', opciones: [{ value: 'DISPUTADA', label: 'Disputar' }, { value: 'CANCELADA', label: 'Cancelar' }] },
                      { name: 'motivo', label: 'Motivo', required: true, maxLength: 500 },
                    ]}
                  />
                ) : c.estado === 'DISPUTADA' ? (
                  <FormAccion
                    accion={moverCuentaAction}
                    ocultos={{ lado: 'CXC', cuentaId: c.id, hasta: 'ABIERTA' }}
                    compacto
                    variant="ghost"
                    etiqueta="Levantar disputa"
                    campos={[{ name: 'motivo', label: 'Cómo se resolvió', required: true, maxLength: 500 }]}
                  />
                ) : null,
              }
            })}
            vacio="Ninguna cuenta por cobrar con ese filtro."
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
            etiqueta="Crear cuenta por cobrar"
            nota="Una penalización, un cargo o un reembolso acordado que el proveedor le debe a Membego."
            campos={[
              { name: 'proveedorId', label: 'Proveedor', tipo: 'select', opciones: opciones.proveedores, required: true },
              { name: 'acuerdoId', label: 'Acuerdo (opcional)', tipo: 'select', opciones: [{ value: '', label: '—' }, ...opciones.acuerdos] },
              { name: 'origen', label: 'Origen', tipo: 'select', opciones: Object.entries(SUPPLY_CXC_ORIGEN_LABELS).map(([value, label]) => ({ value, label })) },
              { name: 'monto', label: 'Monto', tipo: 'number', min: 0.01, required: true },
              { name: 'descripcion', label: 'Descripción', required: true, maxLength: 300 },
              { name: 'vencimientoAt', label: 'Vence', tipo: 'date' },
            ]}
            ocultos={{ lado: 'CXC' }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
