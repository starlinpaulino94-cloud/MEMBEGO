import Link from 'next/link'
import { AlertTriangle, CalendarClock } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { zonaSegura } from '@/lib/zona-horaria'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { NavegacionInventario } from '@/components/inventario/NavegacionInventario'
import { sucursalesDeLaEmpresaEnTx } from '@/modules/inventory/queries'
import { consultaDeFiltrosVencimientos, leerFiltrosVencimientos } from '@/modules/inventory/filtros'
import { formatearCosto, formatearMonto } from '@/modules/inventory/costos'
import { formatearCantidad } from '@/modules/inventory/formato'
import { CLASES_VENCIMIENTO, DIAS_URGENTE, ETIQUETA_CLASE_VENCIMIENTO, ETIQUETA_URGENCIA, FILAS_POR_PAGINA_VENCIMIENTOS, VENTANAS_DIAS, type Urgencia } from '@/modules/inventory/vencimientos'
import { vencimientosEnTx, type VencimientosVista } from '@/modules/inventory/vencimientos-queries'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

const CAMPO = 'h-9 rounded-lg border border-input bg-background px-3 text-sm'
const RUTA = '/admin/inventario/reportes/vencimientos'

const BADGE_URGENCIA: Record<Urgencia, 'destructive' | 'warning' | 'outline'> = {
  VENCIDO: 'destructive',
  URGENTE: 'warning',
  PRONTO: 'outline',
}

/**
 * VENCE PRONTO (INV-5b1): los lotes con existencias que ya vencieron o vencen dentro de la ventana (7 a 90 días), por sucursal, de lo
 * que antes vence a lo que después. Lo vendible es lo que hay menos lo apartado; lo ya dañado no cuenta (ya salió de lo vendible).
 * Un lote que vence HOY todavía se vende: sale como «por vencer». «Hoy» es el día de la empresa.
 *
 * El dinero solo se lee con la función `costos`; sin ella no hay valores.
 */
export default async function VencimientosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const pedido = leerFiltrosVencimientos(await searchParams)
  const conCostos = await puedeFuncion('inventario', 'costos')

  let datos: { sucursales: Awaited<ReturnType<typeof sucursalesDeLaEmpresaEnTx>>; vista: VencimientosVista } | null = null
  let fallo = ''
  try {
    datos = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      const zona = zonaSegura(empresa?.zonaHoraria)
      const sucursales = await sucursalesDeLaEmpresaEnTx(tx, companyId)
      // Lo que llega por la URL es texto libre: una sucursal solo filtra si es de esta empresa.
      const f = { ...pedido }
      if (!sucursales.some((s) => s.id === f.sucursalId)) delete f.sucursalId
      return { sucursales, vista: await vencimientosEnTx(tx, companyId, f, { zonaHoraria: zona, conCostos }) }
    })
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-reportes-vencimientos', e)
  }

  const f = { ...pedido }
  if (datos && !datos.sucursales.some((s) => s.id === f.sucursalId)) delete f.sucursalId
  const hayFiltros = Boolean(f.q || f.sucursalId || f.clase)
  const v = datos?.vista
  const totalPaginas = v ? Math.max(1, Math.ceil(v.total / v.porPagina)) : 1
  const consultaExportar = consultaDeFiltrosVencimientos({ ...f, pagina: 1 })
  /** «Quitar filtros» conserva la ventana: es lo que se está mirando, no un filtro. */
  const soloDias = consultaDeFiltrosVencimientos({ dias: f.dias, pagina: 1 })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vence pronto"
        description="Los lotes con existencias que ya vencieron o vencen en los próximos días."
        action={datos && v ? <BotonExportar href={`${RUTA}/exportar${consultaExportar ? `?${consultaExportar}` : ''}`} variant="outline" size="sm" /> : undefined}
      />
      <NavegacionInventario actual="reportes" />
      <Link href="/admin/inventario/reportes" className="inline-block text-sm text-muted-foreground underline">
        ← Todos los reportes
      </Link>

      {!datos || !v ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{fallo}</CardContent>
        </Card>
      ) : (
        <>
          {/* La `key` es la consulta: al quitar filtros (navegación suave) el formulario se monta de nuevo y los campos vuelven a lo que dice la URL; sin ella conservarían lo que se eligió antes. */}
          <form key={consultaExportar} method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtrar lo que vence pronto">
            <div className="space-y-1">
              <label htmlFor="vp-dias" className="text-xs text-muted-foreground">
                Vence en
              </label>
              <select id="vp-dias" name="dias" defaultValue={String(f.dias)} className={CAMPO}>
                {VENTANAS_DIAS.map((d) => (
                  <option key={d} value={d}>
                    {d} días o menos
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="vp-estado" className="text-xs text-muted-foreground">
                Estado
              </label>
              <select id="vp-estado" name="estado" defaultValue={f.clase ?? ''} className={CAMPO}>
                <option value="">Todos</option>
                {CLASES_VENCIMIENTO.map((c) => (
                  <option key={c} value={c}>
                    {ETIQUETA_CLASE_VENCIMIENTO[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="vp-q" className="text-xs text-muted-foreground">
                Producto o lote
              </label>
              <Input id="vp-q" name="q" defaultValue={f.q ?? ''} placeholder="Nombre, SKU, código de barras o lote" className="w-72" maxLength={80} />
            </div>
            {datos.sucursales.length > 1 && (
              <div className="space-y-1">
                <label htmlFor="vp-sucursal" className="text-xs text-muted-foreground">
                  Sucursal
                </label>
                <select id="vp-sucursal" name="sucursal" defaultValue={f.sucursalId ?? ''} className={CAMPO}>
                  <option value="">Todas</option>
                  {datos.sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                      {s.activa ? '' : ' (desactivada)'}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Button type="submit" variant="outline">
              Filtrar
            </Button>
            {hayFiltros && (
              <Link href={`${RUTA}${soloDias ? `?${soloDias}` : ''}`} className="text-sm text-muted-foreground underline">
                Quitar filtros
              </Link>
            )}
          </form>

          <div className={`grid grid-cols-2 gap-4 ${v.resumen.valor !== null ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`} aria-label="Resumen de lo que vence pronto">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Lotes</p>
                <p className="text-2xl font-semibold tabular-nums">{formatearCantidad(v.resumen.lotes)}</p>
                <p className="text-xs text-muted-foreground">que vencen en {v.dias} días o ya vencieron</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Ya vencidos</p>
                <p className="text-2xl font-semibold tabular-nums">{formatearCantidad(v.resumen.lotesVencidos)}</p>
                <p className="text-xs text-muted-foreground">con existencias sin barrer o apartadas</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Unidades vendibles</p>
                <p className="text-2xl font-semibold tabular-nums">{formatearCantidad(v.resumen.unidades)}</p>
                <p className="text-xs text-muted-foreground">sin contar lo apartado</p>
              </CardContent>
            </Card>
            {v.resumen.valor !== null && (
              <Card aria-label="Dinero en riesgo">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Dinero en riesgo</p>
                  <p className="text-2xl font-semibold tabular-nums">{formatearMonto(v.resumen.valor)}</p>
                  <p className="text-xs text-muted-foreground">a costo promedio</p>
                </CardContent>
              </Card>
            )}
          </div>

          {v.resumen.lotesVencidos > 0 && (
            <Alert className="border-warning/40" aria-label="Lotes ya vencidos">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
              <AlertDescription>
                {v.resumen.lotesVencidos === 1 ? 'Hay 1 lote vencido' : `Hay ${v.resumen.lotesVencidos} lotes vencidos`} con existencias. No se pueden vender ni apartar, y el barrido diario pasa a dañado lo que quede disponible; lo apartado se
                resuelve al cobrar o al vencer su reserva.
              </AlertDescription>
            </Alert>
          )}

          {conCostos && (v.resumen.unidadesSinCosto ?? 0) > 0 && (
            <Alert className="border-warning/40" aria-label="Lo que no tiene costo">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
              <AlertDescription>
                {formatearCantidad(v.resumen.unidadesSinCosto ?? 0)} unidades vendibles no tienen costo y no suman al dinero en riesgo (no valen cero: no se sabe). Se arregla al registrar una entrada con costo, o desde la ficha del producto.
              </AlertDescription>
            </Alert>
          )}

          {v.filas.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <CalendarClock className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
                <p className="font-medium">{hayFiltros ? 'Nada coincide con esos filtros' : `Nada vence en los próximos ${v.dias} días`}</p>
                {!hayFiltros && <p className="text-sm">Aquí aparecen los lotes con fecha de vencimiento que se acercan. Un producto sin lotes, o un lote que no vence, nunca sale.</p>}
              </CardContent>
            </Card>
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Lotes que vencen pronto">
              {v.filas.map((l) => (
                <li key={l.saldoPorLoteId} data-lote={l.codigo} data-estado={l.clase} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      <Link href={`/admin/inventario/${l.varianteId}`} className="underline-offset-2 hover:underline">
                        {l.nombre}
                      </Link>{' '}
                      <span className="text-xs font-normal text-muted-foreground">
                        SKU {l.sku} · {l.sucursalNombre}
                        {l.sucursalActiva ? '' : ' (desactivada)'}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Lote {l.codigo} · vence el {l.vencimiento} ·{' '}
                      <Badge variant={BADGE_URGENCIA[l.urgencia]} aria-label={`Estado: ${ETIQUETA_URGENCIA[l.urgencia]}`}>
                        {l.texto}
                      </Badge>
                    </p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="font-semibold">
                      {formatearCantidad(l.vendible)} vendible{l.vendible === 1 ? '' : 's'}
                    </p>
                    {(l.apartado > 0 || l.danado > 0) && (
                      <p className="text-xs text-muted-foreground">
                        {l.apartado > 0 ? `${formatearCantidad(l.apartado)} apartada${l.apartado === 1 ? '' : 's'}` : ''}
                        {l.apartado > 0 && l.danado > 0 ? ' · ' : ''}
                        {l.danado > 0 ? `${formatearCantidad(l.danado)} dañada${l.danado === 1 ? '' : 's'}` : ''}
                      </p>
                    )}
                    {conCostos &&
                      (l.valor === null || l.costo === null ? (
                        <Badge variant="outline">Sin costo</Badge>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {formatearMonto(l.valor)} · a {formatearCosto(l.costo)} c/u
                        </p>
                      ))}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {totalPaginas > 1 && (
            <nav className="flex items-center justify-between text-sm" aria-label="Paginación de lo que vence pronto">
              {v.pagina > 1 ? (
                <Link href={`${RUTA}?${consultaDeFiltrosVencimientos(f, v.pagina - 1)}`} className="underline">
                  ← Anteriores
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">
                Página {v.pagina} de {totalPaginas} · {formatearCantidad(v.total)} lotes por sucursal
              </span>
              {v.pagina < totalPaginas ? (
                <Link href={`${RUTA}?${consultaDeFiltrosVencimientos(f, v.pagina + 1)}`} className="underline">
                  Siguientes →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}

          <p className="text-xs text-muted-foreground">
            Cada fila es un lote en una sucursal. Salen los que vencen en {v.dias} días o menos (los de {DIAS_URGENTE} días o menos, marcados como urgentes) y los que ya vencieron y siguen con existencias; van primero los que antes vencen.
            Un lote que vence hoy todavía se vende. Lo dañado no cuenta: ya salió de lo vendible. «Hoy» es el día de tu empresa. {FILAS_POR_PAGINA_VENCIMIENTOS} por página; el archivo trae todos.
          </p>
        </>
      )}
    </div>
  )
}
