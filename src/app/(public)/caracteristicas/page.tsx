import type { Metadata } from 'next'
import Link from 'next/link'
import {
  CreditCard,
  Tag,
  QrCode,
  Users,
  ScanLine,
  BarChart3,
  Rocket,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react'

export const metadata: Metadata = {
  title: 'Características',
  description:
    'Membresías digitales, promociones, validación por QR, referidos virales y panel de control: todo lo que MembeGo ofrece a empresas y clientes.',
  alternates: { canonical: '/caracteristicas' },
}

const FEATURES = [
  {
    icon: CreditCard,
    titulo: 'Membresías digitales',
    desc: 'Crea planes, gestiona suscripciones y renovaciones, y ofrece a tus clientes una membresía siempre a mano en su teléfono.',
  },
  {
    icon: Tag,
    titulo: 'Promociones y beneficios',
    desc: 'Publica ofertas, cupones y beneficios digitales. Cada promoción es un producto compartible con su propia vista previa.',
  },
  {
    icon: QrCode,
    titulo: 'Validación por QR',
    desc: 'Cada membresía y beneficio genera un QR único de un solo uso. Canje instantáneo, sin fricción y sin papel.',
  },
  {
    icon: ScanLine,
    titulo: 'Escáner universal',
    desc: 'Valida con la cámara del dispositivo o con cualquier lector físico HID (USB/Bluetooth). El mismo flujo, sin configurar el modelo.',
  },
  {
    icon: Rocket,
    titulo: 'Referidos virales (Growth Engine)',
    desc: 'Cada enlace compartido es una campaña: landing con el beneficio, contador de urgencia y recompensas configurables por evento.',
  },
  {
    icon: Users,
    titulo: 'Clientes y fidelización',
    desc: 'Base de clientes, historial de visitas, niveles de embajador y campañas para que vuelvan una y otra vez.',
  },
  {
    icon: BarChart3,
    titulo: 'Panel de control',
    desc: 'Métricas reales de ventas, conversión, QR usados y clientes nuevos vs. recurrentes. Decisiones con datos, no estimaciones.',
  },
  {
    icon: ShieldCheck,
    titulo: 'Seguro y multi-empresa',
    desc: 'Roles y permisos por equipo, control de acceso por sección y datos aislados por empresa.',
  },
]

export default function CaracteristicasPage() {
  return (
    <div className="min-h-screen bg-card">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-caption font-medium text-muted-foreground">
            <Rocket className="h-3.5 w-3.5 text-primary" /> Todo en una plataforma
          </span>
          <h1 className="mt-4 text-h1 text-foreground">
            Características de MembeGo
          </h1>
          <p className="mt-3 text-body text-muted-foreground">
            Membresías, promociones, QR, referidos y analítica — el sistema completo
            para que las empresas conecten con sus clientes y crezcan.
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon
            return (
              <div
                key={f.titulo}
                className="rounded-2xl border border-border/80 bg-card p-6 shadow-card transition hover:shadow-premium"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </span>
                <h2 className="mt-4 font-semibold text-foreground">{f.titulo}</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            )
          })}
        </div>

        <div className="mt-14 flex flex-col items-center gap-4 rounded-2xl border border-border/80 bg-gradient-to-br from-primary/10 via-card to-card p-10 text-center">
          <h2 className="text-h1 text-foreground">
            ¿Listo para ofrecer membresías digitales?
          </h2>
          <p className="max-w-lg text-muted-foreground">
            Registra tu empresa en minutos o explora las promociones disponibles.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/registro-empresa"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground shadow-glow transition hover:opacity-95"
            >
              Registrar mi empresa <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/empresas"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-3 font-semibold text-foreground transition hover:bg-muted"
            >
              Explorar empresas
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
