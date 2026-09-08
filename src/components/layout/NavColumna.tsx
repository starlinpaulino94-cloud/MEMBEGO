'use client'

import { LogOut, Store } from 'lucide-react'
import { Logo } from '@/components/layout/Logo'
import { NavPanel, type BadgesNav } from '@/components/layout/NavPanel'
import { MenuUsuario } from '@/components/layout/MenuUsuario'
import { logout } from '@/modules/auth/actions'
import type { EspacioVisible } from '@/components/layout/nav-config'
import type { AppRole } from '@/types'

/**
 * EL MENÚ EN UNA COLUMNA (contrato Stitch · Admin Hub).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * Cuando un ámbito tiene un solo espacio, un riel de 68 px con UN icono
 * siempre activo no reparte nada. Aquí el menú se pinta entero: marca,
 * empresa activa, grupos rotulados y pie. Quién lo decide es
 * `menuEnUnaColumna` en nav-config; este archivo no cuenta espacios.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA ANATOMÍA ES LA DEL DISEÑO, DE ARRIBA ABAJO
 *
 *  1. Marca: logo + «MEMBEGO / Admin Hub».
 *  2. Empresa activa: el conmutador real si hay varias empresas (`conmutador`,
 *     que el layout monta solo entonces) o una tarjeta estática con nombre y
 *     sede. Va ANTES que el menú: sobre qué negocio estás trabajando se lee
 *     antes de decidir a dónde ir.
 *  3. Los grupos, sin cabecera de espacio: con la marca y la empresa encima,
 *     repetir «Empresa» como título era una tercera etiqueta para lo mismo.
 *  4. Pie: la empresa como razón social + salir de la sesión. El RNC que
 *     enseña el diseño no está en el modelo, así que no se pinta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO HAY MODO COMPACTO
 *
 * Plegar una columna sería dejar iconos sueltos sin el riel que los explica.
 * La preferencia guardada desde el panel de dos niveles no se aplica aquí: la
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
  empresa,
  conmutador,
}: {
  espacio: EspacioVisible
  rutaActiva: string | null
  badges?: BadgesNav
  onNavigate?: () => void
  role: AppRole
  userEmail: string
  userName?: string | null
  ayudaHref?: string | null
  /** Empresa activa, solo texto — no autoriza nada; el ámbito lo decide el servidor. */
  empresa?: { nombre: string; sede: string | null } | null
  /** El conmutador real (AdminCompanySwitcher); el layout lo monta solo con ≥2 empresas. */
  conmutador?: React.ReactNode
}) {
  return (
    // 280 px: lo que suman riel (68) y panel (212) en el menú de dos niveles,
    // para que el contenido no salte de ancho al cambiar de ámbito.
    <div className="flex h-full min-h-0 w-[280px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 w-full shrink-0 items-center gap-2.5 px-4">
        <Logo size={30} className="rounded-lg" />
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-bold uppercase tracking-tight text-sidebar-accent-foreground">
            Membego
          </span>
          <span className="block truncate text-label-sm uppercase tracking-[0.14em] text-sidebar-foreground">
            Admin Hub
          </span>
        </span>
      </div>

      {(conmutador || empresa) && (
        <div className="shrink-0 px-2.5 pb-2">
          {conmutador ?? (
            <div className="flex items-center gap-2.5 rounded-lg bg-sidebar-accent px-3 py-2.5">
              <Store className="size-4 shrink-0 text-sidebar-accent-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-label-lg text-sidebar-accent-foreground">
                  {empresa!.nombre}
                </span>
                {empresa!.sede ? (
                  <span className="block truncate text-label-md text-sidebar-foreground">
                    {empresa!.sede}
                  </span>
                ) : null}
              </span>
            </div>
          )}
        </div>
      )}

      {/* El panel trae los grupos rotulados y su propio scroll con `min-h-0`;
          aquí solo se le da el hueco. Sin cabecera de espacio: ver anatomía. */}
      <NavPanel
        espacio={espacio}
        rutaActiva={rutaActiva}
        badges={badges}
        onNavigate={onNavigate}
        conCabecera={false}
        className="min-h-0 flex-1 pt-2"
      />

      <div className="flex w-full shrink-0 items-center gap-1.5 border-t border-sidebar-border px-2.5 py-2">
        <MenuUsuario
          role={role}
          userEmail={userEmail}
          userName={userName}
          ayudaHref={ayudaHref}
          align="start"
          side="top"
          triggerClassName="h-10 w-10 rounded-lg hover:bg-sidebar-hover focus-visible:ring-sidebar-ring"
        />
        {empresa ? (
          <span className="min-w-0 flex-1 truncate text-label-md text-sidebar-foreground">
            {empresa.nombre}
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <form action={logout} className="shrink-0">
          <button
            type="submit"
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-sidebar-foreground outline-none transition hover:bg-sidebar-hover hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <LogOut className="size-4" aria-hidden />
          </button>
        </form>
      </div>
    </div>
  )
}
