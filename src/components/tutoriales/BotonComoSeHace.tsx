'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CircleHelp, PlayCircle } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { buscarTutoriales, duracionLegible, tutorialesDeRuta, urlCartel, type Tutorial } from '@/modules/tutoriales/catalogo'
import { ReproductorTutorial } from './ReproductorTutorial'

/**
 * «¿Cómo se hace?» en la cabecera: abre un panel lateral con los tutoriales de la pantalla en la que está la
 * persona (por la ruta), un buscador sobre todos y el enlace a la página completa. Los videos son públicos y
 * no dependen de la empresa, así que el botón se ofrece a todos los roles.
 */
export function BotonComoSeHace() {
  const pathname = usePathname()
  const [abierto, setAbierto] = useState(false)
  const [consulta, setConsulta] = useState('')
  const [activo, setActivo] = useState<Tutorial | null>(null)

  const dePantalla = useMemo(() => tutorialesDeRuta(pathname), [pathname])
  const lista = consulta.trim() ? buscarTutoriales(consulta) : dePantalla
  const modulo = dePantalla[0]?.modulo

  const cambiar = (o: boolean) => {
    setAbierto(o)
    if (!o) { setActivo(null); setConsulta('') }
  }

  return (
    <Sheet open={abierto} onOpenChange={cambiar}>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border/70 bg-card px-3 text-label-lg text-foreground shadow-sm transition-colors duration-fast hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
        aria-label="¿Cómo se hace? Tutoriales de esta pantalla"
      >
        <CircleHelp className="size-4" aria-hidden />
        <span className="hidden lg:inline">¿Cómo se hace?</span>
      </button>
      <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{modulo ? `Tutoriales de ${modulo}` : 'Tutoriales'}</SheetTitle>
          <SheetDescription>
            {dePantalla.length > 0
              ? 'Videos cortos sobre lo que puedes hacer en esta pantalla.'
              : 'Esta pantalla todavía no tiene tutoriales propios; busca en todos.'}
          </SheetDescription>
        </SheetHeader>

        {activo && (
          <div className="space-y-2">
            <ReproductorTutorial tutorial={activo} compacto />
            <p className="text-sm font-medium">{activo.titulo}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{activo.texto}</p>
          </div>
        )}

        <Input
          type="search"
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          placeholder="Buscar en todos los tutoriales…"
          aria-label="Buscar tutorial"
        />

        {lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay tutoriales con esas palabras.</p>
        ) : (
          <ul className="space-y-1">
            {lista.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setActivo(t)}
                  aria-current={activo?.id === t.id ? 'true' : undefined}
                  className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors duration-fast hover:bg-muted aria-[current=true]:bg-muted"
                >
                  <span className="relative block w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element -- cartel externo de Storage */}
                    <img
                      src={urlCartel(t.id)}
                      alt=""
                      className="aspect-video w-full object-cover"
                      loading="lazy"
                      onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
                    />
                    <PlayCircle className="absolute inset-0 m-auto size-6 text-white opacity-90 drop-shadow" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{t.titulo}</span>
                    <span className="block text-xs text-muted-foreground">{t.modulo} · {duracionLegible(t.duracionS)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <Link
          href="/admin/tutoriales"
          onClick={() => cambiar(false)}
          className="mt-auto inline-flex items-center justify-center rounded-lg border border-border/70 px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          Ver todos los tutoriales
        </Link>
      </SheetContent>
    </Sheet>
  )
}
