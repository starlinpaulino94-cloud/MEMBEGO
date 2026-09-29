import { redirect } from 'next/navigation'

/** La antigua «Liquidaciones» eran pagos y ledger; las liquidaciones reales viven en Finanzas. */
export default function LiquidacionesRedirect() {
  redirect('/superadmin/supply/finanzas/liquidaciones')
}
