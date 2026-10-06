import Link from 'next/link'
import { AlertTriangle, ArrowRight, Banknote, FileText, Landmark, PiggyBank, Percent, Receipt, TrendingUp, type LucideIcon } from 'lucide-react'
import { RUTA_ECONOMIA, RUTA_FINANZAS, RUTA_LIQUIDACIONES } from '@/modules/supply-v2/core/catalogo'
import { Tarjeta } from '../resumen/superficie'

const SECCIONES: { href: string; label: string; icon: LucideIcon; texto: string }[] = [
  { href: `${RUTA_FINANZAS}/facturas`, label: 'Facturas', icon: FileText, texto: 'Documentos del proveedor: registrar, aprobar, aplicar depósito, pagar.' },
  { href: `${RUTA_FINANZAS}/depositos`, label: 'Depósitos', icon: PiggyBank, texto: 'Dinero adelantado a proveedores y su saldo disponible.' },
  { href: `${RUTA_FINANZAS}/pagos`, label: 'Pagos', icon: Banknote, texto: 'Dinero que sale. Quien registra no confirma.' },
  { href: `${RUTA_FINANZAS}/obligaciones`, label: 'Obligaciones', icon: Landmark, texto: 'Lo que Membego debe y por qué nació cada deuda.' },
  { href: `${RUTA_FINANZAS}/conciliaciones`, label: 'Conciliaciones', icon: Receipt, texto: 'Membego frente al estado de cuenta del proveedor (supply y comisión).' },
  { href: RUTA_LIQUIDACIONES, label: 'Liquidaciones', icon: Percent, texto: 'Ventas a comisión entregadas: bruto, comisión y neto a pagar por periodo.' },
  { href: `${RUTA_FINANZAS}/incidencias`, label: 'Incidencias', icon: AlertTriangle, texto: 'Lo que no se deshace en silencio: entregas reversadas ya pagadas.' },
  { href: RUTA_ECONOMIA, label: 'Economía', icon: TrendingUp, texto: 'GMV, ingreso, costo, margen, breakage.' },
]

/** Las ocho entradas del módulo financiero; `avisos` pone una cifra viva junto a la etiqueta cuando existe. */
export function TarjetasSecciones({ avisos = {} }: { avisos?: Partial<Record<string, string>> }) {
  return (
    <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @5xl:grid-cols-4">
      {SECCIONES.map((s) => (
        <Link
          key={s.href}
          href={s.href}
          data-testid={`seccion-${s.label.toLowerCase()}`}
          className="group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sv2-accent focus-visible:ring-offset-2 rounded-[12px]"
        >
          <Tarjeta className="flex h-full flex-col gap-2 p-4 transition-colors group-hover:bg-sv2-soft">
            <div className="flex items-center justify-between gap-2">
              <span aria-hidden className="flex size-8 items-center justify-center rounded-[8px] bg-sv2-primary-fixed text-sv2-primary">
                <s.icon className="size-[18px]" strokeWidth={2} />
              </span>
              {avisos[s.label] && <span className="rounded-full bg-sv2-tertiary-fixed px-2 py-0.5 text-[12px] font-semibold leading-4 text-sv2-on-tertiary-fixed">{avisos[s.label]}</span>}
            </div>
            <p className="flex items-center gap-1 text-[14px] font-semibold leading-5">
              {s.label}
              <ArrowRight aria-hidden className="size-3.5 text-sv2-outline transition-transform group-hover:translate-x-0.5" />
            </p>
            <p className="text-[13px] leading-[18px] text-sv2-ink-variant">{s.texto}</p>
          </Tarjeta>
        </Link>
      ))}
    </div>
  )
}
