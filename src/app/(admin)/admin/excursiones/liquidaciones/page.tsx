import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { listarLiquidaciones, vendedoresPorLiquidar } from '@/modules/excursiones/liquidaciones/queries'
import {
  OPCIONES_ESTADO_LIQUIDACION,
  hayFiltrosLiquidaciones,
  leerFiltrosLiquidaciones,
} from '@/modules/excursiones/liquidaciones/lista'
import { vendedoresParaFiltro } from '@/modules/excursiones/comisiones/queries'
import { getExcursionesConfig } from '@/modules/excursiones/config'
import { urlConFiltros } from '@/modules/admin/filtrosComunes'
import { leerPaginacion } from '@/lib/paginacion'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { LiquidacionForm } from '@/components/excursiones/LiquidacionForm'
import { LiquidacionesTabla } from '@/components/excursiones/LiquidacionesTabla'
import { BarraFiltros } from '@/components/ui/barra-filtros'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Liquidaciones' }

/**
 * LAS LIQUIDACIONES (auditoría admin · fase 7, tarea 7.1; 06 · T-04, T-05).
 *
 * Búsqueda, vendedor, estado, período y página viajan en la URL y los resuelve la base sobre TODAS las liquidaciones: antes la
 * consulta traía las 200 más recientes y el navegador filtraba esas.
 */
export default async function LiquidacionesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las liquidaciones de excursiones" />

  const sp = await searchParams
  const filtros = leerFiltrosLiquidaciones(sp)
  const paginacion = leerPaginacion(sp)
  const [{ filas, total }, pendientes, config, vendedores] = await Promise.all([
    listarLiquidaciones(companyId, { filtros, paginacion }),
    vendedoresPorLiquidar(companyId),
    getExcursionesConfig(companyId),
    vendedoresParaFiltro(companyId),
  ])

  const base = '/admin/excursiones/liquidaciones'
  const hayFiltros = hayFiltrosLiquidaciones(filtros)

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <p className="text-sm text-muted-foreground">
        Una liquidación agrupa las comisiones aprobadas de un vendedor en un período y las paga
        de una vez. Una comisión entra en una sola liquidación: nadie cobra dos veces lo mismo.
      </p>

      <LiquidacionForm pendientes={pendientes} />

      <section className="space-y-4" aria-labelledby="historial-liquidaciones">
        <h2 id="historial-liquidaciones" className="text-h3 text-foreground">
          Historial de liquidaciones
        </h2>

        <BarraFiltros
          busqueda={{ nombre: 'q', valor: filtros.q, etiqueta: 'Buscar', placeholder: 'Número o vendedor…' }}
          filtros={[
            {
              nombre: 'vendedor',
              etiqueta: 'Vendedor',
              valor: filtros.vendedor,
              opciones: vendedores.map((v) => ({ valor: v.id, etiqueta: `${v.nombre} (${v.codigo})` })),
              todas: 'Todos los vendedores',
            },
            { nombre: 'estado', etiqueta: 'Estado', valor: filtros.estado, opciones: OPCIONES_ESTADO_LIQUIDACION, todas: 'Todos los estados' },
          ]}
          fechas={[
            { nombre: 'desde', etiqueta: 'Período desde', valor: filtros.desde },
            { nombre: 'hasta', etiqueta: 'hasta', valor: filtros.hasta },
          ]}
          hrefSin={(nombre) => urlConFiltros(base, sp, { [nombre]: undefined })}
          hrefLimpiar={base}
          enlace={({ href, ...resto }) => <Link href={href} {...resto} />}
        />

        <LiquidacionesTabla
          filas={filas}
          monedaDefecto={config.monedaDefecto}
          hayFiltros={hayFiltros}
          vacio={{
            titulo: 'Todavía no hay liquidaciones',
            descripcion: 'Cuando liquides las comisiones aprobadas de un vendedor, el pago queda aquí con su recibo.',
          }}
          sinResultados={{
            titulo: 'Ninguna liquidación coincide con los filtros',
            descripcion: 'Prueba con otro vendedor, estado o período, o quita algún filtro. El período tiene que caer entero dentro del rango.',
            accion: (
              <Link href={base} className="text-small font-medium text-primary hover:underline">
                Limpiar filtros
              </Link>
            ),
          }}
          pie={<TablaPaginacion paginacion={paginacion} total={total} params={sp} etiqueta="liquidaciones" />}
        />
      </section>
    </div>
  )
}
