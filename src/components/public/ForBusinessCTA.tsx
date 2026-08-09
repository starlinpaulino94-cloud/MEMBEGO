import Link from 'next/link'
import { ArrowRight, Store, BarChart3, Users } from 'lucide-react'

const PUNTOS = [
  { icon: Store, texto: 'Publica tu negocio y tus planes de membresía.' },
  { icon: Users, texto: 'Gestiona clientes, pagos y validación por QR.' },
  { icon: BarChart3, texto: 'Mide tu programa de referidos y crece.' },
]

export function ForBusinessCTA() {
  return (
    <section className="bg-card py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-2xl surface-hero px-6 py-12 sm:px-12">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div className="text-white">
              <h2 className="text-h1">
                ¿Tienes un negocio?
              </h2>
              <p className="mt-4 max-w-lg text-body text-muted-foreground/40">
                Convierte a tus clientes en miembros fieles. Ofrece membresías
                digitales, promociones y un programa de referidos que hace crecer
                tu comunidad.
              </p>
              <div className="mt-8">
                <Link
                  href="/registro-empresa"
                  className="inline-flex items-center gap-2 rounded-xl bg-card px-6 py-3 font-semibold text-foreground transition hover:bg-muted"
                >
                  Registrar mi empresa
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            <ul className="space-y-4">
              {PUNTOS.map((p) => (
                <li
                  key={p.texto}
                  className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
                    <p.icon className="h-5 w-5" />
                  </span>
                  <span className="text-sm text-white/80">{p.texto}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
