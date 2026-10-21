import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { listarReservas } from '@/modules/excursiones/reservas/queries'
import { OPCIONES_VER_RESERVAS, leerFiltrosReservas } from '@/modules/excursiones/reservas/lista'
import { urlConFiltros } from '@/modules/admin/filtrosComunes'
import { leerPaginacion } from '@/lib/paginacion'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { Button } from '@/components/ui/button'
import { BarraFiltros } from '@/components/ui/barra-filtros'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { ReservasTabla } from '@/components/excursiones/ReservasTabla'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reservas' }

/**
 * LAS RESERVAS (auditoría admin · fase 7, tarea 7.1; 06 · T-04, T-05).
 *
 * Búsqueda, estado y página viajan en la URL y los resuelve la base sobre TODAS las reservas: antes la consulta traía 200 y la
 * búsqueda y las «archivadas» filtraban esas 200 en el navegador, así que la reserva 201 no se podía alcanzar y un «sin
 * resultados» podía ser mentira. Por defecto se ven las abiertas; las cerradas (completadas, canceladas, no se presentó) se piden
 * con «Todas».
 */
export default async function ReservasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las reservas de excursiones" />

  const sp = await searchParams
  const { q, ver } = leerFiltrosReservas(sp)
  const paginacion = leerPaginacion(sp)
  const { filas, total, hayAlgunaSinFiltro } = await listarReservas(companyId, { q, ver, paginacion })

  const hayFiltros = Boolean(q) || ver !== 'abiertas'
  const base = '/admin/excursiones/reservas'
  const hrefSin = (nombre: string) => urlConFiltros(base, sp, { [nombre]: undefined })
  const crear = (
    <Button asChild>
      <Link href="/admin/excursiones/reservas/nueva">
        <Plus className="mr-1.5 h-4 w-4" /> Nueva reserva
      </Link>
    </Button>
  )

  // «Abiertas» sin nada: puede ser que no haya reservas, o que todas estén cerradas. Se dice cuál de las dos.
  const soloCerradas = !hayFiltros && total === 0 && hayAlgunaSinFiltro

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Cada reserva congela su precio y su vendedor al crearse: lo que se cobre después no cambia lo que ya se pactó.
        </p>
        {crear}
      </div>

      <BarraFiltros
        busqueda={{ nombre: 'q', valor: q, etiqueta: 'Buscar', placeholder: 'Número, cliente, excursión o vendedor…' }}
        filtros={[{ nombre: 'ver', etiqueta: 'Mostrar', valor: ver === 'abiertas' ? '' : ver, opciones: OPCIONES_VER_RESERVAS, todas: 'Abiertas' }]}
        hrefSin={hrefSin}
        hrefLimpiar={base}
        enlace={({ href, ...resto }) => <Link href={href} {...resto} />}
      />

      <ReservasTabla
        filas={filas}
        hayFiltros={hayFiltros || soloCerradas}
        vacio={{
          titulo: 'Todavía no hay reservas',
          descripcion: 'Crea la primera reserva: elige el cliente, la excursión y la fecha. MembeGo calcula el total con los precios del catálogo y le pone su número.',
          accion: (
            <Button asChild size="lg">
              <Link href="/admin/excursiones/reservas/nueva">Crear reserva</Link>
            </Button>
          ),
        }}
        sinResultados={
          soloCerradas
            ? {
                titulo: 'No hay reservas abiertas',
                descripcion: 'Todas las que existen ya están cerradas (completadas, canceladas o sin presentarse).',
                accion: (
                  <Link href={urlConFiltros(base, sp, { ver: 'todas' })} className="text-small font-medium text-primary hover:underline">
                    Ver todas
                  </Link>
                ),
              }
            : {
                titulo: q ? 'Ninguna reserva coincide con la búsqueda' : 'Ninguna reserva en este estado',
                descripcion: 'Prueba con otro número o nombre, o cambia lo que se muestra.',
                accion: (
                  <Link href={base} className="text-small font-medium text-primary hover:underline">
                    Limpiar filtros
                  </Link>
                ),
              }
        }
        pie={<TablaPaginacion paginacion={paginacion} total={total} params={sp} etiqueta="reservas" />}
      />
    </div>
  )
}
