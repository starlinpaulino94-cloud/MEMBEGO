'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import type { SupplyV2MembershipPlanKind } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  adjuntarBeneficioAPlanAction,
  ajustarPuntosAction,
  anularReferidoAction,
  aprobarProgramaAction,
  aprobarRecompensaAction,
  aprobarReferidoAction,
  archivarPlanAction,
  buscarClientesFidelizacionAction,
  cancelarProgramaAction,
  configurarReferidosAction,
  crearPlanAction,
  crearRecompensaAction,
  enviarProgramaARevisionAction,
  otorgarMembresiaAction,
  pausarPlanAction,
  pausarProgramaAction,
  pausarRecompensaAction,
  publicarPlanAction,
  reanudarProgramaAction,
  rechazarProgramaAction,
  reversarReclamacionAction,
} from '@/modules/supply-v2/actions-fidelizacion'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'
import { MEMBERSHIP_BENEFIT_KIND_LABELS, MEMBERSHIP_PLAN_KIND_LABELS, REFERRAL_REWARD_KIND_LABELS, REWARD_KIND_LABELS } from '@/modules/supply-v2/core/catalogo'

/**
 * MEMBEGO SUPPLY · SLICE 8 · acciones de la ficha de un programa.
 *
 * Cada formulario llama a su server action, y la action exige su permiso. Lo
 * que se ve aquí no decide nada: si alguien manda el formulario sin permiso,
 * el servidor lo rechaza igual.
 */

const SELECT = 'h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm'

function useAviso(estados: EstadoAccion<unknown>[]): void {
  const visto = useRef<string | undefined>(undefined)
  useEffect(() => {
    for (const e of estados) {
      if (e.success && visto.current !== e.success) {
        visto.current = e.success
        toast.success(e.success)
      }
      if (e.error && visto.current !== e.error) {
        visto.current = e.error
        toast.error(e.error)
      }
    }
  }, [estados])
}

// ── Ciclo de vida del programa ──────────────────────────────────────────────

export function AccionesPrograma({
  programId,
  estado,
  puedeCrear,
  puedeAprobar,
}: {
  programId: string
  estado: string
  puedeCrear: boolean
  puedeAprobar: boolean
}) {
  const [revision, enviarRevision, enviando] = useActionState<EstadoAccion, FormData>(enviarProgramaARevisionAction, {})
  const [aprob, aprobar, aprobando] = useActionState<EstadoAccion, FormData>(aprobarProgramaAction, {})
  const [rech, rechazar, rechazando] = useActionState<EstadoAccion, FormData>(rechazarProgramaAction, {})
  const [pau, pausar, pausando] = useActionState<EstadoAccion, FormData>(pausarProgramaAction, {})
  const [rea, reanudar, reanudando] = useActionState<EstadoAccion, FormData>(reanudarProgramaAction, {})
  const [can, cancelar, cancelando] = useActionState<EstadoAccion, FormData>(cancelarProgramaAction, {})
  const [abierto, setAbierto] = useState<'rechazo' | 'cancelacion' | null>(null)
  useAviso([revision, aprob, rech, pau, rea, can])
  const error = revision.error ?? aprob.error ?? rech.error ?? pau.error ?? rea.error ?? can.error

  return (
    <div className="space-y-3" data-testid="acciones-programa">
      <div className="flex flex-wrap gap-2">
        {puedeCrear && estado === 'DRAFT' && (
          <form action={enviarRevision}>
            <input type="hidden" name="programId" value={programId} />
            <Button type="submit" size="sm" disabled={enviando} loading={enviando} data-testid="btn-enviar-revision-programa">Enviar a revisión</Button>
          </form>
        )}
        {puedeAprobar && estado === 'PENDING_APPROVAL' && (
          <>
            <form action={aprobar}>
              <input type="hidden" name="programId" value={programId} />
              <Button type="submit" size="sm" disabled={aprobando} loading={aprobando} data-testid="btn-aprobar-programa">Aprobar y activar</Button>
            </form>
            <Button type="button" size="sm" variant="outline" onClick={() => setAbierto(abierto === 'rechazo' ? null : 'rechazo')} data-testid="btn-abrir-rechazo-programa">Devolver a borrador</Button>
          </>
        )}
        {puedeCrear && estado === 'ACTIVE' && (
          <form action={pausar}>
            <input type="hidden" name="programId" value={programId} />
            <Button type="submit" size="sm" variant="outline" disabled={pausando} loading={pausando} data-testid="btn-pausar-programa">Pausar</Button>
          </form>
        )}
        {puedeCrear && estado === 'PAUSED' && (
          <form action={reanudar}>
            <input type="hidden" name="programId" value={programId} />
            <Button type="submit" size="sm" disabled={reanudando} loading={reanudando} data-testid="btn-reanudar-programa">Reactivar</Button>
          </form>
        )}
        {puedeAprobar && estado !== 'CANCELLED' && estado !== 'COMPLETED' && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(abierto === 'cancelacion' ? null : 'cancelacion')} data-testid="btn-abrir-cancelacion-programa">Cancelar programa</Button>
        )}
      </div>

      {abierto === 'rechazo' && (
        <form action={rechazar} className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3" data-testid="form-rechazo-programa">
          <input type="hidden" name="programId" value={programId} />
          <Label htmlFor="motivoRechazo">¿Por qué se devuelve?</Label>
          <Textarea id="motivoRechazo" name="motivo" rows={2} maxLength={500} required data-testid="motivo-rechazo-programa" />
          <Button type="submit" size="sm" disabled={rechazando} loading={rechazando} data-testid="btn-rechazar-programa">Devolver con este motivo</Button>
        </form>
      )}

      {abierto === 'cancelacion' && (
        <form action={cancelar} className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3" data-testid="form-cancelacion-programa">
          <input type="hidden" name="programId" value={programId} />
          <Label htmlFor="motivoCancelar">¿Por qué se cancela?</Label>
          <Textarea id="motivoCancelar" name="motivo" rows={2} maxLength={500} required data-testid="motivo-cancelacion-programa" />
          <p className="text-caption text-muted-foreground">Se archivan sus planes. Las membresías ya vendidas siguen vigentes hasta vencer: cancelar no quita lo que la gente pagó.</p>
          <Button type="submit" size="sm" variant="destructive" disabled={cancelando} loading={cancelando} data-testid="btn-cancelar-programa">Cancelar el programa</Button>
        </form>
      )}

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  )
}

// ── Planes ──────────────────────────────────────────────────────────────────

export function FormPlan({ programId, moneda }: { programId: string; moneda: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(crearPlanAction, {})
  const [kind, setKind] = useState<SupplyV2MembershipPlanKind>('PAID')
  useAviso([estado])
  return (
    <form action={accion} className="space-y-3 rounded-lg border border-border bg-muted/20 p-3" data-testid="form-plan">
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="planNombre">Nombre del plan</Label>
          <Input id="planNombre" name="name" maxLength={140} required placeholder="Membresía Oro" data-testid="plan-nombre" />
        </div>
        <div>
          <Label htmlFor="planTipo">Tipo</Label>
          <select id="planTipo" value={kind} onChange={(e) => setKind(e.target.value as SupplyV2MembershipPlanKind)} className={SELECT} data-testid="plan-tipo">
            {(['FREE', 'PAID', 'GRANTED'] as const).map((k) => (
              <option key={k} value={k}>{MEMBERSHIP_PLAN_KIND_LABELS[k]}</option>
            ))}
          </select>
        </div>
        {kind === 'PAID' && (
          <div>
            <Label htmlFor="planPrecio">Precio ({moneda})</Label>
            <Input id="planPrecio" name="price" type="number" min={0} step="0.01" inputMode="decimal" required placeholder="500" data-testid="plan-precio" />
          </div>
        )}
        <div>
          <Label htmlFor="planDias">Duración (días)</Label>
          <Input id="planDias" name="durationDays" type="number" min={1} step={1} inputMode="numeric" required defaultValue={30} data-testid="plan-dias" />
        </div>
        <div>
          <Label htmlFor="planMax">Límite de miembros (opcional)</Label>
          <Input id="planMax" name="maxMembers" type="number" min={1} step={1} inputMode="numeric" data-testid="plan-max-miembros" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="planDescripcion">Qué incluye, para el cliente (opcional)</Label>
          <Textarea id="planDescripcion" name="description" rows={2} maxLength={2000} data-testid="plan-descripcion" />
        </div>
      </div>
      <Button type="submit" size="sm" disabled={pendiente} loading={pendiente} data-testid="btn-crear-plan">Crear plan</Button>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}

export function AccionesPlan({ programId, planId, estado }: { programId: string; planId: string; estado: string }) {
  const [pub, publicar, publicando] = useActionState<EstadoAccion, FormData>(publicarPlanAction, {})
  const [pau, pausar, pausando] = useActionState<EstadoAccion, FormData>(pausarPlanAction, {})
  const [arc, archivar, archivando] = useActionState<EstadoAccion, FormData>(archivarPlanAction, {})
  useAviso([pub, pau, arc])
  return (
    <div className="flex flex-wrap gap-2" data-testid="acciones-plan">
      {(estado === 'DRAFT' || estado === 'PAUSED') && (
        <form action={publicar}>
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="planId" value={planId} />
          <Button type="submit" size="sm" disabled={publicando} loading={publicando} data-testid="btn-publicar-plan">Publicar</Button>
        </form>
      )}
      {estado === 'PUBLISHED' && (
        <form action={pausar}>
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="planId" value={planId} />
          <Button type="submit" size="sm" variant="outline" disabled={pausando} loading={pausando} data-testid="btn-pausar-plan">Pausar</Button>
        </form>
      )}
      {estado !== 'ARCHIVED' && (
        <form action={archivar}>
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="planId" value={planId} />
          <Button type="submit" size="sm" variant="ghost" disabled={archivando} loading={archivando} data-testid="btn-archivar-plan">Archivar</Button>
        </form>
      )}
      {(pub.error ?? pau.error ?? arc.error) && <p className="w-full text-sm text-destructive" role="alert">{pub.error ?? pau.error ?? arc.error}</p>}
    </div>
  )
}

export function FormBeneficioDePlan({ programId, planId, beneficios }: { programId: string; planId: string; beneficios: { id: string; nombre: string }[] }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(adjuntarBeneficioAPlanAction, {})
  const [kind, setKind] = useState<'BENEFIT' | 'COUPON' | 'POINTS_MULTIPLIER' | 'EARLY_ACCESS'>('BENEFIT')
  const [abierto, setAbierto] = useState(false)
  useAviso([estado])
  if (!abierto) {
    return <Button type="button" size="sm" variant="outline" onClick={() => setAbierto(true)} data-testid="btn-abrir-beneficio-plan">Añadir lo que incluye</Button>
  }
  return (
    <form action={accion} className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3" data-testid="form-beneficio-plan">
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="kind" value={kind} />
      <div>
        <Label htmlFor={`bpKind-${planId}`}>Qué incluye</Label>
        <select id={`bpKind-${planId}`} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={SELECT} data-testid="beneficio-plan-tipo">
          {(['BENEFIT', 'COUPON', 'POINTS_MULTIPLIER', 'EARLY_ACCESS'] as const).map((k) => (
            <option key={k} value={k}>{MEMBERSHIP_BENEFIT_KIND_LABELS[k]}</option>
          ))}
        </select>
      </div>
      {(kind === 'BENEFIT' || kind === 'COUPON') && (
        <div>
          <Label htmlFor={`bpBen-${planId}`}>Beneficio del catálogo</Label>
          <select id={`bpBen-${planId}`} name="benefitId" className={SELECT} required data-testid="beneficio-plan-beneficio">
            <option value="">Elige uno…</option>
            {beneficios.map((b) => (
              <option key={b.id} value={b.id}>{b.nombre}</option>
            ))}
          </select>
          <p className="text-caption text-muted-foreground">Es un beneficio del catálogo de siempre, con su presupuesto y su ledger: aquí no se crea ningún descuento nuevo.</p>
        </div>
      )}
      {kind === 'POINTS_MULTIPLIER' && (
        <div>
          <Label htmlFor={`bpMul-${planId}`}>Multiplicador</Label>
          <Input id={`bpMul-${planId}`} name="pointsMultiplier" type="number" min={1} step="0.01" inputMode="decimal" placeholder="1.50" required data-testid="beneficio-plan-multiplicador" />
          <p className="text-caption text-muted-foreground">Los puntos se multiplican y siempre se redondean hacia abajo.</p>
        </div>
      )}
      {kind === 'EARLY_ACCESS' && (
        <div>
          <Label htmlFor={`bpHoras-${planId}`}>Horas de adelanto</Label>
          <Input id={`bpHoras-${planId}`} name="earlyAccessHours" type="number" min={1} step={1} inputMode="numeric" placeholder="24" required data-testid="beneficio-plan-horas" />
        </div>
      )}
      <div>
        <Label htmlFor={`bpUsos-${planId}`}>Usos por período (opcional)</Label>
        <Input id={`bpUsos-${planId}`} name="usesPerPeriod" type="number" min={1} step={1} inputMode="numeric" data-testid="beneficio-plan-usos" />
      </div>
      <Button type="submit" size="sm" disabled={pendiente} loading={pendiente} data-testid="btn-guardar-beneficio-plan">Añadir al plan</Button>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}

// ── Recompensas ─────────────────────────────────────────────────────────────

export function FormRecompensa({ programId, beneficios, ofertas, moneda }: { programId: string; beneficios: { id: string; nombre: string }[]; ofertas: { id: string; titulo: string }[]; moneda: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(crearRecompensaAction, {})
  const [kind, setKind] = useState<'COUPON' | 'BENEFIT' | 'FREE_PRODUCT' | 'SERVICE' | 'PARTIAL_BONUS'>('FREE_PRODUCT')
  const hoy = new Date().toISOString().slice(0, 10)
  useAviso([estado])
  const pideOferta = kind === 'FREE_PRODUCT' || kind === 'SERVICE'
  return (
    <form action={accion} className="space-y-3 rounded-lg border border-border bg-muted/20 p-3" data-testid="form-recompensa">
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="recNombre">Nombre</Label>
          <Input id="recNombre" name="name" maxLength={140} required placeholder="Pizza gratis" data-testid="recompensa-nombre" />
        </div>
        <div>
          <Label htmlFor="recTipo">Qué entrega</Label>
          <select id="recTipo" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={SELECT} data-testid="recompensa-tipo">
            {(['FREE_PRODUCT', 'SERVICE', 'COUPON', 'BENEFIT', 'PARTIAL_BONUS'] as const).map((k) => (
              <option key={k} value={k}>{REWARD_KIND_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="recPuntos">Cuántos puntos cuesta</Label>
          <Input id="recPuntos" name="pointsCost" type="number" min={0} step={1} inputMode="numeric" required placeholder="100" data-testid="recompensa-puntos" />
        </div>
        <div>
          <Label htmlFor="recBeneficio">Con qué se paga la entrega</Label>
          <select id="recBeneficio" name="benefitId" className={SELECT} required data-testid="recompensa-beneficio">
            <option value="">Elige el beneficio…</option>
            {beneficios.map((b) => (
              <option key={b.id} value={b.id}>{b.nombre}</option>
            ))}
          </select>
          <p className="text-caption text-muted-foreground">Toda recompensa necesita su beneficio: es lo que paga lo que el cliente se lleva.</p>
        </div>
        {pideOferta && (
          <div>
            <Label htmlFor="recOferta">Qué oferta se entrega</Label>
            <select id="recOferta" name="offerId" className={SELECT} required data-testid="recompensa-oferta">
              <option value="">Elige la oferta…</option>
              {ofertas.map((o) => (
                <option key={o.id} value={o.id}>{o.titulo}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <Label htmlFor="recCosto">Costo por entrega ({moneda}, opcional)</Label>
          <Input id="recCosto" name="unitCost" type="number" min={0} step="0.01" inputMode="decimal" data-testid="recompensa-costo" />
        </div>
        <div>
          <Label htmlFor="recPresupuesto">Presupuesto ({moneda}, opcional)</Label>
          <Input id="recPresupuesto" name="budgetTotal" type="number" min={0} step="0.01" inputMode="decimal" data-testid="recompensa-presupuesto" />
        </div>
        <div>
          <Label htmlFor="recTope">Tope total de canjes (opcional)</Label>
          <Input id="recTope" name="maxClaims" type="number" min={1} step={1} inputMode="numeric" data-testid="recompensa-tope" />
        </div>
        <div>
          <Label htmlFor="recDesde">Desde</Label>
          <Input id="recDesde" name="startsAt" type="date" defaultValue={hoy} required data-testid="recompensa-desde" />
        </div>
      </div>
      <Button type="submit" size="sm" disabled={pendiente} loading={pendiente} data-testid="btn-crear-recompensa">Crear recompensa</Button>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}

export function AccionesRecompensa({ programId, rewardId, estado }: { programId: string; rewardId: string; estado: string }) {
  const [apr, aprobar, aprobando] = useActionState<EstadoAccion, FormData>(aprobarRecompensaAction, {})
  const [pau, pausar, pausando] = useActionState<EstadoAccion, FormData>(pausarRecompensaAction, {})
  useAviso([apr, pau])
  return (
    <div className="flex flex-wrap gap-2" data-testid="acciones-recompensa">
      {estado === 'DRAFT' && (
        <form action={aprobar}>
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="rewardId" value={rewardId} />
          <Button type="submit" size="sm" disabled={aprobando} loading={aprobando} data-testid="btn-aprobar-recompensa">Aprobar</Button>
        </form>
      )}
      {estado === 'ACTIVE' && (
        <form action={pausar}>
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="rewardId" value={rewardId} />
          <Button type="submit" size="sm" variant="outline" disabled={pausando} loading={pausando} data-testid="btn-pausar-recompensa">Pausar</Button>
        </form>
      )}
      {(apr.error ?? pau.error) && <p className="w-full text-sm text-destructive" role="alert">{apr.error ?? pau.error}</p>}
    </div>
  )
}

export function FormReversarReclamacion({ programId, claimId }: { programId: string; claimId: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(reversarReclamacionAction, {})
  const [abierto, setAbierto] = useState(false)
  useAviso([estado])
  if (!abierto) {
    return <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(true)} data-testid="btn-abrir-reversa">Reversar</Button>
  }
  return (
    <form action={accion} className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3" data-testid="form-reversa">
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="claimId" value={claimId} />
      <Label htmlFor={`rev-${claimId}`}>¿Por qué se reversa?</Label>
      <Textarea id={`rev-${claimId}`} name="motivo" rows={2} maxLength={500} required data-testid="motivo-reversa" />
      <p className="text-caption text-muted-foreground">Lo que todavía no se usó devuelve los puntos. Lo ya entregado, no: el costo ya se realizó.</p>
      <Button type="submit" size="sm" variant="destructive" disabled={pendiente} loading={pendiente} data-testid="btn-reversar">Reversar</Button>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}

// ── Referidos ───────────────────────────────────────────────────────────────

export function FormReferidos({ programId, beneficios, configurado }: { programId: string; beneficios: { id: string; nombre: string }[]; configurado: boolean }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(configurarReferidosAction, {})
  const [kind, setKind] = useState<'POINTS' | 'BONUS' | 'COUPON' | 'SUPPLIER_BENEFIT'>('POINTS')
  useAviso([estado])
  return (
    <form action={accion} className="space-y-3 rounded-lg border border-border bg-muted/20 p-3" data-testid="form-referidos">
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="rewardKind" value={kind} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="refTipo">Con qué se premia a quien invita</Label>
          <select id="refTipo" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={SELECT} data-testid="referidos-tipo">
            {(['POINTS', 'BONUS', 'COUPON', 'SUPPLIER_BENEFIT'] as const).map((k) => (
              <option key={k} value={k}>{REFERRAL_REWARD_KIND_LABELS[k]}</option>
            ))}
          </select>
        </div>
        {kind === 'POINTS' ? (
          <div>
            <Label htmlFor="refPuntos">Cuántos puntos</Label>
            <Input id="refPuntos" name="rewardPoints" type="number" min={1} step={1} inputMode="numeric" required placeholder="200" data-testid="referidos-puntos" />
          </div>
        ) : (
          <div>
            <Label htmlFor="refBeneficio">Qué beneficio</Label>
            <select id="refBeneficio" name="rewardBenefitId" className={SELECT} required data-testid="referidos-beneficio">
              <option value="">Elige uno…</option>
              {beneficios.map((b) => (
                <option key={b.id} value={b.id}>{b.nombre}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <Label htmlFor="refMinimo">Compra mínima del invitado (opcional)</Label>
          <Input id="refMinimo" name="minPurchaseAmount" type="number" min={0} step="0.01" inputMode="decimal" data-testid="referidos-minimo" />
        </div>
        <div>
          <Label htmlFor="refEspera">Días de espera antes de pagar</Label>
          <Input id="refEspera" name="waitingPeriodDays" type="number" min={0} step={1} inputMode="numeric" defaultValue={0} data-testid="referidos-espera" />
          <p className="text-caption text-muted-foreground">Si el invitado cancela dentro del plazo, el premio se anula.</p>
        </div>
        <div>
          <Label htmlFor="refTopePersona">Tope por persona (opcional)</Label>
          <Input id="refTopePersona" name="maxPerReferrer" type="number" min={1} step={1} inputMode="numeric" data-testid="referidos-tope-persona" />
        </div>
        <div>
          <Label htmlFor="refTopeTotal">Tope total (opcional)</Label>
          <Input id="refTopeTotal" name="maxTotal" type="number" min={1} step={1} inputMode="numeric" data-testid="referidos-tope-total" />
        </div>
      </div>
      <Button type="submit" size="sm" disabled={pendiente} loading={pendiente} data-testid="btn-guardar-referidos">{configurado ? 'Actualizar referidos' : 'Activar referidos'}</Button>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}

export function AccionesReferido({ programId, referralId, estado }: { programId: string; referralId: string; estado: string }) {
  const [apr, aprobar, aprobando] = useActionState<EstadoAccion, FormData>(aprobarReferidoAction, {})
  const [anu, anular, anulando] = useActionState<EstadoAccion, FormData>(anularReferidoAction, {})
  const [abierto, setAbierto] = useState(false)
  useAviso([apr, anu])
  const cerrado = estado === 'REWARD_GRANTED' || estado === 'REWARD_VOIDED'
  return (
    <div className="space-y-2" data-testid="acciones-referido">
      <div className="flex flex-wrap gap-2">
        {!cerrado && (
          <form action={aprobar}>
            <input type="hidden" name="programId" value={programId} />
            <input type="hidden" name="referralId" value={referralId} />
            <Button type="submit" size="sm" disabled={aprobando} loading={aprobando} data-testid="btn-aprobar-referido">Conceder el premio</Button>
          </form>
        )}
        {!cerrado && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(!abierto)} data-testid="btn-abrir-anular-referido">Anular</Button>
        )}
      </div>
      {abierto && (
        <form action={anular} className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3" data-testid="form-anular-referido">
          <input type="hidden" name="programId" value={programId} />
          <input type="hidden" name="referralId" value={referralId} />
          <Label htmlFor={`anu-${referralId}`}>¿Por qué se anula?</Label>
          <Textarea id={`anu-${referralId}`} name="motivo" rows={2} maxLength={500} required data-testid="motivo-anular-referido" />
          <Button type="submit" size="sm" variant="destructive" disabled={anulando} loading={anulando} data-testid="btn-anular-referido">Anular (es definitivo)</Button>
        </form>
      )}
      {(apr.error ?? anu.error) && <p className="text-sm text-destructive" role="alert">{apr.error ?? anu.error}</p>}
    </div>
  )
}

// ── Otorgar membresía y ajustar puntos: las dos que tocan a una persona ─────

function BuscadorDeClientes({ onElegir, testid }: { onElegir: (c: { id: string; nombre: string; email: string }) => void; testid: string }) {
  const [consulta, setConsulta] = useState('')
  const [resultados, setResultados] = useState<{ id: string; nombre: string; email: string }[]>([])
  const [buscando, buscar] = useTransition()
  return (
    <div className="space-y-2">
      <Label htmlFor={`buscar-${testid}`}>Buscar cliente</Label>
      <div className="flex gap-2">
        <Input
          id={`buscar-${testid}`}
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          placeholder="Nombre o correo"
          data-testid={testid}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={buscando || consulta.trim().length < 2}
          onClick={() => buscar(async () => setResultados(await buscarClientesFidelizacionAction(consulta)))}
          data-testid={`${testid}-buscar`}
        >
          Buscar
        </Button>
      </div>
      {resultados.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {resultados.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onElegir(c)} className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50" data-testid={`${testid}-opcion`}>
                {c.nombre} · <span className="text-muted-foreground">{c.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function FormOtorgarMembresia({ programId, planes }: { programId: string; planes: { id: string; nombre: string }[] }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(otorgarMembresiaAction, {})
  const [elegido, setElegido] = useState<{ id: string; nombre: string; email: string } | null>(null)
  useAviso([estado])
  return (
    <form action={accion} className="space-y-3" data-testid="form-otorgar-membresia">
      <input type="hidden" name="programId" value={programId} />
      {elegido && <input type="hidden" name="customerId" value={elegido.id} />}
      <BuscadorDeClientes onElegir={setElegido} testid="otorgar-cliente" />
      {elegido && <p className="text-sm" data-testid="otorgar-elegido">Para: <span className="font-medium">{elegido.nombre}</span> · {elegido.email}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="otorgarPlan">Plan</Label>
          <select id="otorgarPlan" name="planId" className={SELECT} required data-testid="otorgar-plan">
            <option value="">Elige el plan…</option>
            {planes.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="otorgarDias">Días (opcional, si no, la duración del plan)</Label>
          <Input id="otorgarDias" name="dias" type="number" min={1} step={1} inputMode="numeric" data-testid="otorgar-dias" />
        </div>
      </div>
      <div>
        <Label htmlFor="otorgarMotivo">Motivo (obligatorio)</Label>
        <Textarea id="otorgarMotivo" name="motivo" rows={2} maxLength={500} required placeholder="Compensación por la incidencia del 12 de marzo" data-testid="otorgar-motivo" />
        <p className="text-caption text-muted-foreground">Regalar una membresía cuesta dinero: el motivo queda en la bitácora con tu nombre.</p>
      </div>
      <Button type="submit" size="sm" disabled={pendiente || !elegido} loading={pendiente} data-testid="btn-otorgar-membresia">Otorgar la membresía</Button>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}

export function FormAjustarPuntos({ programId }: { programId: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(ajustarPuntosAction, {})
  const [elegido, setElegido] = useState<{ id: string; nombre: string; email: string } | null>(null)
  useAviso([estado])
  return (
    <form action={accion} className="space-y-3" data-testid="form-ajustar-puntos">
      <input type="hidden" name="programId" value={programId} />
      {elegido && <input type="hidden" name="customerId" value={elegido.id} />}
      <BuscadorDeClientes onElegir={setElegido} testid="ajuste-cliente" />
      {elegido && <p className="text-sm" data-testid="ajuste-elegido">A: <span className="font-medium">{elegido.nombre}</span> · {elegido.email}</p>}
      <div>
        <Label htmlFor="ajustePuntos">Puntos (negativo para quitar)</Label>
        <Input id="ajustePuntos" name="puntos" type="number" step={1} inputMode="numeric" required placeholder="50" data-testid="ajuste-puntos" />
      </div>
      <div>
        <Label htmlFor="ajusteMotivo">Motivo (obligatorio)</Label>
        <Textarea id="ajusteMotivo" name="motivo" rows={2} maxLength={500} required placeholder="Puntos que no se acreditaron por la caída del 3 de abril" data-testid="ajuste-motivo" />
        <p className="text-caption text-muted-foreground">Queda en el ledger para siempre, con tu nombre. No se puede borrar.</p>
      </div>
      <Button type="submit" size="sm" disabled={pendiente || !elegido} loading={pendiente} data-testid="btn-ajustar-puntos">Registrar el ajuste</Button>
      {estado.error && <p className="text-sm text-destructive" role="alert">{estado.error}</p>}
    </form>
  )
}
