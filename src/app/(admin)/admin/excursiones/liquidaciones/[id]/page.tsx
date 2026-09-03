import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  ArrowLeftRight,
  Percent,
  Users,
  TrendingUp,
  Award,
  Gift,
  Scale,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { liquidacionDetalle } from '@/modules/excursiones/liquidaciones/queries'
import {
  ESTADO_LIQUIDACION_LABEL,
  TONO_LIQUIDACION,
  type EstadoLiquidacion,
} from '@/modules/excursiones/liquidaciones/nucleo'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { LiquidacionAcciones } from '@/components/excursiones/LiquidacionAcciones'
import { StatusChip } from '@/components/ui/status-chip'
import { formatDate, formatDateTime, formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Liquidación' }

const TIPO_REMUNERACION_INFO: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'neutral' | 'info' | 'danger' }
> = {
  PORCENTAJE: { label: '% Porcentaje', tone: 'info' },
  FIJO_ADULTO: { label: 'Fijo Adulto', tone: 'success' },
  FIJO_NINO: { label: 'Fijo Niño', tone: 'success' },
  FIJO_VENTA: { label: 'Fijo Venta', tone: 'neutral' },
  FIJO_PASAJERO: { label: 'Fijo Pasajero', tone: 'neutral' },
  ESCALON: { label: 'Escalón Volumen', tone: 'info' },
  PAQUETE_REGALO: { label: '🎁 Paquete Regalo', tone: 'warning' },
}

export default async function LiquidacionDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las liquidaciones de excursiones" />

  const { id } = await params
  const detalle = await liquidacionDetalle(companyId, id)
  if (!detalle) notFound()
  const {
    liquidacion,
    vendedor,
    lineas,
    bonos,
    resumenRemuneracion,
    comisionesConConversion,
    tasasUsadas,
  } = detalle

  const moneda = liquidacion.moneda
  const estado = liquidacion.estado as EstadoLiquidacion
  const dinero = (n: number | string) => formatMoney(n, { moneda }, 2)

  const totalFijos =
    resumenRemuneracion.fijoAdulto.total +
    resumenRemuneracion.fijoNino.total +
    resumenRemuneracion.fijoVenta.total +
    resumenRemuneracion.fijoPasajero.total

  const cantFijos =
    resumenRemuneracion.fijoAdulto.cantidad +
    resumenRemuneracion.fijoNino.cantidad +
    resumenRemuneracion.fijoVenta.cantidad +
    resumenRemuneracion.fijoPasajero.cantidad

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* ── ENCABEZADO ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/admin/excursiones/liquidaciones"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Liquidaciones
          </Link>
          <h2 className="mt-1 font-mono text-h2 text-foreground">{liquidacion.numero}</h2>
          <p className="text-sm text-muted-foreground">
            {vendedor ? (
              <Link
                href={`/admin/excursiones/vendedores/${vendedor.id}`}
                className="hover:text-primary hover:underline"
              >
                {vendedor.nombre} <span className="font-mono text-caption">{vendedor.codigo}</span>
              </Link>
            ) : (
              'Vendedor'
            )}{' '}
            · {formatDate(liquidacion.periodoDesde)} → {formatDate(liquidacion.periodoHasta)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-h2 text-foreground font-mono font-bold">{dinero(String(liquidacion.total))}</p>
          <StatusChip tone={TONO_LIQUIDACION[estado] ?? 'neutral'}>
            {ESTADO_LIQUIDACION_LABEL[estado] ?? liquidacion.estado}
          </StatusChip>
        </div>
      </div>

      {/* ── ACCIONES Y MODAL DE PAGO ── */}
      <LiquidacionAcciones
        liquidacionId={liquidacion.id}
        estado={estado}
        numero={liquidacion.numero}
        total={Number(liquidacion.total)}
        moneda={moneda}
        vendedor={vendedor?.nombre ?? 'Vendedor'}
      />

      {/* ── COMPROBANTE DE PAGO SI ESTÁ PAGADA ── */}
      {liquidacion.pagadaAt ? (
        <section className="rounded-2xl border border-success/25 bg-success/5 p-4 text-sm">
          <p className="font-semibold text-foreground">
            Pagada el {formatDateTime(liquidacion.pagadaAt)}
          </p>
          <p className="text-muted-foreground">
            {liquidacion.metodo ?? 'Método no registrado'}
            {liquidacion.referencia ? ` · Ref. ${liquidacion.referencia}` : ''}
          </p>
        </section>
      ) : null}

      {/* ── AVISO DE MULTI-MONEDA SI APLICA ── */}
      {comisionesConConversion > 0 && (
        <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-xs space-y-2">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-primary shrink-0" />
            <p className="font-semibold text-foreground text-sm">
              Liquidación Multi-Moneda con Conversión Previa
            </p>
          </div>
          <p className="text-muted-foreground">
            Esta liquidación en <strong className="text-foreground font-semibold">{moneda}</strong> incluye{' '}
            <strong className="text-foreground font-semibold">{comisionesConConversion}</strong> comisi
            {comisionesConConversion === 1 ? 'ón' : 'ones'} que requirieron conversión de divisa utilizando
            las tasas predeterminadas configuradas en la empresa:
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {tasasUsadas.map((t) => (
              <span key={t} className="font-mono bg-background border border-border px-2 py-0.5 rounded-lg text-foreground font-medium">
                {t}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ── PANEL DE RESUMEN POR TIPOS DE REMUNERACIÓN ── */}
      <section className="space-y-3">
        <h3 className="text-caption uppercase tracking-wider font-semibold text-muted-foreground">
          Composición de la Remuneración
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {/* Tarjeta Porcentaje */}
          <div className="rounded-xl border border-border bg-card p-3.5 space-y-1">
            <span className="text-caption text-muted-foreground flex items-center gap-1">
              <Percent className="h-3.5 w-3.5 text-primary" /> % Porcentajes
            </span>
            <p className="font-mono font-bold text-foreground text-base">
              {dinero(resumenRemuneracion.porcentaje.total)}
            </p>
            <p className="text-caption text-muted-foreground">
              {resumenRemuneracion.porcentaje.cantidad} comisi{resumenRemuneracion.porcentaje.cantidad === 1 ? 'ón' : 'ones'}
            </p>
          </div>

          {/* Tarjeta Fijos */}
          <div className="rounded-xl border border-border bg-card p-3.5 space-y-1">
            <span className="text-caption text-muted-foreground flex items-center gap-1">
              <Users className="h-3.5 w-3.5 text-primary" /> Tarifas Fijas
            </span>
            <p className="font-mono font-bold text-foreground text-base">
              {dinero(totalFijos)}
            </p>
            <p className="text-caption text-muted-foreground">
              {cantFijos} comisi{cantFijos === 1 ? 'ón' : 'ones'} (adultos/niños/ventas)
            </p>
          </div>

          {/* Tarjeta Escalones */}
          <div className="rounded-xl border border-border bg-card p-3.5 space-y-1">
            <span className="text-caption text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5 text-primary" /> Escalón Volumen
            </span>
            <p className="font-mono font-bold text-foreground text-base">
              {dinero(resumenRemuneracion.escalon.total)}
            </p>
            <p className="text-caption text-muted-foreground">
              {resumenRemuneracion.escalon.cantidad} por tramos grupales
            </p>
          </div>

          {/* Tarjeta Bonos por Metas */}
          {bonos.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-3.5 space-y-1">
              <span className="text-caption text-muted-foreground flex items-center gap-1">
                <Award className="h-3.5 w-3.5 text-primary" /> Bonos por Metas
              </span>
              <p className="font-mono font-bold text-foreground text-base">
                {dinero(resumenRemuneracion.bonosMetas.total)}
              </p>
              <p className="text-caption text-muted-foreground">
                {bonos.length} meta{bonos.length === 1 ? '' : 's'} cumplida{bonos.length === 1 ? '' : 's'}
              </p>
            </div>
          )}

          {/* Tarjeta Ajustes Netos */}
          {(resumenRemuneracion.ajustesPositivos.cantidad > 0 ||
            resumenRemuneracion.ajustesNegativos.cantidad > 0) && (
            <div className="rounded-xl border border-border bg-card p-3.5 space-y-1">
              <span className="text-caption text-muted-foreground flex items-center gap-1">
                <Scale className="h-3.5 w-3.5 text-muted-foreground" /> Ajustes (+/−)
              </span>
              <p className="font-mono font-bold text-foreground text-base">
                +{dinero(resumenRemuneracion.ajustesPositivos.total)} / −{dinero(resumenRemuneracion.ajustesNegativos.total)}
              </p>
              <p className="text-caption text-muted-foreground">
                {resumenRemuneracion.ajustesPositivos.cantidad + resumenRemuneracion.ajustesNegativos.cantidad} ajustes contables
              </p>
            </div>
          )}

          {/* Tarjeta Premios en Especie Ganados */}
          {resumenRemuneracion.premiosEspecie.cantidad > 0 && (
            <div className="rounded-xl border border-border bg-muted/40 p-3.5 space-y-1">
              <span className="text-caption text-foreground flex items-center gap-1 font-semibold">
                <Gift className="h-3.5 w-3.5 text-primary" /> Premios en Especie
              </span>
              <p className="font-mono font-bold text-foreground text-base">
                {resumenRemuneracion.premiosEspecie.cantidad} Voucher{resumenRemuneracion.premiosEspecie.cantidad === 1 ? '' : 's'}
              </p>
              <p className="text-caption text-muted-foreground">
                Excursiones de regalo (No dinerario)
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── PREMIOS EN ESPECIE OTORGADOS (SI EXISTEN) ── */}
      {resumenRemuneracion.premiosEspecie.descripciones.length > 0 && (
        <section className="rounded-2xl border border-border bg-muted/30 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Gift className="h-4 w-4 text-primary shrink-0" />
            <h3 className="font-semibold text-foreground text-sm">
              Paquetes de Regalo en Especie Otorgados
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Estos paquetes fueron ganados por el vendedor según las reglas de fidelización comercial.
            Se entregan como boleto de cortesía/voucher y <strong>no se suman a la transferencia en dinero</strong>:
          </p>
          <ul className="space-y-1 pt-1">
            {resumenRemuneracion.premiosEspecie.descripciones.map((desc, idx) => (
              <li key={idx} className="text-xs font-medium text-foreground bg-background border border-border p-2 rounded-lg">
                🎁 {desc}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── BONIFICACIONES POR METAS (SI EXISTEN) ── */}
      {bonos.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-primary shrink-0" />
              <h2 className="text-h3 text-foreground font-semibold">Bonos por Metas Cumplidas</h2>
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {bonos.length} bono{bonos.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Descripción / Meta</th>
                  <th className="py-2 pr-3">Fecha Otorgado</th>
                  <th className="py-2 pr-3 text-right">Monto</th>
                  <th className="py-2 text-center">Estado</th>
                </tr>
              </thead>
              <tbody>
                {bonos.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 text-foreground font-medium">{b.descripcion}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{formatDate(b.createdAt)}</td>
                    <td className="py-2 pr-3 text-right font-mono font-bold text-foreground">
                      {dinero(b.monto)}
                    </td>
                    <td className="py-2 text-center">
                      <StatusChip tone={b.estado === 'PAGADO' ? 'success' : 'warning'}>
                        {b.estado === 'PAGADO' ? 'Pagado' : 'Por liquidar'}
                      </StatusChip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── COMISIONES POR VENTA INCLUIDAS ── */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-h3 text-foreground font-semibold">Comisiones de Ventas Incluidas</h2>
          <span className="font-mono text-xs text-muted-foreground">
            {lineas.length} comisi{lineas.length === 1 ? 'ón' : 'ones'}
          </span>
        </div>
        <p className="text-caption text-muted-foreground">
          Detalle línea por línea del lote liquidado con su respectivo tipo de remuneración comercial.
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">Venta</th>
                <th className="py-2 pr-3">Tipo</th>
                <th className="py-2 pr-3">Cálculo & Desglose</th>
                <th className="py-2 pr-3">Fecha</th>
                <th className="py-2 text-right">Neto a Liquidar</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l) => {
                const info = TIPO_REMUNERACION_INFO[l.tipoCalculo] ?? {
                  label: l.tipoCalculo,
                  tone: 'neutral' as const,
                }
                const esEspecie = l.tipoCalculo === 'PAQUETE_REGALO'

                return (
                  <tr key={l.id} className="border-b border-border last:border-0 align-top hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 pr-3 font-mono font-semibold text-foreground">{l.venta}</td>
                    <td className="py-2.5 pr-3">
                      <StatusChip tone={info.tone}>{info.label}</StatusChip>
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground max-w-sm">
                      <p className="text-sm text-foreground">{l.desglose}</p>
                      {l.ajustes.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 border-t border-border/50 pt-1">
                          {l.ajustes.map((a, i) => (
                            <li key={i} className="text-caption text-muted-foreground">
                              Ajuste {a.monto > 0 ? '+' : ''}
                              {dinero(a.monto)} · {a.motivo}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground whitespace-nowrap">
                      {formatDate(l.createdAt)}
                    </td>
                    <td className="py-2.5 text-right font-medium text-foreground whitespace-nowrap">
                      {esEspecie ? (
                        <span className="font-mono text-xs text-muted-foreground font-semibold">
                          Premio Voucher
                        </span>
                      ) : (
                        <p className="font-mono font-bold">{dinero(l.neto)}</p>
                      )}
                      {l.conversion.esConversion && !esEspecie ? (
                        <div className="mt-1 space-y-0.5 text-right">
                          <span
                            className="inline-flex items-center gap-1 text-xs font-mono font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-lg"
                            title={`Tasa predeterminada aplicada: ${l.conversion.tasaLabel}`}
                          >
                            💱 {l.conversion.tasaLabel}
                          </span>
                          <p className="text-caption text-muted-foreground font-mono">
                            Orig: {formatMoney(l.netoOriginal, { moneda: l.monedaOriginal }, 2)}
                          </p>
                          {!l.conversion.tasaConfigurada && (
                            <span className="block text-xs text-muted-foreground font-semibold">
                              Tasa 1:1 no configurada
                            </span>
                          )}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="pt-4 text-right font-semibold text-foreground text-sm">
                  Total en Efectivo / Transferencia
                </td>
                <td className="pt-4 text-right text-h3 font-mono font-bold text-foreground">
                  {dinero(String(liquidacion.total))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* ── NOTAS DE LA LIQUIDACIÓN ── */}
      {liquidacion.notas ? (
        <p className="whitespace-pre-line rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground border border-border">
          {liquidacion.notas}
        </p>
      ) : null}
    </div>
  )
}
