'use client'

/**
 * Alta de vendedor por pasos (§67): personal → comercial → crear. Al terminar
 * enseña DE INMEDIATO el QR, el código y el enlace — lo que el vendedor
 * necesita para empezar a captar hoy mismo. Comisión y metas llegan en sus
 * fases (6 y 9); el wizard no promete pasos que aún no existen.
 */

import { useActionState, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  crearVendedor,
  type VendedorActionState,
} from '@/modules/excursiones/vendedores/actions'
import { TIPOS_VENDEDOR_SEMILLA } from '@/modules/excursiones/vendedores/nucleo'
import { VendedorQrCard } from '@/components/excursiones/VendedorQrCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

const init: VendedorActionState = {}

export interface SupervisorOpcion {
  id: string
  nombre: string
  apellido: string | null
  codigo: string
}

export function VendedorWizard({ supervisores }: { supervisores: SupervisorOpcion[] }) {
  const [paso, setPaso] = useState<1 | 2>(1)
  const [datos, setDatos] = useState<Record<string, string>>({ tipo: 'Empleado' })
  const [errorLocal, setErrorLocal] = useState<string | null>(null)
  const [state, formAction, pending] = useActionState(crearVendedor, init)

  useEffect(() => {
    if (state.success) toast.success(state.success)
  }, [state.success])

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDatos((d) => ({ ...d, [k]: e.target.value }))

  // ── Pantalla de éxito: QR + código + enlace, al instante (§67) ────────────
  if (state.creado) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-success/25 bg-success/5 p-4 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
          <p className="mt-2 font-semibold text-foreground">
            Vendedor creado: {datos.nombre} {datos.apellido ?? ''}
          </p>
          <p className="text-sm text-muted-foreground">
            Entrégale su QR y su enlace: todo cliente que entre por ahí queda atribuido a él.
          </p>
        </div>
        <VendedorQrCard
          codigo={state.creado.codigo}
          enlaceUrl={state.creado.enlaceUrl}
          qrUrl={state.creado.qrUrl}
          nombre={datos.nombre ?? ''}
        />
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/admin/excursiones/vendedores/${state.creado.vendedorId}`}>Ver su perfil</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/excursiones/vendedores">Volver al equipo</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form
      action={(fd) => {
        for (const [k, v] of Object.entries(datos)) fd.set(k, v)
        formAction(fd)
      }}
      className="space-y-4"
    >
      <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
        Paso {paso} de 2 · {paso === 1 ? 'Información personal' : 'Información comercial'}
      </p>

      {paso === 1 ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ven-nombre">Nombre *</Label>
              <Input id="ven-nombre" value={datos.nombre ?? ''} onChange={set('nombre')} required />
            </div>
            <div>
              <Label htmlFor="ven-apellido">Apellido</Label>
              <Input id="ven-apellido" value={datos.apellido ?? ''} onChange={set('apellido')} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ven-telefono">Teléfono *</Label>
              <Input id="ven-telefono" type="tel" value={datos.telefono ?? ''} onChange={set('telefono')} placeholder="809-555-0000" required />
            </div>
            <div>
              <Label htmlFor="ven-whatsapp">WhatsApp</Label>
              <Input id="ven-whatsapp" type="tel" value={datos.whatsapp ?? ''} onChange={set('whatsapp')} placeholder="Si es distinto al teléfono" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ven-email">Correo</Label>
              <Input id="ven-email" type="email" value={datos.email ?? ''} onChange={set('email')} />
            </div>
            <div>
              <Label htmlFor="ven-documento">Documento</Label>
              <Input id="ven-documento" value={datos.documento ?? ''} onChange={set('documento')} placeholder="Cédula o pasaporte (opcional)" />
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ven-tipo">Tipo de vendedor</Label>
              <select
                id="ven-tipo"
                value={datos.tipo ?? 'Empleado'}
                onChange={set('tipo')}
                className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
              >
                {TIPOS_VENDEDOR_SEMILLA.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="ven-supervisor">
                {datos.tipo === 'Rep Hotel' ? 'Touroperador Matriz (Supervisor)' : 'Supervisor / Agencia Matriz'}
              </Label>
              <select
                id="ven-supervisor"
                value={datos.supervisorId ?? ''}
                onChange={set('supervisorId')}
                className="mt-1.5 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
              >
                <option value="">Sin supervisor / Cuenta Independiente</option>
                {supervisores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre} {s.apellido ?? ''} ({s.codigo})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Sección B2B / Touroperadores & Agencias */}
          {['Touroperador', 'Agencia', 'Rep Hotel', 'Hotel'].includes(datos.tipo ?? '') && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-4">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
                Datos Corporativos & Crédito B2B
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ven-razonSocial">Razón Social</Label>
                  <Input
                    id="ven-razonSocial"
                    value={datos.razonSocial ?? ''}
                    onChange={set('razonSocial')}
                    placeholder="Ej: Nexus Tours Dominicana SRL"
                  />
                </div>
                <div>
                  <Label htmlFor="ven-rnc">RNC / Tax ID</Label>
                  <Input
                    id="ven-rnc"
                    value={datos.rnc ?? ''}
                    onChange={set('rnc')}
                    placeholder="Ej: 1-30-12345-6"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="ven-diasCredito">Días de Crédito</Label>
                  <select
                    id="ven-diasCredito"
                    value={datos.diasCredito ?? '0'}
                    onChange={set('diasCredito')}
                    className="mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  >
                    <option value="0">0 días (Inmediato)</option>
                    <option value="15">15 días</option>
                    <option value="30">30 días</option>
                    <option value="45">45 días</option>
                    <option value="60">60 días</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="ven-limiteCredito">Límite de Crédito</Label>
                  <Input
                    id="ven-limiteCredito"
                    type="number"
                    value={datos.limiteCredito ?? ''}
                    onChange={set('limiteCredito')}
                    placeholder="Monto max"
                  />
                </div>
                <div>
                  <Label htmlFor="ven-prefijoVoucher">Prefijo de Voucher</Label>
                  <Input
                    id="ven-prefijoVoucher"
                    value={datos.prefijoVoucher ?? ''}
                    onChange={set('prefijoVoucher')}
                    placeholder="Ej: NX-, TUI-"
                  />
                </div>
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="ven-direccion">Dirección</Label>
            <Input id="ven-direccion" value={datos.direccion ?? ''} onChange={set('direccion')} placeholder="Opcional" />
          </div>
          <p className="rounded-xl bg-primary/5 p-3 text-sm text-muted-foreground">
            Al crearlo, MembeGo genera su <strong className="text-foreground">código</strong>, su{' '}
            <strong className="text-foreground">enlace</strong> y su{' '}
            <strong className="text-foreground">QR</strong> — listos para compartir.
          </p>
        </div>
      )}

      {(errorLocal || state.error) && (
        <Alert variant="destructive">
          <AlertDescription>{errorLocal ?? state.error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        {paso === 2 ? (
          <Button type="button" variant="outline" onClick={() => setPaso(1)} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Atrás
          </Button>
        ) : null}
        {paso === 1 ? (
          <Button
            type="button"
            className="gap-1.5"
            onClick={() => {
              if (!(datos.nombre ?? '').trim() || !(datos.telefono ?? '').trim()) {
                setErrorLocal('Nombre y teléfono son obligatorios.')
                return
              }
              setErrorLocal(null)
              setPaso(2)
            }}
          >
            Siguiente <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="submit" disabled={pending} className="gap-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Crear vendedor
          </Button>
        )}
      </div>
    </form>
  )
}
