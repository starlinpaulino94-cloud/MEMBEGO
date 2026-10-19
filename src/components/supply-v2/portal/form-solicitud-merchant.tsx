'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import { enviarSolicitudMerchantAction, retirarSolicitudMerchantAction } from '@/modules/supply-v2/actions-solicitud-merchant'
import { TIPOS_DE_NEGOCIO_SOLICITUD, type DatosSolicitudMerchant } from '@/modules/supply-v2/suppliers/solicitud-merchant-dominio'

const TIPO_LABELS: Record<(typeof TIPOS_DE_NEGOCIO_SOLICITUD)[number], string> = {
  restaurante: 'Restaurante o bar',
  cafeteria: 'Cafetería',
  carwash: 'Car wash',
  barberia: 'Barbería o salón',
  gym: 'Gimnasio',
  tienda: 'Tienda',
  servicios: 'Servicios',
  excursiones: 'Excursiones y turismo',
  otro: 'Otro',
}

/**
 * SUPPLIER & FULFILLMENT COMMERCE · «Convertirme en empresa Membego» (§40).
 * Llega prellenado con lo que Membego ya sabe; el proveedor completa qué
 * quiere vender y envía. Si Membego pidió más información, el mismo
 * formulario sirve para responder.
 */
export function FormSolicitudMerchant({ prellenado, solicitudId, respondiendoA }: { prellenado: DatosSolicitudMerchant; solicitudId?: string | null; respondiendoA?: string | null }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion<{ status: string }>, FormData>(enviarSolicitudMerchantAction, {})
  const [sucursales, setSucursales] = useState(prellenado.sucursales.length ? prellenado.sucursales : [{ nombre: 'Principal', direccion: prellenado.direccion }])
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (estado.success && visto.current !== estado.success) {
      visto.current = estado.success
      toast.success(estado.success)
      router.refresh()
    }
  }, [estado, router])

  if (estado.success) {
    return <p className="rounded-lg bg-success/10 p-3 text-sm text-success" data-testid="solicitud-enviada">{estado.success}</p>
  }

  return (
    <form action={enviar} className="space-y-4" data-testid="form-solicitud-merchant">
      {solicitudId && <input type="hidden" name="applicationId" value={solicitudId} />}
      {respondiendoA && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="peticion-membego">
          <p className="font-medium">Membego pidió más información</p>
          <p>{respondiendoA}</p>
        </div>
      )}
      <Card>
        <CardHeader><CardTitle>Tu negocio</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="nombreComercial">Nombre comercial</Label>
            <Input id="nombreComercial" name="nombreComercial" defaultValue={prellenado.nombreComercial} required maxLength={120} data-testid="sol-nombre" />
          </div>
          <div>
            <Label htmlFor="tipoNegocio">Tipo de negocio</Label>
            <select id="tipoNegocio" name="tipoNegocio" defaultValue={prellenado.tipoNegocio} className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm" data-testid="sol-tipo">
              {TIPOS_DE_NEGOCIO_SOLICITUD.map((t) => (
                <option key={t} value={t}>{TIPO_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="descripcion">Qué es tu negocio</Label>
            <Textarea id="descripcion" name="descripcion" defaultValue={prellenado.descripcion} rows={3} maxLength={1000} required minLength={10} data-testid="sol-descripcion" />
          </div>
          <div>
            <Label htmlFor="queVende">Qué quieres vender en Membego</Label>
            <Textarea id="queVende" name="queVende" defaultValue={prellenado.queVende} rows={3} maxLength={1000} required minLength={5} placeholder="Productos, servicios, ofertas…" data-testid="sol-que-vende" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Contacto y ubicación</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="telefono">Teléfono</Label>
              <Input id="telefono" name="telefono" defaultValue={prellenado.telefono} required maxLength={40} inputMode="tel" data-testid="sol-telefono" />
            </div>
            <div>
              <Label htmlFor="rnc">RNC o cédula (opcional)</Label>
              <Input id="rnc" name="rnc" defaultValue={prellenado.rnc} maxLength={20} inputMode="numeric" />
            </div>
          </div>
          <div>
            <Label htmlFor="direccion">Dirección principal</Label>
            <Input id="direccion" name="direccion" defaultValue={prellenado.direccion} required maxLength={200} data-testid="sol-direccion" />
          </div>
          <div>
            <Label htmlFor="ciudad">Ciudad</Label>
            <Input id="ciudad" name="ciudad" defaultValue={prellenado.ciudad} maxLength={80} />
          </div>
          <div className="space-y-2">
            <Label>Sucursales</Label>
            <input type="hidden" name="sucursales" value={JSON.stringify(sucursales)} />
            {sucursales.map((s, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                <Input aria-label="Nombre de la sucursal" value={s.nombre} onChange={(e) => setSucursales((l) => l.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} maxLength={80} />
                <Input aria-label="Dirección de la sucursal" value={s.direccion} onChange={(e) => setSucursales((l) => l.map((x, j) => (j === i ? { ...x, direccion: e.target.value } : x)))} maxLength={200} />
                <Button type="button" variant="ghost" size="sm" onClick={() => setSucursales((l) => l.filter((_, j) => j !== i))} disabled={sucursales.length === 1}>Quitar</Button>
              </div>
            ))}
            {sucursales.length < 20 && (
              <Button type="button" variant="outline" size="sm" onClick={() => setSucursales((l) => [...l, { nombre: '', direccion: '' }])}>Añadir sucursal</Button>
            )}
          </div>
          <div>
            <Label htmlFor="notas">Algo más que debamos saber (opcional)</Label>
            <Textarea id="notas" name="notas" defaultValue={prellenado.notas} rows={2} maxLength={1000} data-testid="sol-notas" />
          </div>
        </CardContent>
      </Card>
      {estado.error && <p className="text-sm text-destructive" role="alert" data-testid="solicitud-error">{estado.error}</p>}
      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={pendiente} loading={pendiente} data-testid="btn-enviar-solicitud">
        {respondiendoA ? 'Enviar respuesta' : 'Enviar solicitud'}
      </Button>
      <p className="text-caption text-muted-foreground">Tu organización sigue siendo la misma: lo que ya operas como proveedor no cambia. Si Membego aprueba, se encienden catálogo, pedidos y ofertas en tu mismo panel.</p>
    </form>
  )
}

export function RetirarSolicitud({ applicationId }: { applicationId: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(retirarSolicitudMerchantAction, {})
  const router = useRouter()
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (estado.success && visto.current !== estado.success) {
      visto.current = estado.success
      toast.success(estado.success)
      router.refresh()
    }
  }, [estado, router])
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="applicationId" value={applicationId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pendiente} loading={pendiente} data-testid="btn-retirar-solicitud">Retirar la solicitud</Button>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}
