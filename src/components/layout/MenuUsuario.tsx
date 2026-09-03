'use client'

import { useId } from 'react'
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
import { cn } from '@/lib/utils'
import { logout } from '@/modules/auth/actions'
import { roleLabel } from '@/components/layout/nav-config'
import type { AppRole } from '@/types'

/**
 * EL ID DEL FORMULARIO DE SALIDA SE GENERA, NO SE ESCRIBE.
 *
 * Era una constante: «el shell monta un solo menú de usuario, así que un id
 * fijo es seguro». Dejó de serlo en cuanto el mismo menú se montó también en
 * el pie del riel. Dos elementos con el mismo id es HTML inválido y el
 * síntoma habría sido silencioso: `form="…"` resuelve al PRIMERO del
 * documento, así que cerrar sesión desde el riel enviaría el formulario del
 * menú de la cabecera. Funciona por casualidad hasta que uno de los dos no
 * está montado.
 */

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
  align = 'end',
  side,
  triggerClassName,
}: {
  role: AppRole
  userEmail: string
  userName?: string | null
  /** Sin destino, la entrada de ayuda no se muestra. */
  ayudaHref?: string | null
  /**
   * Dónde se abre el panel. Existe porque este MISMO menú se monta en dos
   * sitios con geometrías opuestas: arriba a la derecha (cabecera) y abajo a
   * la izquierda (pie del riel). Duplicar el componente para cambiar dos
   * atributos habría duplicado también el formulario de cerrar sesión.
   */
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Estilo del disparador: la cabecera es clara y el riel es navy. */
  triggerClassName?: string
}) {
  const idFormSalir = useId()
  const identidad = userName?.trim() || userEmail
  const inicial = (identidad[0] ?? 'U').toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Tu cuenta"
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-lg outline-none transition-colors duration-fast hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
          triggerClassName
        )}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-brand text-[13px] font-semibold text-white">
          {inicial}
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align={align} side={side} className="w-60">
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
        <form action={logout} id={idFormSalir} className="hidden" />
        <DropdownMenuItem variant="destructive" asChild>
          <button type="submit" form={idFormSalir}>
            <LogOut aria-hidden />
            Cerrar sesión
          </button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
