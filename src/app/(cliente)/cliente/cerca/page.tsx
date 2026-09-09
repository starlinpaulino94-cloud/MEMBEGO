import { requireRole } from '@/lib/auth/guards'
import { MapaCercaDeMi } from '@/components/geo/MapaCercaDeMi'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Cerca de mí',
  description: 'Descubre negocios y ofertas cerca de ti',
}

/**
 * Cerca de mí — el mapa ES la pantalla (DS 2.0 · Fase 5).
 *
 * Antes vivía dentro del contenedor de página, con título encima y la altura
 * de una tarjeta: en un teléfono quedaba media pantalla de mapa y media de
 * lista, sin que ninguna de las dos sirviera bien. Ahora el mapa ocupa todo y
 * los resultados llegan en una hoja inferior.
 *
 * Los márgenes negativos cancelan el padding del shell. Es la ÚNICA excepción
 * a la regla de "una pantalla no declara su propio contenedor", y está
 * justificada: una experiencia a sangre necesita el ancho completo.
 *
 * OJO: los valores replican los de `CustomerShell` (`px-4 py-4 lg:px-6`) —
 * los anteriores replicaban el AppShell del personal (`px-8`, `py-8`) y desde
 * que el cliente vive en su propia carcasa el mapa quedaba descuadrado: se
 * pasaba de ancho en escritorio y se comía la cabecera en móvil.
 */
export default async function CercaPage() {
  const user = await requireRole('CLIENTE')

  return (
    <div className="-mx-4 -my-4 lg:-mx-6">
      <h1 className="sr-only">Cerca de mí</h1>
      <MapaCercaDeMi userId={user.metadata.dbUserId} />
    </div>
  )
}
