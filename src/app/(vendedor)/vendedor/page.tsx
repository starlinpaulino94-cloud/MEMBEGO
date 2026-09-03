import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import {
  vendedorDeUsuario,
  miEmbudo,
  misComisiones,
} from '@/modules/excursiones/panel/queries'
import { getExcursionesConfig } from '@/modules/excursiones/config'
import { urlDeEnlace, urlDeQr } from '@/modules/excursiones/vendedores/nucleo'
import { metasDeVendedor, realesDeVendedor } from '@/modules/excursiones/metricas/queries'
import {
  rangoDePeriodo,
  progresoMeta,
  PERIODO_META_LABEL,
  type PeriodoMeta,
} from '@/modules/excursiones/metricas/nucleo'
import { VendedorQrCard } from '@/components/excursiones/VendedorQrCard'
import { MetaProgreso } from '@/components/excursiones/MetaProgreso'
import { formatMoney } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mi QR' }

const ETAPAS = [
  { clave: 'visitas', label: 'Abrieron', detalle: 'tu enlace' },
  { clave: 'registros', label: 'Se registraron', detalle: 'por tu QR' },
  { clave: 'reservas', label: 'Reservaron', detalle: 'una excursión' },
  { clave: 'compras', label: 'Compraron', detalle: 'y pagaron' },
] as const

export default async function VendedorInicioPage() {
  const user = await requireRole(['VENDEDOR'])
  const vendedor = user.metadata.dbUserId
    ? await vendedorDeUsuario(user.metadata.dbUserId)
    : null
  if (!vendedor) redirect('/login')

  const [embudo, comisiones, metas, config] = await Promise.all([
    miEmbudo(vendedor.companyId, vendedor.id),
    misComisiones(vendedor.companyId, vendedor.id),
    metasDeVendedor(vendedor.companyId, vendedor.id),
    getExcursionesConfig(vendedor.companyId),
  ])

  // Su progreso, con la misma cuenta que ve su administrador.
  const ahora = new Date()
  const misMetas = await Promise.all(
    metas.map(async (m) => {
      const rango = rangoDePeriodo(m.periodo as PeriodoMeta, ahora, { desde: m.desde, hasta: m.hasta })
      const reales = await realesDeVendedor(vendedor.companyId, vendedor.id, rango, m.excursionId)
      return {
        id: m.id,
        periodo: m.periodo,
        excursionNombre: m.excursionNombre,
        excursionTipoItem: m.excursionTipoItem,
        lineas: progresoMeta(m, reales),
      }
    })
  )

  return (
    <div className="space-y-6">
      {/* ── SECCIÓN SUPERIOR: BALANCE & MÉTRICAS PRINCIPALES ── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 shadow-sm flex flex-col justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-primary">Comisión por cobrar</span>
            <p className="mt-1 font-mono text-3xl sm:text-4xl font-extrabold text-foreground">
              {formatMoney(comisiones.porCobrar, { moneda: config.monedaDefecto }, 2)}
            </p>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Disponible para tu próxima liquidación de comisiones.
          </p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm flex flex-col justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total ya cobrado</span>
            <p className="mt-1 font-mono text-3xl sm:text-4xl font-bold text-foreground/90">
              {formatMoney(comisiones.cobrado, { moneda: config.monedaDefecto }, 2)}
            </p>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Acumulado histórico pagado por la empresa.
          </p>
        </div>
      </div>

      {/* ── GRID PRINCIPAL RESPONSIVO: QR A LA IZQ / EMBUDO Y METAS A LA DER ── */}
      <div className="grid gap-6 lg:grid-cols-12 items-start">
        {/* Columna Izquierda: Tarjeta QR y Enlaces */}
        <div className="space-y-6 lg:col-span-6">
          {vendedor.slug ? (
            <VendedorQrCard
              codigo={vendedor.codigo}
              enlaceUrl={urlDeEnlace(vendedor.slug)}
              qrUrl={urlDeQr(vendedor.slug)}
              nombre={vendedor.primerNombre}
            />
          ) : null}
        </div>

        {/* Columna Derecha: Embudo de Clientes y Metas */}
        <div className="space-y-6 lg:col-span-6">
          {/* Embudo de Clientes */}
          <section aria-labelledby="embudo-heading" className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm space-y-4">
            <div>
              <h2 id="embudo-heading" className="text-base sm:text-lg font-bold text-foreground">
                Embudo de Clientes & Conversión
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Seguimiento en tiempo real de quienes escanean tu código QR.
              </p>
            </div>

            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {ETAPAS.map((e) => (
                <div key={e.clave} className="rounded-xl border border-border/60 bg-muted/30 p-3 text-center transition-all hover:bg-muted/50">
                  <dd className="font-mono text-2xl sm:text-3xl font-extrabold text-foreground">{embudo[e.clave]}</dd>
                  <dt className="text-xs font-bold text-foreground mt-0.5">{e.label}</dt>
                  <p className="text-xs text-muted-foreground">{e.detalle}</p>
                </div>
              ))}
            </dl>
          </section>

          {/* Metas Activas si existen */}
          {misMetas.length > 0 ? (
            <section aria-labelledby="metas-heading" className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <h2 id="metas-heading" className="text-base font-bold text-foreground">
                  Tus Metas Activas
                </h2>
              </div>
              <div className="space-y-3">
                {misMetas.map((m) => (
                  <div key={m.id} className="rounded-xl border border-border/70 p-3.5 bg-muted/20 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        {PERIODO_META_LABEL[m.periodo as PeriodoMeta] ?? m.periodo}
                      </p>
                      {m.excursionNombre ? (
                        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary truncate max-w-[200px]">
                          {m.excursionTipoItem === 'COMBO' ? '📦 ' : '🎯 '} {m.excursionNombre}
                        </span>
                      ) : null}
                    </div>
                    <div>
                      <MetaProgreso lineas={m.lineas} moneda={config.monedaDefecto} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}
