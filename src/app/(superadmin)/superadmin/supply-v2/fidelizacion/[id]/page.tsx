import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipPlan, ChipPrograma, ChipRecompensa } from '@/components/supply-v2/chips'
import {
  AccionesPlan,
  AccionesPrograma,
  AccionesRecompensa,
  FormAjustarPuntos,
  FormBeneficioDePlan,
  FormOtorgarMembresia,
  FormPlan,
  FormRecompensa,
  FormReferidos,
} from '@/components/supply-v2/acciones-fidelizacion'
import { fichaDePrograma } from '@/modules/supply-v2/loyalty/queries'
import { listarBeneficios } from '@/modules/supply-v2/benefits/queries'
import { opcionesDeBeneficio } from '@/modules/supply-v2/benefits/queries'
import { puedeSupplyV2 } from '@/modules/supply-v2/permisos'
import {
  LOYALTY_EVENT_LABELS,
  LOYALTY_MODALITY_LABELS,
  LOYALTY_OWNER_LABELS,
  MEMBERSHIP_PLAN_KIND_LABELS,
  REFERRAL_REWARD_KIND_LABELS,
  RUTA_FIDELIZACION,
} from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Programa de fidelización · Supply 2.0' }

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · FICHA DE UN PROGRAMA (§41).
 *
 * Todo lo del programa en una página: su ciclo de vida, sus planes con lo que
 * incluyen, sus recompensas, los referidos, el presupuesto, los puntos y la
 * bitácora completa. El presupuesto y los costos solo se enseñan a quien tiene
 * el permiso financiero: ver un programa no es ver lo que cuesta.
 *
 * La estimación del costo de los puntos pendientes va SIEMPRE con su
 * advertencia: no es dinero que ya se deba.
 */
export default async function ProgramaPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const [p, puedeCrear, puedeAprobar, puedePlanes, puedeOtorgar, puedeAjustar, puedeRecompensas, puedeReferidos, puedeFinanzas] = await Promise.all([
    fichaDePrograma(id),
    puedeSupplyV2('SUPPLY_V2_LOYALTY_PROGRAM_CREATE'),
    puedeSupplyV2('SUPPLY_V2_LOYALTY_PROGRAM_APPROVE'),
    puedeSupplyV2('SUPPLY_V2_MEMBERSHIP_MANAGE'),
    puedeSupplyV2('SUPPLY_V2_MEMBERSHIP_GRANT'),
    puedeSupplyV2('SUPPLY_V2_POINTS_ADJUST'),
    puedeSupplyV2('SUPPLY_V2_REWARD_APPROVE'),
    puedeSupplyV2('SUPPLY_V2_REFERRAL_MANAGE'),
    puedeSupplyV2('SUPPLY_V2_LOYALTY_FINANCE_VIEW'),
  ])
  if (!p) notFound()
  const [beneficios, opciones] = await Promise.all([listarBeneficios(), opcionesDeBeneficio()])
  const asignables = beneficios
    .filter((b) => b.status === 'ACTIVE' || b.status === 'DRAFT')
    .map((b) => ({ id: b.id, nombre: `${b.code} · ${b.name}` }))
  const abierto = p.estado !== 'CANCELLED' && p.estado !== 'COMPLETED'
  const planesVivos = p.planes.filter((pl) => pl.estado !== 'ARCHIVED').map((pl) => ({ id: pl.id, nombre: `${pl.nombre} (${pl.precio})` }))

  return (
    <div className="space-y-6">
      <PageHeader
        title={p.nombre}
        description={`${p.code} · ${LOYALTY_OWNER_LABELS[p.propietario === 'Membego' ? 'MEMBEGO' : 'SUPPLIER']}${p.propietario !== 'Membego' ? ` · ${p.propietario}` : ''}`}
        eyebrow={<Link href={RUTA_FIDELIZACION} className="hover:underline">Fidelización</Link>}
        nav={<NavSupplyV2 activa="fidelizacion" />}
        action={<ChipPrograma estado={p.estado} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Qué movió el programa</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-caption text-muted-foreground">Puntos emitidos</dt>
                <dd className="text-h2 tabular-nums" data-testid="programa-puntos-emitidos">{p.puntos.emitidos.toLocaleString('es-DO')}</dd>
              </div>
              <div>
                <dt className="text-caption text-muted-foreground">Sin canjear</dt>
                <dd className="text-h2 tabular-nums" data-testid="programa-puntos-disponibles">{p.puntos.disponibles.toLocaleString('es-DO')}</dd>
                <p className="text-caption text-muted-foreground">{p.puntos.pendientes.toLocaleString('es-DO')} todavía en espera</p>
              </div>
              <div>
                <dt className="text-caption text-muted-foreground">Canjeados · vencidos</dt>
                <dd className="text-h2 tabular-nums">{p.puntos.usados.toLocaleString('es-DO')} · {p.puntos.vencidos.toLocaleString('es-DO')}</dd>
              </div>
            </dl>
            {puedeFinanzas && (
              <dl className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
                <div>
                  <dt className="text-caption text-muted-foreground">Costo ya realizado</dt>
                  <dd className="text-h3 tabular-nums" data-testid="programa-costo-efectivo">{p.puntos.costoEfectivo}</dd>
                  <p className="text-caption text-muted-foreground">Lo que de verdad se entregó.</p>
                </div>
                <div>
                  <dt className="text-caption text-warning">Costo potencial (estimación)</dt>
                  <dd className="text-h3 tabular-nums text-warning" data-testid="programa-costo-estimado">{p.puntos.costoPotencialEstimado}</dd>
                  <p className="text-caption text-warning" data-testid="programa-estimacion-aviso">
                    Es una ESTIMACIÓN de lo que costarían los puntos sin canjear, al valor medio de lo ya entregado. No es dinero que se deba.
                  </p>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Ficha</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-sm" data-testid="programa-ficha">
              <Fila k="Incluye" v={p.modalidades.map((m) => LOYALTY_MODALITY_LABELS[m]).join(' · ')} />
              <Fila k="Vigencia" v={`${formatDate(new Date(p.vigencia.desde))}${p.vigencia.hasta ? ` → ${formatDate(new Date(p.vigencia.hasta))}` : ' → sin fin'}`} />
              <Fila k="Regla de puntos" v={p.reglaDePuntos ?? 'Sin puntos'} />
              <Fila k="Los puntos vencen" v={p.vencimientoDePuntos} />
              {puedeFinanzas && <Fila k="Presupuesto aprobado" v={p.presupuesto.aprobado ?? 'Sin tope'} />}
              {puedeFinanzas && <Fila k="Comprometido" v={p.presupuesto.comprometido} />}
              {puedeFinanzas && <Fila k="Disponible" v={p.presupuesto.disponible ?? 'Sin tope'} />}
            </dl>
            {p.presupuesto.sinTopeAutorizado && (
              <p className="mt-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-caption text-warning" data-testid="programa-sin-tope">
                Autorizado sin presupuesto máximo: «{p.presupuesto.sinTopeAutorizado.motivo}»
                {p.presupuesto.sinTopeAutorizado.cuando ? ` · ${formatDate(new Date(p.presupuesto.sinTopeAutorizado.cuando))}` : ''}
              </p>
            )}
            <div className="mt-4">
              <AccionesPrograma programId={p.id} estado={p.estado} puedeCrear={puedeCrear} puedeAprobar={puedeAprobar} />
            </div>
          </CardContent>
        </Card>
      </div>

      {p.modalidades.includes('MEMBERSHIPS') && (
        <Card>
          <CardHeader><CardTitle>Planes de membresía ({p.planes.length})</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {puedePlanes && abierto && <FormPlan programId={p.id} moneda="DOP" />}
            {p.planes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ningún plan todavía. Sin planes publicados no hay nada que contratar.</p>
            ) : (
              <ul className="divide-y divide-border" data-testid="planes-programa">
                {p.planes.map((pl) => (
                  <li key={pl.id} className="space-y-2 py-3" data-testid="plan-programa">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium" data-testid="plan-nombre-fila">{pl.nombre}</p>
                        <p className="text-caption text-muted-foreground">
                          {pl.code} · {MEMBERSHIP_PLAN_KIND_LABELS[pl.tipo]} · <span data-testid="plan-precio-fila">{pl.precio}</span> · {pl.dias} días · versión {pl.version} · {pl.miembros} miembro(s)
                        </p>
                      </div>
                      <div className="flex flex-col items-start gap-2">
                        <ChipPlan estado={pl.estado} />
                        {puedePlanes && abierto && <AccionesPlan programId={p.id} planId={pl.id} estado={pl.estado} />}
                        {puedePlanes && abierto && pl.estado !== 'ARCHIVED' && (
                          <FormBeneficioDePlan programId={p.id} planId={pl.id} beneficios={asignables} />
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {p.modalidades.includes('REWARDS') && (
        <Card>
          <CardHeader><CardTitle>Recompensas ({p.recompensas.length})</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {puedeRecompensas && abierto && (
              <FormRecompensa programId={p.id} beneficios={asignables} ofertas={opciones.ofertas.map((o) => ({ id: o.id, titulo: o.title }))} moneda="DOP" />
            )}
            {p.recompensas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ninguna recompensa todavía: los puntos no se podrían canjear por nada.</p>
            ) : (
              <ul className="divide-y divide-border" data-testid="recompensas-programa">
                {p.recompensas.map((r) => (
                  <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between" data-testid="recompensa-programa">
                    <div>
                      <p className="font-medium" data-testid="recompensa-nombre-fila">{r.nombre}</p>
                      <p className="text-caption text-muted-foreground">
                        {r.code} · <span data-testid="recompensa-puntos-fila">{r.puntosNecesarios} puntos</span> · {r.reclamadas} canje(s){r.tope ? ` de ${r.tope}` : ''}
                        {puedeFinanzas && r.costoPorEntrega ? ` · costo ${r.costoPorEntrega}` : ''}
                        {puedeFinanzas && r.presupuesto ? ` · presupuesto ${r.presupuesto}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-2">
                      <ChipRecompensa estado={r.estado} />
                      {puedeRecompensas && abierto && <AccionesRecompensa programId={p.id} rewardId={r.id} estado={r.estado} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {p.modalidades.includes('REFERRALS') && (
        <Card>
          <CardHeader><CardTitle>Referidos</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {p.referidos ? (
              <dl className="grid gap-2 text-sm sm:grid-cols-2" data-testid="referidos-config">
                <Fila k="Premio para quien invita" v={`${REFERRAL_REWARD_KIND_LABELS[p.referidos.rewardKind]}${p.referidos.rewardPoints ? `: ${p.referidos.rewardPoints} puntos` : ''}`} />
                <Fila k="Días de espera" v={String(p.referidos.waitingPeriodDays)} />
                <Fila k="Tope por persona" v={p.referidos.maxPerReferrer ? String(p.referidos.maxPerReferrer) : 'sin tope'} />
                <Fila k="Tope total" v={p.referidos.maxTotal ? String(p.referidos.maxTotal) : 'sin tope'} />
                <Fila k="Estado" v={p.referidos.active ? 'Activo' : 'Inactivo'} />
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Los referidos no están configurados todavía: nadie puede pedir su código.</p>
            )}
            {puedeReferidos && abierto && <FormReferidos programId={p.id} beneficios={asignables} configurado={Boolean(p.referidos)} />}
            <p className="text-caption text-muted-foreground">
              El premio se paga con la PRIMERA compra válida del invitado, no por abrir el enlace. Un autorreferido se rechaza, y nadie entra por dos invitaciones.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {puedeOtorgar && abierto && planesVivos.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Otorgar una membresía sin cobrarla</CardTitle></CardHeader>
            <CardContent>
              <FormOtorgarMembresia programId={p.id} planes={planesVivos} />
            </CardContent>
          </Card>
        )}
        {puedeAjustar && abierto && p.modalidades.includes('POINTS') && (
          <Card>
            <CardHeader><CardTitle>Ajustar puntos a mano</CardTitle></CardHeader>
            <CardContent>
              <FormAjustarPuntos programId={p.id} />
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle>Historial ({p.bitacora.length})</CardTitle></CardHeader>
        <CardContent>
          {p.bitacora.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos todavía.</p>
          ) : (
            <ul className="divide-y divide-border text-sm" data-testid="historial-programa">
              {p.bitacora.map((e, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span className="font-medium">{LOYALTY_EVENT_LABELS[e.tipo]}</span>
                  <span className="text-caption text-muted-foreground">{e.quien} · {formatDate(new Date(e.cuando))}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-caption text-muted-foreground">El historial no se borra nunca: con él se reconstruye qué pasó y quién lo hizo.</p>
        </CardContent>
      </Card>
    </div>
  )
}

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-caption text-muted-foreground">{k}</dt>
      <dd className="text-right tabular-nums">{v}</dd>
    </div>
  )
}
