import type { Metadata } from 'next'
import Link from 'next/link'
import { Newspaper, ArrowRight } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Blog',
  description:
    'Ideas, guías y novedades sobre membresías digitales, fidelización y crecimiento para tu negocio con MembeGo.',
  alternates: { canonical: '/blog' },
}

// Fase Landing · índice del blog. Estructura lista para contenido; hoy sin
// artículos publicados (no se inventan entradas). Cuando se conecte un CMS o
// se añadan MDX, esta lista se poblará desde la fuente de datos.
const ARTICULOS: { slug: string; titulo: string; resumen: string; fecha: string }[] = []

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-card">
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="text-h1 text-foreground">Blog</h1>
        <p className="mt-3 text-body text-muted-foreground">
          Guías y novedades sobre membresías digitales, fidelización y crecimiento.
        </p>

        {ARTICULOS.length === 0 ? (
          <div className="mt-12 flex flex-col items-center rounded-2xl border border-dashed border-border bg-muted/40 py-16 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Newspaper className="h-7 w-7 text-primary" />
            </span>
            <h2 className="mt-4 text-h2 text-foreground">
              Muy pronto, contenido nuevo
            </h2>
            <p className="mt-1 max-w-md text-muted-foreground">
              Estamos preparando artículos para ayudarte a sacar el máximo provecho de
              MembeGo. Mientras tanto, explora la plataforma.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/caracteristicas"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-primary-foreground shadow-glow transition hover:opacity-95"
              >
                Ver características <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/empresas"
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 font-semibold text-foreground transition hover:bg-muted"
              >
                Explorar empresas
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {ARTICULOS.map((a) => (
              <Link
                key={a.slug}
                href={`/blog/${a.slug}`}
                className="rounded-2xl border border-border/80 bg-card p-6 shadow-card transition hover:shadow-premium"
              >
                <p className="text-caption text-muted-foreground">{a.fecha}</p>
                <h2 className="mt-1 font-semibold text-foreground">{a.titulo}</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">{a.resumen}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
