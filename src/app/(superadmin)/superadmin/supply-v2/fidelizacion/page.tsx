import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { tableroDeFidelizacion } from '@/modules/supply-v2/loyalty/queries'
import { puedeSupplyV2 } from '@/modules/supply-v2/permisos'
import { ESTADO_PROGRAMA, RUTA_FIDELIZACION } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Fidelización · Supply 2.0' }

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · el centro de fidelización de Membego (§41).
 *
 * Las cifras de resultado son reales, leídas del ledger. La ÚNICA estimación
 * va marcada como tal y con su advertencia al lado: §41 prohíbe enseñar una
 * estimación como si fuera un resultado confirmado, y sumarla al gasto real
 * sería exactamente eso.
 *
 * El dinero solo se enseña con `SUPPLY_V2_LOYALTY_FINANCE_VIEW`: ver un
 * programa no es ver lo que cuesta.
 */
export default async function FidelizacionAdminPage() {
  const [tablero, veFinanzas] = await Promise.all([tableroDeFidelizacion(), puedeSupplyV2('SUPPLY_V2_LOYALTY_FINANCE_VIEW')])
  const t = tablero.totales

  const metricas = [
    ['Programas activos', String(t.programasActivos), 'metrica-programas'],
    ['Miembros activos', String(t.miembrosActivos), 'metrica-miembros'],
    ['Referidos válidos', String(t.referidosValidos), 'metrica-referidos'],
    ['Puntos emitidos', String(t.puntosEmitidos), 'metrica-puntos-emitidos'],
    ['Puntos disponibles', String(t.puntosDisponibles), 'metrica-puntos-disponibles'],
    ['Recompensas entregadas', String(t.recompensasEntregadas), 'metrica-entregadas'],
  ] as const

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fidelización"
        description="Membresías, referidos, puntos y recompensas de todos los programas."
        eyebrow="Supply 2.0"
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {metricas.map(([k, v, tid]) => (
          <Card key={k}>
            <CardContent className="pt-6">
              <p className="text-caption uppercase text-muted-foreground">{k}</p>
              <p className="text-h2 tabular-nums" data-testid={tid}>{v}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {veFinanzas && (
        <Card data-testid="bloque-economia">
          <CardContent className="space-y-3 pt-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-caption uppercase text-muted-foreground">Costo realizado</p>
                <p className="text-h2 tabular-nums" data-testid="metrica-costo-realizado">{t.costoRealizado}</p>
                <p className="text-caption text-muted-foreground">Recompensas ya entregadas. Esto se gastó.</p>
              </div>
              <div>
                <p className="text-caption uppercase text-muted-foreground">Costo potencial estimado</p>
                <p className="text-h2 tabular-nums" data-testid="metrica-costo-estimado">{t.costoPotencialEstimado}</p>
                <p className="text-caption text-muted-foreground" data-testid="aviso-estimacion">{t.estimacionAdvertencia}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {tablero.programas.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<Sparkles className="h-6 w-6" aria-hidden />}
          title="Todavía no hay programas de fidelización"
          description="Crea el primero para empezar a ofrecer membresías, puntos y recompensas."
        />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto pt-6">
            <table className="w-full text-sm">
              <caption className="sr-only">Programas de fidelización</caption>
              <thead>
                <tr className="border-b text-left text-caption uppercase text-muted-foreground">
                  <th scope="col" className="py-2">Programa</th>
                  <th scope="col">Dueño</th>
                  <th scope="col">Estado</th>
                  <th scope="col" className="text-right">Miembros</th>
                  <th scope="col" className="text-right">Referidos</th>
                  <th scope="col" className="text-right">Puntos</th>
                  {veFinanzas && <th scope="col" className="text-right">Gastado</th>}
                </tr>
              </thead>
              <tbody data-testid="tabla-programas">
                {tablero.programas.map((p) => (
                  <tr key={p.id} className="border-b last:border-0" data-testid="fila-programa">
                    <td className="py-2">
                      <Link className="underline" href={`${RUTA_FIDELIZACION}/${p.id}`} data-testid="enlace-programa">
                        {p.nombre}
                      </Link>
                      <span className="block font-mono text-caption text-muted-foreground">{p.code}</span>
                    </td>
                    <td>{p.propietario}</td>
                    <td data-testid="programa-estado">{ESTADO_PROGRAMA[p.estado] ?? p.estado}</td>
                    <td className="text-right tabular-nums">{p.miembrosActivos}</td>
                    <td className="text-right tabular-nums">{p.referidosValidos}</td>
                    <td className="text-right tabular-nums">{p.puntosEmitidos}</td>
                    {veFinanzas && <td className="text-right tabular-nums">{p.costoRealizado}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
