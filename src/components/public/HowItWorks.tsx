import { Search, CreditCard, QrCode, Sparkles } from 'lucide-react'

const STEPS = [
  {
    icon: Search,
    title: 'Elige una empresa',
    description: 'Explora los negocios afiliados y encuentra el que se adapta a ti.',
  },
  {
    icon: CreditCard,
    title: 'Activa tu plan',
    description: 'Selecciona un plan, realiza tu pago y espera la confirmación.',
  },
  {
    icon: QrCode,
    title: 'Recibe tu QR',
    description: 'Se genera tu membresía digital con un código QR único y seguro.',
  },
  {
    icon: Sparkles,
    title: 'Disfruta beneficios',
    description: 'Preséntalo en el negocio y accede a tus beneficios al instante.',
  },
]

export function HowItWorks() {
  return (
    <section className="bg-muted py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-h1 text-foreground">
            Cómo funciona
          </h2>
          <p className="mt-4 text-body text-muted-foreground">
            Cuatro pasos simples para empezar a disfrutar tus beneficios.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <div key={step.title} className="relative">
              <div className="h-full rounded-2xl border border-border/60 bg-card p-6 text-center shadow-sm">
                <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-brand text-white">
                  <step.icon className="h-6 w-6" />
                  <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-caption font-bold text-white">
                    {i + 1}
                  </span>
                </div>
                <h3 className="mt-4 font-semibold text-foreground">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
              </div>

              {i < STEPS.length - 1 && (
                <div
                  aria-hidden
                  className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-2xl text-muted-foreground/40 lg:block"
                >
                  →
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
