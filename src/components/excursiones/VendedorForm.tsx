'use client'

/** Edición de los datos del vendedor (el alta tiene su wizard propio). */

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Building2, Briefcase } from 'lucide-react'
import { toast } from 'sonner'
import {
  actualizarVendedor,
  type VendedorActionState } from '@/modules/excursiones/vendedores/actions'
import { TIPOS_VENDEDOR_SEMILLA } from '@/modules/excursiones/vendedores/nucleo'
import type { SupervisorOpcion } from '@/components/excursiones/VendedorWizard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

const init: VendedorActionState = {}

export function VendedorForm({
  vendedor,
  supervisores }: {
  vendedor: {
    id: string
    nombre: string
    apellido: string | null
    telefono: string | null
    whatsapp: string | null
    email: string | null
    documento: string | null
    direccion: string | null
    tipo: string | null
    supervisorId: string | null
    razonSocial?: string | null
    rnc?: string | null
    diasCredito?: number | null
    limiteCredito?: number | string | null
    emailFacturacion?: string | null
    prefijoVoucher?: string | null
    modeloComercial?: string | null
  }
  supervisores: SupervisorOpcion[]
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(actualizarVendedor, init)
  const [tipo, setTipo] = useState(vendedor.tipo ?? 'Empleado')

  useEffect(() => {
    if (state.success) {
      toast.success(state.success)
      router.refresh()
    }
  }, [state, router])

  const tipos = TIPOS_VENDEDOR_SEMILLA.includes(vendedor.tipo as (typeof TIPOS_VENDEDOR_SEMILLA)[number]) || !vendedor.tipo
    ? TIPOS_VENDEDOR_SEMILLA
    : [...TIPOS_VENDEDOR_SEMILLA, vendedor.tipo]

  const esB2B = ['Touroperador', 'Agencia', 'Rep Hotel', 'Hotel'].includes(tipo)

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="vendedorId" value={vendedor.id} />
      
      {/* Sección Personal / Contacto */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-primary" />
          Información General
        </h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="vf-nombre">Nombre / Contacto Principal *</Label>
            <Input id="vf-nombre" name="nombre" defaultValue={vendedor.nombre} required />
          </div>
          <div>
            <Label htmlFor="vf-apellido">Apellido</Label>
            <Input id="vf-apellido" name="apellido" defaultValue={vendedor.apellido ?? ''} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="vf-telefono">Teléfono *</Label>
            <Input id="vf-telefono" name="telefono" type="tel" defaultValue={vendedor.telefono ?? ''} required />
          </div>
          <div>
            <Label htmlFor="vf-whatsapp">WhatsApp</Label>
            <Input id="vf-whatsapp" name="whatsapp" type="tel" defaultValue={vendedor.whatsapp ?? ''} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="vf-email">Correo Electrónico</Label>
            <Input id="vf-email" name="email" type="email" defaultValue={vendedor.email ?? ''} />
          </div>
          <div>
            <Label htmlFor="vf-documento">Documento / Cédula / Pasaporte</Label>
            <Input id="vf-documento" name="documento" defaultValue={vendedor.documento ?? ''} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="vf-tipo">Tipo de Vendedor</Label>
            <select
              id="vf-tipo"
              name="tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
            >
              {tipos.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="vf-supervisor">
              {tipo === 'Rep Hotel' ? 'Touroperador Matriz (Supervisor)' : 'Supervisor / Agencia Matriz'}
            </Label>
            <select
              id="vf-supervisor"
              name="supervisorId"
              defaultValue={vendedor.supervisorId ?? ''}
              className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
            >
              <option value="">Sin supervisor / Cuenta Independiente</option>
              {supervisores
                .filter((s) => s.id !== vendedor.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre} {s.apellido ?? ''} ({s.codigo})
                  </option>
                ))}
            </select>
          </div>
        </div>
        <div>
          <Label htmlFor="vf-direccion">Dirección Física</Label>
          <Input id="vf-direccion" name="direccion" defaultValue={vendedor.direccion ?? ''} />
        </div>
      </div>

      {/* Sección B2B / Touroperador & Crédito Comercial */}
      {esB2B && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Building2 className="h-4 w-4 text-primary" />
            <span>Datos Corporativos & Crédito B2B</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="vf-razonSocial">Razón Social de la Empresa</Label>
              <Input
                id="vf-razonSocial"
                name="razonSocial"
                defaultValue={vendedor.razonSocial ?? ''}
                placeholder="Ej: Nexus Tours Dominicana SRL"
              />
            </div>
            <div>
              <Label htmlFor="vf-rnc">RNC / Tax ID</Label>
              <Input
                id="vf-rnc"
                name="rnc"
                defaultValue={vendedor.rnc ?? ''}
                placeholder="Ej: 1-30-12345-6"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="vf-diasCredito">Días de Crédito (Net)</Label>
              <select
                id="vf-diasCredito"
                name="diasCredito"
                defaultValue={String(vendedor.diasCredito ?? 0)}
                className="mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="0">0 días (Pago Inmediato)</option>
                <option value="15">15 días</option>
                <option value="30">30 días (Mensual)</option>
                <option value="45">45 días</option>
                <option value="60">60 días</option>
              </select>
            </div>
            <div>
              <Label htmlFor="vf-limiteCredito">Límite de Crédito (Monto)</Label>
              <Input
                id="vf-limiteCredito"
                name="limiteCredito"
                type="number"
                step="0.01"
                defaultValue={vendedor.limiteCredito ? String(vendedor.limiteCredito) : ''}
                placeholder="Ej: 5000"
              />
            </div>
            <div>
              <Label htmlFor="vf-prefijoVoucher">Prefijo de Voucher</Label>
              <Input
                id="vf-prefijoVoucher"
                name="prefijoVoucher"
                defaultValue={vendedor.prefijoVoucher ?? ''}
                placeholder="Ej: NX-, TUI-"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="vf-emailFacturacion">Email de Facturación / Cuentas por Cobrar</Label>
              <Input
                id="vf-emailFacturacion"
                name="emailFacturacion"
                type="email"
                defaultValue={vendedor.emailFacturacion ?? ''}
                placeholder="facturacion@agencia.com"
              />
            </div>
            <div>
              <Label htmlFor="vf-modeloComercial">Modelo Comercial</Label>
              <select
                id="vf-modeloComercial"
                name="modeloComercial"
                defaultValue={vendedor.modeloComercial ?? 'COMISION'}
                className="mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="COMISION">Comisión sobre PVP (Venta al Público)</option>
                <option value="TARIFA_NETA">Tarifa Neta Mayorista (Net Rate)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" disabled={pending} className="gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Guardar cambios
      </Button>
    </form>
  )
}
