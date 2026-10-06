import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate, formatDateTime } from '@/lib/format'
import { NavSupplyV2 } from '@/components/supply-v2/nav'
import { ChipCampana, ChipCupon, ChipFinanciacion, ChipTipoCupon } from '@/components/supply-v2/chips'
import { AccionesCampana, CancelarCupon, FormAgregarOferta, FormAsignarCampana, FormCupones, FormPromocion, QuitarOferta } from '@/components/supply-v2/acciones-campana'
import { fichaCampana, ofertasParaCampana } from '@/modules/supply-v2/campaigns/queries'
import { puedeSupplyV2 } from '@/modules/supply-v2/permisos'
import {
  CAMPAIGN_AUDIENCE_LABELS,
  CAMPAIGN_EVENT_LABELS,
  CAMPAIGN_ORGANIZER_LABELS,
  dineroSupplyV2,
  RUTA_CAMPANAS,
  RUTA_OFERTAS_PUBLICAS,
} from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 7 · ficha de una CAMPAÑA (§24, §26).
 *
 * Cinco cosas en una pantalla: qué es y en qué estado está, qué quedó del
 * presupuesto (leído de sus promociones, nunca de un segundo contador), qué
 * movió de verdad, qué ofertas participan con su promoción, y sus cupones con
 * su rastro. Las cifras son de pedidos con la campaña congelada: una venta
 * cuenta una vez.
 */
export default async function CampanaPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('SUPERADMIN')
  const { id } = await params
  const [c, puedeEditar, puedeAprobar, puedePublicar, puedeCupones, puedeAsignar] = await Promise.all([
    fichaCampana(id),
    puedeSupplyV2('SUPPLY_V2_CAMPAIGN_CREATE'),
    puedeSupplyV2('SUPPLY_V2_CAMPAIGN_APPROVE'),
    puedeSupplyV2('SUPPLY_V2_CAMPAIGN_PUBLISH'),
    puedeSupplyV2('SUPPLY_V2_COUPON_MANAGE'),
    puedeSupplyV2('SUPPLY_V2_BENEFIT_ASSIGN'),
  ])
  if (!c) notFound()
  const disponibles = (await ofertasParaCampana(c.supplierId)).filter((o) => !c.ofertas.some((x) => x.offerId === o.id))
  const dinero = (n: string) => dineroSupplyV2(n, c.currency)
  const abierta = c.status !== 'CANCELLED' && c.status !== 'COMPLETED'
  const promociones = c.ofertas.filter((o) => o.benefitId).map((o) => ({ id: o.benefitId!, nombre: `${o.promocion} · ${o.titulo}` }))

  return (
    <div className="space-y-6">
      <PageHeader
        title={c.name}
        description={`${c.code} · ${CAMPAIGN_ORGANIZER_LABELS[c.organizer]}${c.proveedor ? ` · ${c.proveedor}` : ''}`}
        eyebrow={<Link href={RUTA_CAMPANAS} className="hover:underline">Campañas</Link>}
        nav={<NavSupplyV2 activa="campanas" />}
        action={<ChipCampana estado={c.status} />}
      />

      {/* §24 · lo que la campaña movió de verdad. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="campana-metricas">
        <StatCard label="Ventas confirmadas" value={<span data-testid="metrica-ventas">{c.metricas.ventasConfirmadas.toLocaleString('es-DO')}</span>} sub={`${c.metricas.pedidos} pedido(s) atribuido(s)${c.metricas.pedidosEnCurso > 0 ? ` · ${c.metricas.pedidosEnCurso} en curso` : ''}`} />
        <StatCard label="GMV" value={<span data-testid="metrica-gmv">{dinero(c.metricas.gmv)}</span>} sub={`valor contractual ${dinero(c.metricas.valorContractual)}`} />
        <StatCard label="Subsidio de Membego" value={<span data-testid="metrica-subsidio">{dinero(c.metricas.subsidioMembego)}</span>} sub="costo promocional" accent={Number(c.metricas.subsidioMembego) > 0 ? 'warning' : undefined} />
        <StatCard
          label="Contribución tras el subsidio"
          value={<span data-testid="metrica-contribucion">{dinero(c.metricas.contribucionTrasSubsidio)}</span>}
          sub={`comisión ${dinero(c.metricas.comision)} − subsidio ${dinero(c.metricas.subsidioMembego)}`}
          accent={Number(c.metricas.contribucionTrasSubsidio) < 0 ? 'danger' : 'success'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Qué es esta campaña</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ChipFinanciacion funding={c.funding} />
              {c.vigenteAhora && <span className="rounded-full border border-success/30 px-2 py-0.5 text-caption text-success" data-testid="campana-vigente">Vigente ahora mismo</span>}
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2" data-testid="campana-ficha">
              <Dato k="Público" v={CAMPAIGN_AUDIENCE_LABELS[c.audience]} />
              <Dato k="Vigencia" v={`${formatDate(c.startsAt)}${c.endsAt ? ` → ${formatDate(c.endsAt)}` : ' → sin fin'}`} />
              {c.horario && <Dato k="Horario" v={c.horario} />}
              <Dato k="Límites" v={`${c.maxRedemptions ?? 'sin tope'} en total · ${c.maxPerCustomer} por cliente`} />
              <Dato k="Creada por" v={c.creadaPor} />
              <Dato k="Aprobada por" v={c.aprobadaPor ? `${c.aprobadaPor}${c.approvedAt ? ` · ${formatDateTime(c.approvedAt)}` : ''}` : 'Pendiente de aprobación'} />
              <Dato k="Publicada por" v={c.publicadaPor ? `${c.publicadaPor}${c.publishedAt ? ` · ${formatDateTime(c.publishedAt)}` : ''}` : 'Sin publicar'} />
              <Dato k="Moneda" v={c.currency} />
            </dl>
            {c.objective && <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Objetivo: </span>{c.objective}</p>}
            {c.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
            {c.reviewNotes && (
              <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm" data-testid="campana-revision">
                Devuelta a borrador: {c.reviewNotes}
              </p>
            )}
            {c.cancelledAt && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm" data-testid="campana-cancelada">
                Cancelada el {formatDateTime(c.cancelledAt)}. Motivo: {c.cancelledReason ?? '—'}
              </p>
            )}
            {c.completedAt && <p className="text-sm text-muted-foreground">Terminada el {formatDateTime(c.completedAt)}.</p>}
            <AccionesCampana
              campaignId={c.id}
              estado={c.status}
              aprobada={c.approvedAt !== null}
              puedeEditar={puedeEditar}
              puedeAprobar={puedeAprobar}
              puedePublicar={puedePublicar}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Presupuesto de la campaña</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {c.funding === 'SUPPLIER' ? (
              <p className="text-sm text-muted-foreground">La financia el proveedor: no consume presupuesto de Membego.</p>
            ) : (
              <>
                <dl className="space-y-1 text-sm">
                  <Fila k="Aprobado" v={c.presupuesto.aprobado ? dinero(c.presupuesto.aprobado) : 'Sin tope'} testid="presupuesto-aprobado" />
                  <Fila k="Comprometido en promociones" v={dinero(c.presupuesto.comprometido)} testid="presupuesto-comprometido" />
                  <Fila k="Reservado (checkouts en curso)" v={dinero(c.presupuesto.reservado)} testid="presupuesto-reservado" />
                  <Fila k="Consumido (aplicado)" v={dinero(c.presupuesto.consumido)} testid="presupuesto-consumido" />
                  <Fila k="Disponible del techo" v={c.presupuesto.disponible ? dinero(c.presupuesto.disponible) : 'Sin tope'} destacado testid="presupuesto-disponible" />
                </dl>
                <p className="text-caption text-muted-foreground">
                  Lo reservado y lo consumido se leen del libro de sus promociones: aquí no hay un segundo contador que pueda contar dos veces el mismo dinero.
                </p>
                {c.presupuesto.algunBeneficioSinTope && (
                  <p className="text-caption text-warning" data-testid="aviso-promocion-sin-tope">Alguna promoción va sin tope: el techo de la campaña no se puede garantizar.</p>
                )}
                {c.budgetWaiverReason && (
                  <p className="rounded-lg border border-warning/40 bg-warning/5 p-2 text-caption" data-testid="campana-sin-tope-autorizada">
                    Autorizada sin presupuesto máximo{c.autorizadaSinTopePor ? ` por ${c.autorizadaSinTopePor}` : ''}: {c.budgetWaiverReason}
                  </p>
                )}
              </>
            )}
            <dl className="space-y-1 border-t border-border pt-2 text-sm" data-testid="campana-economia">
              <Fila k="Aportación del proveedor" v={dinero(c.metricas.aportacionProveedor)} />
              <Fila k="Cobrado a los clientes" v={dinero(c.metricas.cobradoAlCliente)} />
              <Fila k="Comisión de Membego" v={dinero(c.metricas.comision)} />
              <Fila k="Neto de los proveedores" v={dinero(c.metricas.netoProveedor)} />
              <Fila k="Derechos emitidos" v={String(c.metricas.derechosEmitidos)} />
              <Fila k="Entregados" v={String(c.metricas.derechosRedimidos)} />
              <Fila k="Vencidos sin usar" v={String(c.metricas.derechosVencidos)} />
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Ofertas participantes ({c.ofertas.length})</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {puedeEditar && abierta && <FormAgregarOferta campaignId={c.id} ofertas={disponibles} />}
          {c.ofertas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguna oferta participa todavía. Sin ofertas la campaña no se puede aprobar.</p>
          ) : (
            <ul className="divide-y divide-border" data-testid="ofertas-campana">
              {c.ofertas.map((o) => (
                <li key={o.id} className="space-y-2 py-3" data-testid="oferta-campana">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium">
                        <Link href={`${RUTA_OFERTAS_PUBLICAS}/${o.slug}`} className="underline-offset-4 hover:underline">{o.titulo}</Link>
                        {o.featured && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-caption text-primary">Destacada</span>}
                      </p>
                      <p className="text-caption text-muted-foreground">
                        {o.proveedor} · {o.producto} · {dinero(o.salePrice)} · {o.sourceType === 'COMMISSION' ? 'a comisión' : 'supply adquirido'}
                      </p>
                      {o.promocion ? (
                        <p className="text-caption" data-testid="oferta-promocion">
                          <span className="font-medium">Promoción:</span> {o.promocion} · {o.promocionValor}
                          {o.exigeCupon ? ' · se abre con cupón' : ''}
                          {o.presupuestoPromocion ? ` · presupuesto ${dinero(o.presupuestoPromocion)}, consumido ${dinero(o.consumidoPromocion)}` : ' · sin tope'}
                        </p>
                      ) : (
                        <p className="text-caption text-warning">Sin promoción configurada: esta oferta no rebajaría nada.</p>
                      )}
                    </div>
                    <div className="flex flex-col items-start gap-2">
                      {puedeEditar && abierta && (
                        <FormPromocion campaignId={c.id} offerId={o.offerId} moneda={c.currency} funding={c.funding} presupuestoDisponible={c.presupuesto.disponible ? dinero(c.presupuesto.disponible) : null} actual={o.promocionActual} />
                      )}
                      {puedeEditar && abierta && <QuitarOferta campaignId={c.id} offerId={o.offerId} />}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {puedeCupones && abierta && (
        <Card>
          <CardHeader><CardTitle>Generar cupones</CardTitle></CardHeader>
          <CardContent>
            <FormCupones campaignId={c.id} promociones={promociones} moneda={c.currency} />
          </CardContent>
        </Card>
      )}

      {puedeAsignar && abierta && c.audience === 'SELECTED' && (
        <Card>
          <CardHeader><CardTitle>Asignar la campaña a un cliente</CardTitle></CardHeader>
          <CardContent>
            <FormAsignarCampana campaignId={c.id} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Cupones ({c.cupones.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {c.cupones.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Esta campaña no tiene cupones. Las promociones sin código se aplican solas en su oferta.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="tabla-cupones">
                <thead className="text-left text-caption text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Código</th>
                    <th className="px-4 py-2">Tipo</th>
                    <th className="px-4 py-2">Cliente</th>
                    <th className="px-4 py-2">Promoción</th>
                    <th className="px-4 py-2 text-right">Usos</th>
                    <th className="px-4 py-2 text-right">Compra mínima</th>
                    <th className="px-4 py-2">Vence</th>
                    <th className="px-4 py-2">Estado</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {c.cupones.map((k) => (
                    <tr key={k.id} className="border-t border-border align-top">
                      <td className="px-4 py-2 font-mono font-medium" data-testid="cupon-codigo">{k.code}</td>
                      <td className="px-4 py-2"><ChipTipoCupon kind={k.kind} /></td>
                      <td className="px-4 py-2 text-caption">{k.cliente ?? '—'}</td>
                      <td className="px-4 py-2 text-caption">{k.promocion}</td>
                      <td className="px-4 py-2 text-right tabular-nums" data-testid="cupon-usos">
                        {k.timesRedeemed} / {k.maxRedemptions ?? '∞'}
                        <span className="block text-caption text-muted-foreground">{k.maxPerCustomer} por cliente</span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{k.minPurchase ? dinero(k.minPurchase) : '—'}</td>
                      <td className="px-4 py-2 text-caption">{k.expiresAt ? formatDate(k.expiresAt) : '—'}</td>
                      <td className="px-4 py-2"><ChipCupon estado={k.status} /></td>
                      <td className="px-4 py-2">{puedeCupones && k.status === 'ACTIVE' && <CancelarCupon campaignId={c.id} couponId={k.id} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {c.lotes.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Lotes de cupones</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm" data-testid="lotes-cupones">
              {c.lotes.map((l) => (
                <li key={l.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {l.name}
                    <span className="block text-caption text-muted-foreground">{l.prefix ? `prefijo ${l.prefix} · ` : ''}{formatDateTime(l.createdAt)} · {l.creadoPor}</span>
                  </span>
                  <span className="tabular-nums">{l.generated} de {l.requested} generados</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Historial de la campaña</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="historial-campana">
              <thead className="text-left text-caption text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Cuándo</th>
                  <th className="px-4 py-2">Qué pasó</th>
                  <th className="px-4 py-2">Detalle</th>
                  <th className="px-4 py-2">Quién</th>
                </tr>
              </thead>
              <tbody>
                {c.eventos.map((e) => (
                  <tr key={e.id} className="border-t border-border align-top">
                    <td className="px-4 py-2 text-caption">{formatDateTime(e.createdAt)}</td>
                    <td className="px-4 py-2">{CAMPAIGN_EVENT_LABELS[e.type as keyof typeof CAMPAIGN_EVENT_LABELS] ?? e.type}</td>
                    <td className="px-4 py-2 text-caption text-muted-foreground">{e.detail ?? '—'}</td>
                    <td className="px-4 py-2 text-caption">{e.actor ?? 'Sistema'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  )
}

function Fila({ k, v, destacado = false, testid }: { k: string; v: string; destacado?: boolean; testid?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={`text-right tabular-nums ${destacado ? 'text-h4' : 'font-medium'}`} data-testid={testid}>{v}</dd>
    </div>
  )
}
