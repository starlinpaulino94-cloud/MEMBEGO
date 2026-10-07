'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { designarCasaMembego, sincronizarPuenteAhora } from '@/modules/supply-bridge/actions'
import { Button } from '@/components/ui/button'

/** Los botones del puente: designar (o retirar) la empresa de la casa y sincronizar a pedido. */
export function PuenteAcciones({ companyId, modo }: { companyId?: string; modo: 'designar' | 'retirar' | 'sincronizar' }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function ir() {
    start(async () => {
      if (modo === 'sincronizar') {
        const r = await sincronizarPuenteAhora()
        if (!r.ok) return void toast.error(r.error)
        const x = r.resultado
        toast.success(`Sincronizado: ${x.creados} nuevo(s), ${x.actualizados} actualizado(s), ${x.sinCambios} sin cambios${x.errores ? `, ${x.errores} con error` : ''}.${x.pedidosCreados || x.pedidosPendientes || x.pedidosReembolsados ? ` Pedidos de compras de Supply: ${x.pedidosCreados} registrado(s)${x.pedidosPendientes ? `, ${x.pedidosPendientes} pendiente(s) (la casa necesita el ítem o una sucursal activa)` : ''}${x.pedidosReembolsados ? `, ${x.pedidosReembolsados} reembolsado(s)` : ''}.` : ''}`)
      } else {
        const r = await designarCasaMembego(modo === 'retirar' ? null : (companyId ?? null))
        if (!r.ok) return void toast.error(r.error)
        toast.success(modo === 'retirar' ? `Empresa de la casa retirada${r.archivados ? ` (${r.archivados} ítem(s) archivados)` : ''}.` : 'Empresa de la casa designada. Sincronizando…')
      }
      router.refresh()
    })
  }

  const texto = modo === 'sincronizar' ? 'Sincronizar ahora' : modo === 'retirar' ? 'Retirar la casa' : 'Designar como casa'
  return (
    <Button size="sm" variant={modo === 'retirar' ? 'destructive' : modo === 'sincronizar' ? 'default' : 'outline'} disabled={pending} onClick={ir}>
      {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
      {texto}
    </Button>
  )
}
