import Link from 'next/link'
import { AlertTriangle, TrendingDown } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { puedeFuncion, requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { formatDateTimeExacto } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { NavegacionInventario } from '@/components/inventario/NavegacionInventario'
import { sucursalesDeLaEmpresaEnTx } from '@/modules/inventory/queries'
import { consultaDeFiltrosKardex, consultaDeFiltrosMermas, leerFiltrosMermas } from '@/modules/inventory/filtros'
import { formatearCosto, formatearMonto } from '@/modules/inventory/costos'
import { formatearCantidad } from '@/modules/inventory/formato'
import { EXPLICACION_GRUPO, ETIQUETA_GRUPO, FILTRO_SIN_MOTIVO, GRUPOS_DE_MERMA, participacion, type GrupoDeMerma } from '@/modules/inventory/mermas'
import { MOTIVOS, SIN_MOTIVO_CODIFICADO, ETIQUETA_CLASE } from '@/modules/inventory/motivos'
import { mermasEnTx, type MermasVista } from '@/modules/inventory/mermas-queries'
import { FILAS_POR_PAGINA_REPORTES } from '@/modules/inventory/reportes'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'

const CAMPO = 'h-9 rounded-lg border border-input bg-background px-3 text-sm'
const RUTA = '/admin/inventario/reportes/mermas'

/**
 * MERMAS POR MOTIVO (INV-4b): cuánto se perdió, por qué y cuánto costó, en un rango de días. Lo perdido son los faltantes y las
 * bajas de lo dañado (lo que salió del inventario sin venderse); los sobrantes y lo dañado se enseñan aparte.
 *
 * El dinero solo se lee con la función `costos`; sin ella ve unidades y motivos, nunca costos.
 */
export default async function MermasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const pedido = leerFiltrosMermas(await searchParams)
  const conCostos = await puedeFuncion('inventario', 'costos')

  let datos: { zona: string; sucursales: Awaited<ReturnType<typeof sucursalesDeLaEmpresaEnTx>>; vista: MermasVista } | null = null
  let fallo = ''
  try {
    datos = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      const zona = zonaSegura(empresa?.zonaHoraria)
      const sucursales = await sucursalesDeLaEmpresaEnTx(tx, companyId)
      // Lo que llega por la URL es texto libre: una sucursal solo filtra si es de esta empresa.
      const f = { ...pedido }
      if (!sucursales.some((s) => s.id === f.sucursalId)) delete f.sucursalId
      return { zona, sucursales, vista: await mermasEnTx(tx, companyId, f, { zonaHoraria: zona, conCostos }) }
    })
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-reportes-mermas', e)
  }

  const f = { ...pedido }
  if (datos && !datos.sucursales.some((s) => s.id === f.sucursalId)) delete f.sucursalId
  const v = datos?.vista
  const hayFiltros = Boolean(f.sucursalId || f.motivo || f.q)
  const totalPaginas = v ? Math.max(1, Math.ceil(v.total / v.porPagina)) : 1
  // El rango que se está mirando (el de siempre si no se pidió otro) viaja en todos los enlaces y en el archivo.
  const rango = v ? { desde: v.desde, hasta: v.hasta } : {}
  const consultaExportar = consultaDeFiltrosMermas({ ...f, ...rango, pagina: 1 })
  const soloRango = consultaDeFiltrosMermas({ ...rango, pagina: 1 })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mermas por motivo"
        description="Cuánto se perdió, por qué y cuánto costó."
        action={datos && v ? <BotonExportar href={`${RUTA}/exportar?${consultaExportar}`} variant="outline" size="sm" /> : undefined}
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
          <form key={consultaExportar} method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtrar las mermas">
            <div className="space-y-1">
              <label htmlFor="me-desde" className="text-xs text-muted-foreground">
                Desde
              </label>
              <Input id="me-desde" type="date" name="desde" defaultValue={v.desde} className="w-40" />
            </div>
            <div className="space-y-1">
              <label htmlFor="me-hasta" className="text-xs text-muted-foreground">
                Hasta
              </label>
              <Input id="me-hasta" type="date" name="hasta" defaultValue={v.hasta} className="w-40" />
            </div>
            <div className="space-y-1">
              <label htmlFor="me-motivo" className="text-xs text-muted-foreground">
                Motivo
              </label>
              <select id="me-motivo" name="motivo" defaultValue={f.motivo ?? ''} className={CAMPO}>
                <option value="">Todos</option>
                <option value={FILTRO_SIN_MOTIVO}>{SIN_MOTIVO_CODIFICADO}</option>
                {MOTIVOS.map((m) => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            {datos.sucursales.length > 1 && (
              <div className="space-y-1">
                <label htmlFor="me-sucursal" className="text-xs text-muted-foreground">
                  Sucursal
                </label>
                <select id="me-sucursal" name="sucursal" defaultValue={f.sucursalId ?? ''} className={CAMPO}>
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
            <div className="space-y-1">
              <label htmlFor="me-q" className="text-xs text-muted-foreground">
                Producto
              </label>
              <Input id="me-q" name="q" defaultValue={f.q ?? ''} placeholder="Nombre, SKU o código de barras" className="w-64" maxLength={80} />
            </div>
            <Button type="submit" variant="outline">
              Filtrar
            </Button>
            {hayFiltros && (
              <Link href={`${RUTA}?${soloRango}`} className="text-sm text-muted-foreground underline">
                Quitar filtros
              </Link>
            )}
          </form>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3" aria-label="Resumen de las mermas">
            {GRUPOS_DE_MERMA.map((g) => {
              const t = v.grupos[g].total
              return (
                <Card key={g} aria-label={ETIQUETA_GRUPO[g]}>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">{ETIQUETA_GRUPO[g]}</p>
                    <p className="text-2xl font-semibold tabular-nums">{formatearCantidad(t.unidades)}</p>
                    <p className="text-xs text-muted-foreground">
                      unidad{t.unidades === 1 ? '' : 'es'} en {formatearCantidad(t.movimientos)} movimiento{t.movimientos === 1 ? '' : 's'}
                      {t.valor !== null && ` · ${formatearMonto(t.valor)}`}
                    </p>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {conCostos && (v.grupos.PERDIDA.total.unidadesSinCosto ?? 0) > 0 && (
            <Alert className="border-warning/40" aria-label="Lo que no tiene costo">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
              <AlertDescription>
                {formatearCantidad(v.grupos.PERDIDA.total.unidadesSinCosto ?? 0)} unidades perdidas no tenían costo conocido: no suman al valor de lo perdido (no valen cero: no se sabe). Se arregla al registrar una entrada con costo,
                o desde la ficha del producto.
              </AlertDescription>
            </Alert>
          )}

          {v.total === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <TrendingDown className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden />
                <p className="font-medium">{hayFiltros ? 'Nada coincide con esos filtros' : `No hubo mermas entre el ${v.desde} y el ${v.hasta}`}</p>
                {!hayFiltros && <p className="text-sm">Aquí aparecen los faltantes, las bajas, los sobrantes y lo dañado en cuanto se registren.</p>}
              </CardContent>
            </Card>
          ) : (
            <>
              {GRUPOS_DE_MERMA.filter((g) => v.grupos[g].filas.length > 0).map((g) => (
                <GrupoPorMotivo key={g} grupo={g} datos={v.grupos[g]} conCostos={conCostos} enlace={(codigo) => `${RUTA}?${consultaDeFiltrosMermas({ ...f, ...rango, motivo: codigo ?? FILTRO_SIN_MOTIVO, pagina: 1 })}`} />
              ))}

              <ul className="divide-y rounded-lg border" aria-label="Movimientos de merma">
                {v.movimientos.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        <Link href={`/admin/inventario/${m.varianteId}`} className="underline-offset-2 hover:underline">
                          {m.producto}
                        </Link>{' '}
                        <span className="text-xs font-normal text-muted-foreground">
                          SKU {m.sku} · {m.sucursalNombre}
                        </span>
                      </p>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant={m.grupo === 'PERDIDA' ? 'destructive' : m.grupo === 'DANO' ? 'warning' : 'info'}>{ETIQUETA_CLASE[m.clase]}</Badge>
                        <span className={m.codigo === null ? '' : 'font-medium text-foreground'}>{m.etiquetaMotivo}</span>
                        <span>
                          {formatDateTimeExacto(m.creadoEn, { zonaHoraria: datos.zona })} · {m.usuarioNombre ?? 'Sistema'}
                        </span>
                      </p>
                      {m.detalle && <p className="mt-0.5 break-words text-xs">{m.detalle}</p>}
                      <p className="text-xs">
                        <Link href={`/admin/inventario/reportes/kardex?${consultaDeFiltrosKardex({ varianteId: m.varianteId })}`} className="text-muted-foreground underline">
                          Ver su kardex
                        </Link>
                      </p>
                    </div>
                    <div className="text-right tabular-nums">
                      <p className={m.grupo === 'SOBRANTE' ? 'font-semibold text-success' : m.grupo === 'PERDIDA' ? 'font-semibold text-destructive' : 'font-semibold'}>
                        {m.grupo === 'SOBRANTE' ? '+' : m.grupo === 'PERDIDA' ? '−' : ''}
                        {formatearCantidad(m.unidades)}
                      </p>
                      {conCostos && (m.valor !== null && m.costo !== null ? <p className="text-xs text-muted-foreground">{formatearMonto(m.valor)} · a {formatearCosto(m.costo)} c/u</p> : <p className="text-xs text-muted-foreground">Sin costo</p>)}
                    </div>
                  </li>
                ))}
              </ul>

              {totalPaginas > 1 && (
                <nav className="flex items-center justify-between text-sm" aria-label="Paginación de las mermas">
                  {v.pagina > 1 ? (
                    <Link href={`${RUTA}?${consultaDeFiltrosMermas({ ...f, ...rango }, v.pagina - 1)}`} className="underline">
                      ← Más recientes
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span className="text-muted-foreground">
                    Página {v.pagina} de {totalPaginas} · {formatearCantidad(v.total)} movimientos
                  </span>
                  {v.pagina < totalPaginas ? (
                    <Link href={`${RUTA}?${consultaDeFiltrosMermas({ ...f, ...rango }, v.pagina + 1)}`} className="underline">
                      Más antiguos →
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              )}
            </>
          )}

          <p className="text-xs text-muted-foreground">
            Lo perdido son los faltantes y las bajas de lo dañado: lo que salió del inventario sin venderse. Lo dañado todavía está en la sucursal, así que no se suma a lo perdido (se cuenta cuando se da de baja). «{SIN_MOTIVO_CODIFICADO}» es
            lo anterior a que existieran los motivos o lo que hacen procesos que no eligen uno; los conteos físicos ponen solos «Diferencia de conteo». {conCostos ? 'El valor es la cantidad por el costo promedio de ese momento. ' : ''}
            Las fechas son días de tu empresa ({datos.zona}). {FILAS_POR_PAGINA_REPORTES} movimientos por página; el archivo trae todos.
          </p>
        </>
      )}
    </div>
  )
}

function GrupoPorMotivo({
  grupo,
  datos,
  conCostos,
  enlace,
}: {
  grupo: GrupoDeMerma
  datos: MermasVista['grupos'][GrupoDeMerma]
  conCostos: boolean
  enlace: (codigo: string | null) => string
}) {
  const t = datos.total
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{ETIQUETA_GRUPO[grupo]} por motivo</CardTitle>
        <p className="text-xs text-muted-foreground">{EXPLICACION_GRUPO[grupo]}</p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm" aria-label={`${ETIQUETA_GRUPO[grupo]} por motivo`}>
          {datos.filas.map((fila) => (
            <li key={fila.codigo ?? 'sin'} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link href={enlace(fila.codigo)} className="font-medium underline-offset-2 hover:underline">
                {fila.etiqueta}
              </Link>
              <span className="tabular-nums">
                {formatearCantidad(fila.unidades)} unidad{fila.unidades === 1 ? '' : 'es'}{' '}
                <span className="text-xs text-muted-foreground">
                  · {participacion(fila.unidades, t.unidades).toLocaleString('es-DO')} %
                  {conCostos && fila.valor !== null && ` · ${formatearMonto(fila.valor)}`}
                  {conCostos && (fila.unidadesSinCosto ?? 0) > 0 && `, ${formatearCantidad(fila.unidadesSinCosto ?? 0)} sin costo`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
