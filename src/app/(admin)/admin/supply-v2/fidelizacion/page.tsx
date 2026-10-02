import { Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { exigirProveedorSupplyV2 } from '@/modules/supply-v2/permisos'
import { fidelizacionDelProveedor } from '@/modules/supply-v2/loyalty/queries'
import { ESTADO_PROGRAMA } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Fidelización · Membego Supply' }

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · el portal del negocio (§40).
 *
 * Ve SUS programas y solo los suyos: el `supplierId` sale de la sesión
 * (`exigirProveedorSupplyV2`), no de lo que mande la pantalla. Aquí no hay
 * ninguna acción de escritura sobre presupuesto ni financiación: lo que un
 * negocio no decide, tampoco lo toca.
 */
export default async function FidelizacionProveedorPage() {
  const proveedor = await exigirProveedorSupplyV2()
  const programas = await fidelizacionDelProveedor(proveedor.supplierId)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fidelización"
        description={`Los programas de ${proveedor.supplierName}: miembros, referidos, puntos y recompensas.`}
        eyebrow="Membego Supply"
      />

      {programas.length === 0 ? (
        <EmptyState
          variant="card"
          icon={<Sparkles className="h-6 w-6" aria-hidden />}
          title="Todavía no tienes programas"
          description="Cuando Membego active un programa de fidelización para tu negocio, lo verás aquí con sus resultados."
        />
      ) : (
        programas.map((p) => (
          <Card key={p.id} data-testid="tarjeta-programa-proveedor">
            <CardContent className="space-y-4 pt-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-h4" data-testid="proveedor-programa">{p.nombre}</p>
                  <p className="font-mono text-caption text-muted-foreground">{p.code}</p>
                </div>
                <span className="rounded-full bg-muted px-3 py-1 text-caption">{ESTADO_PROGRAMA[p.estado] ?? p.estado}</span>
              </div>

              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
                {([
                  ['Miembros activos', String(p.miembrosActivos), 'prov-miembros'],
                  ['Vencidas', String(p.membresiasVencidas), 'prov-vencidas'],
                  ['Referidos válidos', String(p.referidosValidos), 'prov-referidos'],
                  ['Puntos otorgados', String(p.puntosOtorgados), 'prov-puntos'],
                  ['Recompensas', String(p.recompensasReclamadas), 'prov-recompensas'],
                  ['Entregas', String(p.entregas), 'prov-entregas'],
                ] as const).map(([k, v, tid]) => (
                  <div key={k} className="rounded-xl bg-muted/50 p-2">
                    <dt className="text-caption text-muted-foreground">{k}</dt>
                    <dd className="tabular-nums" data-testid={tid}>{v}</dd>
                  </div>
                ))}
              </dl>

              {p.planes.length > 0 && (
                <div>
                  <p className="mb-1 text-caption uppercase text-muted-foreground">Tus planes</p>
                  <ul className="space-y-1 text-sm" data-testid="prov-planes">
                    {p.planes.map((pl) => (
                      <li key={pl.id} className="flex flex-wrap justify-between gap-2">
                        <span>{pl.nombre} · {pl.dias} días</span>
                        <span className="tabular-nums">{pl.precio} · {pl.estado}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-sm" data-testid="prov-costo">
                Lo que has asumido en recompensas entregadas: <strong className="tabular-nums">{p.costoAsumido}</strong>.
                {' '}Comprometido en topes: <strong className="tabular-nums">{p.comprometido}</strong>.
              </p>
              <p className="text-caption text-muted-foreground">
                Vigente desde {formatDate(new Date(p.vigencia.desde))}
                {p.vigencia.hasta ? ` hasta ${formatDate(new Date(p.vigencia.hasta))}` : ', sin fecha de fin'}.
              </p>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
