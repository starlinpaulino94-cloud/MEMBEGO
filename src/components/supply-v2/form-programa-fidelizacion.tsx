'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { SupplyV2BenefitFunding, SupplyV2LoyaltyModality, SupplyV2LoyaltyOwner } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { crearProgramaAction } from '@/modules/supply-v2/actions-fidelizacion'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import type { ProgramaCreado } from '@/modules/supply-v2/loyalty/programs'
import {
  BENEFIT_FUNDING_EXPLICACION,
  BENEFIT_FUNDING_LABELS,
  LOYALTY_MODALITY_EXPLICACION,
  LOYALTY_MODALITY_LABELS,
  LOYALTY_OWNER_LABELS,
  RUTA_FIDELIZACION,
} from '@/modules/supply-v2/core/catalogo'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · alta de un programa de fidelización.
 *
 * Enseña lo que cada decisión implica antes de guardar: qué hace cada
 * modalidad, quién pone el dinero, y qué pasa si el programa va sin techo.
 * La regla de puntos solo se pide cuando el programa tiene puntos, así que
 * nadie rellena campos que no aplican.
 */

const MODALIDADES: SupplyV2LoyaltyModality[] = ['MEMBERSHIPS', 'REFERRALS', 'POINTS', 'REWARDS']
const SELECT = 'h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm'

export function FormPrograma({ proveedores }: { proveedores: { id: string; nombre: string }[] }) {
  const router = useRouter()
  const [estado, accion, pendiente] = useActionState<EstadoAccion<ProgramaCreado>, FormData>(crearProgramaAction, {})
  const [owner, setOwner] = useState<SupplyV2LoyaltyOwner>('MEMBEGO')
  const [funding, setFunding] = useState<SupplyV2BenefitFunding>('MEMBEGO')
  const [elegidas, setElegidas] = useState<SupplyV2LoyaltyModality[]>(['MEMBERSHIPS'])
  const [supplierId, setSupplierId] = useState('')
  const [budgetTotal, setBudgetTotal] = useState('')
  const [waiver, setWaiver] = useState('')
  const hoy = new Date().toISOString().slice(0, 10)

  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!estado.success || !estado.id || visto.current === estado.id) return
    visto.current = estado.id
    toast.success(estado.success)
    router.push(`${RUTA_FIDELIZACION}/${estado.id}`)
  }, [estado, router])

  const conPuntos = elegidas.includes('POINTS')
  const conMembresias = elegidas.includes('MEMBERSHIPS')
  /**
   * El negocio es obligatorio cuando lo administra él, cuando pone dinero, y
   * también cuando el programa tiene MEMBRESÍAS: una membresía es siempre «la
   * de este negocio», y el servidor rechaza un plan en un programa sin negocio.
   * Pedirlo aquí evita crear un programa con el que después no se puede hacer
   * nada.
   */
  const exigeProveedor = owner === 'SUPPLIER' || funding !== 'MEMBEGO' || conMembresias
  const exigeTecho = funding !== 'SUPPLIER'
  const listo =
    elegidas.length > 0 &&
    (!exigeProveedor || Boolean(supplierId)) &&
    (!exigeTecho || Boolean(budgetTotal) || waiver.trim().length > 0)

  const alternar = (m: SupplyV2LoyaltyModality) =>
    setElegidas((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={accion} className="space-y-5" data-testid="form-programa">
          <input type="hidden" name="owner" value={owner} />
          <input type="hidden" name="funding" value={funding} />
          {elegidas.map((m) => (
            <input key={m} type="hidden" name="modalities" value={m} />
          ))}

          <section className="space-y-3">
            <h2 className="text-h3">¿Qué programa vas a montar?</h2>
            <div>
              <Label htmlFor="progNombre">Nombre que verá el cliente</Label>
              <Input id="progNombre" name="name" maxLength={140} required placeholder="Club Membego" data-testid="programa-nombre" />
            </div>
            <div>
              <Label htmlFor="progObjetivo">¿Para qué? (interno, opcional)</Label>
              <Input id="progObjetivo" name="objective" maxLength={300} placeholder="Que quien ya compró vuelva" />
            </div>
            <div>
              <Label htmlFor="progDescripcion">Descripción para el cliente (opcional)</Label>
              <Textarea id="progDescripcion" name="description" rows={2} maxLength={2000} />
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-h3">¿Qué incluye?</h2>
            <div className="space-y-2" data-testid="programa-modalidades">
              {MODALIDADES.map((m) => (
                <label key={m} className="flex cursor-pointer gap-2 rounded-lg border border-border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input type="checkbox" checked={elegidas.includes(m)} onChange={() => alternar(m)} className="mt-0.5" data-testid={`modalidad-${m}`} />
                  <span>
                    <span className="block font-medium">{LOYALTY_MODALITY_LABELS[m]}</span>
                    <span className="block text-caption text-muted-foreground">{LOYALTY_MODALITY_EXPLICACION[m]}</span>
                  </span>
                </label>
              ))}
            </div>
            {elegidas.length === 0 && <p className="text-sm text-destructive">Elige al menos una modalidad.</p>}
          </section>

          <section className="space-y-3">
            <h2 className="text-h3">¿Quién lo administra y quién pone el dinero?</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="progOwner">Lo administra</Label>
                <select id="progOwner" value={owner} onChange={(e) => setOwner(e.target.value as SupplyV2LoyaltyOwner)} className={SELECT} data-testid="programa-owner">
                  {(['MEMBEGO', 'SUPPLIER'] as const).map((o) => (
                    <option key={o} value={o}>{LOYALTY_OWNER_LABELS[o]}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="progFunding">Quién financia</Label>
                <select id="progFunding" value={funding} onChange={(e) => setFunding(e.target.value as SupplyV2BenefitFunding)} className={SELECT} data-testid="programa-funding">
                  {(['MEMBEGO', 'SUPPLIER', 'SHARED'] as const).map((f) => (
                    <option key={f} value={f}>{BENEFIT_FUNDING_LABELS[f]}</option>
                  ))}
                </select>
                <p className="text-caption text-muted-foreground">{BENEFIT_FUNDING_EXPLICACION[funding]}</p>
              </div>
              {exigeProveedor && (
                <div className="sm:col-span-2">
                  <Label htmlFor="progProveedor">¿De qué negocio?</Label>
                  {conMembresias && owner === 'MEMBEGO' && funding === 'MEMBEGO' && (
                    <p className="text-caption text-muted-foreground">
                      Una membresía es siempre la de un negocio concreto, aunque la administre y la pague Membego.
                    </p>
                  )}
                  <select id="progProveedor" name="supplierId" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={SELECT} required data-testid="programa-proveedor">
                    <option value="">Elige el negocio…</option>
                    {proveedores.map((p) => (
                      <option key={p.id} value={p.id}>{p.nombre}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </section>

          {exigeTecho && (
            <section className="space-y-3">
              <h2 className="text-h3">Presupuesto</h2>
              <div>
                <Label htmlFor="progPresupuesto">Techo del programa (RD$)</Label>
                <Input
                  id="progPresupuesto"
                  name="budgetTotal"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={budgetTotal}
                  onChange={(e) => setBudgetTotal(e.target.value)}
                  placeholder="50000"
                  data-testid="programa-presupuesto"
                />
                <p className="text-caption text-muted-foreground">La suma de los presupuestos de sus recompensas no podrá pasar de aquí.</p>
              </div>
              {!budgetTotal && (
                <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
                  <Label htmlFor="progWaiver">Sin techo: escribe quién lo autoriza y por qué</Label>
                  <Textarea
                    id="progWaiver"
                    name="budgetWaiverReason"
                    rows={2}
                    maxLength={500}
                    value={waiver}
                    onChange={(e) => setWaiver(e.target.value)}
                    placeholder="Autorizado por la dirección financiera para el lanzamiento del club"
                    data-testid="programa-waiver"
                  />
                  <p className="text-caption text-warning">
                    Un programa sin techo puede gastar sin límite. Queda registrado con tu nombre y la fecha, y aparece en la bitácora.
                  </p>
                </div>
              )}
            </section>
          )}

          {conPuntos && (
            <section className="space-y-3" data-testid="programa-regla-puntos">
              <h2 className="text-h3">Regla de puntos</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="progPuntos">Puntos que se ganan</Label>
                  <Input id="progPuntos" name="pointsPerUnit" type="number" min={1} step={1} inputMode="numeric" required defaultValue={1} data-testid="programa-puntos-por-unidad" />
                </div>
                <div>
                  <Label htmlFor="progImporte">Por cada (RD$)</Label>
                  <Input id="progImporte" name="amountPerPoint" type="number" min={1} step="0.01" inputMode="decimal" required defaultValue={100} data-testid="programa-importe-por-punto" />
                </div>
                <div>
                  <Label htmlFor="progBase">Sobre qué se calcula</Label>
                  <select id="progBase" name="accrualBasis" className={SELECT} defaultValue="CUSTOMER_PAID" data-testid="programa-base">
                    <option value="CUSTOMER_PAID">Lo que paga el cliente</option>
                    <option value="CONTRACTUAL_VALUE">El valor de la compra</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="progVencen">Los puntos vencen a los (días, vacío = no vencen)</Label>
                  <Input id="progVencen" name="pointsExpireDays" type="number" min={1} step={1} inputMode="numeric" data-testid="programa-vencimiento" />
                </div>
                <div>
                  <Label htmlFor="progEspera">Días hasta que se pueden usar</Label>
                  <Input id="progEspera" name="pointsHoldDays" type="number" min={0} step={1} inputMode="numeric" defaultValue={0} data-testid="programa-espera" />
                  <p className="text-caption text-muted-foreground">Mientras esperan, los puntos están «pendientes» y no se pueden canjear.</p>
                </div>
              </div>
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-h3">Vigencia</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="progDesde">Desde</Label>
                <Input id="progDesde" name="startsAt" type="date" defaultValue={hoy} required data-testid="programa-desde" />
              </div>
              <div>
                <Label htmlFor="progHasta">Hasta (opcional)</Label>
                <Input id="progHasta" name="endsAt" type="date" data-testid="programa-hasta" />
              </div>
            </div>
          </section>

          <div className="flex items-center gap-3 border-t border-border pt-4">
            <Button type="submit" disabled={pendiente || !listo} loading={pendiente} data-testid="btn-crear-programa">Crear como borrador</Button>
            <p className="text-caption text-muted-foreground">Después añades los planes y las recompensas, y otra persona autorizada lo aprueba.</p>
          </div>
          {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
        </form>
      </CardContent>
    </Card>
  )
}
