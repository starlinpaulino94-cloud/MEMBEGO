'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Star,
  Gift,
  MapPin,
  ArrowRight,
  UserMinus,
  UserPlus,
  BadgeCheck,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  toggleSeguirEmpresa,
  toggleFavoritaEmpresa,
} from '@/modules/social/actions'
import type { EmpresaSeguida } from '@/modules/social/queries'

const TIPO_LABEL: Record<string, string> = {
  carwash: 'Car Wash',
  restaurante: 'Restaurante',
  gimnasio: 'Gimnasio',
  salon: 'Salón',
}

export function MisEmpresasList({ empresas }: { empresas: EmpresaSeguida[] }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function alternarSeguir(companyId: string, name: string, seguiaAntes: boolean) {
    setPendingId(companyId)
    startTransition(async () => {
      const res = await toggleSeguirEmpresa(companyId)
      setPendingId(null)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(
        seguiaAntes ? `Dejaste de seguir ${name}.` : `Ahora sigues ${name}.`
      )
      router.refresh()
    })
  }

  function toggleFavorita(companyId: string) {
    setPendingId(companyId)
    startTransition(async () => {
      const res = await toggleFavoritaEmpresa(companyId)
      setPendingId(null)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(res.esFavorita ? 'Marcada como favorita.' : 'Quitada de favoritas.')
      router.refresh()
    })
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {empresas.map(({ company, esFavorita, sigo, esCliente }) => {
        const pending = pendingId === company.id
        const initials = company.name.slice(0, 2).toUpperCase()
        return (
          <div
            key={company.id}
            className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition hover:border-primary/30 hover:shadow-sm"
          >
            {/* Cabecera con banner/gradiente */}
            <div className="relative h-16 bg-gradient-to-br from-blue-600 to-sky-500">
              {company.bannerUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={company.bannerUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              )}
              {esFavorita && (
                <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-xs font-semibold text-warning">
                  <Star className="h-3 w-3 fill-amber-400 text-warning" /> Favorita
                </span>
              )}
            </div>

            <div className="flex flex-1 flex-col p-4">
              <div className="-mt-10 mb-2">
                {company.logoUrl ? (
                  <div className="relative h-12 w-12 overflow-hidden rounded-xl border-2 border-white bg-card shadow">
                    <Image src={company.logoUrl} alt={company.name} fill className="object-cover" />
                  </div>
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-white bg-gradient-to-br from-primary to-teal-500 text-sm font-bold text-white shadow">
                    {initials}
                  </div>
                )}
              </div>

              <h3 className="font-semibold text-foreground">{company.name}</h3>
              {esCliente && (
                <p className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-caption font-semibold text-success">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Eres cliente
                </p>
              )}
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-muted px-2 py-0.5">
                  {TIPO_LABEL[company.type] ?? company.type}
                </span>
                {company.ciudad && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {company.ciudad}
                  </span>
                )}
              </div>

              <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Gift className="h-4 w-4 text-destructive" />
                {company.activePromotionsCount} promociones activas
              </p>

              {/* Acciones */}
              <div className="mt-4 flex items-center gap-2 border-t border-border/60 pt-3">
                <Link
                  href={`/cliente/empresas/${company.slug}`}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary"
                >
                  Ver perfil <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                {/* Marcar favorita presupone seguir: sin seguimiento no hay
                    fila que marcar. */}
                {sigo && (
                  <button
                    onClick={() => toggleFavorita(company.id)}
                    disabled={pending}
                    aria-label={esFavorita ? 'Quitar de favoritas' : 'Marcar favorita'}
                    title={esFavorita ? 'Quitar de favoritas' : 'Marcar favorita'}
                    className={`rounded-lg border p-2 transition disabled:opacity-50 ${
                      esFavorita
                        ? 'border-warning/30 bg-warning/15 text-warning'
                        : 'border-border text-muted-foreground hover:text-warning'
                    }`}
                  >
                    <Star className={`h-4 w-4 ${esFavorita ? 'fill-amber-400' : ''}`} />
                  </button>
                )}
                {/* Un negocio del que se es cliente sin seguirlo se queda en la
                    lista —la relación existe— y lo que se ofrece es volver a
                    recibir sus novedades, no echarlo de aquí. */}
                <button
                  onClick={() => alternarSeguir(company.id, company.name, sigo)}
                  disabled={pending}
                  aria-label={sigo ? 'Dejar de seguir' : 'Seguir'}
                  title={sigo ? 'Dejar de seguir' : 'Seguir'}
                  className={`rounded-lg border p-2 transition disabled:opacity-50 ${
                    sigo
                      ? 'border-border text-muted-foreground hover:border-destructive/25 hover:text-destructive'
                      : 'border-primary/30 text-primary hover:bg-primary/10'
                  }`}
                >
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : sigo ? (
                    <UserMinus className="h-4 w-4" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
