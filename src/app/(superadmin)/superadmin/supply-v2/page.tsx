import {
  ArrowLeftRight,
  Archive,
  Banknote,
  ChartLine,
  ClipboardCheck,
  Clock,
  Info,
  Package,
  Receipt,
  ReceiptText,
  ShoppingBag,
  Tag,
  TrendingUp,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { formatMoneyRD } from '@/lib/format'
import { MarcoSupplyV2 } from '@/components/supply-v2/marco'
import { AccionesCabeceraSupplyV2 } from '@/components/supply-v2/acciones-cabecera'
import { PanelAbastecimiento } from '@/components/supply-v2/resumen/panel-abastecimiento'
import { TarjetaAlerta } from '@/components/supply-v2/resumen/tarjeta-alerta'
import { CifraPilar, MiniMetrica, TarjetaPilar } from '@/components/supply-v2/resumen/tarjeta-pilar'
import { InventarioActivo } from '@/components/supply-v2/resumen/inventario-activo'
import { OrdenesRecientes } from '@/components/supply-v2/resumen/ordenes-recientes'
import { ActividadReciente } from '@/components/supply-v2/resumen/actividad-reciente'
import { EnlaceSuave } from '@/components/supply-v2/resumen/superficie'
import { ORDEN_POR_RECIBIR } from '@/modules/supply-v2/core/estados'
import { actividadRecienteSupplyV2, resumenSupplyV2, supplyPorProducto } from '@/modules/supply-v2/pool/queries'
import { listarOrdenes } from '@/modules/supply-v2/procurement/queries'
import { resumenFinanzas } from '@/modules/supply-v2/finance/queries'
import { calcularEconomia } from '@/modules/supply-v2/economics/queries'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Membego Supply 2.0' }

const DIA = 86_400_000
const PRODUCTOS_VISIBLES = 3
const ORDENES_VISIBLES = 5

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function plural(n: number, uno: string, varios: string): string {
  return `${n.toLocaleString('es-DO')} ${n === 1 ? uno : varios}`
}

/**
 * MEMBEGO SUPPLY 2.0 · tablero (§24), rediseño Stitch: panel de accesos,
 * centro de atención, los tres pilares (tengo / compro / vendo), inventario,
 * órdenes recientes y actividad. Todo sale de la base; nada está escrito a
 * mano. El filtro rápido (?q=) acota el inventario y las órdenes por SKU,
 * producto, proveedor o número de orden.
 */
export default async function SupplyV2ResumenPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireRole('SUPERADMIN')
  const { q } = await searchParams
  const filtro = (q ?? '').trim().slice(0, 80)
  const ahora = new Date()
  const [resumen, actividad, productos, ordenes, finanzas, economia] = await Promise.all([
    resumenSupplyV2(ahora),
    actividadRecienteSupplyV2(8),
    supplyPorProducto(),
    listarOrdenes(),
    resumenFinanzas(ahora),
    calcularEconomia({ ventana: 'MES' }, ahora),
  ])

  const coincide = (...campos: (string | null)[]) => !filtro || campos.some((c) => c && normalizar(c).includes(normalizar(filtro)))
  const productosFiltrados = productos.filter((p) => coincide(p.producto, p.proveedor, p.sku))
  const ordenesFiltradas = ordenes.filter((o) => coincide(o.number, o.proveedor, o.producto))

  // ── Centro de atención ────────────────────────────────────────────────────
  const ordenPorRecibir = ordenes.find((o) => ORDEN_POR_RECIBIR.includes(o.status))
  const limiteVencimiento = new Date(ahora.getTime() + 7 * DIA)
  const porVencer = productos.filter((p) => p.proximoVencimiento && p.proximoVencimiento <= limiteVencimiento)
  const masAsignado = productos.filter((p) => p.asignadas > 0).sort((a, b) => b.asignadas - a.asignadas)[0]
  const { incidenciasAbiertas, liquidacionesPendientesDeAprobar } = finanzas.comision
  const alertaFinanzas =
    incidenciasAbiertas > 0
      ? { n: incidenciasAbiertas, titulo: 'Incidencias financieras abiertas', descripcion: 'Diferencias entre lo cobrado, lo pagado y lo liquidado que esperan resolución.', accion: 'Resolver incidencias', href: '/superadmin/supply-v2/finanzas/incidencias' }
      : finanzas.facturasPendientes > 0
        ? { n: finanzas.facturasPendientes, titulo: plural(finanzas.facturasPendientes, 'factura por pagar', 'facturas por pagar'), descripcion: `${formatMoneyRD(Number(finanzas.facturasPendientesMonto))} aprobados y pendientes de pago a proveedores.`, accion: 'Ver facturas', href: '/superadmin/supply-v2/finanzas/facturas' }
        : liquidacionesPendientesDeAprobar > 0
          ? { n: liquidacionesPendientesDeAprobar, titulo: plural(liquidacionesPendientesDeAprobar, 'liquidación por aprobar', 'liquidaciones por aprobar'), descripcion: 'Liquidaciones de ventas a comisión que esperan aprobación.', accion: 'Ver finanzas', href: '/superadmin/supply-v2/finanzas' }
          : null

  // ── Pilares ───────────────────────────────────────────────────────────────
  const pctLibre = resumen.unidadesRecibidas > 0 ? Math.round((resumen.unidadesDisponibles / resumen.unidadesRecibidas) * 100) : null
  const propio = economia.prepurchase
  const margenPropio = propio.revenue.greaterThan(0) ? Number(propio.revenue.minus(propio.cost).dividedBy(propio.revenue).times(100).toDecimalPlaces(1)) : null

  return (
    <MarcoSupplyV2
      activa=""
      contadores={{ compras: { valor: resumen.comprasAbiertas }, campanas: { valor: resumen.campanasActivas, tono: 'exito' } }}
      acciones={<AccionesCabeceraSupplyV2 destino="/superadmin/supply-v2" filtro={filtro} />}
    >
      <div className="flex flex-col gap-4">
        <PanelAbastecimiento />

        {/* Centro de atención */}
        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @5xl:grid-cols-4" data-testid="resumen-alertas">
          {resumen.comprasPorRecibir > 0 ? (
            <TarjetaAlerta
              tono="tertiary"
              icono={Package}
              categoria="Por recibir"
              insignia={plural(resumen.comprasPorRecibir, 'orden', 'órdenes')}
              titulo="Recepción en espera"
              descripcion={ordenPorRecibir ? `${ordenPorRecibir.proveedor} (${ordenPorRecibir.number})` : 'Órdenes aprobadas con unidades sin recibir.'}
              accion="Revisar recepción"
              href={ordenPorRecibir ? `/superadmin/supply-v2/compras/${ordenPorRecibir.id}` : '/superadmin/supply-v2/compras'}
              testId="alerta-por-recibir"
            />
          ) : (
            <TarjetaAlerta tono="tertiary" icono={Package} categoria="Por recibir" insignia="Al día" titulo="Sin recepciones pendientes" descripcion="Todas las órdenes aprobadas están recibidas." accion="Ver compras" href="/superadmin/supply-v2/compras" testId="alerta-por-recibir" />
          )}
          {alertaFinanzas ? (
            <TarjetaAlerta tono="error" icono={ReceiptText} categoria="Finanzas" insignia={plural(alertaFinanzas.n, 'pendiente', 'pendientes')} titulo={alertaFinanzas.titulo} descripcion={alertaFinanzas.descripcion} accion={alertaFinanzas.accion} href={alertaFinanzas.href} testId="alerta-finanzas" />
          ) : (
            <TarjetaAlerta tono="error" icono={ReceiptText} categoria="Finanzas" insignia="Al día" titulo="Finanzas al día" descripcion="Sin facturas por pagar, liquidaciones por aprobar ni incidencias abiertas." accion="Ver finanzas" href="/superadmin/supply-v2/finanzas" testId="alerta-finanzas" />
          )}
          <TarjetaAlerta
            tono="tertiary"
            icono={Clock}
            categoria="Vencimiento"
            insignia="≤ 7 días"
            titulo={porVencer.length > 0 ? `${plural(porVencer.length, 'producto', 'productos')} por vencer` : 'Sin vencimientos próximos'}
            descripcion={porVencer.length > 0 ? `${porVencer.map((p) => p.producto).join(', ')}: lotes con unidades disponibles que vencen pronto.` : 'Ningún lote con unidades disponibles vence en los próximos 7 días.'}
            accion="Ver supply"
            href={porVencer.length === 1 ? `/superadmin/supply-v2/supply/${porVencer[0]!.catalogItemId}` : '/superadmin/supply-v2/supply'}
            testId="alerta-vencimiento"
          />
          {masAsignado ? (
            <TarjetaAlerta
              tono="primary"
              icono={TrendingUp}
              categoria="Demanda"
              insignia="Más asignado"
              titulo={masAsignado.producto}
              descripcion={`${plural(masAsignado.asignadas, 'unidad asignada', 'unidades asignadas')} a ofertas · ${plural(masAsignado.disponibles, 'libre', 'libres')}`}
              accion="Ver producto"
              href={`/superadmin/supply-v2/supply/${masAsignado.catalogItemId}`}
              testId="alerta-demanda"
            />
          ) : (
            <TarjetaAlerta tono="primary" icono={TrendingUp} categoria="Demanda" insignia="Sin asignar" titulo="Sin unidades en ofertas" descripcion="Ninguna unidad del supply está comprometida en una oferta." accion="Crear oferta" href="/superadmin/supply-v2/ofertas/nueva" testId="alerta-demanda" />
          )}
        </div>

        {/* Los tres pilares */}
        <div className="grid grid-cols-1 gap-6 @5xl:grid-cols-3">
          <TarjetaPilar icono={ClipboardCheck} iconoSecundario={Info} pilar="Pilar A" pregunta="¿Qué tengo? (Activos)" testId="pilar-activos"
            principal={<CifraPilar etiqueta="Valor Supply disponible" valor={formatMoneyRD(resumen.valorDisponible)} nota="unidades disponibles × costo compra" icono={Banknote} tono="primary" testId="kpi-valor" />}
          >
            <MiniMetrica etiqueta="Unidades disponibles" valor={resumen.unidadesDisponibles.toLocaleString('es-DO')} complemento={`/ ${resumen.unidadesAsignadas.toLocaleString('es-DO')} asignadas`} pie={pctLibre === null ? 'Sin recepciones' : `${pctLibre}% libre`} tonoPie={pctLibre === null ? 'tenue' : 'exito'} testId="kpi-unidades" />
            <MiniMetrica etiqueta="Ofertas activas" valor={resumen.ofertasActivas.toLocaleString('es-DO')} complemento="en catálogo" pie={plural(resumen.proveedoresActivos, 'proveedor', 'proveedores')} testId="kpi-ofertas" />
          </TarjetaPilar>

          <TarjetaPilar icono={ShoppingBag} iconoSecundario={ArrowLeftRight} pilar="Pilar B" pregunta="¿Qué compro? (Procurement)" testId="pilar-compras"
            principal={<CifraPilar etiqueta="Compras abiertas" valor={resumen.comprasAbiertas.toLocaleString('es-DO')} unidad={resumen.comprasAbiertas === 1 ? 'orden' : 'órdenes'} nota="borrador, pendientes o en recepción" icono={Archive} tono="neutral" testId="kpi-compras" />}
          >
            <MiniMetrica etiqueta="Por aprobación" valor={resumen.comprasPorAprobar.toLocaleString('es-DO')} complemento={resumen.comprasPorAprobar === 1 ? 'orden' : 'órdenes'} pie={resumen.comprasPorAprobar > 0 ? 'Requiere aprobación' : 'Al día'} tonoPie={resumen.comprasPorAprobar > 0 ? 'aviso' : 'exito'} />
            <MiniMetrica etiqueta="Recepciones pendientes" valor={resumen.comprasPorRecibir.toLocaleString('es-DO')} complemento={resumen.comprasPorRecibir === 1 ? 'pendiente' : 'pendientes'} pie={`${plural(resumen.comprasRecibidasMes, 'recibida', 'recibidas')} (mes)`} />
          </TarjetaPilar>

          <TarjetaPilar icono={ChartLine} iconoSecundario={Receipt} pilar="Pilar C" pregunta="¿Qué vendo? (Tracción)" testId="pilar-ventas"
            principal={<CifraPilar etiqueta="Ventas confirmadas (mes)" valor={formatMoneyRD(Number(economia.gmv.toFixed(2)))} nota={`${plural(economia.unitsSold, 'unidad vendida', 'unidades vendidas')}`} icono={Tag} tono="secondary" testId="kpi-ventas" />}
          >
            <MiniMetrica etiqueta="Inventario propio" valor={formatMoneyRD(Number(propio.revenue.toFixed(2)))} pie={margenPropio === null ? 'Sin ventas este mes' : `Margen ${margenPropio}%`} tonoPie="tenue" />
            <MiniMetrica etiqueta="Por comisión" valor={formatMoneyRD(Number(economia.commission.revenue.toFixed(2)))} pie="Fee plataforma" tonoPie="tenue" />
          </TarjetaPilar>
        </div>

        {/* Operación: inventario y órdenes a la izquierda, actividad a la derecha */}
        <div className="grid grid-cols-1 gap-6 @5xl:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-4 @5xl:col-span-7">
            <InventarioActivo
              productos={productosFiltrados.slice(0, PRODUCTOS_VISIBLES)}
              total={productos.length}
              coincidencias={productosFiltrados.length}
              filtro={filtro}
              vacio={
                <div className="flex flex-col items-start gap-2 rounded-[8px] bg-sv2-well p-3" data-testid="resumen-vacio">
                  <p className="text-[15px] font-semibold leading-5 text-foreground">Todavía no hay supply</p>
                  <p className="text-[13px] leading-[18px] text-sv2-ink-variant">Registra un proveedor, lo que vende y un acuerdo; compra una cantidad y recíbela. Todo empieza en «Nueva compra».</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <EnlaceSuave href="/superadmin/supply-v2/compras/nueva" className="h-8 px-3 text-[13px] leading-4">Nueva compra</EnlaceSuave>
                    <EnlaceSuave href="/superadmin/supply-v2/proveedores" className="h-8 px-3 text-[13px] leading-4">Agregar primer proveedor</EnlaceSuave>
                  </div>
                </div>
              }
            />
            <OrdenesRecientes ordenes={ordenesFiltradas.slice(0, ORDENES_VISIBLES)} filtro={filtro} />
          </div>
          <div className="min-w-0 @5xl:col-span-5">
            <ActividadReciente actividad={actividad} />
          </div>
        </div>
      </div>
    </MarcoSupplyV2>
  )
}
