import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NavSupply } from '@/components/supply/nav'
import { opcionesFinanzas } from '@/modules/supply/opciones'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reportes de Membego Supply' }

/** Los bloques que exporta `/superadmin/supply/exportar` (§24), con filtros. */
const REPORTES = [
  { clave: 'overview', label: 'Resumen del pool' },
  { clave: 'proveedores', label: 'Proveedores y scorecard' },
  { clave: 'lotes', label: 'Lotes' },
  { clave: 'campanas', label: 'Campañas y asignaciones' },
  { clave: 'redenciones', label: 'Redenciones' },
  { clave: 'vencimientos', label: 'Vencimientos' },
  { clave: 'conciliacion', label: 'Conciliación interna' },
  { clave: 'utilizacion', label: 'Utilización del supply' },
  { clave: 'vencidos', label: 'Supply vencido' },
  { clave: 'derechos', label: 'Derechos emitidos' },
  { clave: 'cuentas-por-pagar', label: 'Cuentas por pagar' },
  { clave: 'cuentas-por-cobrar', label: 'Cuentas por cobrar' },
  { clave: 'liquidaciones', label: 'Liquidaciones' },
  { clave: 'conciliaciones', label: 'Conciliaciones con proveedores' },
  { clave: 'incidencias', label: 'Incidencias' },
  { clave: 'depositos', label: 'Depósitos' },
  { clave: 'ventas', label: 'Ventas sin precompra' },
  { clave: 'rentabilidad', label: 'Rentabilidad y unit economics' },
] as const

export default async function ReportesPage({ searchParams }: { searchParams: Promise<{ proveedor?: string; desde?: string; hasta?: string }> }) {
  await requireRole('SUPERADMIN')
  const { proveedor = '', desde = '', hasta = '' } = await searchParams
  const opciones = await opcionesFinanzas()
  const q = new URLSearchParams()
  if (proveedor) q.set('proveedor', proveedor)
  if (desde) q.set('desde', desde)
  if (hasta) q.set('hasta', hasta)
  const filtros = q.toString()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reportes"
        description="Cada bloque se descarga en CSV con los filtros elegidos. Todos salen de los mismos libros que las pantallas."
        eyebrow={
          <Link href="/superadmin/supply" className="hover:underline">
            Membego Supply
          </Link>
        }
        nav={<NavSupply activa="reportes" />}
      />

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <form action="/superadmin/supply/reportes" method="get" className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="proveedor" className="text-caption text-muted-foreground">
                Proveedor
              </label>
              <select id="proveedor" name="proveedor" defaultValue={proveedor} className="block h-9 rounded-lg border border-input bg-transparent px-3 text-sm">
                <option value="">Todos</option>
                {opciones.proveedores.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="desde" className="text-caption text-muted-foreground">
                Desde
              </label>
              <input id="desde" name="desde" type="date" defaultValue={desde} className="block h-9 rounded-lg border border-input bg-transparent px-3 text-sm" />
            </div>
            <div>
              <label htmlFor="hasta" className="text-caption text-muted-foreground">
                Hasta
              </label>
              <input id="hasta" name="hasta" type="date" defaultValue={hasta} className="block h-9 rounded-lg border border-input bg-transparent px-3 text-sm" />
            </div>
            <button type="submit" className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-muted">
              Aplicar
            </button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {REPORTES.map((r) => (
              <li key={r.clave} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                <span>{r.label}</span>
                <a href={`/superadmin/supply/exportar?reporte=${r.clave}${filtros ? `&${filtros}` : ''}`} className="font-medium text-primary underline-offset-4 hover:underline">
                  CSV
                </a>
              </li>
            ))}
            <li className="flex items-center justify-between rounded-lg border border-dashed border-border p-3 text-sm">
              <span>Todos los bloques en un archivo</span>
              <a href={`/superadmin/supply/exportar${filtros ? `?${filtros}` : ''}`} className="font-medium text-primary underline-offset-4 hover:underline">
                CSV
              </a>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
