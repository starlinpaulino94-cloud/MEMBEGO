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
import { BonosLiquidacionTabla, ComisionesLiquidacionTabla } from '@/components/excursiones/LiquidacionLineasTablas'
import { StatusChip } from '@/components/ui/status-chip'
import { formatDate, formatDateTime, formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Liquidación' }

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
          <BonosLiquidacionTabla bonos={bonos} moneda={moneda} />
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

        <div className="mt-3">
          <ComisionesLiquidacionTabla lineas={lineas} moneda={moneda} total={String(liquidacion.total)} />
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
