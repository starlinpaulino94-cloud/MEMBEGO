'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { iniciarConteo } from '@/modules/inventory/actions'
import { MAX_NOTA_CONTEO } from '@/modules/inventory/conteos'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { SucursalOpcionForm } from './EntradaMultipleForm'

/**
 * Abre el conteo de una sucursal. Solo puede haber UNO abierto por sucursal: si
 * esta persona ya lo tenía, el servidor le devuelve el mismo (un doble clic no abre
 * dos); si lo abrió otra, le dice cuál es.
 */
export function IniciarConteoForm({ sucursales }: { sucursales: SucursalOpcionForm[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? '')
  const [nota, setNota] = useState('')

  function abrir(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!sucursalId) {
      toast.error('Elige la sucursal que vas a contar.')
      return
    }
    start(async () => {
      const r = await iniciarConteo({ sucursalId, nota })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(r.repetido ? `Continúas el conteo ${r.numero}.` : `Conteo ${r.numero} abierto.`)
      router.push(`/admin/inventario/conteos/${r.conteoId}`)
    })
  }

  const campo = 'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm'
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4" aria-hidden />
          Iniciar un conteo físico
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={abrir} aria-label="Iniciar conteo" className="grid items-end gap-4 sm:grid-cols-[1fr_2fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="ic-sucursal">Sucursal que vas a contar</Label>
            <select id="ic-sucursal" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} className={campo}>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ic-nota">Para qué es (opcional)</Label>
            <Input id="ic-nota" value={nota} maxLength={MAX_NOTA_CONTEO} onChange={(e) => setNota(e.target.value)} placeholder="Ej: Inventario de cierre de mes" />
          </div>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Abrir conteo
          </Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">
          Se cuenta a ciegas: mientras cuentas no ves lo que dice el sistema. Al terminar revisas las diferencias y, solo entonces, aplicas el ajuste. Lo que no cuentes no se toca.
        </p>
      </CardContent>
    </Card>
  )
}
