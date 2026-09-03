'use client'

import { Logo } from '@/components/layout/Logo'
import { NavPanel, type BadgesNav } from '@/components/layout/NavPanel'
import { MenuUsuario } from '@/components/layout/MenuUsuario'
import type { EspacioVisible } from '@/components/layout/nav-config'
import type { AppRole } from '@/types'

/**
 * EL MENÚ EN UNA COLUMNA: para cuando el riel no tendría más que un icono.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * La plataforma es un solo espacio, y el mostrador también. Pintarles el menú
 * de dos niveles daba un riel de 68 px con UN icono siempre activo: no
 * repartía nada, solo separaba el logo del menú y desperdiciaba el ancho. Aquí
 * el segundo nivel se pinta entero y a todo el ancho, con sus grupos como
 * secciones rotuladas —Resumen, Negocio, Operación, Sistema—, que es
 * exactamente el sidebar de una columna que tenía el superadministrador antes
 * de los espacios, sin volver a escribirlo: es el MISMO `NavPanel`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUIÉN DECIDE
 *
 * `menuEnUnaColumna` en nav-config, sobre los espacios ya filtrados. Este
 * archivo no sabe qué rol lo pinta ni cuenta espacios: recibe el único que
 * hay. Si mañana la plataforma se reparte en varios espacios, el riel vuelve
 * solo, sin tocar nada de aquí.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO HAY MODO COMPACTO
 *
 * Plegar una columna sería dejar iconos sueltos sin el riel que los explica.
 * La preferencia guardada desde el panel de empresa no se aplica aquí: la
 * columna NO lleva `data-nav-panel`, que es a lo que apunta la regla CSS que
 * oculta el segundo nivel antes de hidratar.
 */
export function NavColumna({
  espacio,
  rutaActiva,
  badges,
  onNavigate,
  role,
  userEmail,
  userName,
  ayudaHref,
}: {
  espacio: EspacioVisible
  rutaActiva: string | null
  badges?: BadgesNav
  onNavigate?: () => void
  role: AppRole
  userEmail: string
  userName?: string | null
  ayudaHref?: string | null
}) {
  return (
    // 280 px: lo que suman riel (68) y panel (212) en el menú de dos niveles,
    // para que el contenido no salte de ancho al cambiar de ámbito.
    <div className="flex h-full min-h-0 w-[280px] shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 w-full shrink-0 items-center gap-2.5 px-4">
        <Logo size={28} className="rounded-lg" />
        <span className="truncate text-[15px] font-semibold tracking-tight text-sidebar-accent-foreground">
          MembeGo
        </span>
      </div>

      {/* El panel trae la cabecera del espacio, los grupos rotulados y su
          propio scroll con `min-h-0`; aquí solo se le da el hueco. */}
      <NavPanel
        espacio={espacio}
        rutaActiva={rutaActiva}
        badges={badges}
        onNavigate={onNavigate}
        className="min-h-0 flex-1"
      />

      <div className="flex w-full shrink-0 items-center border-t border-sidebar-border px-2.5 py-2">
        <MenuUsuario
          role={role}
          userEmail={userEmail}
          userName={userName}
          ayudaHref={ayudaHref}
          align="start"
          side="top"
          triggerClassName="h-11 w-11 rounded-xl hover:bg-sidebar-hover focus-visible:ring-sidebar-ring"
        />
      </div>
    </div>
  )
}
