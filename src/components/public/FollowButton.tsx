'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Check, Star, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  getEstadoSeguimiento,
  toggleSeguirEmpresa,
  toggleFavoritaEmpresa,
} from '@/modules/social/actions'

interface FollowButtonProps {
  companyId: string
  /** Ruta a la que volver tras iniciar sesión. */
  redirectTo: string
}

type Estado =
  | { status: 'loading' }
  | { status: 'anon' }
  | { status: 'ready'; following: boolean; esFavorita: boolean }

/**
 * Botón "Seguir empresa" del perfil público. La página está cacheada, por lo
 * que el estado por-usuario se consulta al montar vía server action.
 */
export function FollowButton({ companyId, redirectTo }: FollowButtonProps) {
  const router = useRouter()
  const [estado, setEstado] = useState<Estado>({ status: 'loading' })
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    getEstadoSeguimiento(companyId).then((s) => {
      if (cancelled) return
      setEstado(
        s.authenticated
          ? { status: 'ready', following: s.following, esFavorita: s.esFavorita }
          : { status: 'anon' }
      )
    })
    return () => {
      cancelled = true
    }
  }, [companyId])

  if (estado.status === 'loading') {
    return (
      <button
        disabled
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-3 font-semibold text-muted-foreground sm:w-auto"
      >
        <Loader2 className="h-4 w-4 animate-spin" /> Seguir
      </button>
    )
  }

  if (estado.status === 'anon') {
    return (
      <button
        onClick={() =>
          router.push(`/login?redirect=${encodeURIComponent(redirectTo)}`)
        }
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-card px-5 py-3 font-semibold text-primary transition hover:bg-primary/10 sm:w-auto"
      >
        <Plus className="h-4 w-4" /> Seguir empresa
      </button>
    )
  }

  const { following, esFavorita } = estado

  function handleFollow() {
    startTransition(async () => {
      const res = await toggleSeguirEmpresa(companyId)
      if (res.error) {
        toast.error(res.error)
        return
      }
      setEstado({
        status: 'ready',
        following: res.following ?? false,
        // al dejar de seguir se pierde también la favorita
        esFavorita: res.following ? esFavorita : false,
      })
      toast.success(
        res.following
          ? 'Ahora sigues esta empresa. Recibirás sus promociones y novedades.'
          : 'Dejaste de seguir esta empresa.'
      )
      // Refresca la vista actual (feed, listas, contadores) sin recargar.
      router.refresh()
    })
  }

  function handleFavorita() {
    startTransition(async () => {
      const res = await toggleFavoritaEmpresa(companyId)
      if (res.error) {
        toast.error(res.error)
        return
      }
      setEstado({
        status: 'ready',
        following: res.following ?? true,
        esFavorita: res.esFavorita ?? false,
      })
      toast.success(
        res.esFavorita ? 'Marcada como favorita.' : 'Quitada de favoritas.'
      )
      router.refresh()
    })
  }

  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <button
        onClick={handleFollow}
        disabled={pending}
        className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold transition disabled:opacity-60 sm:flex-none ${
          following
            ? 'border border-border bg-muted text-foreground hover:bg-muted'
            : 'border border-primary/30 bg-card text-primary hover:bg-primary/10'
        }`}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : following ? (
          <Check className="h-4 w-4" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        {following ? 'Siguiendo' : 'Seguir empresa'}
      </button>

      {following && (
        <button
          onClick={handleFavorita}
          disabled={pending}
          aria-label={esFavorita ? 'Quitar de favoritas' : 'Marcar favorita'}
          title={esFavorita ? 'Quitar de favoritas' : 'Marcar favorita'}
          className={`inline-flex items-center justify-center rounded-xl border p-3 transition disabled:opacity-60 ${
            esFavorita
              ? 'border-warning/30 bg-warning/15 text-warning-foreground'
              : 'border-border bg-card text-muted-foreground hover:text-warning-foreground'
          }`}
        >
          <Star className={`h-4 w-4 ${esFavorita ? 'fill-amber-400' : ''}`} />
        </button>
      )}
    </div>
  )
}
