import Link from 'next/link'
import Form from 'next/form'
import { Search, X } from 'lucide-react'
import {
  DIAS_INACTIVO,
  ORDENES,
  ORDEN_LABEL,
  ROLES_FILTRABLES,
  ROL_FILTRO_LABEL,
  fichasDeFiltro,
  hayFiltro,
  type FiltroUsuarios,
} from '@/modules/usuarios/filtros'

const BASE = '/superadmin/usuarios'

/**
 * Filtros del control de accesos, en el servidor y con etiqueta visible.
 *
 * `next/form` = navegación normal con los valores en la URL: sin JavaScript de
 * cliente, con el «atrás» del navegador funcionando y con el filtro aplicado
 * compartible por enlace. Mismo patrón que el CRM de empresas, a propósito: dos
 * pantallas del mismo panel que se filtran de dos maneras distintas obligan a
 * aprender dos veces lo mismo.
 */
export function FiltrosUsuarios({
  f,
  empresas,
}: {
  f: FiltroUsuarios
  empresas: { id: string; name: string; esDemo: boolean }[]
}) {
  const fichas = fichasDeFiltro(f, BASE, empresas)
  const clase = 'h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground'

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
            placeholder="Nombre o correo…"
            className={`${clase} w-full pl-9`}
          />
        </div>

        <div>
          <label htmlFor="rol" className="mb-1 block text-caption text-muted-foreground">
            Rol
          </label>
          <select id="rol" name="rol" defaultValue={f.rol} className={clase}>
            {ROLES_FILTRABLES.map((r) => (
              <option key={r} value={r}>
                {ROL_FILTRO_LABEL[r]}
              </option>
            ))}
          </select>
        </div>

        {empresas.length > 0 && (
          <div>
            <label htmlFor="empresa" className="mb-1 block text-caption text-muted-foreground">
              Empresa
            </label>
            <select
              id="empresa"
              name="empresa"
              defaultValue={f.empresa ?? 'todas'}
              className={clase}
            >
              <option value="todas">Todas</option>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.esDemo ? `${e.name} (práctica)` : e.name}
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

        {/* Casilla y no desplegable: es una pregunta de sí o no, y la respuesta
            «no» es el estado normal de la pantalla. */}
        <label className="flex h-10 items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="inactivos"
            value="1"
            defaultChecked={f.inactivos}
            className="h-4 w-4 rounded border-border"
          />
          Sin actividad en {DIAS_INACTIVO} días
        </label>

        <button
          type="submit"
          className="h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Aplicar
        </button>
      </Form>

      {/* Lo aplicado, a la vista y quitable de uno en uno. Sin esto hay que
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
