import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SUPPLY_VENTA_ESTADO_LABELS } from '@/modules/supply/catalogo'
import type { SupplyVentaEstado } from '@prisma/client'

export interface VentaVista {
  id: string
  numero: string
  estado: SupplyVentaEstado
  producto: string
  cantidad: number
  proveedor: string
  sucursal: string | null
  montoBruto: number
  /** Solo se enseña cuando la venta está PAGADA: antes no sirve. */
  codigoEntrega: string | null
  entregadaAt: string | null
}

/**
 * MEMBEGO SUPPLY · las compras sin precompra del cliente, con su código de
 * recogida. El código es un secreto al portador: solo aparece cuando Membego
 * ya confirmó el pago, y deja de servir en cuanto el negocio lo escanea.
 */
export function MisVentas({ ventas }: { ventas: VentaVista[] }) {
  if (ventas.length === 0) return null
  return (
    <section className="space-y-3">
      <h2 className="text-h3 font-semibold">Mis compras</h2>
      {ventas.map((v) => (
        <Card key={v.id}>
          <CardContent className="space-y-2 pt-6">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">
                  {v.producto} × {v.cantidad}
                </p>
                <p className="text-caption text-muted-foreground">
                  {v.proveedor}
                  {v.sucursal ? ` · ${v.sucursal}` : ''} · {v.numero} · RD${v.montoBruto.toLocaleString('es-DO')}
                </p>
              </div>
              <Badge variant={v.estado === 'ENTREGADA' ? 'success' : v.estado === 'PAGADA' ? 'default' : 'outline'}>
                {SUPPLY_VENTA_ESTADO_LABELS[v.estado]}
              </Badge>
            </div>
            {v.estado === 'PAGADA' && v.codigoEntrega && (
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-caption text-muted-foreground">Enseña este código en el negocio para que te lo entreguen:</p>
                <p className="mt-1 break-all font-mono text-sm font-semibold">{v.codigoEntrega}</p>
              </div>
            )}
            {v.estado === 'INICIADA' && (
              <p className="text-caption text-muted-foreground">Cuando Membego confirme tu pago, aquí aparece el código de recogida.</p>
            )}
            {v.entregadaAt && (
              <p className="text-caption text-muted-foreground">
                Entregada el {new Intl.DateTimeFormat('es-DO', { dateStyle: 'long' }).format(new Date(v.entregadaAt))}.
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </section>
  )
}
