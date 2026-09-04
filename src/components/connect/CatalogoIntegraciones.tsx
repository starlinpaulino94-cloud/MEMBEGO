'use client'

import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { TabsNav } from '@/components/ui/tabs-nav'
import { TarjetaIntegracion } from '@/components/connect/TarjetaIntegracion'
import type { EntradaCatalogo } from '@/modules/connect/catalogo'
import { ESTADOS_PROPIOS } from '@/modules/connect/proveedores/tipos'

/**
 * EL CATÁLOGO: pestañas, buscador, píldoras de categoría y rejilla.
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
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS PESTAÑAS Y UNA FILA DE PÍLDORAS
 *
 * «Explorar» es todo el catálogo; «Mis integraciones», solo lo que la empresa
 * ya tiene suyo. Las categorías son píldoras redondas —la activa rellena con
 * el color de marca— y no botones: son filtros, y un filtro se lee de un
 * vistazo cuando tiene la forma de una etiqueta.
 */

function Pildora({
  activa,
  onClick,
  children,
}: {
  activa: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={activa}
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium outline-none transition-colors duration-fast focus-visible:ring-2 focus-visible:ring-ring',
        activa
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

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
    <div className="space-y-6">
      <TabsNav
        aria-label="Integraciones"
        items={[
          {
            label: 'Explorar',
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

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {/* Las píldoras se ARRASTRAN en horizontal en móvil en vez de apilarse:
            ocho categorías envueltas en tres filas empujaban la rejilla fuera
            de la primera pantalla. Mismo patrón que las pestañas. */}
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 sm:mx-0 sm:flex-1 sm:flex-wrap sm:overflow-visible sm:px-0">
          <Pildora activa={categoria === null} onClick={() => setCategoria(null)}>
            Todas
          </Pildora>
          {categorias.map(([clave, etiqueta]) => (
            <Pildora
              key={clave}
              activa={categoria === clave}
              onClick={() => setCategoria((v) => (v === clave ? null : clave))}
            >
              {etiqueta}
            </Pildora>
          ))}
        </div>

        {/* En un teléfono el buscador ocupa su propia línea: compartirla con
            ocho filtros lo dejaba en un hueco donde no cabe una palabra. */}
        <div className="relative w-full sm:w-64">
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
      </div>

      {filtradas.length === 0 ? (
        <EmptyState
          icon={<X className="h-6 w-6" aria-hidden />}
          title="Nada coincide con esa búsqueda"
          description={
            soloMias
              ? 'Todavía no has conectado ninguna aplicación. Cambia a «Explorar» para ver lo que hay.'
              : 'Prueba con otro nombre o quita el filtro de categoría.'
          }
        />
      ) : (
        <div className="space-y-8">
          {disponibles.length > 0 && (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {disponibles.map((e) => (
                <TarjetaIntegracion key={e.slug} entrada={e} />
              ))}
            </div>
          )}

          {previstas.length > 0 && (
            <section className="space-y-3">
              <div>
                <h2 className="text-h4 font-bold">Próximamente</h2>
                <p className="text-caption text-muted-foreground">
                  Todavía no se pueden conectar. Están aquí para que veas hacia dónde va Membego.
                </p>
              </div>
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
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
