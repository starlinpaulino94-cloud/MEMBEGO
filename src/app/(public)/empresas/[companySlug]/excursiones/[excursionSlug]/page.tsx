import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { ArrowLeft, Clock, MapPin, Users, Check, X as XIcon } from 'lucide-react'
import {
  companyIdPorSlug,
  excursionPublica,
} from '@/modules/excursiones/catalogo/public-queries'
import { getCompanyPublic } from '@/modules/marketplace/cached'
import { formatMoney } from '@/lib/format'
import { SITE_NAME } from '@/lib/site'
import { shareMetadata } from '@/lib/share/metadata'
import { DIAS_SEMANA } from '@/modules/excursiones/catalogo/nucleo'
import { getUser } from '@/lib/auth'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { ReservaExcursionForm } from './ReservaExcursionForm'
import type { SalidaDisponible } from '@/modules/excursiones/catalogo/public-queries'

interface ExcursionDetailPageProps {
  params: Promise<{ companySlug: string; excursionSlug: string }>
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
  searchParams,
}: ExcursionDetailPageProps): Promise<Metadata> {
  const { companySlug, excursionSlug } = await params
  const company = await getCompanyPublic(companySlug)
  if (!company) return { title: `Excursión · ${SITE_NAME}` }

  const companyId = await companyIdPorSlug(companySlug)
  if (!companyId) return { title: `Excursión · ${company.name}` }

  const exc = await excursionPublica(companyId, excursionSlug)
  if (!exc) return { title: `Excursión · ${company.name}` }

  const sp = searchParams ? await searchParams : {}
  const eParam = typeof sp?.e === 'string' ? `?e=${encodeURIComponent(sp.e)}` : ''

  return shareMetadata({
    title: `${exc.nombre} · ${company.name}`,
    description: exc.descripcion ?? `Reserva ${exc.nombre} con ${company.name}.`,
    url: `/empresas/${company.slug}/excursiones/${exc.slug}${eParam}`,
    image: exc.portadaUrl ?? undefined,
  })
}

const DIAS_LABEL: Record<number, string> = Object.fromEntries(
  DIAS_SEMANA.map((d) => [d.n, d.label])
)

export default async function ExcursionDetailPage({ params, searchParams }: ExcursionDetailPageProps) {
  const { companySlug, excursionSlug } = await params
  const sp = searchParams ? await searchParams : {}
  const enlaceVendedor = typeof sp?.e === 'string' ? sp.e : undefined

  const company = await getCompanyPublic(companySlug)
  if (!company) notFound()

  const companyId = await companyIdPorSlug(companySlug)
  if (!companyId) notFound()

  const exc = await excursionPublica(companyId, excursionSlug)
  if (!exc) notFound()

  const precioDesde = exc.variantes[0]?.precioAdulto

  // Auth + follow check for the booking form
  const user = await getUser()
  const isAuthenticated = !!user
  let isFollowing = false
  if (user) {
    const company = await getCompanyPublic(companySlug)
    if (company) {
      // `users` es una tabla del NÚCLEO, no de una empresa: la identidad del
      // usuario autenticado existe antes que cualquier tenant y se resuelve
      // por su `supabaseId`. Por eso va con `sinEmpresa` y su motivo escrito.
      const usuario = await sinEmpresa('identidad del usuario autenticado (tabla del núcleo)', (tx) =>
        tx.user.findUnique({
          where: { supabaseId: user.supabaseId },
          select: { id: true },
        })
      )
      if (usuario) {
        // El seguimiento sí pertenece a una empresa concreta: va acotado a ella.
        const follow = await conEmpresa(company.id, (tx) =>
          tx.companyFollow.findUnique({
            where: { userId_companyId: { userId: usuario.id, companyId: company.id } },
            select: { id: true },
          })
        )
        isFollowing = !!follow
      }
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-4">
          <Link
            href={`/empresas/${companySlug}/excursiones`}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Excursiones
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          {/* Detalle */}
          <div>
            {/* Portada */}
            {exc.portadaUrl && (
              <div className="relative mb-6 aspect-[16/9] overflow-hidden rounded-xl bg-muted">
                <Image
                  src={exc.portadaUrl}
                  alt={exc.nombre}
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 60vw"
                  priority
                />
              </div>
            )}

            <h1 className="text-h2 font-bold tracking-tight">
              {exc.nombre}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              {exc.duracionMin && (
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />
                  {exc.duracionMin} minutos
                </span>
              )}
              {exc.ubicacion && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" />
                  {exc.ubicacion}
                </span>
              )}
              {exc.capacidad && (
                <span className="flex items-center gap-1.5">
                  <Users className="h-4 w-4" />
                  Máx. {exc.capacidad} personas
                </span>
              )}
            </div>

            {exc.descripcion && (
              <p className="mt-6 leading-relaxed text-muted-foreground">
                {exc.descripcion}
              </p>
            )}

            {/* Incluye / No incluye */}
            {(exc.incluye || exc.noIncluye) && (
              <div className="mt-8 grid gap-6 sm:grid-cols-2">
                {exc.incluye && (
                  <div>
                    <h3 className="mb-2 font-semibold">Incluye</h3>
                    <ul className="space-y-1.5 text-sm text-muted-foreground">
                      {exc.incluye.split('\n').map((line, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {exc.noIncluye && (
                  <div>
                    <h3 className="mb-2 font-semibold">No incluye</h3>
                    <ul className="space-y-1.5 text-sm text-muted-foreground">
                      {exc.noIncluye.split('\n').map((line, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <XIcon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Actividades e Itinerario del Combo */}
            {exc.tipoItem === 'COMBO' && exc.comboItems && exc.comboItems.length > 0 && (
              <div className="mt-8 rounded-2xl border border-primary/20 bg-primary/5 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-foreground flex items-center gap-2">
                    <Clock className="h-5 w-5 text-primary" />
                    Itinerario del Combo (Mismo Día)
                  </h3>
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                    {exc.comboItems.length} Actividades
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Todas las actividades se realizan de forma consecutiva y coordinada el mismo día de tu reserva.
                </p>

                <div className="space-y-2 pt-1">
                  {exc.comboItems.map((item, idx) => {
                    const act = item.actividad
                    const inicio = act.horaSalida ? act.horaSalida.trim().slice(0, 5) : '—'
                    const fin = act.horaRegreso ? act.horaRegreso.trim().slice(0, 5) : '—'
                    const dur = act.duracionMin ? `${(act.duracionMin / 60).toFixed(1)}h` : null

                    return (
                      <div
                        key={act.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3.5 shadow-xs"
                      >
                        <div className="flex items-center gap-3">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                            {idx + 1}
                          </span>
                          <div>
                            <p className="text-sm font-bold text-foreground">{act.nombre}</p>
                            {act.categoria && (
                              <p className="text-caption text-muted-foreground">{act.categoria}</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 font-mono text-xs font-semibold text-foreground">
                          {inicio !== '—' ? (
                            <span>
                              {inicio} {fin !== '—' ? `→ ${fin}` : ''} {dur ? `(${dur})` : ''}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Horario según turno</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Horarios */}
            {exc.horarios.length > 0 && (
              <div className="mt-8">
                <h3 className="mb-3 font-semibold">Horarios de salida</h3>
                <div className="flex flex-wrap gap-2">
                  {exc.horarios.map((h) => (
                    <span
                      key={h.id}
                      className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm"
                    >
                      <span className="font-medium">{h.horaSalida}</span>
                      <span className="text-muted-foreground">
                        {h.diasSemana
                          .map((d) => DIAS_LABEL[d] ?? d)
                          .join(', ')}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Variantes */}
            {exc.variantes.length > 0 && (
              <div className="mt-8">
                <h3 className="mb-3 font-semibold">Opciones</h3>
                <div className="space-y-2">
                  {exc.variantes.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between rounded-lg border bg-card p-4"
                    >
                      <div>
                        <span className="font-medium">{v.nombre}</span>
                        {v.capacidad && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (máx. {v.capacidad})
                          </span>
                        )}
                      </div>
                      <span className="font-semibold text-primary">
                        {formatMoney(Number(v.precioAdulto), { moneda: exc.moneda })}
                        <span className="text-xs font-normal text-muted-foreground">
                          {' '}/adulto
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Políticas */}
            {exc.politicas && (
              <div className="mt-8">
                <h3 className="mb-2 font-semibold">Políticas</h3>
                <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
                  {exc.politicas}
                </p>
              </div>
            )}
          </div>

          {/* Sidebar de reserva */}
          <div className="lg:sticky lg:top-4 lg:self-start">
            <ReservaExcursionForm
              companyId={companyId}
              companySlug={companySlug}
              excursionId={exc.id}
              nombreExcursion={exc.nombre}
              portadaUrl={exc.portadaUrl}
              moneda={exc.moneda}
              variantes={exc.variantes.map((v) => ({
                id: v.id,
                nombre: v.nombre,
                precioAdulto: Number(v.precioAdulto),
                precioNino: v.precioNino != null ? Number(v.precioNino) : null,
              }))}
              horarios={exc.horarios.map((h) => ({
                id: h.id,
                horaSalida: h.horaSalida,
                diasSemana: h.diasSemana,
              }))}
              precioDesde={precioDesde != null ? Number(precioDesde) : null}
              isAuthenticated={isAuthenticated}
              isFollowing={isFollowing}
              proximasSalidas={exc.proximasSalidas as SalidaDisponible[]}
              agotadaGlobal={exc.agotadaGlobal}
              todasFechasPasadas={exc.todasFechasPasadas}
              capacidad={exc.capacidad}
              tipoItem={exc.tipoItem}
              comboItems={exc.comboItems?.map((ci) => ({
                actividad: {
                  id: ci.actividad.id,
                  nombre: ci.actividad.nombre,
                  slug: ci.actividad.slug,
                  portadaUrl: ci.actividad.portadaUrl,
                  duracionMin: ci.actividad.duracionMin,
                  horaSalida: ci.actividad.horaSalida,
                  horaRegreso: ci.actividad.horaRegreso,
                  categoria: ci.actividad.categoria,
                  horarios: ci.actividad.horarios?.map((h) => ({
                    id: h.id,
                    horaSalida: h.horaSalida,
                    diasSemana: Array.isArray(h.diasSemana) ? (h.diasSemana as number[]) : [],
                    cupo: h.cupo,
                  })),
                },
              }))}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
