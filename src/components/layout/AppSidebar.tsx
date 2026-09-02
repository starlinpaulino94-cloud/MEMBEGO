'use client'

import { useCallback, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { NavRail } from '@/components/layout/NavRail'
import { NavPanel, type BadgesNav } from '@/components/layout/NavPanel'
import {
  resolverRuta,
  visibleWorkspaces,
  workspaceLanding,
  type ContextoNav,
  type EspacioVisible,
} from '@/components/layout/nav-config'

/**
 * EL MENÚ DE DOS NIVELES, RESUELTO EN UN SOLO SITIO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUIÉN DECIDE QUÉ
 *
 * Este componente NO decide nada de visibilidad. Recibe un contexto —rol,
 * capacidades encendidas, vertical, rutas negadas— y se lo pasa a los helpers
 * puros de `nav-config`. Aquí no hay ni un `if (role === …)`, y ésa es la
 * razón por la que las reglas del menú se pueden probar sin navegador.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL ESPACIO ACTIVO TIENE UN ESTADO OPTIMISTA
 *
 * Pulsar un espacio navega a su aterrizaje, y hasta que el servidor responde
 * la ruta sigue siendo la vieja: el segundo nivel se quedaría enseñando los
 * módulos del espacio ANTERIOR durante medio segundo. Se lee como que el clic
 * no funcionó.
 *
 * Lo que se guarda es el espacio elegido JUNTO A LA RUTA desde la que se
 * eligió. El adelanto vale mientras esa ruta siga siendo la actual; en cuanto
 * el enrutador aterriza, deja de aplicarse y manda la URL, que es la verdad.
 *
 * Guardarlo así —y no con un efecto que ponga el adelanto a null al cambiar de
 * ruta— es lo que hace imposible que los dos datos discrepen: solo hay uno, y
 * se compara. Un efecto que sincroniza dos estados siempre tiene una ventana
 * de un render en la que dicen cosas distintas.
 */

/**
 * Un espacio sin nada visible no llega hasta aquí (`canSeeWorkspace` lo
 * descarta), pero la ruta puede caer fuera de todo espacio —una pantalla que
 * no está en ningún menú—. En ese caso se enseña el primero: un panel vacío
 * sería peor que uno que no corresponde.
 */
function espacioAPintar(
  espacios: EspacioVisible[],
  elegido: string | null,
  activoPorRuta: string | null
): EspacioVisible | null {
  return (
    espacios.find((e) => e.id === elegido) ??
    espacios.find((e) => e.id === activoPorRuta) ??
    espacios[0] ??
    null
  )
}

export function AppSidebar({
  ctx,
  badges,
  compacto = false,
  onToggleCompacto,
  onNavigate,
  userEmail,
  userName,
  ayudaHref,
  /** El cajón móvil pinta los dos niveles a la vez y sin plegar. */
  variante = 'escritorio',
}: {
  ctx: ContextoNav
  badges?: BadgesNav
  compacto?: boolean
  onToggleCompacto?: () => void
  onNavigate?: () => void
  userEmail: string
  userName?: string | null
  ayudaHref?: string | null
  variante?: 'escritorio' | 'movil'
}) {
  const pathname = usePathname()

  const espacios = useMemo(() => visibleWorkspaces(ctx), [ctx])
  const landings = useMemo(() => {
    const mapa: Record<string, string> = {}
    for (const e of espacios) {
      const destino = workspaceLanding(e, ctx)
      if (destino) mapa[e.id] = destino
    }
    return mapa
  }, [espacios, ctx])

  const ruta = useMemo(() => resolverRuta(pathname, ctx), [pathname, ctx])

  const [adelanto, setAdelanto] = useState<{ id: string; desde: string } | null>(null)
  // Vale solo mientras no hayamos llegado: al cambiar la ruta se rinde solo.
  const elegido = adelanto && adelanto.desde === pathname ? adelanto.id : null
  const elegirEspacio = useCallback(
    (id: string) => setAdelanto({ id, desde: pathname }),
    [pathname]
  )

  const espacio = espacioAPintar(espacios, elegido, ruta?.workspaceId ?? null)
  const compactoReal = variante === 'movil' ? false : compacto

  return (
    <div className="flex h-full min-h-0">
      <NavRail
        espacios={espacios}
        landings={landings}
        espacioActivoId={espacio?.id ?? null}
        rutaActiva={ruta?.href ?? null}
        compacto={compactoReal}
        onToggleCompacto={variante === 'escritorio' ? onToggleCompacto : undefined}
        badges={badges}
        role={ctx.role}
        userEmail={userEmail}
        userName={userName}
        ayudaHref={ayudaHref}
        onElegirEspacio={elegirEspacio}
      />

      {/* El segundo nivel se pinta SIEMPRE en el HTML del servidor y lo oculta
          una regla CSS cuando el modo compacto está guardado (ver AppShell).
          Por eso el envoltorio lleva `data-nav-panel`: es a lo que apunta esa
          regla. React lo retira después, ya hidratado, sin que se vea nada.

          212 px de panel + 68 de riel son 280 en total. La referencia visual
          usa 260, pero sus etiquetas están en inglés: «Configuración»,
          «Personalización» o «Origen de clientes» se truncan a 260 y una
          etiqueta cortada obliga a pasar el cursor por encima para leer el
          menú. */}
      {espacio && (
        <div
          data-nav-panel
          className={cn('w-[212px] shrink-0 border-l border-sidebar-border', compactoReal && 'hidden')}
        >
          <NavPanel
            espacio={espacio}
            rutaActiva={ruta?.href ?? null}
            badges={badges}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </div>
  )
}
