import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipPrograma } from '@/components/supply-v2/chips'
import { tableroDeFidelizacion } from '@/modules/supply-v2/loyalty/queries'
import { puedeSupplyV2 } from '@/modules/supply-v2/permisos'
import { LOYALTY_MODALITY_LABELS, RUTA_FIDELIZACION } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Fidelización · Supply 2.0' }

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · TABLERO DE FIDELIZACIÓN (§41).
 *
 * Las cifras de resultado son REALES: miembros activos, referidos pagados,
 * puntos emitidos y costo ya realizado. La única estimación —lo que costarían
 * los puntos que la gente todavía no ha canjeado— va marcada como tal y con su
 * advertencia al lado, porque una estimación no se enseña como si fuera dinero
 * que ya se debe.
 */
export default async function FidelizacionPage() {
  await requireRole('SUPERADMIN')
  const [tablero, puedeCrear, puedeFinanzas] = await Promise.all([
    tableroDeFidelizacion(),
    puedeSupplyV2('SUPPLY_V2_LOYALTY_PROGRAM_CREATE'),
    puedeSupplyV2('SUPPLY_V2_LOYALTY_FINANCE_VIEW'),
  ])
  const t = tablero.totales

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fidelización"
        description="Membresías, referidos, puntos y recompensas. Los beneficios de un plan o de una recompensa son los del catálogo de siempre, con su presupuesto y su ledger: aquí se agrupan y se les pone el techo."
        eyebrow="Supply 2.0"
        nav={<NavSupplyV2 activa="fidelizacion" />}
        action={
          puedeCrear ? (
            <Button asChild>
              <Link href={`${RUTA_FIDELIZACION}/nuevo`} data-testid="btn-crear-programa-nav">+ Crear programa</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="tablero-fidelizacion">
        <StatCard label="Programas activos" value={<span data-testid="tablero-programas">{t.programasActivos.toLocaleString('es-DO')}</span>} sub={`${tablero.programas.length} en total`} accent="brand" />
        <StatCard label="Miembros activos" value={<span data-testid="tablero-miembros">{t.miembrosActivos.toLocaleString('es-DO')}</span>} sub="membresías vigentes ahora" />
        <StatCard label="Referidos pagados" value={<span data-testid="tablero-referidos">{t.referidosValidos.toLocaleString('es-DO')}</span>} sub="invitaciones que ya cobraron" />
        <StatCard
          label="Puntos emitidos"
          value={<span data-testid="tablero-puntos">{t.puntosEmitidos.toLocaleString('es-DO')}</span>}
          sub={`${t.puntosDisponibles.toLocaleString('es-DO')} sin canjear todavía`}
        />
      </div>

      {puedeFinanzas && (
        <Card>
          <CardHeader><CardTitle>El dinero de la fidelización</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-caption text-muted-foreground">Costo ya realizado</dt>
                <dd className="text-h2 tabular-nums" data-testid="tablero-costo-realizado">{t.costoRealizado}</dd>
                <p className="text-caption text-muted-foreground">Recompensas entregadas y premios concedidos. Esto sí es dinero gastado.</p>
              </div>
              <div>
                <dt className="text-caption text-muted-foreground">Recompensas entregadas</dt>
                <dd className="text-h2 tabular-nums" data-testid="tablero-entregadas">{t.recompensasEntregadas.toLocaleString('es-DO')}</dd>
              </div>
              <div>
                <dt className="text-caption text-muted-foreground">Costo potencial (estimación)</dt>
                <dd className="text-h2 tabular-nums text-warning" data-testid="tablero-costo-estimado">{t.costoPotencialEstimado}</dd>
                <p className="text-caption text-warning" data-testid="tablero-advertencia">{t.estimacionAdvertencia}</p>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Programas ({tablero.programas.length})</CardTitle></CardHeader>
        <CardContent>
          {tablero.programas.length === 0 ? (
            <EmptyState
              title="Todavía no hay ningún programa"
              description="Un programa de fidelización agrupa las membresías, los referidos, los puntos y las recompensas de un negocio o de Membego."
              action={puedeCrear ? <Button asChild><Link href={`${RUTA_FIDELIZACION}/nuevo`}>Crear el primero</Link></Button> : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="tabla-programas">
                <thead>
                  <tr className="border-b border-border text-left text-caption text-muted-foreground">
                    <th className="py-2 pr-3">Programa</th>
                    <th className="py-2 pr-3">Estado</th>
                    <th className="py-2 pr-3 text-right">Miembros</th>
                    <th className="py-2 pr-3 text-right">Referidos</th>
                    <th className="py-2 pr-3 text-right">Puntos</th>
                    <th className="py-2 pr-3 text-right">Canjes</th>
                    {puedeFinanzas && <th className="py-2 pr-3 text-right">Presupuesto</th>}
                    {puedeFinanzas && <th className="py-2 text-right">Gastado</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tablero.programas.map((p) => (
                    <tr key={p.id} data-testid="fila-programa">
                      <td className="py-2 pr-3">
                        <Link href={`${RUTA_FIDELIZACION}/${p.id}`} className="font-medium underline-offset-4 hover:underline" data-testid="programa-nombre">{p.nombre}</Link>
                        <span className="block font-mono text-caption text-muted-foreground">{p.code} · {p.negocio ?? p.propietario}</span>
                      </td>
                      <td className="py-2 pr-3"><ChipPrograma estado={p.estado} /></td>
                      <td className="py-2 pr-3 text-right tabular-nums" data-testid="programa-miembros">{p.miembrosActivos.toLocaleString('es-DO')}</td>
                      <td className="py-2 pr-3 text-right tabular-nums" data-testid="programa-referidos">{p.referidosValidos.toLocaleString('es-DO')}</td>
                      <td className="py-2 pr-3 text-right tabular-nums" data-testid="programa-puntos">{p.puntosEmitidos.toLocaleString('es-DO')}</td>
                      <td className="py-2 pr-3 text-right tabular-nums" data-testid="programa-canjes">{p.recompensasReclamadas.toLocaleString('es-DO')}</td>
                      {puedeFinanzas && (
                        <td className="py-2 pr-3 text-right tabular-nums" data-testid="programa-presupuesto">
                          {p.presupuestoAprobado ?? <span className="text-warning">Sin tope</span>}
                        </td>
                      )}
                      {puedeFinanzas && <td className="py-2 text-right tabular-nums" data-testid="programa-gastado">{p.costoRealizado}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-caption text-muted-foreground">
        Las modalidades posibles son {Object.values(LOYALTY_MODALITY_LABELS).join(', ').toLowerCase()}. Un programa puede combinarlas o quedarse con una.
      </p>
    </div>
  )
}
