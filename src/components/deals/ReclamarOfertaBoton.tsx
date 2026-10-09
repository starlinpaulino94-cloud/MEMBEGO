'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Gift, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { reclamarOferta } from '@/modules/deals/cliente-actions'
import { Button } from '@/components/ui/button'

const campoSelector = 'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm'

interface Props {
  dealId: string
  campaignId?: string
  /** Adónde volver tras iniciar sesión. */
  retorno: string
  sucursales: { id: string; nombre: string }[]
}

/**
 * «Obtener oferta». Funciona sin saber si hay sesión (las páginas públicas son estáticas): si no
 * la hay, la acción lo dice y se manda a la persona a iniciar sesión y volver aquí. Si ya la
 * había obtenido, se le lleva a su pedido (su cupón con el QR).
 */
export function ReclamarOfertaBoton({ dealId, campaignId, retorno, sucursales }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [sucursalId, setSucursalId] = useState(sucursales.length === 1 ? sucursales[0].id : '')

  function obtener() {
    if (!sucursalId) {
      toast.error('Elige la sucursal donde la vas a canjear.')
      return
    }
    start(async () => {
      const r = await reclamarOferta({ dealId, sucursalId, campaignId })
      if (!r.ok) {
        if (r.sinSesion) {
          router.push(`/login?redirect=${encodeURIComponent(retorno)}`)
          return
        }
        toast.error(r.error)
        return
      }
      toast.success(r.repetido ? 'Ya tenías esta oferta: aquí está tu cupón.' : `Oferta obtenida${r.code ? ` (${r.code})` : ''}. Muestra tu QR al canjearla.`)
      router.push(`/cliente/pedidos/${r.pedidoId}`)
    })
  }

  return (
    <div className="space-y-2">
      {sucursales.length > 1 && (
        <select aria-label="Sucursal donde la canjearás" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} className={campoSelector}>
          <option value="">Elige la sucursal…</option>
          {sucursales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      )}
      <Button type="button" className="w-full" disabled={pending} onClick={obtener}>
        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Gift className="mr-2 h-4 w-4" />}
        Obtener oferta
      </Button>
    </div>
  )
}
