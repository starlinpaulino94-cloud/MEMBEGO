import Link from 'next/link'
import { Map, Users, Ticket, Coins, Wallet, Smartphone, BarChart3, ArrowRight } from 'lucide-react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Excursiones' }

/**
 * Resumen del módulo: las puertas que YA existen y, aparte, lo que todavía no.
 *
 * Esta pantalla se actualiza al publicar cada fase. Dejar anunciado como «lo
 * que viene» algo que ya está construido es tan deshonesto como prometer lo
 * que no existe: el panel dice lo que hay, hoy. El dashboard con KPIs reales
 * llega en su fase — aquí no se inventan métricas.
 */
const DISPONIBLES = [
  {
    href: '/admin/excursiones/catalogo',
    icon: Map,
    titulo: 'Catálogo de excursiones',
    detalle: 'Tus excursiones con variantes, precios por adulto y niño, y horarios de salida.',
  },
  {
    href: '/admin/excursiones/vendedores',
    icon: Users,
    titulo: 'Vendedores',
    detalle:
      'Cada vendedor con su código, su enlace y su QR. Su perfil muestra cuántos clientes captó, etapa por etapa.',
  },
  {
    href: '/admin/excursiones/reservas',
    icon: Ticket,
    titulo: 'Reservas',
    detalle:
      'Reservas con pasajeros y pagos parciales. El precio y el vendedor se congelan al crearlas.',
  },
  {
    href: '/admin/excursiones/comisiones',
    icon: Coins,
    titulo: 'Comisiones',
    detalle:
      'Reglas por vendedor y excursión. Cada comisión nace con su regla dentro y ya no cambia.',
  },
  {
    href: '/admin/excursiones/liquidaciones',
    icon: Wallet,
    titulo: 'Liquidaciones',
    detalle:
      'Agrupa las comisiones aprobadas de un período en un pago, con su detalle y su referencia.',
  },
]

const PENDIENTES = [
  {
    icon: Smartphone,
    titulo: 'Panel del vendedor',
    detalle: 'Su vista móvil: su QR, sus clientes, sus ventas y lo que se le debe.',
    fase: 'Fase 8',
  },
  {
    icon: BarChart3,
    titulo: 'Dashboard y reportes',
    detalle: 'Rankings, metas y exportaciones — con cifras reales, calculadas al consultarlas.',
    fase: 'Fases 9–10',
  },
]

export default function ExcursionesResumenPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="space-y-3">
        <h2 className="text-h3 text-foreground">Disponible ahora</h2>
        {DISPONIBLES.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="flex items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-card p-4 transition hover:-translate-y-0.5 hover:shadow-premium"
          >
            <span className="flex items-start gap-3">
              <m.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span>
                <span className="block font-semibold text-foreground">{m.titulo}</span>
                <span className="block text-sm text-muted-foreground">{m.detalle}</span>
              </span>
            </span>
            <ArrowRight className="h-5 w-5 shrink-0 text-primary" />
          </Link>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-h3 text-foreground">Lo que viene, por fases</h2>
        {PENDIENTES.map((f) => (
          <div
            key={f.titulo}
            className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4"
          >
            <f.icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground">{f.titulo}</p>
              <p className="text-sm text-muted-foreground">{f.detalle}</p>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-caption font-semibold text-muted-foreground">
              {f.fase}
            </span>
          </div>
        ))}
      </section>
    </div>
  )
}
