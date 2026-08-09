import { QrCode, Gift, CreditCard, TrendingUp } from 'lucide-react'

const FEATURES = [
  {
    icon: QrCode,
    title: 'Membresía con QR único',
    description:
      'Al activar tu plan recibes un código QR digital. Lo presentas en el negocio y validan tu membresía al instante.',
    color: 'bg-primary/10 text-primary',
  },
  {
    icon: Gift,
    title: 'Beneficios y promociones',
    description:
      'Accede a descuentos, promociones y beneficios exclusivos de cada empresa donde tengas membresía.',
    color: 'bg-destructive/10 text-destructive',
  },
  {
    icon: CreditCard,
    title: 'Planes a tu medida',
    description:
      'Elige el plan que se adapta a ti, cámbialo cuando quieras y controla tus pagos y vencimientos desde la app.',
    color: 'bg-success/15 text-success',
  },
  {
    icon: TrendingUp,
    title: 'Refiere y gana',
    description:
      'Comparte tu enlace, suma puntos, sube de nivel como embajador y gana recompensas por cada amigo que se une.',
    color: 'bg-primary/10 text-primary',
  },
]

export function ValueProps() {
  return (
    <section className="bg-card py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-h1 text-foreground">
            Todo tu club de beneficios, en un solo lugar
          </h2>
          <p className="mt-4 text-body text-muted-foreground">
            MembeGo digitaliza las membresías de tus negocios favoritos: sin
            tarjetas físicas, sin papeleo, con todo a la mano.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-border/60 bg-card p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
            >
              <span className={`inline-flex h-12 w-12 items-center justify-center rounded-xl ${f.color}`}>
                <f.icon className="h-6 w-6" />
              </span>
              <h3 className="mt-4 font-semibold text-foreground">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
