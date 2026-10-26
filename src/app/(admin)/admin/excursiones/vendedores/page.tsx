import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { listarVendedores } from '@/modules/excursiones/vendedores/queries'
import { OPCIONES_VER_VENDEDORES, leerFiltrosVendedores } from '@/modules/excursiones/vendedores/lista'
import { urlConFiltros } from '@/modules/admin/filtrosComunes'
import { leerPaginacion } from '@/lib/paginacion'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { Button } from '@/components/ui/button'
import { BarraFiltros } from '@/components/ui/barra-filtros'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { VendedoresTabla } from '@/components/excursiones/VendedoresTabla'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Vendedores' }

/**
 * LOS VENDEDORES (auditoría admin · fase 7, tarea 7.1; 06 · T-04, T-05).
 *
 * Búsqueda, estado y página viajan en la URL y los resuelve la base sobre TODO el equipo: antes la consulta traía a todos y el
 * navegador filtraba sin paginar. Por defecto se ven los que no están inactivos; los inactivos se piden con «Todos».
 */
export default async function VendedoresPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="los vendedores de excursiones" />

  const sp = await searchParams
  const { q, ver } = leerFiltrosVendedores(sp)
  const paginacion = leerPaginacion(sp)
  const { filas, total, hayAlgunoSinFiltro } = await listarVendedores(companyId, { q, ver, paginacion })

  const hayFiltros = Boolean(q) || ver !== 'activos'
  const base = '/admin/excursiones/vendedores'
  const soloInactivos = !hayFiltros && total === 0 && hayAlgunoSinFiltro

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Tu equipo comercial: cada vendedor con su código, su enlace y su QR. Los clientes que se registren por su QR quedan atribuidos a él.
        </p>
        <Button asChild>
          <Link href="/admin/excursiones/vendedores/nuevo">
            <Plus className="mr-1.5 h-4 w-4" /> Nuevo vendedor
          </Link>
        </Button>
      </div>

      <BarraFiltros
        busqueda={{ nombre: 'q', valor: q, etiqueta: 'Buscar', placeholder: 'Nombre, código, tipo o teléfono…' }}
        filtros={[{ nombre: 'ver', etiqueta: 'Mostrar', valor: ver === 'activos' ? '' : ver, opciones: OPCIONES_VER_VENDEDORES, todas: 'Activos y suspendidos' }]}
        hrefSin={(nombre) => urlConFiltros(base, sp, { [nombre]: undefined })}
        hrefLimpiar={base}
        enlace={({ href, ...resto }) => <Link href={href} {...resto} />}
      />

      <VendedoresTabla
        filas={filas}
        hayFiltros={hayFiltros || soloInactivos}
        vacio={{
          titulo: 'Todavía no tienes vendedores',
          descripcion:
            'Crea tu primer vendedor para comenzar a medir registros, ventas y comisiones. Al crearlo, MembeGo le genera su código, su enlace y su QR.',
          accion: (
            <Button asChild size="lg">
              <Link href="/admin/excursiones/vendedores/nuevo">Crear vendedor</Link>
            </Button>
          ),
        }}
        sinResultados={
          soloInactivos
            ? {
                titulo: 'No hay vendedores activos',
                descripcion: 'Todos los que existen están inactivos.',
                accion: (
                  <Link href={urlConFiltros(base, sp, { ver: 'todas' })} className="text-small font-medium text-primary hover:underline">
                    Ver todos
                  </Link>
                ),
              }
            : {
                titulo: q ? 'Ningún vendedor coincide con la búsqueda' : 'Ningún vendedor en este estado',
                descripcion: 'Prueba con otro nombre, código o teléfono, o cambia lo que se muestra.',
                accion: (
                  <Link href={base} className="text-small font-medium text-primary hover:underline">
                    Limpiar filtros
                  </Link>
                ),
              }
        }
        pie={<TablaPaginacion paginacion={paginacion} total={total} params={sp} etiqueta="vendedores" />}
      />
    </div>
  )
}
