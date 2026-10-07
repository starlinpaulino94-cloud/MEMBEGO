import Link from 'next/link'
import { Gift } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { ChipMembresia } from '@/components/supply-v2/chips'
import { BotonReclamarRecompensa } from '@/components/supply-v2/boton-reclamar-recompensa'
import { FormMiCodigo } from '@/components/supply-v2/form-mi-codigo'
import { misInvitaciones, misMembresias, misPuntos, recompensasParaElCliente } from '@/modules/supply-v2/loyalty/queries'
import { POINTS_MOVEMENT_LABELS, RUTA_MEMBRESIAS_PUBLICAS } from '@/modules/supply-v2/core/catalogo'
import type { SupplyV2PointsMovementType } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mi fidelización' }

/**
 * MEMBEGO SUPPLY · SLICE 8 · lo que el CLIENTE ve de su fidelización (§39).
 *
 * Su membresía, sus puntos, lo que puede canjear y su código para invitar, en
 * una sola página. Nunca presupuesto, nunca costos, nunca comisión: esas
 * claves no salen de la consulta, así que no es que la plantilla las esconda.
 *
 * Cuando una recompensa no se puede pedir, se dice por qué en una frase, y a
 * quien no cumple un requisito no se le informa de cuántos puntos le faltan.
 */
export default async function MiFidelizacionPage() {
  const user = await requireRole('CLIENTE')
  const id = user.metadata.dbUserId
  if (!id) {
    return (
      <div className="space-y-6">
        <PageHeader title="Mi fidelización" description="Tu membresía, tus puntos y tus recompensas." />
        <EmptyState title="Tu cuenta todavía se está preparando" description="Vuelve en un momento." />
      </div>
    )
  }

  const [membresias, puntos, invitaciones] = await Promise.all([misMembresias(id), misPuntos(id), misInvitaciones(id)])
  // Las recompensas se piden por programa: solo las de los programas donde
  // esta persona tiene cuenta de puntos.
  const recompensasPorPrograma = await Promise.all(
    puntos.map(async (p) => ({ programa: p.programa, programaId: p.programaId, recompensas: await recompensasParaElCliente(id, p.programaId) }))
  )
  const vigentes = membresias.filter((m) => m.vigente)
  const totalPuntos = puntos.reduce((t, p) => t + p.disponibles, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mi fidelización"
        description="Tu membresía, tus puntos, lo que puedes canjear y tu código para invitar."
        action={
          <Button asChild variant="outline">
            <Link href={RUTA_MEMBRESIAS_PUBLICAS} data-testid="link-ver-membresias">Ver membresías</Link>
          </Button>
        }
      />

      <p className="text-sm text-muted-foreground" data-testid="fidelizacion-resumen">
        {vigentes.length > 0 ? `${vigentes.length} membresía(s) vigente(s)` : 'Sin membresía activa'} ·{' '}
        <span data-testid="fidelizacion-puntos-total">{totalPuntos.toLocaleString('es-DO')}</span> punto(s) para canjear
      </p>

      {/* ── Membresías ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle>Mis membresías</CardTitle></CardHeader>
        <CardContent>
          {membresias.length === 0 ? (
            <EmptyState
              title="Todavía no tienes ninguna membresía"
              description="Los planes de los negocios de la red están en el escaparate, con lo que incluye cada uno."
              action={<Button asChild><Link href={RUTA_MEMBRESIAS_PUBLICAS}>Ver las membresías</Link></Button>}
            />
          ) : (
            <ul className="space-y-3" data-testid="mis-membresias">
              {membresias.map((m) => (
                <li key={m.id} className="rounded-lg border border-border p-3" data-testid="tarjeta-membresia">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium" data-testid="membresia-plan">{m.plan}</p>
                      <p className="text-caption text-muted-foreground" data-testid="membresia-negocio">{m.negocio} · {m.code}</p>
                    </div>
                    <ChipMembresia estado={m.estado} />
                  </div>
                  <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-caption text-muted-foreground">Desde</dt>
                      <dd>{m.desde ? formatDate(new Date(m.desde)) : '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-caption text-muted-foreground">Hasta</dt>
                      <dd data-testid="membresia-hasta">{m.hasta ? formatDate(new Date(m.hasta)) : '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-caption text-muted-foreground">Te quedan</dt>
                      <dd data-testid="membresia-dias">{m.diasRestantes != null ? `${m.diasRestantes} día(s)` : '—'}</dd>
                    </div>
                  </dl>
                  {m.beneficios.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm" data-testid="membresia-beneficios">
                      {m.beneficios.map((b, i) => (
                        <li key={i} className="flex gap-2">
                          <span aria-hidden="true" className="text-success">✓</span>
                          <span>
                            {b.nombre}
                            {b.usosDisponibles > 0 ? ` · ${b.usosDisponibles} uso(s)` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Puntos ─────────────────────────────────────────────────────── */}
      {puntos.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Mis puntos</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {puntos.map((p) => (
              <div key={p.programaId} className="space-y-2" data-testid="tarjeta-puntos">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium" data-testid="puntos-programa">{p.programa}{p.negocio ? ` · ${p.negocio}` : ''}</p>
                  <p className="text-h2 tabular-nums" data-testid="puntos-disponibles">{p.disponibles.toLocaleString('es-DO')}</p>
                </div>
                <p className="text-caption text-muted-foreground" data-testid="puntos-detalle">
                  {p.pendientes.toLocaleString('es-DO')} en espera · {p.reservados.toLocaleString('es-DO')} reservados · {p.usados.toLocaleString('es-DO')} ya canjeados
                </p>
                {p.proximoVencimiento && (
                  <p className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-caption text-warning" data-testid="puntos-vencimiento">
                    {p.proximoVencimiento.puntos.toLocaleString('es-DO')} punto(s) vencen el {formatDate(new Date(p.proximoVencimiento.fecha))}.
                  </p>
                )}
                {p.historial.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">Ver movimientos</summary>
                    <ul className="mt-2 divide-y divide-border" data-testid="puntos-historial">
                      {p.historial.map((h, i) => (
                        <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-1">
                          <span>{POINTS_MOVEMENT_LABELS[h.tipo as SupplyV2PointsMovementType] ?? h.tipo} · {h.concepto}</span>
                          <span className="tabular-nums text-muted-foreground">{h.puntos > 0 ? `+${h.puntos}` : h.puntos} · {formatDate(new Date(h.fecha))}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Recompensas ────────────────────────────────────────────────── */}
      {recompensasPorPrograma.some((r) => r.recompensas.length > 0) && (
        <Card>
          <CardHeader><CardTitle>Canjea tus puntos</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {recompensasPorPrograma.map((grupo) =>
              grupo.recompensas.length === 0 ? null : (
                <div key={grupo.programaId} className="space-y-3">
                  <p className="text-caption text-muted-foreground">{grupo.programa}</p>
                  <ul className="grid gap-3 sm:grid-cols-2" data-testid="recompensas-cliente">
                    {grupo.recompensas.map((r) => (
                      <li key={r.id} className="rounded-lg border border-border p-3" data-testid="tarjeta-recompensa">
                        <div className="flex items-start gap-2">
                          <Gift aria-hidden="true" className="mt-0.5 size-4 text-primary" />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium" data-testid="recompensa-nombre">{r.nombre}</p>
                            <p className="text-caption text-muted-foreground" data-testid="recompensa-puntos">{r.puntosNecesarios.toLocaleString('es-DO')} puntos</p>
                            {r.descripcion && <p className="mt-1 text-sm text-muted-foreground">{r.descripcion}</p>}
                          </div>
                        </div>
                        <div className="mt-3">
                          <BotonReclamarRecompensa rewardId={r.id} nombre={r.nombre} puntos={r.puntosNecesarios} alcanza={r.alcanza} porQueNo={r.porQueNo} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            )}
            <p className="text-caption text-muted-foreground">
              Al canjear, la recompensa queda en tu cuenta lista para usar. Si lleva algo que hay que recoger, se recoge con su QR como cualquier compra.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Invitaciones ───────────────────────────────────────────────── */}
      {invitaciones.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Invita y gana</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {invitaciones.map((inv) => (
              <div key={inv.programaId} className="space-y-2" data-testid="tarjeta-invitacion">
                <p className="font-medium" data-testid="invitacion-programa">{inv.programa}{inv.negocio ? ` · ${inv.negocio}` : ''}</p>
                <p className="text-sm text-muted-foreground" data-testid="invitacion-premio">
                  Ganas {inv.premio}. {inv.condicion}
                  {inv.espera > 0 ? ` El premio se paga ${inv.espera} día(s) después, si no cancela.` : ''}
                </p>
                <FormMiCodigo programId={inv.programaId} codigo={inv.codigo} />
                {inv.estadisticas && (
                  <p className="text-caption text-muted-foreground" data-testid="invitacion-estadisticas">
                    {inv.estadisticas.registros} registrado(s) · {inv.estadisticas.validos} con derecho · {inv.estadisticas.recompensados} premiado(s)
                  </p>
                )}
              </div>
            ))}
            <p className="text-caption text-muted-foreground">
              Cobras cuando quien use tu código haga su primera compra válida, no por compartir el enlace. No puedes usar tu propio código.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
