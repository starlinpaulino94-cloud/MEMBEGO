import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { Gift, CheckCircle2, Sparkles, ShieldCheck, Users } from 'lucide-react'
import { getGrowthLanding } from '@/modules/growth/links'
import { getGrowthConfig } from '@/modules/growth/config'
import { evaluarRecompensasGrowth } from '@/modules/growth/rewards'
import { logReferralEvent } from '@/lib/referidos'
import { SITE_NAME } from '@/lib/site'
import { shareMetadata } from '@/lib/share/metadata'
import { CountdownTimer } from '@/components/growth/CountdownTimer'

export const dynamic = 'force-dynamic'

interface InvitacionPageProps {
  params: Promise<{ code: string }>
}

export async function generateMetadata({ params }: InvitacionPageProps): Promise<Metadata> {
  const { code } = await params
  const data = await getGrowthLanding(code)
  if (!data) return { title: `Invitación · ${SITE_NAME}` }

  const beneficio = data.beneficio?.titulo ?? 'un beneficio exclusivo'
  const title = `${data.referente} te invita a ${data.empresa.name}`
  const description = `Acepta esta invitación y recibe ${beneficio} en ${data.empresa.name} · ${SITE_NAME}.`
  // Share Engine: la imagen la genera opengraph-image.tsx de esta ruta
  // (tarjeta con el beneficio y quien invita).
  return shareMetadata({
    title,
    description,
    url: `/i/${data.code}`,
  })
}

export default async function InvitacionPage({ params }: InvitacionPageProps) {
  const { code } = await params
  const data = await getGrowthLanding(code)
  if (!data) notFound()

  // Registrar la vista de la landing (embudo, no bloqueante).
  logReferralEvent({
    clienteId: data.clienteId,
    companyId: data.companyId,
    tipo: 'LANDING_VIEW',
    growthLinkId: undefined,
    meta: { code: data.code },
  }).catch(() => {})

  // Recompensa por apertura (si la empresa la activó); idempotente por enlace.
  const cfg = await getGrowthConfig(data.companyId)
  if (cfg.premiaClic && !data.expirado) {
    evaluarRecompensasGrowth({
      companyId: data.companyId,
      trigger: 'LINK_ABIERTO',
      referenteClienteId: data.clienteId,
    }).catch(() => {})
  }

  // Invitación expirada (req #2): mensaje + otras promociones.
  if (data.expirado || !data.expiresAt) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-card px-4">
        <div className="w-full max-w-md rounded-2xl border border-border/80 p-8 text-center shadow-premium">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Gift className="h-8 w-8 text-muted-foreground" />
          </div>
          <h1 className="text-h1 text-foreground">Esta invitación expiró</h1>
          <p className="mt-2 text-muted-foreground">
            La oferta de {data.referente} ya no está disponible, pero {data.empresa.name} tiene
            otras promociones esperándote.
          </p>
          <Link
            href={`/empresas/${data.empresa.slug}`}
            className="mt-6 inline-block rounded-xl bg-primary px-6 py-3 font-bold text-primary-foreground transition hover:opacity-95"
          >
            Ver otras promociones
          </Link>
        </div>
      </div>
    )
  }

  const beneficioTitulo = data.beneficio?.titulo ?? 'un beneficio exclusivo'
  const ctaHref = `/registro/${data.empresa.slug}?ref=${data.referenteCodigo}&gl=${data.code}`

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/10 via-card to-card">
      <div className="mx-auto max-w-lg px-4 py-10">
        {/* Marca MembeGo + empresa */}
        <div className="mb-6 flex items-center justify-between">
          <span className="text-sm font-bold tracking-tight text-foreground">{SITE_NAME}</span>
          <div className="flex items-center gap-2">
            {data.empresa.logoUrl && (
              <span className="relative h-7 w-7 overflow-hidden rounded-full bg-muted">
                <Image src={data.empresa.logoUrl} alt={data.empresa.name} fill className="object-cover" />
              </span>
            )}
            <span className="text-sm font-semibold text-foreground">{data.empresa.name}</span>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-premium">
          {/* Imagen principal del beneficio */}
          <div className="relative h-52 w-full bg-muted">
            {data.beneficio?.imagenUrl ? (
              <Image src={data.beneficio.imagenUrl} alt={beneficioTitulo} fill className="object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary via-info to-success">
                <Gift className="h-20 w-20 text-white/90" />
              </div>
            )}
            <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-caption font-bold text-foreground shadow">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Invitación exclusiva
            </span>
          </div>

          <div className="space-y-6 p-6">
            {/* Título llamativo */}
            <div className="text-center">
              <p className="text-4xl" role="img" aria-label="Celebración">🎉</p>
              <h1 className="mt-1 text-h1 text-foreground">
                {data.titulo ?? `¡${data.referente} te regala un beneficio!`}
              </h1>
              <p className="mt-2 text-muted-foreground">
                {data.mensaje ??
                  `${data.referente} quiere que disfrutes ${beneficioTitulo} en ${data.empresa.name}.`}
              </p>
            </div>

            {/* Beneficio que recibirá */}
            <div className="rounded-2xl border border-success/25 bg-success/10 p-4">
              <p className="text-sm font-semibold text-success">Solo por aceptar recibirás</p>
              <div className="mt-2 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                <span className="text-h3 text-foreground">{beneficioTitulo}</span>
              </div>
              {data.beneficio?.descripcion && (
                <p className="mt-1 text-sm text-muted-foreground">{data.beneficio.descripcion}</p>
              )}
            </div>

            {/* Contador regresivo */}
            <div className="text-center">
              <p className="mb-3 text-sm font-medium text-muted-foreground">⏳ Oferta válida por</p>
              <CountdownTimer expiresAt={data.expiresAt.toISOString()} />
            </div>

            {/* CTA principal */}
            <Link
              href={ctaHref}
              className="block w-full rounded-2xl bg-primary px-6 py-4 text-center text-h3 text-primary-foreground shadow-glow transition hover:opacity-95"
            >
              Quiero aprovechar esta promoción
            </Link>

            {/* Confianza / prueba social */}
            <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-success" /> Registro seguro · sin tarjeta
              </span>
              {data.yaAprovecharon > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-primary" />
                  {data.yaAprovecharon} persona{data.yaAprovecharon !== 1 ? 's' : ''} ya
                  {data.yaAprovecharon !== 1 ? ' aprovecharon' : ' aprovechó'} esta invitación
                </span>
              )}
              {data.recompensaReferente && (
                <span className="text-caption">
                  Al registrarte, {data.referente} también recibe {data.recompensaReferente}.
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
