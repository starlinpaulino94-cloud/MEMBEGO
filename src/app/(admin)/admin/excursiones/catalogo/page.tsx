import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { listarExcursiones } from '@/modules/excursiones/catalogo/queries'
import { OPCIONES_VER_CATALOGO, leerFiltrosCatalogo } from '@/modules/excursiones/catalogo/lista'
import { urlConFiltros } from '@/modules/admin/filtrosComunes'
import { leerPaginacion } from '@/lib/paginacion'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { Button } from '@/components/ui/button'
import { BarraFiltros } from '@/components/ui/barra-filtros'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { CatalogoTabla } from '@/components/excursiones/CatalogoTabla'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Catálogo de actividades' }

/**
 * EL CATÁLOGO DE ACTIVIDADES (auditoría admin · fase 7, tarea 7.1; 06 · T-04, T-05).
 *
 * Búsqueda, estado y página viajan en la URL y los resuelve la base sobre TODAS las actividades: antes la consulta traía todas
 * y el navegador filtraba sin paginar. Por defecto se ven las que no están archivadas; las archivadas se piden con «Todas».
 */
export default async function CatalogoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="el catálogo de actividades" />

  const sp = await searchParams
  const { q, ver } = leerFiltrosCatalogo(sp)
  const paginacion = leerPaginacion(sp)
  const { filas, total, hayAlgunaSinFiltro } = await listarExcursiones(companyId, { q, ver, paginacion })

  const hayFiltros = Boolean(q) || ver !== 'activas'
  const base = '/admin/excursiones/catalogo'
  const soloArchivadas = !hayFiltros && total === 0 && hayAlgunaSinFiltro

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Lo que tu empresa vende: cada actividad con sus variantes, precios y horarios.</p>
        <Button asChild>
          <Link href="/admin/excursiones/catalogo/nueva">
            <Plus className="mr-1.5 h-4 w-4" /> Nueva actividad
          </Link>
        </Button>
      </div>

      <BarraFiltros
        busqueda={{ nombre: 'q', valor: q, etiqueta: 'Buscar', placeholder: 'Nombre o categoría de la actividad…' }}
        filtros={[{ nombre: 'ver', etiqueta: 'Mostrar', valor: ver === 'activas' ? '' : ver, opciones: OPCIONES_VER_CATALOGO, todas: 'Activas' }]}
        hrefSin={(nombre) => urlConFiltros(base, sp, { [nombre]: undefined })}
        hrefLimpiar={base}
        enlace={({ href, ...resto }) => <Link href={href} {...resto} />}
      />

      <CatalogoTabla
        filas={filas}
        hayFiltros={hayFiltros || soloArchivadas}
        vacio={{
          titulo: 'Todavía no tienes actividades',
          descripcion: 'Crea tu primera actividad con su precio y sus horarios: es el catálogo sobre el que venderán tus vendedores.',
          accion: (
            <Button asChild size="lg">
              <Link href="/admin/excursiones/catalogo/nueva">Crear actividad</Link>
            </Button>
          ),
        }}
        sinResultados={
          soloArchivadas
            ? {
                titulo: 'No hay actividades activas',
                descripcion: 'Todas las que existen están archivadas.',
                accion: (
                  <Link href={urlConFiltros(base, sp, { ver: 'todas' })} className="text-small font-medium text-primary hover:underline">
                    Ver todas
                  </Link>
                ),
              }
            : {
                titulo: q ? 'Ninguna actividad coincide con la búsqueda' : 'Ninguna actividad en este estado',
                descripcion: 'Prueba con otro nombre o categoría, o cambia lo que se muestra.',
                accion: (
                  <Link href={base} className="text-small font-medium text-primary hover:underline">
                    Limpiar filtros
                  </Link>
                ),
              }
        }
        pie={<TablaPaginacion paginacion={paginacion} total={total} params={sp} etiqueta="actividades" />}
      />
    </div>
  )
}
