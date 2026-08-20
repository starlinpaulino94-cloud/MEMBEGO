'use client'

import Link from 'next/link'
import { CircleHelp, LogOut, User } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { logout } from '@/modules/auth/actions'
import { roleLabel } from '@/components/layout/nav-config'
import type { AppRole } from '@/types'

/** El shell monta un solo menú de usuario, así que un id fijo es seguro. */
const ID_FORM_SALIR = 'menu-usuario-cerrar-sesion'

/**
 * Menú de perfil del header: identidad, ayuda y cerrar sesión.
 *
 * Existe porque esas acciones vivían SOLO en el pie del menú lateral. En
 * escritorio se veían, pero en móvil el menú es un drawer cerrado: cerrar
 * sesión obligaba a abrirlo y bajar hasta el final. El header es donde la
 * gente busca su avatar.
 *
 * El nombre solo se muestra si se conoce: la sesión trae el correo, así que
 * mientras ninguna capa cargue el perfil, el correo hace de identidad. No se
 * inventa un nombre a partir del correo.
 */
export function MenuUsuario({
  role,
  userEmail,
  userName,
  ayudaHref,
}: {
  role: AppRole
  userEmail: string
  userName?: string | null
  /** Sin destino, la entrada de ayuda no se muestra. */
  ayudaHref?: string | null
}) {
  const identidad = userName?.trim() || userEmail
  const inicial = (identidad[0] ?? 'U').toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        id="menu-usuario-trigger"
        aria-label="Tu cuenta"
        className="flex h-10 w-10 items-center justify-center rounded-lg outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-brand text-[13px] font-semibold text-white">
          {inicial}
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-small font-medium text-foreground" title={identidad}>
            {identidad}
          </p>
          <p className="text-caption">{roleLabel(role)}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {role === 'CLIENTE' && (
          <DropdownMenuItem asChild>
            <Link href="/cliente/perfil">
              <User aria-hidden />
              Mi perfil
            </Link>
          </DropdownMenuItem>
        )}

        {ayudaHref && (
          <DropdownMenuItem asChild>
            <Link href={ayudaHref}>
              <CircleHelp aria-hidden />
              Ayuda
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />
        {/* Cerrar sesión es un POST (server action), no un enlace. El formulario
            va FUERA del item y el botón lo referencia con `form=`: así el item
            del menú sigue siendo un <button> real —con su rol, su foco y su
            Enter— en vez de un <form> disfrazado de opción de menú. */}
        <form action={logout} id={ID_FORM_SALIR} className="hidden" />
        <DropdownMenuItem variant="destructive" asChild>
          <button type="submit" form={ID_FORM_SALIR}>
            <LogOut aria-hidden />
            Cerrar sesión
          </button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
