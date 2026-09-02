import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { ArrowLeft, Clock, MapPin, Users, Check, X as XIcon, CalendarDays } from 'lucide-react'
import {
  companyIdPorSlug,
  excursionPublica,
} from '@/modules/excursiones/catalogo/public-queries'
import { getCompanyPublic } from '@/modules/marketplace/cached'
import { formatMoney } from '@/lib/format'
import { SITE_NAME } from '@/lib/site'
import { shareMetadata } from '@/lib/share/metadata'
import { formatoMinutosAHora, minutosDesdeMedianoche } from '@/modules/excursiones/reservas/nucleo'
import { getUser } from '@/lib/auth'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getExcursionesConfig } from '@/modules/excursiones/config'
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

export default async function ExcursionDetailPage({ params }: ExcursionDetailPageProps) {
  const { companySlug, excursionSlug } = await params
  // Esta página NO lee `searchParams`. Leía el `?e=` del enlace de vendedor y
  // no hacía nada con él: la atribución ocurre en `/e/[slug]`, que es quien
  // siembra las cookies. Se quita para que nadie lo lea y crea que sí atribuye.

  const company = await getCompanyPublic(companySlug)
  if (!company) notFound()

  const companyId = await companyIdPorSlug(companySlug)
  if (!companyId) notFound()

  const exc = await excursionPublica(companyId, excursionSlug)
  if (!exc) notFound()

  const config = await getExcursionesConfig(companyId)

  const precioDesde = exc.variantes[0]?.precioAdulto

  // Normalizar galería: JSON crudo → string[]
  const galeria: string[] = Array.isArray(exc.galeria)
    ? (exc.galeria as string[]).filter((u) => typeof u === 'string' && u.trim())
    : []

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

      <div className="mx-auto max-w-4xl px-3 sm:px-4 py-4 sm:py-8 pb-24 lg:pb-8">
        <div className="grid gap-6 lg:gap-8 lg:grid-cols-[1fr_380px]">
          {/* Detalle */}
          <div className="space-y-6">
            {/* Portada */}
            {exc.portadaUrl && (
              <div className="relative aspect-[16/9] overflow-hidden rounded-2xl bg-muted shadow-xs">
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

            {/* Galería de fotos */}
            {galeria.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
                {galeria.map((url, i) => (
                  <div
                    key={i}
                    className="relative h-24 w-24 sm:h-28 sm:w-28 shrink-0 overflow-hidden rounded-xl bg-muted shadow-xs"
                  >
                    <Image
                      src={url}
                      alt={`${exc.nombre} — foto ${i + 1}`}
                      fill
                      className="object-cover"
                      sizes="112px"
                    />
                  </div>
                ))}
              </div>
            )}

            <div>
              <h1 className="text-h1 text-foreground">
                {exc.nombre}
              </h1>

              <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs sm:text-sm text-muted-foreground">
                {exc.duracionMin && (
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-primary" />
                    {exc.duracionMin} minutos
                  </span>
                )}
                {exc.ubicacion && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 text-primary" />
                    {exc.ubicacion}
                  </span>
                )}
                {exc.capacidad && (
                  <span className="flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-primary" />
                    Máx. {exc.capacidad} personas
                  </span>
                )}
              </div>
            </div>

            {exc.descripcion && (
              <p className="leading-relaxed text-sm sm:text-base text-muted-foreground">
                {exc.descripcion}
              </p>
            )}

            {/* Incluye / No incluye */}
            {(exc.incluye || exc.noIncluye) && (
              <div className="grid gap-4 sm:grid-cols-2 rounded-2xl border border-border/80 bg-card p-4 sm:p-5">
                {exc.incluye && (
                  <div>
                    <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-foreground">Incluye</h3>
                    <ul className="space-y-1.5 text-xs sm:text-sm text-muted-foreground">
                      {exc.incluye.split('\n').map((line, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {exc.noIncluye && (
                  <div>
                    <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-foreground">No incluye</h3>
                    <ul className="space-y-1.5 text-xs sm:text-sm text-muted-foreground">
                      {exc.noIncluye.split('\n').map((line, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <XIcon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Actividades e Itinerario del Combo */}
            {exc.tipoItem === 'COMBO' && exc.comboItems && exc.comboItems.length > 0 && (
              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="font-bold text-foreground text-sm sm:text-base flex items-center gap-2">
                    <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                    Itinerario del Combo (Mismo Día)
                  </h3>
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                    {exc.comboItems.length} Actividades
                  </span>
                </div>

                <div className="space-y-2 pt-1">
                  {exc.comboItems.map((item, idx) => {
                    const act = item.actividad
                    const esPd = act.tipoItem === 'PASE_DIA'
                    const inicio = act.horaSalida ? act.horaSalida.trim().slice(0, 5) : '—'
                    const durMin = act.duracionMin ?? 0
                    const fin = (!esPd && inicio !== '—' && durMin > 0)
                      ? formatoMinutosAHora(minutosDesdeMedianoche(inicio) + durMin)
                      : (act.horaRegreso ? act.horaRegreso.trim().slice(0, 5) : '—')
                    const dur = durMin > 0
                      ? (durMin >= 60 ? `${Math.floor(durMin / 60)}h ${durMin % 60 > 0 ? `${durMin % 60}m` : ''}`.trim() : `${durMin}m`)
                      : null

                    return (
                      <div
                        key={act.id}
                        className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border bg-card p-3 shadow-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-full text-xs font-bold ${
                              esPd
                                ? 'bg-success/10 text-success'
                                : 'bg-primary text-primary-foreground'
                            }`}
                          >
                            {idx + 1}
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-xs sm:text-sm font-bold text-foreground">{act.nombre}</p>
                              {esPd && (
                                <span className="text-xs font-bold bg-success/10 text-success px-2 py-0.5 rounded-full border border-success/20">
                                  Daypass
                                </span>
                              )}
                            </div>
                            {act.categoria && (
                              <p className="text-xs text-muted-foreground">{act.categoria}</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 font-mono text-xs sm:text-xs font-semibold text-foreground">
                          {esPd ? (
                            <span className="text-success font-medium">Acceso libre</span>
                          ) : inicio !== '—' ? (
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
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-foreground">Horarios de salida</h3>
                <div className="flex flex-wrap gap-2">
                  {exc.horarios.map((h) => (
                    <span
                      key={h.id}
                      className="rounded-lg border border-border/80 bg-card px-3 py-1 text-xs font-semibold text-foreground shadow-2xs"
                    >
                      {h.horaSalida}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Variantes / Tarifas */}
            {exc.variantes.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-foreground">Tarifas y variantes</h3>
                <div className="space-y-2">
                  {exc.variantes.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between rounded-xl border border-border/80 bg-card p-3.5 shadow-2xs"
                    >
                      <div>
                        <span className="text-xs sm:text-sm font-semibold text-foreground">{v.nombre}</span>
                        {v.capacidad && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (máx. {v.capacidad})
                          </span>
                        )}
                      </div>
                      <span className="text-sm sm:text-base font-bold text-primary">
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
            {(exc.politicas || config.notasPoliticas) && (
              <div className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 space-y-2">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-foreground">Políticas y Términos</h3>
                {exc.politicas && (
                  <p className="text-xs sm:text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
                    {exc.politicas}
                  </p>
                )}
                {config.notasPoliticas && (
                  <p className="text-xs sm:text-sm leading-relaxed text-muted-foreground whitespace-pre-line pt-2 border-t border-border/60">
                    <strong className="text-foreground">Políticas de la empresa:</strong> {config.notasPoliticas}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Sidebar de reserva */}
          <div id="seccion-reserva" className="lg:sticky lg:top-4 lg:self-start">
            <ReservaExcursionForm
              companyId={companyId}
              companySlug={companySlug}
              excursionId={exc.id}
              excursionSlug={excursionSlug}
              nombreExcursion={exc.nombre}
              portadaUrl={exc.portadaUrl}
              moneda={exc.moneda}
              variantes={exc.variantes.map((v) => ({
                id: v.id,
                nombre: v.nombre,
                precioAdulto: Number(v.precioAdulto),
                precioNino: v.precioNino != null ? Number(v.precioNino) : null,
                preciosDinamicos: v.preciosDinamicos,
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
                  tipoItem: ci.actividad.tipoItem,
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
                horaSalida: ci.horaSalida,
                permitirSolapamiento: ci.permitirSolapamiento,
                horarioFijo: ci.horarioFijo,
              }))}
              esEmpresaDemo={company.esDemo}
            />
          </div>
        </div>
      </div>

      {/* Barra flotante inferior para dispositivos móviles */}
      <div className="fixed bottom-0 left-0 right-0 z-40 lg:hidden border-t border-border/80 bg-card/95 backdrop-blur-md px-4 py-2.5 shadow-lg">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div>
            <span className="text-xs text-muted-foreground block uppercase font-medium">Precio desde</span>
            <span className="text-base font-bold text-primary">
              {precioDesde != null ? formatMoney(Number(precioDesde), { moneda: exc.moneda }) : '—'}
            </span>
          </div>

          <a
            href="#seccion-reserva"
            className="flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-md transition hover:bg-primary/90 active:scale-95"
          >
            <CalendarDays className="h-4 w-4" />
            Reservar Ahora
          </a>
        </div>
      </div>
    </div>
  )
}
