import { requireRole } from '@/lib/auth/guards'
import { sinEmpresa } from '@/lib/tenant'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Megaphone, Gift, MessageCircle } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function OperacionesPage() {
  await requireRole('SUPERADMIN')

  let companies: { id: string; name: string; type: string }[] = []
  try {
    companies = await sinEmpresa(
      'operaciones de plataforma: compara empresas entre sí',
      (tx) => tx.company.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true, type: true },
      })
    )
  } catch (e) {
    console.error('[operaciones] companies', e)
  }

  const promoMap = new Map<string, { total: number; activas: number }>()
  const referidosMap = new Map<string, { completados: number; reglas: number }>()
  const whatsappMap = new Map<string, { numero: string; activo: boolean }>()

  // Agregaciones en bloque (evita N+1: antes eran ~5 queries por empresa).
  try {
    const [
      promosTotal,
      promosActivas,
      referidosCompletados,
      reglas,
      whatsapps,
    ] = await sinEmpresa(
      'operaciones de plataforma: compara empresas entre sí',
      (tx) => Promise.all([
        tx.promocion.groupBy({ by: ['companyId'], _count: { _all: true } }),
        tx.promocion.groupBy({
          by: ['companyId'],
          where: { activo: true },
          _count: { _all: true },
        }),
        tx.referido.groupBy({
          by: ['companyId'],
          where: { estado: 'COMPLETADO' },
          _count: { _all: true },
        }),
        tx.reglaRecompensa.groupBy({ by: ['companyId'], _count: { _all: true } }),
        tx.whatsAppConfig.findMany({
          select: { companyId: true, numero: true, activo: true },
        }),
      ])
    )

    for (const c of companies) {
      const total = promosTotal.find((p) => p.companyId === c.id)?._count._all ?? 0
      const activas = promosActivas.find((p) => p.companyId === c.id)?._count._all ?? 0
      promoMap.set(c.id, { total, activas })

      const completados =
        referidosCompletados.find((r) => r.companyId === c.id)?._count._all ?? 0
      const numReglas = reglas.find((r) => r.companyId === c.id)?._count._all ?? 0
      referidosMap.set(c.id, { completados, reglas: numReglas })
    }

    for (const wa of whatsapps) {
      whatsappMap.set(wa.companyId, { numero: wa.numero, activo: wa.activo })
    }
  } catch (e) {
    console.error('[operaciones] aggregations', e)
  }

  return (
    <div className="space-y-8 animate-fade-up">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Superadmin</p>
        <h1 className="text-h1 text-foreground">
          Operaciones por empresa
        </h1>
        <p className="text-small text-muted-foreground">
          Vista unificada de promociones, referidos y WhatsApp configurados por cada empresa.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {companies.map((c) => {
          const promo = promoMap.get(c.id)
          const ref = referidosMap.get(c.id)
          const wa = whatsappMap.get(c.id)
          return (
            <Card key={c.id} className="border-border/60 shadow-card">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  {c.name}
                  <Badge variant="secondary" className="text-caption capitalize">
                    {c.type}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Megaphone className="h-4 w-4 text-primary" />
                    Promociones activas
                  </div>
                  <span className="font-semibold">
                    {promo ? `${promo.activas} / ${promo.total}` : '0'}
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Gift className="h-4 w-4 text-warning" />
                    Referidos completados
                  </div>
                  <span className="font-semibold">
                    {ref ? `${ref.completados} (${ref.reglas} regla${ref.reglas !== 1 ? 's' : ''})` : '0'}
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <MessageCircle className="h-4 w-4 text-success" />
                    WhatsApp
                  </div>
                  {wa ? (
                    <Badge
                      className={
                        wa.activo
                          ? 'bg-success/15 text-success hover:bg-success/15'
                          : 'bg-muted text-muted-foreground hover:bg-muted'
                      }
                    >
                      {wa.activo ? 'Activo' : 'Inactivo'} · {wa.numero}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-caption">
                      Sin configurar
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
