import type { SupplyV2PaymentMode, SupplyV2PurchaseOrderStatus } from '@prisma/client'
import { PO_STATUS_LABELS } from '@/modules/supply-v2/core/catalogo'
import { BarraFiltrosSupplyV2, type ChipFiltro } from '../filtros'
import { CONDICION_CORTA } from './condicion'

export interface FiltrosCompras {
  q: string
  proveedor: string
  estado: SupplyV2PurchaseOrderStatus | ''
  pago: SupplyV2PaymentMode | ''
}

const RUTA = '/superadmin/supply-v2/compras'

/** Enlace a Compras con estos filtros (sin los vacíos). */
export function hrefCompras(f: Partial<FiltrosCompras> & { pagina?: number; filas?: number }): string {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.proveedor) p.set('proveedor', f.proveedor)
  if (f.estado) p.set('estado', f.estado)
  if (f.pago) p.set('pago', f.pago)
  if (f.filas && f.filas !== 10) p.set('filas', String(f.filas))
  if (f.pagina && f.pagina > 1) p.set('pagina', String(f.pagina))
  const qs = p.toString()
  return qs ? `${RUTA}?${qs}` : RUTA
}

/** Barra de filtros de Compras: búsqueda, proveedor, estado y forma de pago. */
export function FiltrosComprasBarra({ f, proveedores, total }: { f: FiltrosCompras; proveedores: { id: string; nombre: string }[]; total: number }) {
  const chips: ChipFiltro[] = []
  if (f.q) chips.push({ texto: `Búsqueda: «${f.q}»`, quitar: hrefCompras({ ...f, q: '' }) })
  if (f.proveedor) chips.push({ texto: `Proveedor: ${proveedores.find((p) => p.id === f.proveedor)?.nombre ?? '—'}`, quitar: hrefCompras({ ...f, proveedor: '' }) })
  if (f.estado) chips.push({ texto: `Estado: ${PO_STATUS_LABELS[f.estado]}`, quitar: hrefCompras({ ...f, estado: '' }) })
  if (f.pago) chips.push({ texto: `Pago: ${CONDICION_CORTA[f.pago]}`, quitar: hrefCompras({ ...f, pago: '' }) })
  return (
    <BarraFiltrosSupplyV2
      ruta={RUTA}
      testId="filtros-compras"
      busqueda={{ valor: f.q, etiqueta: 'Buscar órdenes', placeholder: 'Buscar PO (ej. MBG-PO-...), proveedor, producto...', testId: 'buscar-compras' }}
      selectores={[
        { name: 'proveedor', etiqueta: 'Proveedor', valor: f.proveedor, opciones: proveedores.map((p) => ({ valor: p.id, texto: p.nombre })) },
        { name: 'estado', etiqueta: 'Estado', valor: f.estado, opciones: Object.entries(PO_STATUS_LABELS).map(([valor, texto]) => ({ valor, texto })) },
        { name: 'pago', etiqueta: 'Pago', valor: f.pago, opciones: Object.entries(CONDICION_CORTA).map(([valor, texto]) => ({ valor, texto })) },
      ]}
      chips={chips}
      resumen={
        <span className="font-sv2-mono font-normal tracking-normal text-sv2-outline" data-testid="total-compras">
          {total.toLocaleString('es-DO')} {total === 1 ? 'orden de compra registrada' : 'órdenes de compra registradas'}
        </span>
      }
    />
  )
}
