import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { ChipPrograma } from '@/components/supply-v2/chips'
import { fidelizacionDelProveedor } from '@/modules/supply-v2/loyalty/queries'
import { proveedorDeLaSesion } from '@/modules/supply-v2/permisos'
import { LOYALTY_MODALITY_LABELS, MEMBERSHIP_PLAN_STATUS_LABELS } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Fidelización · Membego Supply' }

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · lo que el NEGOCIO ve de su fidelización (§40).
 *
 * Solo sus programas: se filtra por el `supplierId` de su sesión, no por lo
 * que mande la pantalla. Ve sus miembros, sus referidos, los puntos que se
 * emitieron y lo que él asume, separado de lo que pone Membego.
 *
 * Lo que NO puede hacer desde aquí: cambiar presupuestos, condiciones
 * financieras ni nada de otro negocio. Es una pantalla de lectura.
 */
export default async function FidelizacionProveedorPage() {
  await requireRole('ADMINISTRADOR')
  const proveedor = await proveedorDeLaSesion()
  if (!proveedor) {
    return (
      <div className="space-y-6">
        <PageHeader title="Fidelización" description="Tus programas de membresías, referidos y puntos." />
        <EmptyState
          title="Tu empresa todavía no es proveedora de Membego Supply"
          description="Cuando Membego la vincule, aquí verás tus programas de fidelización."
        />
      </div>
    )
  }

  const programas = await fidelizacionDelProveedor(proveedor.supplierId)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fidelización"
        description="Tus programas de membresías, referidos, puntos y recompensas. Lo que pones tú y lo que pone Membego, por separado."
        eyebrow="Membego Supply"
      />

      {programas.length === 0 ? (
        <EmptyState
          title="Todavía no hay programas que te afecten"
          description="Cuando Membego cree un programa con tu negocio, o tú propongas uno, aparecerá aquí."
        />
      ) : (
        <ul className="space-y-4" data-testid="programas-proveedor">
          {programas.map((p) => (
            <li key={p.id}>
              <Card data-testid="programa-proveedor">
                <CardContent className="space-y-3 pt-6">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium" data-testid="programa-prov-nombre">{p.nombre}</p>
                      <p className="font-mono text-caption text-muted-foreground">
                        {p.code} · {p.modalidades.map((m) => LOYALTY_MODALITY_LABELS[m]).join(' · ')}
                      </p>
                      <p className="text-caption text-muted-foreground">
                        {formatDate(new Date(p.vigencia.desde))}{p.vigencia.hasta ? ` → ${formatDate(new Date(p.vigencia.hasta))}` : ' → sin fin'}
                      </p>
                    </div>
                    <ChipPrograma estado={p.estado} />
                  </div>

                  <dl className="grid gap-3 sm:grid-cols-4">
                    <div>
                      <dt className="text-caption text-muted-foreground">Miembros activos</dt>
                      <dd className="text-h3 tabular-nums" data-testid="programa-prov-miembros">{p.miembrosActivos.toLocaleString('es-DO')}</dd>
                      <p className="text-caption text-muted-foreground">{p.membresiasVencidas} vencida(s)</p>
                    </div>
                    <div>
                      <dt className="text-caption text-muted-foreground">Referidos pagados</dt>
                      <dd className="text-h3 tabular-nums" data-testid="programa-prov-referidos">{p.referidosValidos.toLocaleString('es-DO')}</dd>
                    </div>
                    <div>
                      <dt className="text-caption text-muted-foreground">Puntos emitidos</dt>
                      <dd className="text-h3 tabular-nums" data-testid="programa-prov-puntos">{p.puntosOtorgados.toLocaleString('es-DO')}</dd>
                    </div>
                    <div>
                      <dt className="text-caption text-muted-foreground">Canjes · entregas</dt>
                      <dd className="text-h3 tabular-nums" data-testid="programa-prov-canjes">{p.recompensasReclamadas} · {p.entregas}</dd>
                    </div>
                  </dl>

                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <p className="text-sm">
                      Lo que asumes: <span className="font-medium tabular-nums" data-testid="programa-prov-costo">{p.costoAsumido}</span>
                      {' · '}comprometido: <span className="tabular-nums" data-testid="programa-prov-comprometido">{p.comprometido}</span>
                    </p>
                    <p className="text-caption text-muted-foreground">
                      El costo se cuenta cuando la recompensa se ENTREGA, no cuando se emiten los puntos.
                    </p>
                  </div>

                  {p.planes.length > 0 && (
                    <ul className="divide-y divide-border text-sm" data-testid="planes-proveedor">
                      {p.planes.map((pl) => (
                        <li key={pl.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2" data-testid="plan-proveedor">
                          <span className="font-medium">{pl.nombre}</span>
                          <span className="text-caption text-muted-foreground">
                            {pl.precio} · {pl.dias} días · {MEMBERSHIP_PLAN_STATUS_LABELS[pl.estado]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="text-caption text-muted-foreground">
        Esta pantalla es de lectura: los presupuestos y las condiciones financieras los administra Membego.
      </p>
    </div>
  )
}
