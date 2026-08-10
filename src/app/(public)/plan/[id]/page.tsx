import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { CheckCircle2, Infinity as InfinityIcon } from 'lucide-react'
import { getPlanPublic, getPlanOg } from '@/modules/marketplace/cached'
import { ShareMenu } from '@/components/public/ShareMenu'
import { SITE_NAME } from '@/lib/site'
import { shareMetadata } from '@/lib/share/metadata'

interface PlanPageProps {
  params: Promise<{ id: string }>
}

export const revalidate = 3600

function fmtRD(n: number) {
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 0,
  }).format(n)
}

// Fase E8 · Membresías promocionables: vista previa enriquecida al compartir.
export async function generateMetadata({ params }: PlanPageProps): Promise<Metadata> {
  const { id } = await params
  const og = await getPlanOg(id)
  if (!og) return { title: `Plan · ${SITE_NAME}` }

  const title = `${og.nombre} · ${og.empresa}`
  const precio = og.precio > 0 ? `${fmtRD(og.precio)} · ` : ''
  const description = `${precio}${og.descripcion || `Plan de membresía de ${og.empresa} en ${SITE_NAME}`}`.slice(
    0,
    200
  )
  // Share Engine: la imagen la genera opengraph-image.tsx de esta ruta
  // (tarjeta con el plan, el precio y la marca de la empresa).
  return shareMetadata({
    title,
    description,
    url: `/plan/${og.id}`,
  })
}

export default async function PlanPublicPage({ params }: PlanPageProps) {
  const { id } = await params
  const plan = await getPlanPublic(id)
  if (!plan) notFound()

  // Al registrarse desde un plan compartido, aterriza directo en la selección
  // de planes para continuar con SU membresía (?next=), no en el home genérico.
  const registroHref = `/registro/${plan.company.slug}?next=${encodeURIComponent('/cliente/planes')}`

  return (
    <div className="min-h-screen bg-card">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <Link href="/empresas" className="flex items-center gap-2 text-primary hover:underline">
          ← Ver empresas
        </Link>

        <div className="mt-8 overflow-hidden rounded-2xl border border-border/80 shadow-premium">
          {/* Encabezado con color del plan */}
          <div
            className="p-8 text-white"
            style={{
              background: plan.color
                ? `linear-gradient(135deg, ${plan.color}, #0D9488)`
                : 'linear-gradient(135deg, #6D28D9, #3B82F6, #0D9488)',
            }}
          >
            <div className="flex items-center gap-3">
              {plan.company.logoUrl && (
                <div className="relative h-10 w-10 overflow-hidden rounded-full bg-white/20">
                  <Image src={plan.company.logoUrl} alt={plan.company.name} fill className="object-cover" />
                </div>
              )}
              <span className="font-semibold">{plan.company.name}</span>
            </div>
            <h1 className="mt-4 text-h1">{plan.nombre}</h1>
            <p className="mt-2 text-h1">
              {plan.precio > 0 ? fmtRD(plan.precio) : 'Gratis'}
              <span className="text-base font-medium opacity-80"> / {plan.vigenciaDias} días</span>
            </p>
          </div>

          <div className="space-y-6 p-8">
            {/* Adquirir + Compartir (acciones prioritarias) */}
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href={registroHref}
                className="flex-1 rounded-xl bg-primary px-6 py-4 text-center text-h3 text-primary-foreground shadow-glow transition hover:opacity-95"
              >
                Elegir este plan
              </Link>
              <ShareMenu
                title={plan.nombre}
                text={`${plan.nombre} — plan de ${plan.company.name} en ${SITE_NAME}.`}
                path={`/plan/${plan.id}`}
              />
            </div>

            {/* Qué incluye */}
            <div className="rounded-xl bg-muted p-5">
              <h2 className="mb-3 font-semibold text-foreground">Qué incluye</h2>
              <ul className="space-y-2 text-sm text-foreground">
                <li className="flex items-center gap-2">
                  {plan.esIlimitado ? (
                    <>
                      <InfinityIcon className="h-4 w-4 shrink-0 text-success" />
                      Servicios ilimitados
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                      {plan.lavadosIncluidos} servicio{plan.lavadosIncluidos !== 1 ? 's' : ''} incluido
                      {plan.lavadosIncluidos !== 1 ? 's' : ''}
                    </>
                  )}
                </li>
                {plan.beneficios.map((b) => (
                  <li key={b} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>

            {plan.descripcion && (
              <div>
                <h2 className="mb-2 text-h2 text-foreground">Descripción</h2>
                <p className="whitespace-pre-wrap leading-relaxed text-foreground">{plan.descripcion}</p>
              </div>
            )}

            {plan.condiciones && (
              <div className="rounded-xl border border-border p-4">
                <h3 className="mb-2 font-semibold text-foreground">Condiciones</h3>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{plan.condiciones}</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 rounded-2xl bg-muted p-6 text-center">
          <p className="text-foreground">
            Al adquirir el plan crearás tu cuenta en {plan.company.name} y activarás tu
            membresía con QR de acceso.
          </p>
          <Link
            href={registroHref}
            className="mt-4 inline-block rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:opacity-95"
          >
            Elegir este plan
          </Link>
        </div>
      </div>
    </div>
  )
}
