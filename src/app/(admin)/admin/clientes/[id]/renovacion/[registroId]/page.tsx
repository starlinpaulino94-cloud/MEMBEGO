import { notFound } from 'next/navigation'
import { requireSection } from '@/lib/auth/guards'
import { comprobanteRenovacion } from '@/modules/membresias/comprobanteRenovacion'
import { formatDate, formatMoney } from '@/lib/format'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { BotonImprimir } from '@/components/admin/BotonImprimir'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Comprobante de renovación' }

/**
 * COMPROBANTE DE RENOVACIÓN, listo para imprimir.
 *
 * Se arma desde el asiento de auditoría, no desde el formulario que lo
 * originó: el papel que se lleva el cliente y el registro que queda en el
 * sistema tienen que ser el mismo dato, o el papel gana la discusión.
 *
 * La guardia es la misma que la de renovar (`membresias`/`renovar`): quien no
 * puede renovar tampoco puede reimprimir el comprobante de un cobro.
 */
export default async function ComprobanteRenovacionPage({
  params,
}: {
  params: Promise<{ id: string; registroId: string }>
}) {
  const user = await requireSection('membresias', 'renovar')
  if (!user) notFound()
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="los comprobantes de renovación" />

  const { registroId } = await params
  const c = await comprobanteRenovacion(companyId, registroId)
  if (!c) notFound()

  const dinero = (n: number) => formatMoney(n, {}, 2)

  return (
    <div className="mx-auto max-w-md p-6 print:p-0">
      <div className="print:hidden">
        <BotonImprimir />
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-card p-6 print:border-0 print:p-0">
        <h1 className="text-h2 text-foreground">Comprobante de renovación</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatDate(c.fecha)} · N.º {c.id.slice(-10).toUpperCase()}
        </p>

        <dl className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
          <Fila termino="Cliente" valor={c.cliente} />
          <Fila termino="Plan" valor={c.plan} />
          <Fila
            termino="Período"
            valor={
              c.desde && c.hasta
                ? `${formatDate(c.desde)} — ${formatDate(c.hasta)}`
                : 'No registrado'
            }
          />
          {c.encadenada && (
            <p className="text-xs text-muted-foreground">
              El período nuevo arranca donde terminaba el anterior: no se perdió
              ningún día pagado.
            </p>
          )}
          <Fila
            termino="Lavados del plan"
            valor={c.lavadosPlan == null ? 'Ilimitados' : String(c.lavadosPlan)}
          />
          {c.lavadosRegaloConservados > 0 && (
            <Fila
              termino="Lavados de regalo conservados"
              valor={String(c.lavadosRegaloConservados)}
            />
          )}
          <Fila termino="Forma de pago" valor={c.metodo} />
          {c.referencia && <Fila termino="Referencia" valor={c.referencia} />}
          {c.atendidoPor && <Fila termino="Atendido por" valor={c.atendidoPor} />}
        </dl>

        <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4">
          <span className="font-semibold text-foreground">Total cobrado</span>
          <span className="text-h2 text-foreground">{dinero(c.monto)}</span>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Conserva este comprobante. Ampara la renovación arriba descrita.
        </p>
      </div>
    </div>
  )
}

function Fila({ termino, valor }: { termino: string; valor: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{termino}</dt>
      <dd className="text-right font-medium text-foreground">{valor}</dd>
    </div>
  )
}
