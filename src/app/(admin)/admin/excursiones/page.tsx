import { redirect } from 'next/navigation'
import { Compass, Map, Users, QrCode, Ticket, Wallet, CheckCircle2 } from 'lucide-react'
import { requireSection } from '@/lib/auth/guards'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Excursiones' }

/**
 * EXCURSIONES · Fase 1 — FUNDACIÓN.
 *
 * El módulo existe, está detrás de su capacidad (EXCURSIONES) y de su sección
 * de permisos; el esquema completo ya vive en la base. Esta pantalla es el
 * punto de entrada honesto: dice qué hay y qué viene, por fases — nada de
 * pantallas con datos inventados (regla de la casa).
 */
const FASES = [
  { icon: Map, titulo: 'Catálogo de excursiones', detalle: 'Excursiones, variantes y horarios con precios por adulto y niño.', fase: 'Fase 2' },
  { icon: Users, titulo: 'Vendedores', detalle: 'Cada vendedor con su código, su enlace y su QR propio.', fase: 'Fase 3' },
  { icon: QrCode, titulo: 'Registro por QR del vendedor', detalle: 'Los clientes se registran escaneando el QR y cada registro queda atribuido a su vendedor — el embudo captados → registrados → compradores.', fase: 'Fase 4' },
  { icon: Ticket, titulo: 'Reservas y ventas', detalle: 'Reservas con pasajeros, pagos parciales y confirmación de venta.', fase: 'Fase 5–6' },
  { icon: Wallet, titulo: 'Comisiones y liquidaciones', detalle: 'Motor de comisiones con reglas por vendedor y excursión, y pagos por liquidación con comprobante.', fase: 'Fase 6–7' },
]

export default async function ExcursionesPage() {
  const user = await requireSection('excursiones')
  if (!user) redirect('/admin/dashboard')

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-h1 text-foreground">
          <Compass className="h-7 w-7 text-primary" /> Excursiones
        </h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          El sistema comercial para empresas de tours: vendedores con QR propio, reservas,
          ventas y comisiones — todo trazable de punta a punta.
        </p>
      </div>

      <Card className="border-primary/25 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-5">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="text-sm">
            <p className="font-semibold text-foreground">El módulo está activado para tu empresa.</p>
            <p className="mt-1 text-muted-foreground">
              La fundación (base de datos, permisos y configuración) ya está instalada. Las
              pantallas se están construyendo por fases — aquí aparecerán según se publiquen.
            </p>
          </div>
        </CardContent>
      </Card>

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
