import { BadgePercent, Coins, Receipt, TrendingUp, Wallet, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dineroSupplyV2 } from '@/modules/supply-v2/core/catalogo'
import type { EconomiaCalculada } from '@/modules/supply-v2/economics/queries'
import { MONO, Tarjeta } from '../resumen/superficie'

type Tono = 'neutral' | 'exito' | 'aviso' | 'error'
const COLOR: Record<Tono, string> = { neutral: 'text-foreground', exito: 'text-sv2-secondary', aviso: 'text-sv2-tertiary', error: 'text-sv2-error' }

/** Cifra grande de la fila principal. El `testId` va en el valor para que se lea solo el importe. */
function Principal({ etiqueta, icono: Icono, valor, nota, pie, tono = 'neutral', testId }: { etiqueta: string; icono: LucideIcon; valor: string; nota: string; pie?: string; tono?: Tono; testId: string }) {
  return (
    <Tarjeta className="@container flex flex-col justify-between gap-1 p-4">
      <div className="flex items-center justify-between gap-2 text-sv2-ink-variant">
        <span className="text-[12px] font-bold uppercase leading-4 tracking-wider">{etiqueta}</span>
        <Icono aria-hidden className="size-[18px] shrink-0 text-sv2-primary" strokeWidth={2} />
      </div>
      <span className={cn('whitespace-nowrap text-[clamp(20px,14cqi,28px)] font-bold leading-8 tracking-[-0.025em] tabular-nums', COLOR[tono])} data-testid={testId}>{valor}</span>
      <span className="text-[13px] leading-[18px] text-sv2-ink-variant">{nota}</span>
      {pie && <span className={cn(MONO, 'text-sv2-outline')}>{pie}</span>}
    </Tarjeta>
  )
}

function Secundaria({ etiqueta, valor, nota, tono = 'neutral', testId, icono: Icono }: { etiqueta: string; valor: string; nota: string; tono?: Tono; testId: string; icono?: LucideIcon }) {
  return (
    <Tarjeta className="flex flex-col gap-0.5 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold uppercase leading-4 tracking-wider text-sv2-ink-variant">{etiqueta}</span>
        {Icono && <Icono aria-hidden className="size-4 text-sv2-tertiary" />}
      </div>
      <span className={cn('whitespace-nowrap text-[20px] font-bold leading-7 tracking-[-0.02em] tabular-nums', COLOR[tono])} data-testid={testId}>{valor}</span>
      <span className="text-[13px] leading-[18px] text-sv2-ink-variant">{nota}</span>
    </Tarjeta>
  )
}

const REJILLA = 'grid grid-cols-1 gap-3 @xl:grid-cols-2 @6xl:grid-cols-4'

/** Los cuatro indicadores principales y las dos bandas (unidades y financiación) de la pantalla de Economía. */
export function IndicadoresEconomia({ e }: { e: EconomiaCalculada }) {
  const n = (v: number) => v.toLocaleString('es-DO')
  return (
    <>
      <div className={REJILLA} data-testid="tablero-economia">
        <Principal etiqueta="GMV" icono={Coins} valor={dineroSupplyV2(e.gmv)} nota="valor vendido al cliente" pie={`${n(e.unitsSold)} unidades vendidas`} testId="eco-gmv" />
        <Principal etiqueta="Ingreso (revenue)" icono={Wallet} valor={dineroSupplyV2(e.revenue)} nota="reconocido por Membego" pie="SUPPLY + COMISIÓN" testId="eco-revenue" />
        <Principal etiqueta="Costo" icono={Receipt} valor={dineroSupplyV2(e.cost)} nota="costo real del supply vendido" pie="Congelado en el lote" testId="eco-cost" />
        <Principal etiqueta="Margen bruto" icono={TrendingUp} valor={dineroSupplyV2(e.grossMargin)} nota={e.marginPct != null ? `${e.marginPct.toLocaleString('es-DO')} % del ingreso` : '—'} tono="exito" testId="eco-margen" />
      </div>
      <div className={REJILLA}>
        <Secundaria etiqueta="Unidades vendidas" valor={n(e.unitsSold)} nota="en el periodo" testId="eco-vendidas" />
        <Secundaria etiqueta="Unidades redimidas" valor={n(e.unitsRedeemed)} nota="entregas vivas en el periodo" testId="eco-redimidas" />
        <Secundaria etiqueta="Unidades vencidas (breakage)" valor={n(e.unitsExpired)} nota={e.breakageRate != null ? `${e.breakageRate.toLocaleString('es-DO')} % de lo vendido` : '—'} tono={e.unitsExpired > 0 ? 'aviso' : 'neutral'} testId="eco-vencidas" />
        <Secundaria etiqueta="Supply vencido sin vender" valor={dineroSupplyV2(e.expiredSupplyCost)} nota={`${n(e.expiredSupplyUnits)} unidades · costo histórico`} tono={e.expiredSupplyUnits > 0 ? 'error' : 'neutral'} testId="eco-supply-vencido" />
      </div>
      {/* Slice 6 (§28): la promoción se ve aparte. Un GMV alto con contribución negativa es una campaña que está comprando ventas. */}
      <div className={REJILLA} data-testid="eco-financiacion">
        <Secundaria etiqueta="Descuento de proveedores" valor={dineroSupplyV2(e.supplierDiscount)} nota="lo rebajaron ellos; no es dinero de Membego" testId="eco-descuento-proveedor" />
        <Secundaria etiqueta="Subsidio de Membego" valor={dineroSupplyV2(e.membegoSubsidy)} nota="costo promocional del periodo" tono={Number(e.membegoSubsidy) > 0 ? 'aviso' : 'neutral'} icono={BadgePercent} testId="eco-subsidio" />
        <Secundaria etiqueta="Cobrado a clientes" valor={dineroSupplyV2(e.customerCollections)} nota="lo que entró de verdad" testId="eco-cobrado" />
        <Secundaria etiqueta="Contribución tras el subsidio" valor={dineroSupplyV2(e.contributionAfterSubsidy)} nota="margen bruto − subsidio" tono={Number(e.contributionAfterSubsidy) < 0 ? 'error' : 'exito'} testId="eco-contribucion" />
      </div>
    </>
  )
}
