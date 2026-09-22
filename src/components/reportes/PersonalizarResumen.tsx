import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw, SlidersHorizontal } from 'lucide-react'
import {
  CIFRAS_RESUMEN,
  hayPreferencias,
  resolverCifras,
  type PreferenciasReportes,
} from '@/modules/reportes/preferencias'
import {
  alternarCifraResumen,
  moverCifraResumen,
  restablecerCifrasResumen,
} from '@/modules/reportes/preferenciasActions'

/**
 * ELEGIR QUÉ CIFRAS SE VEN EN EL RESUMEN EJECUTIVO.
 *
 * El resumen enseñaba las mismas cinco a todo el mundo. A quien lleva el
 * mostrador, «cobros de membresías» no le dice nada el lunes por la mañana; a
 * quien lleva las cuentas, «entregas sin cobro» es ruido. Cinco tarjetas donde
 * dos sobran hacen que las tres que importan se lean peor.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ESTÁ CERRADO, Y NO SE IMPRIME
 *
 * Es un ajuste que se toca una vez y no se vuelve a mirar: abierto de serie
 * robaría el sitio de la primera cifra cada vez que alguien entra. Y en el
 * papel no hay nada que pulsar, así que no sale.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SIN JAVASCRIPT
 *
 * Cada control es un formulario que llama a una server action. No hace falta
 * estado en el cliente para una lista de cinco elementos, y así funciona
 * mientras la página se está hidratando — que es justo cuando alguien que ya
 * sabe lo que quiere pulsa.
 *
 * Las cifras ocultas siguen apareciendo en la lista, en gris: si desaparecieran
 * no habría forma de volver a encenderlas. Y la última visible no se puede
 * apagar —el núcleo no lo permite—, así que su botón sale deshabilitado en vez
 * de fallar en silencio al pulsarlo.
 */
export function PersonalizarResumen({
  pref,
  verFinancieros,
}: {
  pref: PreferenciasReportes
  verFinancieros: boolean
}) {
  const visibles = resolverCifras(pref, { verFinancieros })
  const clavesVisibles = new Set(visibles.map((c) => c.clave))
  const ofrecidas = CIFRAS_RESUMEN.filter((c) => verFinancieros || !c.financiera)

  // Las visibles primero, en su orden; las apagadas debajo, para encenderlas.
  const filas = [...visibles, ...ofrecidas.filter((c) => !clavesVisibles.has(c.clave))]
  const ultima = visibles.length === 1

  return (
    <details className="rounded-2xl border border-border/70 bg-card print:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-small text-foreground">
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden />
        Elegir qué cifras ves
        {hayPreferencias(pref) && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-caption text-primary">
            personalizado
          </span>
        )}
      </summary>

      <div className="border-t border-border/60 px-4 py-3">
        <p className="text-caption text-muted-foreground">
          Es tuyo, no del negocio: cada quien ve su resumen. Las cifras nuevas
          aparecen solas — aquí solo se guarda lo que quitas.
        </p>

        <ul className="mt-3 space-y-1.5">
          {filas.map((c, i) => {
            const visible = clavesVisibles.has(c.clave)
            return (
              <li
                key={c.clave}
                className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2"
              >
                <span
                  className={`flex-1 text-small ${visible ? 'text-foreground' : 'text-muted-foreground line-through'}`}
                >
                  {c.label}
                </span>

                {visible && (
                  <>
                    <form action={moverCifraResumen}>
                      <input type="hidden" name="clave" value={c.clave} />
                      <input type="hidden" name="direccion" value="arriba" />
                      <BotonIcono etiqueta={`Subir ${c.label}`} desactivado={i === 0}>
                        <ArrowUp className="h-4 w-4" aria-hidden />
                      </BotonIcono>
                    </form>
                    <form action={moverCifraResumen}>
                      <input type="hidden" name="clave" value={c.clave} />
                      <input type="hidden" name="direccion" value="abajo" />
                      <BotonIcono
                        etiqueta={`Bajar ${c.label}`}
                        desactivado={i === visibles.length - 1}
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden />
                      </BotonIcono>
                    </form>
                  </>
                )}

                <form action={alternarCifraResumen}>
                  <input type="hidden" name="clave" value={c.clave} />
                  <input type="hidden" name="visible" value={visible ? '0' : '1'} />
                  <BotonIcono
                    etiqueta={visible ? `Quitar ${c.label}` : `Volver a ver ${c.label}`}
                    // La última no se puede apagar: un resumen sin cifras no es
                    // una preferencia, es una pantalla rota.
                    desactivado={visible && ultima}
                    titulo={
                      visible && ultima
                        ? 'Tiene que quedar al menos una cifra'
                        : undefined
                    }
                  >
                    {visible ? (
                      <Eye className="h-4 w-4" aria-hidden />
                    ) : (
                      <EyeOff className="h-4 w-4" aria-hidden />
                    )}
                  </BotonIcono>
                </form>
              </li>
            )
          })}
        </ul>

        {hayPreferencias(pref) && (
          <form action={restablecerCifrasResumen} className="mt-3">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 text-caption text-primary hover:underline"
            >
              <RotateCcw className="h-3 w-3" aria-hidden />
              Volver a las cifras de fábrica
            </button>
          </form>
        )}
      </div>
    </details>
  )
}

/** Un icono que se pulsa. El nombre va en `sr-only`: un icono solo no se lee. */
function BotonIcono({
  etiqueta,
  desactivado,
  titulo,
  children,
}: {
  etiqueta: string
  desactivado?: boolean
  titulo?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="submit"
      disabled={desactivado}
      title={titulo ?? etiqueta}
      className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
      <span className="sr-only">{etiqueta}</span>
    </button>
  )
}
