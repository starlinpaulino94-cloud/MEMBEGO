'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { crearProgramaAction, type ProgramaCreadoDTO } from '@/modules/supply-v2/actions-fidelizacion'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · alta de un programa de fidelización.
 *
 * El formulario enseña lo que implica cada decisión ANTES de guardar: qué
 * acumula la regla de puntos con un ejemplo real, y que un programa de
 * Membego sin techo necesita que alguien firme por qué. Lo que se guarda lo
 * valida el servidor otra vez; esto solo evita que la persona descubra el
 * error después de rellenarlo todo.
 */

const MODALIDADES = [
  ['MEMBERSHIPS', 'Membresías', 'Planes de pago o gratuitos con beneficios exclusivos.'],
  ['POINTS', 'Puntos', 'El cliente acumula puntos con sus compras.'],
  ['REWARDS', 'Recompensas', 'Catálogo donde canjear los puntos.'],
  ['REFERRALS', 'Referidos', 'El cliente invita y gana cuando su invitado compra.'],
] as const

export function FormProgramaFidelizacion({ proveedores }: { proveedores: { id: string; nombre: string }[] }) {
  const [estado, accion] = useActionState(crearProgramaAction, {} as EstadoAccion<ProgramaCreadoDTO>)
  const [owner, setOwner] = useState<'MEMBEGO' | 'SUPPLIER'>('SUPPLIER')
  const [funding, setFunding] = useState<'MEMBEGO' | 'SUPPLIER' | 'SHARED'>('SUPPLIER')
  const [puntos, setPuntos] = useState('1')
  const [porCada, setPorCada] = useState('100')
  const [techo, setTecho] = useState('')
  const { pending } = useFormStatus()

  const ejemplo = (() => {
    const p = Number(puntos)
    const c = Number(porCada)
    if (!Number.isFinite(p) || !Number.isFinite(c) || p <= 0 || c <= 0) return null
    return `Una compra de RD$1,000 daría ${Math.floor(1000 / c) * p} puntos.`
  })()

  const exigeFirma = funding !== 'SUPPLIER' && !techo.trim()

  return (
    <form action={accion} className="space-y-4" data-testid="form-programa">
      <Card>
        <CardContent className="space-y-3 pt-6">
          <label className="block text-sm" htmlFor="name">Nombre del programa</label>
          <Input id="name" name="name" required maxLength={120} placeholder="Club Car Town" data-testid="programa-nombre" />

          <label className="block text-sm" htmlFor="objective">Objetivo comercial</label>
          <Input id="objective" name="objective" maxLength={300} placeholder="Que los clientes de siempre vuelvan más" data-testid="programa-objetivo" />

          <fieldset className="space-y-2">
            <legend className="text-sm">¿Quién lo administra?</legend>
            <select
              name="owner"
              aria-label="¿Quién administra el programa?"
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={owner}
              onChange={(e) => {
                const v = e.target.value as 'MEMBEGO' | 'SUPPLIER'
                setOwner(v)
                setFunding(v === 'MEMBEGO' ? 'MEMBEGO' : 'SUPPLIER')
              }}
              data-testid="programa-owner"
            >
              <option value="SUPPLIER">Un negocio</option>
              <option value="MEMBEGO">Membego</option>
            </select>
          </fieldset>

          {owner === 'SUPPLIER' && (
            <>
              <label className="block text-sm" htmlFor="supplierId">Negocio</label>
              <select id="supplierId" name="supplierId" className="w-full rounded-lg border px-3 py-2 text-sm" required data-testid="programa-negocio">
                <option value="">Elige el negocio…</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              <p className="text-caption text-muted-foreground">
                Las membresías son siempre de un negocio concreto: «la Gold de Car Town», no de nadie.
              </p>
            </>
          )}

          <label className="block text-sm" htmlFor="funding">¿Quién pone el dinero?</label>
          <select
            id="funding"
            name="funding"
            className="w-full rounded-lg border px-3 py-2 text-sm"
            value={funding}
            onChange={(e) => setFunding(e.target.value as 'MEMBEGO' | 'SUPPLIER' | 'SHARED')}
            data-testid="programa-funding"
          >
            <option value="SUPPLIER">El negocio</option>
            <option value="MEMBEGO">Membego</option>
            <option value="SHARED">Compartido</option>
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <fieldset>
            <legend className="mb-2 text-sm">¿Qué incluye el programa?</legend>
            <div className="space-y-2">
              {MODALIDADES.map(([v, label, ayuda]) => (
                <label key={v} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="modalities" value={v} defaultChecked={v !== 'REFERRALS'} data-testid={`modalidad-${v}`} />
                  <span>
                    <strong>{label}</strong>
                    <span className="block text-caption text-muted-foreground">{ayuda}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm">Regla de puntos</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Input name="pointsPerUnit" aria-label="Puntos que se ganan" value={puntos} onChange={(e) => setPuntos(e.target.value)} className="w-20" inputMode="numeric" data-testid="programa-puntos" />
            <span>punto(s) por cada</span>
            <Input name="amountPerPoint" aria-label="Pesos de compra por cada tramo de puntos" value={porCada} onChange={(e) => setPorCada(e.target.value)} className="w-28" inputMode="decimal" data-testid="programa-por-cada" />
            <span>pesos</span>
          </div>
          {ejemplo && <p className="text-sm text-muted-foreground" data-testid="programa-ejemplo">{ejemplo}</p>}

          <label className="block text-sm" htmlFor="accrualBasis">¿Sobre qué se calculan?</label>
          <select id="accrualBasis" name="accrualBasis" className="w-full rounded-lg border px-3 py-2 text-sm" data-testid="programa-base">
            <option value="CONTRACTUAL_VALUE">Sobre lo que vale la compra</option>
            <option value="CUSTOMER_PAID">Sobre lo que el cliente pagó de verdad</option>
          </select>
          <p className="text-caption text-muted-foreground">
            No es lo mismo cuando hubo un bono: una compra de 1 000 con 400 de bono vale 1 000 pero se pagan 600.
            Lo que elijas aquí se congela en cada movimiento y no cambia después.
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            <span>
              <label className="block text-sm" htmlFor="pointsHoldDays">Días pendientes antes de poder usarlos</label>
              <Input id="pointsHoldDays" name="pointsHoldDays" defaultValue="0" inputMode="numeric" data-testid="programa-espera" />
            </span>
            <span>
              <label className="block text-sm" htmlFor="pointsExpireDays">Días hasta que vencen (vacío = no vencen)</label>
              <Input id="pointsExpireDays" name="pointsExpireDays" inputMode="numeric" data-testid="programa-vencimiento" />
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <label className="block text-sm" htmlFor="budgetTotal">Presupuesto máximo de Membego</label>
          <Input id="budgetTotal" name="budgetTotal" value={techo} onChange={(e) => setTecho(e.target.value)} inputMode="decimal" placeholder="100000" data-testid="programa-techo" />
          {exigeFirma && (
            <div className="space-y-2 rounded-lg border border-destructive/40 p-3" data-testid="programa-sin-techo">
              <p className="text-sm text-destructive">
                Un programa que compromete dinero de Membego sin techo necesita un motivo escrito y quién lo autoriza.
                Queda registrado en la bitácora.
              </p>
              <Input name="budgetWaiverReason" aria-label="Motivo para ir sin techo de presupuesto" maxLength={300} placeholder="Motivo de ir sin techo" data-testid="programa-motivo-sin-techo" />
              <Input name="budgetWaiverById" aria-label="Id de quien autoriza ir sin techo" maxLength={60} placeholder="Id de quien lo autoriza" data-testid="programa-autoriza" />
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <span>
              <label className="block text-sm" htmlFor="startsAt">Empieza</label>
              <Input id="startsAt" name="startsAt" type="date" required data-testid="programa-inicio" />
            </span>
            <span>
              <label className="block text-sm" htmlFor="endsAt">Termina (opcional)</label>
              <Input id="endsAt" name="endsAt" type="date" data-testid="programa-fin" />
            </span>
          </div>
        </CardContent>
      </Card>

      <Button type="submit" disabled={pending} data-testid="btn-crear-programa" className="w-full">
        {pending ? 'Guardando…' : 'Crear el programa como borrador'}
      </Button>

      {estado.error && <p className="text-sm text-destructive" role="alert" data-testid="programa-error">{estado.error}</p>}
      {estado.success && (
        <p className="text-sm text-primary" role="status" data-testid="programa-exito">
          {estado.success}{' '}
          {estado.id && <a className="underline" href={`/superadmin/supply-v2/fidelizacion/${estado.id}`}>Ver el programa</a>}
        </p>
      )}
    </form>
  )
}
