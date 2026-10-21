import { cn } from '../cn'
import { EstadoChip } from './estado-chip'

/** El mínimo de contraste de texto (WCAG 2.2 AA). */
export const CONTRASTE_AA = 4.5

/**
 * Un color de la paleta cerrada con lo que ya se calculó de él: qué tinta (clara u oscura) se lee encima y con qué
 * contraste. Lo arma la página con `src/lib/company-branding.ts` (`PALETA_MARCA_EMPRESA`, `contrasteDeMarca`): este paquete
 * no escribe ni calcula colores, solo los pinta (por eso no hay un solo hexadecimal aquí).
 */
export interface ColorDePaleta {
  valor: string
  nombre: string
  tinta: 'claro' | 'oscuro'
  razon: number
}

interface SelectorColorProps {
  /** Nombre del campo del formulario. */
  nombre: string
  /** Color actual (ya normalizado) o `null` si la empresa no eligió ninguno. */
  valor: string | null
  paleta: readonly ColorDePaleta[]
  'aria-describedby'?: string
  className?: string
}

/**
 * Selector de color con PALETA CERRADA (docs/auditoria-admin/04 · F-07).
 *
 * El color de una empresa colorea SUS objetos —tarjetas, QR, comprobantes—, nunca la interfaz del panel (10 §3). Una paleta
 * cerrada impide elegir un color que no se lea, y por cada color dice con qué contraste se lee su tinta.
 *
 * Son radios nativos: se envían con el formulario sin JavaScript y se manejan con teclado (flechas dentro del grupo). El
 * mensaje de contraste es el del color GUARDADO; si el administrador cambia de opción, el de la nueva se ve al guardar. Un
 * `onChange` que lo actualice en vivo es una mejora de cliente, no una necesidad.
 */
export function SelectorColor({ nombre, valor, paleta, className, ...resto }: SelectorColorProps) {
  const elegido = paleta.find((c) => c.valor === valor) ?? null

  return (
    <div role="radiogroup" data-slot="selector-color" aria-describedby={resto['aria-describedby']} className={cn('grid gap-2', className)}>
      <div className="flex flex-wrap gap-2.5">
        {paleta.map((c) => (
          <label key={c.valor} className="relative cursor-pointer">
            <input
              type="radio"
              name={nombre}
              value={c.valor}
              defaultChecked={c.valor === valor}
              aria-label={c.nombre}
              className="peer sr-only"
            />
            <span
              aria-hidden
              style={{ backgroundColor: c.valor }}
              className="block size-9 rounded-full border-2 border-background ring-1 ring-border peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2"
            />
          </label>
        ))}
      </div>
      {elegido && (
        <p className="flex flex-wrap items-center gap-2 text-small text-muted-foreground">
          <EstadoChip tono={elegido.razon >= CONTRASTE_AA ? 'exito' : 'aviso'}>
            {elegido.razon >= CONTRASTE_AA ? 'Pasa AA' : 'No pasa AA'}
          </EstadoChip>
          Texto {elegido.tinta} sobre {elegido.nombre.toLowerCase()}: {elegido.razon.toFixed(1)}:1
        </p>
      )}
    </div>
  )
}
