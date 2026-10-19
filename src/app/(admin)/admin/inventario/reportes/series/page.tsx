import Link from 'next/link'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { formatDateTimeExacto } from '@/lib/format'
import { zonaSegura } from '@/lib/zona-horaria'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { NavegacionInventario } from '@/components/inventario/NavegacionInventario'
import { ETIQUETA_MOVIMIENTO, formatearCantidad, nombreCompleto } from '@/modules/inventory/formato'
import { describirCambioDeCubeta, sentidoDeMovimiento, type Cubeta } from '@/modules/inventory/reportes'
import { MAX_SERIES_ENCONTRADAS, buscarSeriesEnTx, type BusquedaDeSeries, type PasoDeSerie } from '@/modules/inventory/series-queries'
import { describirFalloDeCarga } from '@/modules/inventory/errores-pantalla'

export const dynamic = 'force-dynamic'


/** «Entró», «Salió» o «de vendible a dañado»: lo que ese movimiento le hizo a la unidad. */
function queLePaso(p: PasoDeSerie): string {
  const m = { origen: p.desde as Cubeta | null, destino: p.hacia as Cubeta | null }
  const sentido = sentidoDeMovimiento(m)
  if (sentido === 'ENTRA') return 'Entró'
  if (sentido === 'SALE') return 'Salió'
  return describirCambioDeCubeta(m) ?? 'Sin cambio de cubeta'
}

/**
 * BUSCAR UNA SERIE (INV-5c): dado un número de serie (o parte de él), dice de qué producto es, dónde está ahora y todo lo que le pasó:
 * cuándo entró, a qué sucursal, si se transfirió, se vendió, se dañó o se dio de baja. Una serie es UN lote de una unidad, así que su
 * historia sale de los repartos por lote del ledger, que no se reescribe.
 */
export default async function BuscarSeriePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = await requireCompanyContext(user)
  const crudo = (await searchParams).q
  const q = (Array.isArray(crudo) ? crudo[0] : crudo)?.slice(0, 80) ?? ''

  let busqueda: BusquedaDeSeries | null = null
  let zona = ''
  let fallo = ''
  try {
    const r = await conEmpresa(companyId, async (tx) => {
      const empresa = await tx.company.findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      return { busqueda: await buscarSeriesEnTx(tx, companyId, q), zona: zonaSegura(empresa?.zonaHoraria) }
    })
    busqueda = r.busqueda
    zona = r.zona
  } catch (e) {
    fallo = describirFalloDeCarga('admin-inventario-reportes-series', e)
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Buscar una serie" description="De qué producto es un número de serie, dónde está ahora y todo lo que le pasó." />
      <NavegacionInventario actual="reportes" />
      <Link href="/admin/inventario/reportes" className="inline-block text-sm text-muted-foreground underline">
        ← Todos los reportes
      </Link>

      <form key={q} method="get" className="flex flex-wrap items-end gap-3" aria-label="Buscar una serie">
        <div className="space-y-1">
          <label htmlFor="se-q" className="text-xs text-muted-foreground">
            Número de serie
          </label>
          <Input id="se-q" name="q" defaultValue={q} placeholder="Serie completa o parte de ella" className="w-72" maxLength={80} autoComplete="off" />
        </div>
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>

      {fallo ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{fallo}</CardContent>
        </Card>
      ) : !busqueda || busqueda.consulta === '' ? (
        <p className="text-sm text-muted-foreground">Escribe un número de serie para ver su producto, dónde está y su historia.</p>
      ) : busqueda.series.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">No hay ninguna serie que contenga «{busqueda.consulta}».</CardContent>
        </Card>
      ) : (
        <>
          {busqueda.hayMas && <p className="text-sm text-muted-foreground">Hay más de {MAX_SERIES_ENCONTRADAS} series que coinciden: se muestran las primeras. Escribe más del número para afinar.</p>}
          <ul className="space-y-4" aria-label="Series encontradas">
            {busqueda.series.map((s) => (
              <li key={s.loteId}>
                <Card data-serie={s.serie}>
                  <CardContent className="space-y-3 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-lg font-semibold">{s.serie}</p>
                        <p className="text-sm text-muted-foreground">
                          <Link href={`/admin/inventario/${s.varianteId}`} className="underline">
                            {nombreCompleto(s.producto, s.nombreVariante, s.esDefault)}
                          </Link>{' '}
                          · SKU {s.sku}
                        </p>
                      </div>
                      {s.ubicaciones.length === 0 ? <Badge variant="outline">Ya no está en existencia</Badge> : <Badge variant="success">En existencia</Badge>}
                    </div>
                    {s.ubicaciones.length > 0 && (
                      <ul className="text-sm" aria-label={`Dónde está la serie ${s.serie}`}>
                        {s.ubicaciones.map((u) => (
                          <li key={u.sucursalId}>
                            {u.sucursal}:{' '}
                            {u.danada > 0 ? 'dañada' : u.reservada > 0 ? 'apartada' : `${formatearCantidad(u.disponible)} disponible`}
                          </li>
                        ))}
                      </ul>
                    )}
                    {s.historia.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Esta serie todavía no tiene movimientos.</p>
                    ) : (
                      <ol className="divide-y text-sm" aria-label={`Historia de la serie ${s.serie}`}>
                        {s.historia.map((p) => (
                          <li key={p.movimientoId} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                            <span>
                              <strong>{ETIQUETA_MOVIMIENTO[p.tipo]}</strong> · {queLePaso(p)} · {p.sucursal}
                              {p.motivo ? <span className="text-muted-foreground"> · {p.motivo}</span> : null}
                            </span>
                            <span className="text-xs text-muted-foreground">{formatDateTimeExacto(p.fecha, { zonaHoraria: zona })}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Una serie es una sola unidad: no puede estar en dos sitios a la vez. Si no la encuentras, revisa que el producto lleve series (se activan en su ficha).
      </p>
    </div>
  )
}
