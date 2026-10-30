'use client'

import { useMemo, useState } from 'react'
import { PlayCircle, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import {
  agruparPorModulo,
  buscarTutoriales,
  duracionLegible,
  MODULOS_TUTORIALES,
  TUTORIALES,
  urlCartel,
  type Tutorial,
} from '@/modules/tutoriales/catalogo'
import { ReproductorTutorial } from './ReproductorTutorial'

/** Buscador, filtro por módulo y tarjetas de todos los tutoriales; cada tarjeta abre su video en un diálogo. */
export function GaleriaTutoriales({ consultaInicial = '', abiertoInicial = null }: { consultaInicial?: string; abiertoInicial?: string | null }) {
  const [consulta, setConsulta] = useState(consultaInicial)
  const [modulo, setModulo] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<Tutorial | null>(() => TUTORIALES.find((t) => t.id === abiertoInicial) ?? null)

  const resultados = useMemo(() => {
    const porTexto = buscarTutoriales(consulta)
    return modulo ? porTexto.filter((t) => t.modulo === modulo) : porTexto
  }, [consulta, modulo])
  // Con una búsqueda se muestran por relevancia; sin ella, agrupados como el menú.
  const grupos = useMemo(() => (consulta.trim() ? [{ modulo: '', tutoriales: resultados }] : agruparPorModulo(resultados)), [consulta, resultados])

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="¿Qué quieres hacer? Por ejemplo: crear una promoción"
            aria-label="Buscar tutorial"
            className="pl-9"
            autoFocus
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por módulo">
          <Chip activo={modulo === null} onClick={() => setModulo(null)}>Todos</Chip>
          {MODULOS_TUTORIALES.map((m) => (
            <Chip key={m} activo={modulo === m} onClick={() => setModulo(modulo === m ? null : m)}>{m}</Chip>
          ))}
        </div>
      </div>

      {resultados.length === 0 ? (
        <EmptyState
          icon={<Search className="size-6" aria-hidden />}
          title="No hay tutoriales con esas palabras"
          description="Prueba con el nombre de la pantalla o de la acción: «validar un pago», «segmento», «inventario»."
        />
      ) : (
        grupos.map((g) => (
          <section key={g.modulo || 'resultados'} className="space-y-3">
            {g.modulo && <h2 className="text-label-lg text-muted-foreground">{g.modulo}</h2>}
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {g.tutoriales.map((t) => (
                <li key={t.id}>
                  <TarjetaTutorial tutorial={t} onAbrir={() => setAbierto(t)} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <Dialog open={abierto !== null} onOpenChange={(o) => { if (!o) setAbierto(null) }}>
        <DialogContent className="max-w-3xl">
          {abierto && (
            <>
              <DialogHeader>
                <DialogTitle>{abierto.titulo}</DialogTitle>
                <DialogDescription>{abierto.modulo} · {duracionLegible(abierto.duracionS)}</DialogDescription>
              </DialogHeader>
              <ReproductorTutorial tutorial={abierto} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition-colors duration-fast',
        activo ? 'border-primary bg-primary text-primary-foreground' : 'border-border/70 bg-card text-foreground hover:bg-muted'
      )}
    >
      {children}
    </button>
  )
}

/** Cartel, título y duración; el botón entero abre el video. */
export function TarjetaTutorial({ tutorial, onAbrir }: { tutorial: Tutorial; onAbrir: () => void }) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="group flex w-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-card text-left shadow-sm transition-shadow duration-fast hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="relative block aspect-video w-full bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- cartel externo de Storage, sin optimizar */}
        <img src={urlCartel(tutorial.id)} alt="" className="size-full object-cover" loading="lazy" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-fast group-hover:bg-black/20">
          <PlayCircle className="size-10 text-white opacity-80 drop-shadow transition-opacity group-hover:opacity-100" aria-hidden />
        </span>
        <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
          {duracionLegible(tutorial.duracionS)}
        </span>
      </span>
      <span className="block p-3">
        <span className="block text-sm font-medium leading-snug">{tutorial.titulo}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{tutorial.modulo}</span>
      </span>
    </button>
  )
}
