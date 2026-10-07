import Link from 'next/link'
import { Gift, Landmark, ShoppingCart, Tag, UserPlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DialogoFormulario } from '../dialogo'
import { FormProveedor } from '../form-proveedor'
import { claseBotonSuave, MONO, RecuadroIcono, Tarjeta } from './superficie'

/**
 * Panel Central de Abastecimiento: el contexto del módulo y los cuatro accesos
 * rápidos. «Nuevo proveedor» abre el mismo formulario que la pestaña
 * Proveedores, sin salir del Resumen.
 */
export function PanelAbastecimiento() {
  const accion = cn(claseBotonSuave, 'h-8 px-3 text-[13px] font-medium leading-4')
  return (
    <Tarjeta className="flex flex-col gap-3 p-3 @5xl:flex-row @5xl:flex-wrap @5xl:items-center @5xl:justify-between">
      <div className="flex items-center gap-3">
        <RecuadroIcono icono={Landmark} className="size-10 bg-sv2-soft text-sv2-primary" tamanoIcono="size-6" />
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[15px] font-bold leading-5 tracking-[-0.005em] text-foreground">Panel Central de Abastecimiento</span>
            <span className={cn(MONO, 'rounded-[8px] bg-sv2-soft-hover px-1.5 py-0.5 font-medium text-sv2-ink-variant')}>LIVE V2.0</span>
          </div>
          <p className="text-[13px] leading-[18px] text-sv2-ink-variant">Ciclo integral de abastecimiento: compras, stock auditado y colocación comercial.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1 @xl:flex @xl:flex-wrap @xl:items-center">
        <DialogoFormulario
          etiqueta="+ Nuevo proveedor"
          titulo="Nuevo proveedor"
          descripcion="Una empresa que ya está en Membego o un proveedor externo."
          testId="btn-resumen-nuevo-proveedor"
          variant="ghost"
          className={cn(accion, 'h-8 [&_svg]:size-4')}
          icono={<UserPlus aria-hidden className="text-sv2-ink-variant" />}
        >
          <FormProveedor />
        </DialogoFormulario>
        <Link href="/superadmin/supply/ofertas/nueva" className={accion}>
          <Tag aria-hidden className="size-4 text-sv2-ink-variant" />
          <span>+ Crear oferta</span>
        </Link>
        <Link href="/superadmin/supply/beneficios/nuevo" className={accion}>
          <Gift aria-hidden className="size-4 text-sv2-ink-variant" />
          <span>+ Crear beneficio</span>
        </Link>
        <Link
          href="/superadmin/supply/compras/nueva"
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-sv2-accent px-3 text-[13px] font-semibold leading-4 text-white shadow-sm transition-colors hover:bg-sv2-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sv2-accent focus-visible:ring-offset-2"
        >
          <ShoppingCart aria-hidden className="size-4" />
          <span>+ Nueva compra</span>
        </Link>
      </div>
    </Tarjeta>
  )
}
