import Link from 'next/link'
import { BadgePercent, Package, ShoppingBag, Warehouse } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatMoney } from '@/lib/format'
import { resumenComercioEmpresa } from '@/modules/comercio/dashboard'

/**
 * «Comercio Membego» del Resumen (lo que la empresa vende y le piden hoy). No es de «Hoy · requiere acción» ni de «Este mes»:
 * es un resumen de otro módulo, así que va APARTE y debajo del pliegue, como componente que carga solo (`<Suspense>` en la
 * página): su consulta no frena los bloques de arriba (fase 5, tarea 5.1).
 *
 * Cada tarjeta es un enlace y solo existe si la persona puede abrir su sección (D-07); «Ventas del mes» es dinero y exige
 * `reportes › ver_financieros` (D-01).
 */

const fmt = (n: number) => new Intl.NumberFormat('es-DO').format(n)

export async function ComercioResumen({
  companyId,
  zonaHoraria,
  company,
  ve,
  conFinanzas,
}: {
  companyId: string
  zonaHoraria: string
  company: { moneda: string; idioma: string; zonaHoraria: string }
  ve: (href: string) => boolean
  conFinanzas: boolean
}) {
  const comercio = await resumenComercioEmpresa(companyId, zonaHoraria).catch(() => null)
  if (!comercio) return null

  const verPedidos = comercio.modulos.pedidos && ve('/admin/pedidos-membego')
  const verCatalogo = comercio.modulos.catalogo && ve('/admin/catalogo')
  const verInventario = comercio.modulos.catalogo && ve('/admin/inventario')
  const verOfertas = comercio.modulos.ofertas && ve('/admin/deals')
  if (!verPedidos && !verCatalogo && !verInventario && !verOfertas) return null

  // `block h-full`: el enlace va dentro de un <li> (antes era un <dl> con enlaces dentro, que no es una lista de definición válida).
  const tarjeta = 'block h-full rounded-lg border p-3 transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <section aria-labelledby="comercio-membego" className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="comercio-membego" className="flex items-center gap-2 text-h3 text-foreground">
          <ShoppingBag className="size-4 text-primary" aria-hidden /> Comercio Membego
        </h2>
        <span className="text-caption text-muted-foreground">Catálogo → Inventario → Ofertas → Pedidos</span>
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {verPedidos ? (
          <>
            <li><Link href="/admin/pedidos-membego?estado=AWAITING_MERCHANT" className={cn(tarjeta, comercio.pedidosNuevos > 0 ? 'border-primary/40 bg-primary/5' : 'border-border')}>
              <span className="block text-caption">Pedidos nuevos</span>
              <span className="block text-h3 tabular-nums text-foreground">{fmt(comercio.pedidosNuevos)}</span>
              <p className="text-caption text-muted-foreground">{comercio.pedidosNuevos > 0 ? 'Esperan tu respuesta' : 'Nada pendiente'}</p>
            </Link></li>
            <li><Link href="/admin/pedidos-membego" className={cn(tarjeta, 'border-border')}>
              <span className="block text-caption">En curso</span>
              <span className="block text-h3 tabular-nums text-foreground">{fmt(comercio.pedidosEnCurso)}</span>
              <p className="text-caption text-muted-foreground">Aceptados o listos para recoger</p>
            </Link></li>
            {conFinanzas ? (
              <li className="rounded-lg border border-border p-3">
                <span className="block text-caption">Ventas Membego del mes</span>
                <span className="block text-h3 tabular-nums text-foreground">{formatMoney(Number(comercio.ventasMes), company)}</span>
                <p className="text-caption text-muted-foreground">{fmt(comercio.pedidosCompletadosMes)} pedidos completados</p>
              </li>
            ) : null}
          </>
        ) : null}
        {verCatalogo ? (
          <li><Link href="/admin/catalogo" className={cn(tarjeta, 'border-border')}>
            <span className="flex items-center gap-1 text-caption"><Package className="size-3.5" aria-hidden /> Catálogo</span>
            <span className="block text-h3 tabular-nums text-foreground">{fmt(comercio.productosPublicados)}</span>
            <p className="text-caption text-muted-foreground">{comercio.productosTotal === 0 ? 'Crea tu primer producto' : `publicados de ${fmt(comercio.productosTotal)}`}</p>
          </Link></li>
        ) : null}
        {verInventario ? (
          <li><Link href="/admin/inventario?estado=BAJO" className={cn(tarjeta, comercio.stockBajo > 0 ? 'border-warning/50 bg-warning/5' : 'border-border')}>
            <span className="flex items-center gap-1 text-caption"><Warehouse className="size-3.5" aria-hidden /> Stock bajo</span>
            <span className="block text-h3 tabular-nums text-foreground">{fmt(comercio.stockBajo)}</span>
            <p className="text-caption text-muted-foreground">{comercio.stockBajo > 0 ? 'Productos por reponer' : 'Todo con existencias'}</p>
          </Link></li>
        ) : null}
        {verOfertas ? (
          <li><Link href="/admin/deals" className={cn(tarjeta, 'border-border')}>
            <span className="flex items-center gap-1 text-caption"><BadgePercent className="size-3.5" aria-hidden /> Ofertas activas</span>
            <span className="block text-h3 tabular-nums text-foreground">{fmt(comercio.ofertasActivas)}</span>
            <p className="text-caption text-muted-foreground">{fmt(comercio.canjesMes)} canjes este mes</p>
          </Link></li>
        ) : null}
      </ul>
    </section>
  )
}
