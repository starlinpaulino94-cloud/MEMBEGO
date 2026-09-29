import Link from 'next/link'
import type { SupplyDepositoEstado } from '@prisma/client'
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
import { listarDepositos } from '@/modules/supply/depositos'
import { opcionesFinanzas } from '@/modules/supply/opciones'
import { registrarDepositoAction } from '@/modules/supply/actions-finanzas'
import { DEPOSITO_VIVO, SUPPLY_DEPOSITO_ESTADO_LABELS } from '@/modules/supply/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Depósitos a proveedores' }

const BASE = '/superadmin/supply/finanzas/depositos'

/**
 * MEMBEGO SUPPLY · DEPÓSITOS (Modelo B, §2 del encargo).
 *
 * Un depósito es dinero entregado al proveedor a cuenta de consumo futuro,
 * SIN precomprar unidades. Tiene saldo original, aplicado, devuelto y
 * disponible; cada aplicación a una factura o cuenta por pagar queda en su
 * propio movimiento. Pagar una factura por fuera no toca el depósito.
 */
export default async function DepositosPage({ searchParams }: { searchParams: Promise<{ estado?: string; proveedor?: string }> }) {
  await requireRole('SUPERADMIN')
  const { estado = '', proveedor = '' } = await searchParams
  const estadoValido = (Object.keys(SUPPLY_DEPOSITO_ESTADO_LABELS) as SupplyDepositoEstado[]).includes(estado as SupplyDepositoEstado)
    ? (estado as SupplyDepositoEstado)
    : undefined

  const [depositos, opciones] = await Promise.all([
    listarDepositos({ estado: estadoValido, proveedorId: proveedor || undefined }),
    opcionesFinanzas(),
  ])
  const vivos = depositos.filter((d) => DEPOSITO_VIVO.includes(d.estado))
  const disponible = vivos.reduce((t, d) => t + d.disponible, 0)
  const aplicado = depositos.reduce((t, d) => t + d.montoAplicado, 0)
  const pendientes = depositos.filter((d) => d.estado === 'PENDIENTE')
  const limite30 = new Date()
  limite30.setDate(limite30.getDate() + 30)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Depósitos a proveedores"
        description="Dinero entregado a cuenta, sin unidades precompradas. Cada aplicación a una factura descuenta del saldo y deja su movimiento; una factura pagada por fuera no lo toca."
        eyebrow={
          <Link href="/superadmin/supply/finanzas" className="hover:underline">
            Finanzas
          </Link>
        }
        nav={<NavFinanzas activa="depositos" />}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Saldo disponible" value={formatMoneyRD(disponible)} sub={`${vivos.length} depósitos vivos`} accent="brand" />
        <StatCard label="Aplicado" value={formatMoneyRD(aplicado)} sub="a facturas y cuentas por pagar" />
        <StatCard label="Pendientes de confirmar" value={pendientes.length} sub={formatMoneyRD(pendientes.reduce((t, d) => t + d.montoOriginal, 0))} accent={pendientes.length > 0 ? 'warning' : undefined} />
        <StatCard label="Por cerrar en 30 días" value={vivos.filter((d) => d.cierraAt && d.cierraAt < limite30).length} sub="con saldo que devolver o consumir" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registrar un depósito</CardTitle>
        </CardHeader>
        <CardContent>
          {opciones.acuerdos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Un depósito se registra contra un acuerdo aprobado. Todavía no hay ninguno.</p>
          ) : (
            <FormAccion
              accion={registrarDepositoAction}
              etiqueta="Registrar depósito"
              etiquetaPendiente="Registrando…"
              nota="Nace pendiente: el saldo se abre cuando tesorería confirme el pago en «Pagos»."
              campos={[
                { name: 'acuerdoId', label: 'Acuerdo', tipo: 'select', opciones: opciones.acuerdos, required: true },
                { name: 'monto', label: 'Monto', tipo: 'number', min: 0.01, required: true },
                { name: 'cierraAt', label: 'Fecha de cierre', tipo: 'date', ayuda: 'Cuándo vence el saldo (opcional).' },
                { name: 'referencia', label: 'Referencia', maxLength: 200 },
                { name: 'metodo', label: 'Método', placeholder: 'Transferencia', maxLength: 100 },
                { name: 'documentos', label: 'Documentos (una ruta por línea)', tipo: 'textarea' },
                { name: 'notas', label: 'Notas', tipo: 'textarea' },
              ]}
            />
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FiltrosChips
          base={BASE}
          parametro="estado"
          actual={estadoValido ?? ''}
          otros={{ proveedor }}
          opciones={(Object.keys(SUPPLY_DEPOSITO_ESTADO_LABELS) as SupplyDepositoEstado[]).map((e) => ({ value: e, label: SUPPLY_DEPOSITO_ESTADO_LABELS[e] }))}
        />
        <FiltroProveedor base={BASE} actual={proveedor} proveedores={opciones.proveedores} otros={{ estado: estadoValido }} />
      </div>

      <Card>
        <CardContent className="pt-6">
          <TablaReporte
            titulo="Depósitos"
            columnas={[
              { clave: 'codigo', titulo: 'Depósito' },
              { clave: 'proveedor', titulo: 'Proveedor' },
              { clave: 'acuerdo', titulo: 'Acuerdo' },
              { clave: 'original', titulo: 'Original', alinearDerecha: true },
              { clave: 'aplicado', titulo: 'Aplicado', alinearDerecha: true },
              { clave: 'devuelto', titulo: 'Devuelto', alinearDerecha: true },
              { clave: 'disponible', titulo: 'Disponible', alinearDerecha: true },
              { clave: 'cierra', titulo: 'Cierra' },
              { clave: 'estado', titulo: 'Estado' },
            ]}
            filas={depositos.map((d) => ({
              __clave: d.id,
              codigo: (
                <Link href={`${BASE}/${d.id}`} className="font-medium underline-offset-4 hover:underline">
                  {d.codigo}
                </Link>
              ),
              proveedor: d.proveedor,
              acuerdo: d.acuerdo ?? '—',
              original: formatMoneyRD(d.montoOriginal),
              aplicado: formatMoneyRD(d.montoAplicado),
              devuelto: formatMoneyRD(d.montoDevuelto),
              disponible: <strong>{formatMoneyRD(d.disponible)}</strong>,
              cierra: d.cierraAt ? formatDate(d.cierraAt) : '—',
              estado: (
                <Badge variant={d.estado === 'PENDIENTE' ? 'warning' : DEPOSITO_VIVO.includes(d.estado) ? 'success' : 'outline'}>
                  {SUPPLY_DEPOSITO_ESTADO_LABELS[d.estado]}
                </Badge>
              ),
            }))}
            vacio="Ningún depósito con ese filtro."
          />
        </CardContent>
      </Card>
    </div>
  )
}
