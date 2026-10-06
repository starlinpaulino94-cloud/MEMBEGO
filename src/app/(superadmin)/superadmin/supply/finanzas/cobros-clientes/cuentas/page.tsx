import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TablaReporte } from '@/components/ui/reporte-imprimible'
import { formatDate } from '@/lib/format'
import { NavFinanzas } from '@/components/supply/nav'
import { BotonEstadoCuenta, FormCuentaCobro } from '@/components/supply/form-cuenta-cobro'
import { cuentasParaAdministrar } from '@/modules/supply/cobro'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cuentas de cobro de Membego' }

/**
 * MEMBEGO SUPPLY · dónde cobra Membego (Fases 22-23).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTA PANTALLA ES UN INTERRUPTOR DE NEGOCIO DISFRAZADO DE CONFIGURACIÓN
 *
 * No hay una casilla de «vender supply: sí/no» en ningún sitio, y no la hay a
 * propósito: la venta está encendida si —y solo si— existe aquí una cuenta
 * activa. Dos llaves para lo mismo terminan con una en el estado que nadie
 * esperaba, y en este caso el estado inesperado es «la vitrina publica precios
 * que no se pueden cobrar».
 *
 * Por eso lo primero que se ve arriba es si Membego está cobrando o no, dicho
 * con esas palabras, y no un contador de cuentas que hay que interpretar.
 */
export default async function CuentasCobroPage() {
  await requireRole('SUPERADMIN')

  const cuentas = await cuentasParaAdministrar()
  const activas = cuentas.filter((c) => c.activa)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cuentas de cobro"
        description="Las cuentas de Membego a las que transfiere el cliente cuando compra supply. No son de ninguna empresa."
        eyebrow={
          <Link href="/superadmin/supply/finanzas/cobros-clientes" className="hover:underline">
            Cobros
          </Link>
        }
        nav={<NavFinanzas activa="cobros-clientes" />}
      />

      <Card>
        <CardContent className="py-4">
          {activas.length > 0 ? (
            <p className="text-body">
              <strong>Membego está cobrando.</strong> Hay {activas.length}{' '}
              {activas.length === 1 ? 'cuenta activa' : 'cuentas activas'}, así que la vitrina
              publica las ofertas de pago junto a los regalos.
            </p>
          ) : (
            <p className="text-body">
              <strong>Membego no está cobrando.</strong> Sin ninguna cuenta activa la vitrina solo
              publica lo gratuito, y nadie puede comprar supply. Da de alta una cuenta y actívala.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dar de alta una cuenta</CardTitle>
        </CardHeader>
        <CardContent>
          <FormCuentaCobro />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cuentas registradas ({cuentas.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {cuentas.length === 0 ? (
            <p className="text-body text-muted-foreground">
              Todavía no hay ninguna. La primera que actives enciende la venta de supply.
            </p>
          ) : (
            <>
              <TablaReporte
                columnas={[
                  { clave: 'nombre', titulo: 'Cuenta' },
                  { clave: 'titular', titulo: 'Titular' },
                  { clave: 'numero', titulo: 'Número' },
                  { clave: 'tipo', titulo: 'Tipo' },
                  { clave: 'moneda', titulo: 'Moneda' },
                  { clave: 'pedidos', titulo: 'Pedidos', alinearDerecha: true },
                  { clave: 'estado', titulo: 'Estado' },
                  { clave: 'alta', titulo: 'Alta' },
                  { clave: 'accion', titulo: '' },
                ]}
                filas={cuentas.map((c) => ({
                  __clave: c.id,
                  nombre: (
                    <span className="flex flex-col">
                      <span>{c.nombre}</span>
                      {c.instrucciones && (
                        <span className="text-caption text-muted-foreground">
                          {c.instrucciones}
                        </span>
                      )}
                    </span>
                  ),
                  titular: c.titular ?? '—',
                  numero: c.numeroCuenta ?? '—',
                  tipo: c.tipoCuenta ?? (c.tipo === 'TRANSFERENCIA' ? 'Transferencia' : 'Presencial'),
                  moneda: c.moneda,
                  pedidos: String(c.pedidos),
                  estado: (
                    <Badge variant={c.activa ? 'success' : 'secondary'}>
                      {c.activa ? 'Activa' : 'Apagada'}
                    </Badge>
                  ),
                  alta: formatDate(c.createdAt),
                  accion: <BotonEstadoCuenta cuentaId={c.id} activa={c.activa} />,
                }))}
              />

              <p className="text-caption text-muted-foreground">
                Una cuenta no se borra ni se edita: se apaga. Un pedido guarda a qué cuenta se le
                pidió transferir, y esa es la respuesta a «¿dónde dije que pagara?» seis meses
                después. Si un número está mal, apaga esa cuenta y da de alta la correcta.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
