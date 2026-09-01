'use client'

import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { TabsNav } from '@/components/ui/tabs-nav'
import { TarjetaIntegracion } from '@/components/connect/TarjetaIntegracion'
import type { EntradaCatalogo } from '@/modules/connect/catalogo'
import { ESTADOS_PROPIOS } from '@/modules/connect/proveedores/tipos'

/**
 * EL CATÁLOGO: pestañas, buscador, filtro por categoría y rejilla.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DISPONIBLES Y PREVISTAS, SEPARADAS
 *
 * Lo previsto no se mezcla con lo que funciona: va en su propio bloque, al
 * final, bajo su propio título. Intercaladas parecerían equivalentes, y quien
 * mirara la rejilla creería que Membego ya conecta con trece servicios.
 *
 * El filtrado ocurre en el navegador y NO es una autorización: qué puede ver y
 * conectar cada empresa ya lo decidió el servidor al construir esta lista.
 * Aquí solo se esconden tarjetas de una lista que ya venía recortada.
 */
export function CatalogoIntegraciones({ entradas }: { entradas: EntradaCatalogo[] }) {
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState<string | null>(null)
  const [soloMias, setSoloMias] = useState(false)

  const mias = useMemo(
    () => entradas.filter((e) => (ESTADOS_PROPIOS as readonly string[]).includes(e.estado)),
    [entradas]
  )

  const categorias = useMemo(() => {
    const vistas = new Map<string, string>()
    for (const e of entradas) vistas.set(e.categoria, e.categoriaLabel)
    return [...vistas].sort((a, b) => a[1].localeCompare(b[1], 'es'))
  }, [entradas])

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const base = soloMias ? mias : entradas
    return base.filter((e) => {
      if (categoria && e.categoria !== categoria) return false
      if (!q) return true
      return (
        e.nombre.toLowerCase().includes(q) ||
        e.descripcion.toLowerCase().includes(q) ||
        e.categoriaLabel.toLowerCase().includes(q)
      )
    })
  }, [busqueda, categoria, entradas, mias, soloMias])

  const disponibles = filtradas.filter((e) => e.estado !== 'PROXIMAMENTE')
  const previstas = filtradas.filter((e) => e.estado === 'PROXIMAMENTE')

  return (
    <div className="space-y-4">
      <TabsNav
        aria-label="Integraciones"
        items={[
          {
            label: 'Todas',
            badge: entradas.length,
            active: !soloMias,
            render: ({ className, children }) => (
              <button type="button" className={className} onClick={() => setSoloMias(false)}>
                {children}
              </button>
            ),
          },
          {
            label: 'Mis integraciones',
            badge: mias.length,
            active: soloMias,
            render: ({ className, children }) => (
              <button type="button" className={className} onClick={() => setSoloMias(true)}>
                {children}
              </button>
            ),
          },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar una aplicación…"
            aria-label="Buscar integraciones"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={categoria === null ? 'secondary' : 'ghost'}
            onClick={() => setCategoria(null)}
          >
            Todas
          </Button>
          {categorias.map(([clave, etiqueta]) => (
            <Button
              key={clave}
              type="button"
              size="sm"
              variant={categoria === clave ? 'secondary' : 'ghost'}
              onClick={() => setCategoria((v) => (v === clave ? null : clave))}
            >
              {etiqueta}
            </Button>
          ))}
        </div>
      </div>

      {filtradas.length === 0 ? (
        <EmptyState
          icon={<X className="h-6 w-6" aria-hidden />}
          title="Nada coincide con esa búsqueda"
          description={
            soloMias
              ? 'Todavía no has conectado ninguna aplicación. Cambia a «Todas» para ver lo que hay.'
              : 'Prueba con otro nombre o quita el filtro de categoría.'
          }
        />
      ) : (
        <div className="space-y-6">
          {disponibles.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {disponibles.map((e) => (
                <TarjetaIntegracion key={e.slug} entrada={e} />
              ))}
            </div>
          )}

          {previstas.length > 0 && (
            <section className="space-y-3">
              <div>
                <h2 className="text-sm font-bold">Próximamente</h2>
                <p className="text-caption text-muted-foreground">
                  Todavía no se pueden conectar. Están aquí para que veas hacia dónde va Membego.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {previstas.map((e) => (
                  <TarjetaIntegracion key={e.slug} entrada={e} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
