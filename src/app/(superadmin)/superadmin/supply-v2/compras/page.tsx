import Link from 'next/link'
import type { SupplyV2PaymentMode, SupplyV2PurchaseOrderStatus } from '@prisma/client'
import { ArrowUp, CircleCheck, Hourglass, PackageOpen, Plus, Stamp } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { MarcoSupplyV2 } from '@/components/supply-v2/marco'
import { AccionesCabeceraSupplyV2 } from '@/components/supply-v2/acciones-cabecera'
import { TarjetaIndicador } from '@/components/supply-v2/indicador'
import { PaginacionSupplyV2 } from '@/components/supply-v2/paginacion'
import { Tarjeta } from '@/components/supply-v2/resumen/superficie'
import { FiltrosComprasBarra, hrefCompras, type FiltrosCompras } from '@/components/supply-v2/compras/filtros-compras'
import { CONDICION_CORTA } from '@/components/supply-v2/compras/condicion'
import { TablaCompras } from '@/components/supply-v2/compras/tabla-compras'
import { PO_STATUS_LABELS } from '@/modules/supply-v2/core/catalogo'
import { buscarOrdenes, proveedoresConOrdenes, resumenCompras } from '@/modules/supply-v2/procurement/queries'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Compras · Supply 2.0' }

const FILAS = [10, 25, 50]

function plural(n: number, uno: string, varios: string): string {
  return `${n.toLocaleString('es-DO')} ${n === 1 ? uno : varios}`
}

/**
 * MEMBEGO SUPPLY 2.0 · Compras, rediseño Stitch (propuesta B): cuatro
 * indicadores, filtros por URL que se aplican en la base y la tabla paginada.
 * Crear, aprobar y recibir siguen en sus pantallas de siempre.
 */
export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; proveedor?: string; estado?: string; pago?: string; pagina?: string; filas?: string }>
}) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const f: FiltrosCompras = {
    q: (sp.q ?? '').trim().slice(0, 80),
    proveedor: sp.proveedor ?? '',
    estado: sp.estado && sp.estado in PO_STATUS_LABELS ? (sp.estado as SupplyV2PurchaseOrderStatus) : '',
    pago: sp.pago && sp.pago in CONDICION_CORTA ? (sp.pago as SupplyV2PaymentMode) : '',
  }
  const filas = FILAS.includes(Number(sp.filas)) ? Number(sp.filas) : 10
  const paginaPedida = Math.max(1, Math.floor(Number(sp.pagina)) || 1)

  const [resumen, proveedores, primera] = await Promise.all([
    resumenCompras(),
    proveedoresConOrdenes(),
    buscarOrdenes({ q: f.q, supplierId: f.proveedor || null, status: f.estado || null, paymentMode: f.pago || null }, { pagina: paginaPedida, filas }),
  ])
  // Una página fuera de rango (p. ej. tras filtrar) cae en la última que existe.
  const ultima = Math.max(1, Math.ceil(primera.total / filas))
  const pagina = Math.min(paginaPedida, ultima)
  const { filas: ordenes, total } =
    pagina === paginaPedida ? primera : await buscarOrdenes({ q: f.q, supplierId: f.proveedor || null, status: f.estado || null, paymentMode: f.pago || null }, { pagina, filas })
  const hayFiltros = Boolean(f.q || f.proveedor || f.estado || f.pago)

  return (
    <MarcoSupplyV2 activa="compras" contadores={{ compras: { valor: resumen.abiertas } }} acciones={<AccionesCabeceraSupplyV2 destino="/superadmin/supply-v2/compras" filtro={f.q} />}>
      <div className="flex flex-col gap-4">
        <Tarjeta className="flex flex-col items-start justify-between gap-3 p-4 @xl:flex-row @xl:items-center">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-[12px] leading-4 tracking-[0.04em]">
              <span className="font-bold uppercase tracking-wider text-sv2-outline">Supply 2.0</span>
              <span aria-hidden className="size-1 rounded-full bg-sv2-outline/50" />
              <span className="font-semibold text-sv2-primary">Adquisiciones y Órdenes</span>
            </div>
            <h2 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-foreground">Compras de Supply</h2>
            <p className="max-w-3xl text-[14px] leading-5 text-sv2-ink-variant">
              Órdenes de compra de Membego a sus proveedores: ciclo de vida desde la emisión, aprobación y recepción física.
            </p>
          </div>
          <Link
            href="/superadmin/supply-v2/compras/nueva"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] bg-sv2-accent px-3 text-[13px] font-semibold leading-4 text-white shadow-sm transition-colors hover:bg-sv2-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sv2-accent focus-visible:ring-offset-2"
            data-testid="btn-nueva-compra-seccion"
          >
            <Plus aria-hidden className="size-[18px]" />
            Nueva compra
          </Link>
        </Tarjeta>

        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @5xl:grid-cols-4" data-testid="indicadores-compras">
          <TarjetaIndicador
            etiqueta="Abiertas"
            icono={Hourglass}
            valor={resumen.abiertas.toLocaleString('es-DO')}
            unidad={resumen.abiertas === 1 ? 'orden activa' : 'órdenes activas'}
            pie={resumen.borradores > 0 ? `${plural(resumen.borradores, 'borrador', 'borradores')} por emitir` : 'Sin pendientes por emitir'}
            tonoPie={resumen.borradores > 0 ? 'aviso' : 'neutral'}
            testId="kpi-abiertas"
          />
          <TarjetaIndicador
            etiqueta="En aprobación"
            icono={Stamp}
            tonoIcono="aviso"
            valor={resumen.porAprobar.toLocaleString('es-DO')}
            unidad={resumen.porAprobar === 1 ? 'solicitud' : 'solicitudes'}
            pie={resumen.porAprobar > 0 ? 'Esperan aprobación' : 'Flujo al día'}
            tonoPie={resumen.porAprobar > 0 ? 'aviso' : 'neutral'}
            testId="kpi-aprobacion"
          />
          <TarjetaIndicador
            etiqueta="Recepción pendiente"
            icono={PackageOpen}
            tonoIcono={resumen.porRecibir > 0 ? 'aviso' : 'neutral'}
            valor={resumen.porRecibir.toLocaleString('es-DO')}
            unidad="por recibir"
            pie={resumen.siguienteRecepcion ? `${plural(resumen.siguienteRecepcion.faltan, 'ud restante', 'uds restantes')} en ${resumen.siguienteRecepcion.number}` : 'Nada pendiente de recibir'}
            tonoPie={resumen.siguienteRecepcion ? 'aviso' : 'neutral'}
            testId="kpi-recepcion"
          />
          <TarjetaIndicador
            etiqueta="Recibidas (mes)"
            icono={CircleCheck}
            tonoIcono={resumen.recibidasMes > 0 ? 'exito' : 'neutral'}
            valor={resumen.recibidasMes.toLocaleString('es-DO')}
            unidad={resumen.recibidasMes === 1 ? 'orden completa' : 'órdenes completas'}
            pie={`${plural(resumen.unidadesRecibidasMes, 'unidad ingresada', 'unidades ingresadas')} al supply`}
            tonoPie={resumen.unidadesRecibidasMes > 0 ? 'exito' : 'neutral'}
            iconoPie={resumen.unidadesRecibidasMes > 0 ? ArrowUp : undefined}
            testId="kpi-recibidas"
          />
        </div>

        <FiltrosComprasBarra f={f} proveedores={proveedores} total={total} />

        {ordenes.length === 0 ? (
          <Tarjeta className="flex flex-col items-start gap-2 p-4" data-testid="compras-vacio">
            <p className="text-[15px] font-semibold leading-5 text-foreground">{hayFiltros ? 'Ninguna orden coincide con los filtros' : 'No hay compras'}</p>
            <p className="text-[13px] leading-[18px] text-sv2-ink-variant">
              {hayFiltros ? 'Prueba con otra búsqueda o limpia los filtros.' : 'La primera compra crea el proveedor, el producto y el acuerdo por el camino si hace falta.'}
            </p>
            <Link href={hayFiltros ? '/superadmin/supply-v2/compras' : '/superadmin/supply-v2/compras/nueva'} className="mt-1 inline-flex h-8 items-center rounded-[8px] bg-sv2-soft px-3 text-[13px] font-semibold leading-4 text-foreground hover:bg-sv2-soft-hover">
              {hayFiltros ? 'Limpiar filtros' : 'Nueva compra'}
            </Link>
          </Tarjeta>
        ) : (
          <TablaCompras
            ordenes={ordenes}
            pie={<PaginacionSupplyV2 pagina={pagina} filas={filas} total={total} sustantivo={total === 1 ? 'orden de compra' : 'órdenes de compra'} href={(p, n) => hrefCompras({ ...f, pagina: p, filas: n })} />}
          />
        )}
      </div>
    </MarcoSupplyV2>
  )
}
