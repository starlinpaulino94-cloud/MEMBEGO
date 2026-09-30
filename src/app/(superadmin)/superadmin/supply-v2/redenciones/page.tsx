import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDateTime } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipRedencion } from '@/components/supply-v2/chips'
import { listarRedenciones, proveedoresConRedenciones } from '@/modules/supply-v2/redemption/queries'
import { RUTA_REDENCIONES } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Redenciones · Supply 2.0' }

function fechaDe(v: string | undefined, finDeDia = false): Date | null {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  if (finDeDia) d.setUTCHours(23, 59, 59, 999)
  return d
}

/** MEMBEGO SUPPLY 2.0 · listado de redenciones (§63–§64). Vista interna. */
export default async function RedencionesPage({ searchParams }: { searchParams: Promise<{ proveedor?: string; estado?: string; desde?: string; hasta?: string }> }) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const estado = sp.estado === 'ENTREGADA' || sp.estado === 'REVERSADA' ? sp.estado : null
  const [filas, proveedores] = await Promise.all([
    listarRedenciones({ supplierId: sp.proveedor || null, estado, desde: fechaDe(sp.desde), hasta: fechaDe(sp.hasta, true) }),
    proveedoresConRedenciones(),
  ])
  const hayFiltro = Boolean(sp.proveedor || estado || sp.desde || sp.hasta)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Redenciones"
        description="Cada entrega física de un beneficio: quién, dónde, cuándo y qué. Una reversa devuelve la unidad al cliente y queda registrada."
        eyebrow="Supply 2.0"
        nav={<NavSupplyV2 activa="redenciones" />}
      />

      <Card>
        <CardContent className="pt-6">
          <form method="get" className="grid gap-3 sm:grid-cols-5" data-testid="filtros-redenciones">
            <div>
              <Label htmlFor="proveedor">Proveedor</Label>
              <select id="proveedor" name="proveedor" defaultValue={sp.proveedor ?? ''} className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm">
                <option value="">Todos</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="estado">Estado</Label>
              <select id="estado" name="estado" defaultValue={estado ?? ''} className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm">
                <option value="">Todos</option>
                <option value="ENTREGADA">Entregada</option>
                <option value="REVERSADA">Reversada</option>
              </select>
            </div>
            <div>
              <Label htmlFor="desde">Desde</Label>
              <Input id="desde" name="desde" type="date" defaultValue={sp.desde ?? ''} />
            </div>
            <div>
              <Label htmlFor="hasta">Hasta</Label>
              <Input id="hasta" name="hasta" type="date" defaultValue={sp.hasta ?? ''} />
            </div>
            <div className="flex items-end gap-2">
              <Button type="submit" variant="outline">Filtrar</Button>
              {hayFiltro && (
                <Button asChild variant="ghost">
                  <Link href={RUTA_REDENCIONES}>Limpiar</Link>
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {filas.length === 0 ? (
        <EmptyState variant="card" title={hayFiltro ? 'Nada con esos filtros' : 'Todavía no hay entregas'} description="Cuando un proveedor confirme una entrega, aparecerá aquí." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="tabla-redenciones">
                <thead className="text-left text-caption text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Fecha</th>
                    <th className="px-4 py-2">Cliente</th>
                    <th className="px-4 py-2">Producto</th>
                    <th className="px-4 py-2">Proveedor</th>
                    <th className="px-4 py-2">Sucursal</th>
                    <th className="px-4 py-2">Empleado</th>
                    <th className="px-4 py-2">Estado</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filas.map((r) => (
                    <tr key={r.id} className="border-t border-border align-top" data-testid="redencion">
                      <td className="px-4 py-2">
                        {formatDateTime(r.redeemedAt)}
                        <span className="block font-mono text-caption text-muted-foreground">{r.number}</span>
                      </td>
                      <td className="px-4 py-2">{r.cliente}</td>
                      <td className="px-4 py-2">{r.producto}</td>
                      <td className="px-4 py-2">{r.proveedor}</td>
                      <td className="px-4 py-2">{r.sucursal ?? '—'}</td>
                      <td className="px-4 py-2">{r.empleado}</td>
                      <td className="px-4 py-2"><ChipRedencion reversada={r.reversada} /></td>
                      <td className="px-4 py-2">
                        <Link href={`${RUTA_REDENCIONES}/${r.id}`} className="text-primary underline-offset-4 hover:underline" data-testid="link-redencion">Ver</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
