import Link from 'next/link'
import { CheckCircle2, CircleAlert, Search } from 'lucide-react'
import { sinEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { estadoDelPuenteEnTx } from '@/modules/supply-bridge/service'
import { PuenteAcciones } from '@/components/supply-bridge/PuenteAcciones'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Puente Supply → Catálogo' }

/**
 * Plataforma · el puente Supply → Catálogo (Fase 2.5). Aquí el superadmin
 * designa la empresa «de la casa» —de la que cuelgan las ofertas de Membego en
 * el catálogo— y ve el estado de la sincronización.
 */
export default async function PuenteSupplyPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireRole('SUPERADMIN')
  const q = ((await searchParams).q ?? '').trim().slice(0, 80)

  const { estado, candidatas, casa } = await sinEmpresa('superadmin: puente Supply→Catálogo', async (tx) => {
    const estado = await estadoDelPuenteEnTx(tx)
    const casa = estado.casa
      ? await tx.company.findUnique({ where: { id: estado.casa.id }, select: { id: true, name: true, slug: true, isPublished: true, isActive: true, esDemo: true } })
      : null
    const candidatas = q
      ? await tx.company.findMany({
          where: { esDemo: false, esCasaMembego: false, OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }] },
          select: { id: true, name: true, slug: true },
          orderBy: { name: 'asc' },
          take: 10,
        })
      : []
    return { estado, candidatas, casa }
  })
  const capacidad = casa ? await tieneCapacidad(casa.id, 'CATALOGO_UNIFICADO') : false

  const requisitos = casa
    ? [
        { ok: casa.isActive, texto: 'La empresa está activa' },
        { ok: casa.isPublished, texto: 'La empresa está publicada en el marketplace' },
        { ok: !casa.esDemo, texto: 'No es una empresa de demostración' },
        { ok: capacidad, texto: 'Tiene encendida la capacidad «Catálogo unificado» (override en Capacidades)' },
      ]
    : []
  const listo = requisitos.length > 0 && requisitos.every((r) => r.ok)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Puente Supply → Catálogo"
        description="Las ofertas de Supply 2.0 aparecen en el catálogo y en el descubrimiento como ítems de una empresa «de la casa». Supply es el master: esos ítems son de solo lectura y se actualizan solos."
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Empresa de la casa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {casa ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{casa.name}</p>
                  <p className="text-xs text-muted-foreground">/empresas/{casa.slug}</p>
                </div>
                <PuenteAcciones modo="retirar" />
              </div>
              <ul className="space-y-1.5 text-sm" aria-label="Requisitos para que las ofertas se vean">
                {requisitos.map((r) => (
                  <li key={r.texto} className="flex items-start gap-2">
                    {r.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" aria-hidden /> : <CircleAlert className="mt-0.5 h-4 w-4 text-warning" aria-hidden />}
                    <span>
                      {r.texto}
                      <span className="sr-only">{r.ok ? ': cumplido' : ': falta'}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {!listo && <p className="text-sm text-muted-foreground">Mientras falte alguno, las ofertas se sincronizan pero el público no las ve.</p>}
              <p className="text-xs text-muted-foreground">Retirar la casa archiva todos los ítems puente (se conservan; si vuelves a designar una, se reactivan).</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Todavía no hay empresa de la casa: el puente no sincroniza nada y las ofertas de Supply no aparecen en el catálogo.</p>
          )}

          {!casa && (
            <div className="space-y-3 border-t pt-4">
              <form method="get" className="flex flex-wrap items-end gap-2" role="search">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input name="q" defaultValue={q} placeholder="Buscar empresa por nombre" aria-label="Buscar empresa" className="w-72 pl-8" />
                </div>
                <Button type="submit" variant="outline">
                  Buscar
                </Button>
              </form>
              {q && candidatas.length === 0 && <p className="text-sm text-muted-foreground">Ninguna empresa coincide con «{q}».</p>}
              <ul className="divide-y text-sm" aria-label="Empresas candidatas">
                {candidatas.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {c.name} <span className="text-xs text-muted-foreground">/{c.slug}</span>
                    </span>
                    <PuenteAcciones modo="designar" companyId={c.id} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">Sincronización</CardTitle>
          {casa && <PuenteAcciones modo="sincronizar" />}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2" aria-label="Ítems puente por estado">
            <Badge variant="success">{estado.items.ACTIVE} publicados</Badge>
            <Badge variant="warning">{estado.items.PAUSED} pausados</Badge>
            <Badge variant="outline">{estado.items.ARCHIVED} archivados</Badge>
          </div>
          <p className="text-muted-foreground">
            {estado.pendientes > 0
              ? `${estado.pendientes} oferta(s) de Supply esperan su ítem${casa ? ': sincroniza ahora o espera al cron diario.' : '.'}`
              : 'Todas las ofertas no borrador tienen su ítem.'}
          </p>
          <p className="text-xs text-muted-foreground">
            Cada cambio de una oferta se refleja al momento; el cron diario (06:45 UTC) reconcilia lo que se escapó. El público cruza cada ítem con la oferta en vivo: una oferta pausada, agotada o vencida deja de enseñarse sin esperar a la sincronización. Ver el resultado en{' '}
            <Link href="/catalogo?origen=supply" className="underline">
              /catalogo
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
