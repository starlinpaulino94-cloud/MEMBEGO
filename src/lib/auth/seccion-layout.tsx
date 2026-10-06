import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { requireSection } from './guards'
import type { AdminSection } from './permissions'

/**
 * LA GUARDIA VIVA DE UNA SECCIÓN DEL PANEL, en su layout.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL HUECO QUE ESTO CIERRA
 *
 * De las 147 pantallas del panel, 92 se guardaban SOLO por rol. Su única
 * barrera de sección era el proxy del edge — y el proxy lee los permisos del
 * TOKEN, no de la base. Así que quitarle un módulo a alguien no le cerraba la
 * puerta hasta que su sesión se refrescara: la propia pantalla de Permisos lo
 * admitía («la barrera de vista del sistema, con su próxima sesión»).
 *
 * `requireSection` lee la base VIVA. Puesta en el layout de cada sección,
 * cubre de una vez todas las pantallas del subárbol —las de hoy y las que
 * alguien añada mañana sin acordarse de la guardia—, que es justamente lo que
 * una guardia por página no puede prometer.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UNA FÁBRICA Y NO 38 FICHEROS CON EL MISMO TEXTO
 *
 * Porque el motivo es uno solo y treinta y ocho copias de un comentario se
 * desincronizan a la tercera edición. Cada layout queda en dos líneas: de qué
 * sección es, y nada más.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO SUSTITUYE A NADA
 *
 * Las server actions siguen pidiendo la suya: una action se despacha por su
 * ID desde cualquier path permitido, así que un guardia de layout —que vive
 * en el render— no la protege. Esto cubre la VISTA; las mutaciones se guardan
 * donde se ejecutan.
 *
 * Y el panel de inicio (`dashboard`) NO lleva guardia, a propósito: es el
 * destino al que rebota todo lo negado, aquí y en el proxy. Guardarlo sería
 * rebotar a sí mismo, que es un bucle en vez de una negativa.
 */
export function guardarSeccion(section: AdminSection) {
  return async function LayoutDeSeccion({ children }: { children: ReactNode }) {
    if (!(await requireSection(section))) redirect('/admin/dashboard')
    return children
  }
}
