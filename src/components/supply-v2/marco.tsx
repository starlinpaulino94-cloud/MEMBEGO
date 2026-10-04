import { cn } from '@/lib/utils'
import { claseFuentesSupplyV2 } from './fuentes'
import { NavSupplyV2, type ContadoresSupplyV2, type SeccionSupplyV2 } from './nav'

/**
 * MEMBEGO SUPPLY 2.0 · marco del rediseño (Stitch).
 *
 * Una banda blanca a todo el ancho con el título del módulo, su estado, las
 * acciones y la navegación agrupada; debajo, el lienzo lavanda donde cada
 * pantalla pinta sus tarjetas. Sale del contenedor del AppShell con márgenes
 * negativos que repiten su padding (16/24/32 px), así que no se desalinea.
 */
export function MarcoSupplyV2({
  activa,
  contadores,
  descripcion = 'Compra, controla, vende y liquida productos y servicios de proveedores.',
  acciones,
  children,
}: {
  activa: SeccionSupplyV2
  contadores?: ContadoresSupplyV2
  descripcion?: string
  acciones?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className={cn(claseFuentesSupplyV2, '@container -mx-4 -mb-8 -mt-8 flex [&_:is(h1,h2,h3)]:font-sv2 min-h-[calc(100dvh-4rem)] flex-col bg-sv2-canvas text-foreground antialiased md:-mx-6 lg:-mx-8')}>
      <header className="bg-card shadow-sm dark:border-b dark:border-border">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-4 pb-3 pt-4 md:px-6">
          <div className="flex flex-col gap-3 @4xl:flex-row @4xl:items-center @4xl:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-foreground">Membego Supply 2.0</h1>
                <span className="flex items-center gap-1.5 rounded-full bg-sv2-secondary-container px-2 py-0.5 text-[12px] font-semibold leading-4 tracking-[0.04em] text-sv2-on-secondary-container">
                  <span aria-hidden className="size-1.5 rounded-full bg-sv2-secondary" />
                  En línea
                </span>
              </div>
              <p className="text-[14px] leading-5 text-sv2-ink-variant">{descripcion}</p>
            </div>
            {acciones && <div className="flex shrink-0 flex-col gap-2 @xl:flex-row @xl:items-center">{acciones}</div>}
          </div>
          <div className="pt-1">
            <NavSupplyV2 activa={activa} contadores={contadores} />
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-4 md:px-6">{children}</div>
    </div>
  )
}
