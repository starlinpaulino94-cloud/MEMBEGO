import { BookOpen } from 'lucide-react'
import { TarjetaSeccion } from '../resumen/superficie'

const DEFINICIONES: { termino: string; texto: string }[] = [
  { termino: 'GMV', texto: 'Valor vendido al cliente (lo que pagó).' },
  { termino: 'Ingreso', texto: 'Ingreso reconocido por Membego. En compra anticipada coincide con el GMV; a comisión es SOLO la comisión (cliente paga 1 000 al 10 % → ingreso 100, neto del proveedor 900).' },
  { termino: 'Costo', texto: 'Costo real del lote de cada unidad vendida, congelado en el derecho. Nunca el precio público.' },
  { termino: 'Margen bruto', texto: 'Ingreso − costo. Se reconoce al vender; redimir, reversar o vencer no lo cambian.' },
  { termino: 'Breakage', texto: 'Derechos vendidos que vencieron sin redimirse. El ingreso se conserva y el costo no se duplica.' },
  { termino: 'Supply vencido sin vender', texto: 'Unidades compradas que caducaron sin venderse: pérdida a costo histórico real.' },
  { termino: 'Descuento del proveedor', texto: 'Lo que el proveedor rebaja de su propio precio. Baja el GMV contractual y la base de la comisión; no sale de ningún presupuesto de Membego.' },
  { termino: 'Subsidio de Membego', texto: 'Lo que Membego financia con un bono: costo promocional. El proveedor cobra su importe contractual completo igual.' },
  { termino: 'Contribución tras el subsidio', texto: 'Margen bruto − subsidio. Puede ser negativa: una venta de 1 000 con bono de 500 y comisión de 80 deja −420. Se enseña tal cual.' },
  { termino: 'Cobrado a clientes', texto: 'Dinero que de verdad entró. Con cobertura total es cero y no hay pago bancario que buscar.' },
]

export function Definiciones() {
  return (
    <TarjetaSeccion icono={BookOpen} titulo="Definiciones" data-testid="definiciones-economia">
      <dl className="grid grid-cols-1 gap-3 p-4 @xl:grid-cols-2 @5xl:grid-cols-4">
        {DEFINICIONES.map((d) => (
          <div key={d.termino} className="flex flex-col gap-1 rounded-[8px] border border-sv2-border bg-sv2-well p-3">
            <dt className="text-[13px] font-semibold leading-4 text-sv2-primary">{d.termino}</dt>
            <dd className="text-[13px] leading-[18px] text-sv2-ink-variant">{d.texto}</dd>
          </div>
        ))}
      </dl>
    </TarjetaSeccion>
  )
}
