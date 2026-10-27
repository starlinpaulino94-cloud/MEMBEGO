import { Badge } from '@/components/ui/badge'
import { ConfirmarPagoButton, RechazarPagoButton } from '@/components/admin/ValidarPagoActions'
import { AprobarCompraButton, RechazarCompraButton } from '@/components/admin/ValidarCompraActions'
import type { FilaSucursalCompra, FilaSucursalMembresia } from '@/modules/pagos/colasLectura'
import { descuentoDeBienvenidaVigente, diasDesde, montoEsperado } from '@/modules/pagos/colasMezcla'
import { TarjetaPago, fmtFecha } from './TarjetaPago'

/**
 * Los pagos EN SUCURSAL por confirmar (cola «En sucursal»): el cliente vino a pagar al local y nadie ha cobrado todavía.
 * Confirmar desde el panel activa y factura igual que la Caja; la referencia sirve para cobrarlo en el POS. Dos tarjetas —la
 * de una membresía y la de una compra de promoción— con la misma carcasa. Movidas de `pagos/page.tsx` sin cambiar nada.
 */

const AYUDA = 'Confirma aquí si ya recibiste el dinero en el local, o cóbralo desde la Caja con la referencia.'

function Referencia({ valor }: { valor: string }) {
  return (
    <p className="mt-2">
      <span className="text-muted-foreground">Referencia (Caja):</span>{' '}
      <code className="rounded bg-background px-2 py-0.5 font-mono text-base font-bold tracking-wider">{valor}</code>
    </p>
  )
}

function Solicitado({ fecha }: { fecha: Date }) {
  const dias = diasDesde(fecha)
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      Solicitado: {fmtFecha(fecha)} · hace {dias} día{dias !== 1 ? 's' : ''}
    </p>
  )
}

export function TarjetaSucursalMembresia({
  m,
  fmtMoney,
  esSuperadmin,
}: {
  m: FilaSucursalMembresia
  fmtMoney: (n: number) => string
  esSuperadmin: boolean
}) {
  const desc = descuentoDeBienvenidaVigente(m.descuentoBienvenida, m.fechaInicio)
  return (
    <TarjetaPago
      claseTarjeta="border-success/30" claseCabecera="bg-success/5"
      clienteId={m.clienteId}
      nombre={m.cliente.nombre}
      email={m.cliente.email}
      empresa={esSuperadmin ? m.cliente.company.name : undefined}
      insignia={<Badge variant="success">Pago en sucursal</Badge>}
    >
      <div className="rounded-lg bg-muted p-3 text-sm">
        <p>
          <span className="text-muted-foreground">Plan:</span> <strong>{m.plan.nombre}</strong>
        </p>
        <p>
          <span className="text-muted-foreground">Monto a cobrar:</span>{' '}
          <strong>{fmtMoney(montoEsperado(m.plan.precio, m.descuentoBienvenida, m.fechaInicio))}</strong>
          {desc > 0 && <span className="ml-1 text-xs text-success">(−{fmtMoney(desc)} bienvenida)</span>}
        </p>
        {m.sucursalPago && (
          <p>
            <span className="text-muted-foreground">Sucursal elegida:</span> {m.sucursalPago.nombre}
          </p>
        )}
        {m.referencia && <Referencia valor={m.referencia} />}
        <Solicitado fecha={m.createdAt} />
      </div>
      <p className="text-xs text-muted-foreground">{AYUDA}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        <ConfirmarPagoButton membershipId={m.id} />
        <RechazarPagoButton membershipId={m.id} />
      </div>
    </TarjetaPago>
  )
}

export function TarjetaSucursalCompra({
  c,
  fmtMoney,
  esSuperadmin,
}: {
  c: FilaSucursalCompra
  fmtMoney: (n: number) => string
  esSuperadmin: boolean
}) {
  return (
    <TarjetaPago
      claseTarjeta="border-success/30" claseCabecera="bg-success/5"
      clienteId={c.clienteId}
      nombre={c.cliente.nombre}
      email={c.cliente.email}
      empresa={esSuperadmin ? c.cliente.company.name : undefined}
      insignia={<Badge variant="success">Pago en sucursal</Badge>}
    >
      <div className="rounded-lg bg-muted p-3 text-sm">
        <p>
          <span className="text-muted-foreground">Promoción:</span> <strong>{c.promocion?.titulo ?? '—'}</strong>
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
        {c.referencia && <Referencia valor={c.referencia} />}
        <Solicitado fecha={c.createdAt} />
      </div>
      <p className="text-xs text-muted-foreground">{AYUDA}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        <AprobarCompraButton compraId={c.id} />
        <RechazarCompraButton compraId={c.id} />
      </div>
    </TarjetaPago>
  )
}
