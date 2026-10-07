'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { asignarBeneficioAction, buscarClientesBeneficioAction } from '@/modules/supply-v2/actions-beneficios'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'

/**
 * MEMBEGO SUPPLY · SLICE 6 · asignar un beneficio a un cliente (§10).
 *
 * El cliente se elige de una búsqueda del servidor: nadie escribe un id a
 * mano. Los usos no pueden pasar del límite por cliente del beneficio y el
 * vencimiento no puede ser posterior al del beneficio; el servidor lo exige
 * otra vez.
 */
export function FormAsignarBeneficio({ benefitId, perCustomerLimit, hasta }: { benefitId: string; perCustomerLimit: number; hasta: string | null }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(asignarBeneficioAction, {})
  const [consulta, setConsulta] = useState('')
  const [resultados, setResultados] = useState<{ id: string; nombre: string; email: string }[]>([])
  const [elegido, setElegido] = useState<{ id: string; nombre: string; email: string } | null>(null)
  const [buscando, buscar] = useTransition()
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!estado.success || visto.current === estado.success) return
    visto.current = estado.success
    toast.success(estado.success)
    setElegido(null)
    setConsulta('')
    setResultados([])
    router.refresh()
  }, [estado, router])

  const lanzarBusqueda = (texto: string) => {
    setConsulta(texto)
    setElegido(null)
    if (texto.trim().length < 2) {
      setResultados([])
      return
    }
    buscar(async () => {
      setResultados(await buscarClientesBeneficioAction(texto))
    })
  }

  return (
    <form action={accion} className="space-y-3" data-testid="form-asignar-beneficio">
      <input type="hidden" name="benefitId" value={benefitId} />
      <input type="hidden" name="customerId" value={elegido?.id ?? ''} />
      <div>
        <Label htmlFor="buscarClienteBeneficio">Cliente</Label>
        <Input
          id="buscarClienteBeneficio"
          value={elegido ? `${elegido.nombre} · ${elegido.email}` : consulta}
          onChange={(e) => lanzarBusqueda(e.target.value)}
          placeholder="Nombre o correo del cliente"
          autoComplete="off"
          data-testid="input-buscar-cliente-beneficio"
        />
        {buscando && <p className="text-caption text-muted-foreground">Buscando…</p>}
        {!elegido && resultados.length > 0 && (
          <ul className="mt-1 max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border" data-testid="resultados-cliente-beneficio">
            {resultados.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setElegido(c)} className="w-full px-3 py-2 text-left text-sm hover:bg-muted" data-testid="opcion-cliente-beneficio">
                  <span className="font-medium">{c.nombre}</span>
                  <span className="block text-caption text-muted-foreground">{c.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!elegido && consulta.trim().length >= 2 && !buscando && resultados.length === 0 && (
          <p className="text-caption text-muted-foreground">Ningún cliente coincide con esa búsqueda.</p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="usosBeneficio">Usos para este cliente</Label>
          <Input id="usosBeneficio" name="usesAllowed" type="number" min={1} max={perCustomerLimit} step={1} defaultValue={1} inputMode="numeric" />
          <p className="text-caption text-muted-foreground">Máximo {perCustomerLimit} según el beneficio.</p>
        </div>
        <div>
          <Label htmlFor="venceBeneficio">Vence (opcional)</Label>
          <Input id="venceBeneficio" name="expiresAt" type="date" max={hasta ?? undefined} />
          <p className="text-caption text-muted-foreground">{hasta ? `No puede pasar del ${hasta}, cuando vence el beneficio.` : 'El beneficio no tiene fecha de vencimiento.'}</p>
        </div>
      </div>
      <div>
        <Label htmlFor="notaBeneficio">Nota interna (opcional)</Label>
        <Input id="notaBeneficio" name="note" maxLength={500} placeholder="Compensación por la incidencia del 12/09" />
      </div>
      <Button type="submit" disabled={pendiente || !elegido} loading={pendiente} data-testid="btn-asignar-beneficio">Asignar beneficio</Button>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}
