'use client'

import { useActionState, useState } from 'react'
import type { SupplyV2SupplierAccessStatus } from '@prisma/client'
import { CheckCircle2, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { StatusChip } from '@/components/ui/status-chip'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import {
  darDeBajaAccesoProveedorAction,
  dispensarPreparacionAction,
  invitarDuenoDeProveedorAction,
  reactivarAccesoProveedorAction,
  suspenderAccesoProveedorAction,
} from '@/modules/supply-v2/actions-acceso'
import { ACCESS_STATUS_LABELS, CLASE_LABELS, type ClaseDeProveedor, type Preparacion } from '@/modules/supply-v2/suppliers/acceso-dominio'
import type { InvitacionDeProveedor } from '@/modules/supply-v2/suppliers/acceso'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · Slice 1 · tarjeta «Acceso al portal» del
 * proveedor en el superadmin: estado del acceso, lista de preparación,
 * invitar/reenviar al dueño, suspender, reactivar, dar de baja y dispensar.
 */

export function ChipAcceso({ estado }: { estado: SupplyV2SupplierAccessStatus }) {
  const tone = estado === 'ACTIVE' ? 'success' : estado === 'SUSPENDED' || estado === 'TERMINATED' ? 'danger' : estado === 'DRAFT' ? 'neutral' : 'warning'
  return <StatusChip tone={tone}>{ACCESS_STATUS_LABELS[estado]}</StatusChip>
}

export interface AccesoProveedorProps {
  supplierId: string
  accessStatus: SupplyV2SupplierAccessStatus
  clase: ClaseDeProveedor
  invitedEmail: string | null
  invitedAt: string | null
  activatedAt: string | null
  readinessWaivedReason: string | null
  accessStatusReason: string | null
  emailSugerido: string | null
  preparacion: Preparacion
  companyName: string | null
}

export function AccesoProveedor(p: AccesoProveedorProps) {
  const puedeInvitar = p.accessStatus === 'DRAFT' || p.accessStatus === 'INVITED'
  return (
    <div className="space-y-4" data-testid="acceso-proveedor">
      <div className="flex flex-wrap items-center gap-2">
        <ChipAcceso estado={p.accessStatus} />
        <span className="text-caption text-muted-foreground">{CLASE_LABELS[p.clase]}</span>
        {p.companyName && <span className="text-caption text-muted-foreground">· empresa: {p.companyName}</span>}
      </div>
      {p.accessStatusReason && <p className="text-sm text-muted-foreground">Motivo: {p.accessStatusReason}</p>}
      {p.readinessWaivedReason && <p className="text-sm text-muted-foreground">Dispensa: {p.readinessWaivedReason}</p>}
      {p.invitedEmail && (
        <p className="text-sm text-muted-foreground" data-testid="acceso-invitado">
          Invitado: {p.invitedEmail}
          {p.invitedAt ? ` · ${p.invitedAt}` : ''}
          {p.activatedAt ? ` · operativo desde ${p.activatedAt}` : ''}
        </p>
      )}

      <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2" data-testid="acceso-preparacion">
        {p.preparacion.pasos.map((paso) => (
          <li key={paso.paso} className="flex items-center gap-2">
            {paso.hecho ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <Circle className="size-4 text-muted-foreground" aria-hidden />}
            <span className={paso.hecho ? '' : 'text-muted-foreground'}>{paso.label}</span>
          </li>
        ))}
      </ul>
      <p className="text-caption text-muted-foreground">
        {p.preparacion.completos} de {p.preparacion.total} pasos. {p.preparacion.lista ? 'Listo para entregar.' : 'Hasta completarlos, no se activan acuerdos ni se publican ofertas nuevos con este proveedor.'}
      </p>

      <div className="flex flex-wrap gap-2">
        {puedeInvitar && <Invitar supplierId={p.supplierId} emailSugerido={p.invitedEmail ?? p.emailSugerido} reenvio={p.accessStatus === 'INVITED'} />}
        {(p.accessStatus === 'ACTIVE' || p.accessStatus === 'ACTIVATION_PENDING') && <ConMotivo supplierId={p.supplierId} etiqueta="Suspender acceso" accion={suspenderAccesoProveedorAction} testId="btn-suspender-acceso" variant="outline" />}
        {p.accessStatus === 'SUSPENDED' && <SinMotivo supplierId={p.supplierId} etiqueta="Reactivar acceso" accion={reactivarAccesoProveedorAction} testId="btn-reactivar-acceso" />}
        {p.accessStatus !== 'TERMINATED' && !p.readinessWaivedReason && !p.preparacion.lista && (
          <ConMotivo supplierId={p.supplierId} etiqueta="Dispensar preparación" accion={dispensarPreparacionAction} testId="btn-dispensar" variant="outline" ayuda="Solo para proveedores históricos o un caso excepcional: opera sin completar la lista. Queda auditado con el motivo." />
        )}
        {p.accessStatus !== 'TERMINATED' && <ConMotivo supplierId={p.supplierId} etiqueta="Dar de baja el acceso" accion={darDeBajaAccesoProveedorAction} testId="btn-baja-acceso" variant="ghost" />}
      </div>
    </div>
  )
}

function Invitar({ supplierId, emailSugerido, reenvio }: { supplierId: string; emailSugerido: string | null; reenvio: boolean }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion<InvitacionDeProveedor>, FormData>(invitarDuenoDeProveedorAction, {})
  const [abierto, setAbierto] = useState(false)
  if (estado.success) return <p className="text-sm text-success" data-testid="invitacion-enviada">{estado.success}</p>
  if (!abierto) {
    return (
      <Button type="button" onClick={() => setAbierto(true)} data-testid="btn-invitar-dueno">
        {reenvio ? 'Reenviar invitación' : 'Invitar al dueño al portal'}
      </Button>
    )
  }
  return (
    <form action={enviar} className="w-full space-y-2 rounded-lg border border-border p-3">
      <input type="hidden" name="supplierId" value={supplierId} />
      <Label htmlFor="emailDueno">Correo del dueño del proveedor</Label>
      <Input id="emailDueno" name="email" type="email" required defaultValue={emailSugerido ?? ''} maxLength={160} data-testid="input-email-dueno" />
      <p className="text-caption text-muted-foreground">
        Si el proveedor no tiene empresa en Membego, se le crea una Supplier Lite (sin vitrina) con sus datos actuales. Nunca una segunda empresa.
      </p>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pendiente} loading={pendiente} data-testid="btn-enviar-invitacion">Enviar invitación</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
      </div>
    </form>
  )
}

type AccionConForm = (prev: EstadoAccion, fd: FormData) => Promise<EstadoAccion>

function ConMotivo({ supplierId, etiqueta, accion, testId, variant, ayuda }: { supplierId: string; etiqueta: string; accion: AccionConForm; testId: string; variant: 'outline' | 'ghost'; ayuda?: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(accion, {})
  const [abierto, setAbierto] = useState(false)
  if (estado.success) return <p className="text-sm text-success">{estado.success}</p>
  if (!abierto) return <Button type="button" variant={variant} size="sm" onClick={() => setAbierto(true)} data-testid={testId}>{etiqueta}</Button>
  return (
    <form action={enviar} className="w-full space-y-2 rounded-lg border border-border p-3">
      <input type="hidden" name="supplierId" value={supplierId} />
      <Label htmlFor={`${testId}-motivo`}>{etiqueta}: motivo</Label>
      <Textarea id={`${testId}-motivo`} name="motivo" rows={2} required maxLength={500} data-testid={`${testId}-motivo`} />
      {ayuda && <p className="text-caption text-muted-foreground">{ayuda}</p>}
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pendiente} loading={pendiente} data-testid={`${testId}-confirmar`}>Confirmar</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
      </div>
    </form>
  )
}

function SinMotivo({ supplierId, etiqueta, accion, testId }: { supplierId: string; etiqueta: string; accion: AccionConForm; testId: string }) {
  const [estado, enviar, pendiente] = useActionState<EstadoAccion, FormData>(accion, {})
  if (estado.success) return <p className="text-sm text-success">{estado.success}</p>
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="supplierId" value={supplierId} />
      <Button type="submit" size="sm" disabled={pendiente} loading={pendiente} data-testid={testId}>{etiqueta}</Button>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}
