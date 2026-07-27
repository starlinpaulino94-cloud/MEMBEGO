import { AlertTriangle, CheckCircle2, CreditCard, Landmark, PowerOff } from 'lucide-react'
import type { TransferenciasEnVuelo } from '@/modules/pagos/metodosDisponibles'

/**
 * ESTADO DE LOS COBROS EN LÍNEA — el panel que hay que mirar ANTES de tocar
 * un método de pago.
 *
 * Existe por una razón concreta: apagar la transferencia sin CardNET
 * funcionando deja al negocio sin ninguna forma de cobrar en línea, y eso no
 * se nota hasta que un cliente lo intenta. Aquí se ve de un vistazo, y se ve
 * también cuántas compras siguen dependiendo de la transferencia.
 */

export interface EstadoPasarelasProps {
  transferencia: boolean
  cardnet: boolean
  /** Credenciales de CardNET presentes en el servidor. */
  cardnetConfigurado: boolean
  enVuelo: TransferenciasEnVuelo
  cuentasCargadas: number
}

export function EstadoPasarelas({
  transferencia,
  cardnet,
  cardnetConfigurado,
  enVuelo,
  cuentasCargadas,
}: EstadoPasarelasProps) {
  const transferenciaUtil = transferencia && cuentasCargadas > 0
  const cardnetUtil = cardnet && cardnetConfigurado
  const sinCobroEnLinea = !transferenciaUtil && !cardnetUtil

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Fila
          icono={<Landmark className="h-4 w-4" />}
          titulo="Transferencia bancaria"
          activo={transferenciaUtil}
          detalle={
            !transferencia
              ? 'Retirada. No se ofrece en compras nuevas.'
              : cuentasCargadas === 0
                ? 'Encendida, pero sin cuentas cargadas: el cliente no puede pagar.'
                : `${cuentasCargadas} ${cuentasCargadas === 1 ? 'cuenta' : 'cuentas'} publicadas.`
          }
        />
        <Fila
          icono={<CreditCard className="h-4 w-4" />}
          titulo="Tarjeta (CardNET)"
          activo={cardnetUtil}
          detalle={
            !cardnet
              ? 'Apagada para esta empresa.'
              : !cardnetConfigurado
                ? 'Encendida, pero faltan las credenciales en el servidor. No se ofrece.'
                : 'Cobrando con tarjeta.'
          }
        />
      </div>

      {sinCobroEnLinea && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-bold text-destructive">
              Ahora mismo nadie puede pagarte en línea
            </p>
            <p className="mt-1 text-muted-foreground">
              No hay ningún método de cobro disponible para compras nuevas. Los clientes
              podrán reservar, pero no completar el pago hasta que enciendas uno.
            </p>
          </div>
        </div>
      )}

      {/* El número que decide si es seguro apagar la transferencia. */}
      {(enVuelo.comprometidas > 0 || enVuelo.sinComprometer > 0) && (
        <div className="rounded-xl border border-border/70 bg-muted/20 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-foreground">
            <PowerOff className="h-4 w-4" /> Si retiras la transferencia
          </p>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            <li>
              <b className="text-foreground">{enVuelo.comprometidas}</b>{' '}
              {enVuelo.comprometidas === 1 ? 'compra ya eligió' : 'compras ya eligieron'} cuenta o
              subieron comprobante: siguen funcionando por transferencia y hay que terminar de
              validarlas a mano.
            </li>
            <li>
              <b className="text-foreground">{enVuelo.sinComprometer}</b>{' '}
              {enVuelo.sinComprometer === 1
                ? 'compra está esperando pago sin haber elegido método'
                : 'compras están esperando pago sin haber elegido método'}
              : al volver el cliente verá solo los métodos que sigan encendidos.
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}

function Fila({
  icono,
  titulo,
  activo,
  detalle,
}: {
  icono: React.ReactNode
  titulo: string
  activo: boolean
  detalle: string
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        activo ? 'border-success/30 bg-success/5' : 'border-border/70 bg-muted/20'
      }`}
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {icono} {titulo}
        {activo ? (
          <CheckCircle2 className="h-4 w-4 text-success" />
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            inactivo
          </span>
        )}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{detalle}</p>
    </div>
  )
}
