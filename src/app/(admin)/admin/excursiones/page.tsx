import Link from 'next/link'
import { Map, Users, QrCode, Ticket, Wallet, CheckCircle2, ArrowRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Excursiones' }

/**
 * Resumen del módulo. Mientras las fases se publican, esta pantalla dice la
 * verdad: qué está disponible ya (con su puerta) y qué viene. El dashboard
 * ejecutivo con KPIs reales llega en la Fase 9 — nada de métricas inventadas.
 */
const FASES = [
  { icon: Users, titulo: 'Vendedores', detalle: 'Cada vendedor con su código, su enlace y su QR propio.', fase: 'Fase 3' },
  { icon: QrCode, titulo: 'Registro por QR del vendedor', detalle: 'Cada registro queda atribuido a su vendedor — el embudo captados → registrados → compradores.', fase: 'Fase 4' },
  { icon: Ticket, titulo: 'Reservas y ventas', detalle: 'Reservas con pasajeros, pagos parciales y confirmación de venta.', fase: 'Fase 5–6' },
  { icon: Wallet, titulo: 'Comisiones y liquidaciones', detalle: 'Motor de comisiones con reglas por vendedor y excursión, y pagos por liquidación.', fase: 'Fase 6–7' },
]

export default function ExcursionesResumenPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card className="border-primary/25 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-5">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="text-sm">
            <p className="font-semibold text-foreground">El módulo está activado para tu empresa.</p>
            <p className="mt-1 text-muted-foreground">
              El catálogo ya está disponible; el resto de pantallas aparece aquí según se
              publica cada fase.
            </p>
          </div>
        </CardContent>
      </Card>

      <Link
        href="/admin/excursiones/catalogo"
        className="flex items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-card p-4 transition hover:-translate-y-0.5 hover:shadow-premium"
      >
        <span className="flex items-start gap-3">
          <Map className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <span>
            <span className="block font-semibold text-foreground">Catálogo de excursiones</span>
            <span className="block text-sm text-muted-foreground">
              Crea tus excursiones con variantes, precios por adulto y niño, y horarios de salida.
            </span>
          </span>
        </span>
        <ArrowRight className="h-5 w-5 shrink-0 text-primary" />
      </Link>

      <div className="space-y-3">
        <h2 className="text-h3 text-foreground">Lo que viene, por fases</h2>
        {FASES.map((f) => (
          <div key={f.titulo} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
            <f.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground">{f.titulo}</p>
              <p className="text-sm text-muted-foreground">{f.detalle}</p>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-caption font-semibold text-muted-foreground">
              {f.fase}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
