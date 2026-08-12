import Link from 'next/link'
import Form from 'next/form'
import { Search, X } from 'lucide-react'
import {
  AMBITOS,
  AMBITO_LABEL,
  ESTADOS,
  ESTADO_LABEL,
  ORDENES,
  ORDEN_LABEL,
  fichasDeFiltro,
  hayFiltro,
  type FiltroEmpresas,
} from '@/modules/empresas/filtros'

const BASE = '/superadmin/empresas'

/**
 * Filtros del CRM, en el servidor y con etiqueta visible.
 *
 * DOS COSAS QUE ESTABAN MAL Y NO ERAN DE ESTILO:
 *
 * · Los desplegables decían «Todos» y «Todas» sin decir de QUÉ. Había que
 *   abrirlos para saber si el primero era estado, categoría o ciudad. La
 *   etiqueta va ahora dentro del propio control.
 *
 * · Los de categoría y ciudad no tenían NI UNA opción, porque la consulta del
 *   listado no seleccionaba esos campos y llegaban siempre `null`. Un filtro que
 *   no filtra nada es peor que no tenerlo: ocupa sitio y enseña que la pantalla
 *   no responde.
 *
 * `next/form` = navegación normal con los valores en la URL. Sin JavaScript de
 * cliente, con el «atrás» del navegador funcionando, y el filtro aplicado se
 * puede compartir por enlace.
 */
export function FiltrosEmpresas({
  f,
  categorias,
  ciudades,
  hayDemos,
}: {
  f: FiltroEmpresas
  categorias: string[]
  ciudades: string[]
  hayDemos: boolean
}) {
  const fichas = fichasDeFiltro(f, BASE)
  const clase =
    'h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground'

  return (
    <div className="space-y-3">
      <Form action={BASE} className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="relative flex-1 lg:max-w-sm">
          <label htmlFor="q" className="mb-1 block text-caption text-muted-foreground">
            Buscar
          </label>
          <Search
            aria-hidden
            className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-muted-foreground"
          />
          <input
            id="q"
            name="q"
            defaultValue={f.q}
            placeholder="Nombre, correo o ciudad…"
            className={`${clase} w-full pl-9`}
          />
        </div>

        <div>
          <label htmlFor="estado" className="mb-1 block text-caption text-muted-foreground">
            Estado
          </label>
          <select id="estado" name="estado" defaultValue={f.estado} className={clase}>
            {ESTADOS.map((e) => (
              <option key={e} value={e}>
                {ESTADO_LABEL[e]}
              </option>
            ))}
          </select>
        </div>

        {/* El ámbito solo aparece si hay empresas de práctica: un filtro que
            siempre da lo mismo es ruido. */}
        {hayDemos && (
          <div>
            <label htmlFor="ambito" className="mb-1 block text-caption text-muted-foreground">
              Incluir
            </label>
            <select id="ambito" name="ambito" defaultValue={f.ambito} className={clase}>
              {AMBITOS.map((a) => (
                <option key={a} value={a}>
                  {AMBITO_LABEL[a]}
                </option>
              ))}
            </select>
          </div>
        )}

        {categorias.length > 0 && (
          <div>
            <label htmlFor="categoria" className="mb-1 block text-caption text-muted-foreground">
              Categoría
            </label>
            <select
              id="categoria"
              name="categoria"
              defaultValue={f.categoria ?? 'todas'}
              className={clase}
            >
              <option value="todas">Todas</option>
              {categorias.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}

        {ciudades.length > 0 && (
          <div>
            <label htmlFor="ciudad" className="mb-1 block text-caption text-muted-foreground">
              Ciudad
            </label>
            <select id="ciudad" name="ciudad" defaultValue={f.ciudad ?? 'todas'} className={clase}>
              <option value="todas">Todas</option>
              {ciudades.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label htmlFor="orden" className="mb-1 block text-caption text-muted-foreground">
            Ordenar por
          </label>
          <select id="orden" name="orden" defaultValue={f.orden} className={clase}>
            {ORDENES.map((o) => (
              <option key={o} value={o}>
                {ORDEN_LABEL[o]}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Aplicar
        </button>
      </Form>

      {/* Lo aplicado, a la vista y quitable de una en una. Sin esto hay que
          abrir cada desplegable para saber por qué la lista está corta. */}
      {fichas.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {fichas.map((ficha) => (
            <Link
              key={ficha.clave}
              href={ficha.quitarHref}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-caption text-foreground hover:bg-muted"
              aria-label={`Quitar filtro ${ficha.texto}`}
            >
              {ficha.texto}
              <X aria-hidden className="h-3 w-3" />
            </Link>
          ))}
          {hayFiltro(f) && (
            <Link href={BASE} className="text-caption text-primary hover:underline">
              Limpiar todo
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
