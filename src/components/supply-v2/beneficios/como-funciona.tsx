import Link from 'next/link'
import { ArrowRight, Landmark, Sigma, SquareDashedBottom } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MONO, Tarjeta } from '../resumen/superficie'

const PASOS = [
  {
    paso: 'Paso 01 • Catálogo',
    titulo: 'Precio público / contrato',
    monto: 'RD$800.00',
    tono: 'text-foreground',
    numero: 'bg-sv2-soft-hover text-sv2-ink-variant',
    texto: 'La oferta conserva su precio público y su importe contractual: el bono no rebaja lo pactado con el proveedor.',
  },
  {
    paso: 'Paso 02 • Checkout',
    titulo: 'El cliente paga',
    monto: 'RD$600.00',
    tono: 'text-sv2-secondary',
    numero: 'bg-sv2-secondary-container text-sv2-on-secondary-container',
    texto: 'Al pagar se reserva el bono y se descuenta de lo que paga el cliente; si la compra se cancela, la reserva se libera.',
  },
  {
    paso: 'Paso 03 • Subsidio',
    titulo: 'Membego cubre el bono',
    monto: 'RD$200.00',
    tono: 'text-sv2-primary',
    numero: 'bg-sv2-primary-fixed text-sv2-on-primary-fixed',
    texto: 'Sale del presupuesto del beneficio y queda en su ledger como consumido cuando la compra se confirma.',
  },
  {
    paso: 'Paso 04 • Liquidación',
    titulo: 'El proveedor cobra',
    monto: 'RD$800.00',
    tono: 'text-foreground',
    numero: 'bg-sv2-tertiary-fixed text-sv2-on-tertiary-fixed',
    texto: 'Recibe su importe contractual completo; si la oferta va a comisión, se descuenta solo la comisión pactada.',
  },
] as const

/**
 * Tarjeta explicativa del pie (Stitch): cómo un bono de Membego afecta al
 * cobro y a la liquidación. Es un EJEMPLO fijo y se rotula así; las cifras
 * reales de cada beneficio están en su ficha y en Economía.
 */
export function ComoFuncionaBeneficio({ rutaEconomia }: { rutaEconomia: string }) {
  return (
    <Tarjeta className="flex flex-col gap-4 p-5" data-testid="beneficios-como-funciona">
      <div className="flex flex-col items-start justify-between gap-2 @xl:flex-row @xl:items-center">
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-sv2-primary-fixed text-sv2-primary">
            <Landmark className="size-5" />
          </span>
          <div className="flex flex-col">
            <h3 className="text-[15px] font-bold leading-5">¿Cómo afecta un bono al cobro y a la liquidación?</h3>
            <p className="text-[13px] leading-[18px] text-sv2-ink-variant">Ejemplo con un bono de Membego de RD$200 sobre una oferta de RD$800.</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-sv2-secondary-container px-2 py-0.5 text-[12px] font-semibold leading-4 text-sv2-on-secondary-container">
          <SquareDashedBottom aria-hidden className="size-3.5" />
          Ejemplo
        </span>
      </div>
      <ol className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @5xl:grid-cols-4">
        {PASOS.map((p, i) => (
          <li key={p.paso} className="flex flex-col gap-3 rounded-[8px] border border-sv2-border bg-sv2-well p-4">
            <div className="flex items-center justify-between gap-2">
              <span className={cn(MONO, 'font-semibold uppercase tracking-wide text-sv2-ink-variant')}>{p.paso}</span>
              <span aria-hidden className={cn('flex size-6 items-center justify-center rounded-full text-[12px] font-bold', p.numero)}>{i + 1}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-outline">{p.titulo}</span>
              <span className={cn('text-[24px] font-bold leading-8 tracking-[-0.02em] tabular-nums', p.tono)}>{p.monto}</span>
            </div>
            <p className="text-[13px] leading-[18px] text-sv2-ink-variant">{p.texto}</p>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-2 rounded-[8px] border border-sv2-border bg-sv2-well px-4 py-3 @4xl:flex-row @4xl:items-center @4xl:justify-between">
        <p className="flex items-start gap-2 text-[13px] leading-[18px]">
          <Sigma aria-hidden className="mt-px size-4 shrink-0 text-sv2-primary" />
          <span>
            <strong className="font-semibold">Conciliación:</strong>{' '}
            <code className={cn(MONO, 'text-sv2-primary')}>Pagado por el cliente (RD$600) + bono de Membego (RD$200) = importe contractual (RD$800)</code>
          </span>
        </p>
        <Link href={rutaEconomia} className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold leading-4 text-sv2-primary hover:underline">
          Ver economía de beneficios <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>
    </Tarjeta>
  )
}
