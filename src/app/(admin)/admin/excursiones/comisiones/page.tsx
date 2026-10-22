import Link from 'next/link'
import { SlidersHorizontal } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { listarComisiones, resumenComisiones, vendedoresParaFiltro } from '@/modules/excursiones/comisiones/queries'
import {
  OPCIONES_ESTADO_COMISION,
  OPCIONES_TASA_COMISION,
  hayFiltrosComisiones,
  leerFiltrosComisiones,
} from '@/modules/excursiones/comisiones/lista'
import { ESTADO_COMISION_LABEL, type EstadoComision } from '@/modules/excursiones/comisiones/nucleo'
import { getExcursionesConfig } from '@/modules/excursiones/config'
import { urlConFiltros } from '@/modules/admin/filtrosComunes'
import { leerPaginacion } from '@/lib/paginacion'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { ComisionesTabla } from '@/components/excursiones/ComisionesTabla'
import { ComisionFilaAcciones } from '@/components/excursiones/ComisionFilaAcciones'
import { Button } from '@/components/ui/button'
import { BarraFiltros } from '@/components/ui/barra-filtros'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Comisiones' }

/**
 * LAS COMISIONES (auditoría admin · fase 7, tarea 7.1; 06 · T-04, T-05).
 *
 * Búsqueda, vendedor, estado, tasa, fechas y página viajan en la URL y los resuelve la base sobre TODAS las comisiones: antes
 * la consulta traía las 300 más recientes y el navegador filtraba esas. El resumen de arriba cuenta todas, no solo las filtradas.
 */
export default async function ComisionesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las comisiones de excursiones" />

  const sp = await searchParams
  const filtros = leerFiltrosComisiones(sp)
  const paginacion = leerPaginacion(sp)
  const [{ filas, total }, resumen, config, vendedores] = await Promise.all([
    listarComisiones(companyId, { filtros, paginacion }),
    resumenComisiones(companyId),
    getExcursionesConfig(companyId),
    vendedoresParaFiltro(companyId),
  ])

  const base = '/admin/excursiones/comisiones'
  const hayFiltros = hayFiltrosComisiones(filtros)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Cada comisión guarda dentro la regla con la que nació. Cambiar una regla afecta a lo
          que venga, nunca a lo que ya se generó.
        </p>
        <Button asChild variant="outline">
          <Link href="/admin/excursiones/comisiones/reglas">
            <SlidersHorizontal className="mr-1.5 h-4 w-4" /> Reglas de comisión
          </Link>
        </Button>
      </div>

      {resumen.porEstado.length > 0 ? (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {resumen.porEstado.map((r) => (
            <div key={r.estado} className="rounded-xl border border-border bg-card p-3 text-center">
              <dd className="text-h3 text-foreground">{formatMoney(r.total, { moneda: config.monedaDefecto }, 2)}</dd>
              <dt className="text-caption text-muted-foreground">
                {ESTADO_COMISION_LABEL[r.estado as EstadoComision] ?? r.estado} · {r.cantidad}
              </dt>
            </div>
          ))}
        </dl>
      ) : null}

      <BarraFiltros
        busqueda={{ nombre: 'q', valor: filtros.q, etiqueta: 'Buscar', placeholder: 'Vendedor, venta (#SAL-…), liquidación o desglose…' }}
        filtros={[
          {
            nombre: 'vendedor',
            etiqueta: 'Vendedor',
            valor: filtros.vendedor,
            opciones: vendedores.map((v) => ({ valor: v.id, etiqueta: `${v.nombre} (${v.codigo})` })),
            todas: 'Todos los vendedores',
          },
          { nombre: 'estado', etiqueta: 'Estado', valor: filtros.estado, opciones: OPCIONES_ESTADO_COMISION, todas: 'Todos los estados' },
          { nombre: 'tasa', etiqueta: 'Tasa', valor: filtros.tasa, opciones: OPCIONES_TASA_COMISION, todas: 'Todas las comisiones' },
        ]}
        fechas={[
          { nombre: 'desde', etiqueta: 'Desde', valor: filtros.desde },
          { nombre: 'hasta', etiqueta: 'Hasta', valor: filtros.hasta },
        ]}
        hrefSin={(nombre) => urlConFiltros(base, sp, { [nombre]: undefined })}
        hrefLimpiar={base}
        enlace={({ href, ...resto }) => <Link href={href} {...resto} />}
      />

      <ComisionesTabla
        filas={filas}
        acciones={(c) => <ComisionFilaAcciones comision={c} />}
        hayFiltros={hayFiltros}
        vacio={{
          titulo: 'Todavía no hay comisiones',
          descripcion:
            'Una comisión nace cuando se confirma la venta de una reserva saldada, y solo si hay una regla que diga cuánto se paga. Define tus reglas para empezar.',
          accion: (
            <Button asChild size="lg">
              <Link href="/admin/excursiones/comisiones/reglas">Definir reglas</Link>
            </Button>
          ),
        }}
        sinResultados={{
          titulo: 'Ninguna comisión coincide con los filtros',
          descripcion: 'Prueba con otro vendedor, estado o rango de fechas, o quita algún filtro.',
          accion: (
            <Link href={base} className="text-small font-medium text-primary hover:underline">
              Limpiar filtros
            </Link>
          ),
        }}
        pie={<TablaPaginacion paginacion={paginacion} total={total} params={sp} etiqueta="comisiones" />}
      />
    </div>
  )
}
