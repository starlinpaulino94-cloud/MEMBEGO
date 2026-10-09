'use client'

import Link from 'next/link'
import { useSyncExternalStore, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { hayCookieDeSesion, puertaDeCasa } from '@/lib/auth/sesion-ligera'
import { cn } from '@/lib/utils'
import { useSesionLigera } from './useSesionLigera'

/**
 * LA LANDING, SEGÚN QUIÉN LA MIRE (separación landing/app · F5).
 *
 * El HTML que sirve el servidor es el mismo para todos —el de VISITANTE— y por eso la landing sigue siendo
 * estática: nada aquí lee la sesión en servidor. En el navegador, quien trae una sesión ve en su lugar la
 * puerta a SU espacio: «Ir a mi app» si es cliente, «Ir a mi panel» si es del equipo. Quien no trae la cookie
 * de sesión no hace ninguna petición (ver `useSesionLigera`).
 *
 * Para quien SÍ trae la cookie, mientras llega la respuesta los enlaces conservan su sitio pero invisibles
 * (`pendiente`): ni salto de diseño ni un «Registrarse» que parpadee delante de alguien que ya tiene cuenta.
 *
 * Es solo qué enlace mostrar. Lo que cada persona puede hacer lo siguen decidiendo el proxy y las acciones.
 */

const sinSuscripcion = () => () => {}

export function useSesionDeLaLanding() {
  const sesion = useSesionLigera()
  // En servidor y en la hidratación es `false` (el HTML es el de visitante); en el navegador, lo que diga la cookie.
  const hayPista = useSyncExternalStore(sinSuscripcion, () => hayCookieDeSesion(document.cookie), () => false)
  return { sesion, puerta: puertaDeCasa(sesion), pendiente: sesion.estado === 'cargando' && hayPista }
}

/** Un enlace de cuenta que, con sesión, se convierte en la puerta a su espacio. */
export function EnlaceDeCuenta({ href, etiqueta, className, icono, onClick }: { href: string; etiqueta: string; className?: string; icono?: ReactNode; onClick?: () => void }) {
  const { sesion, puerta, pendiente } = useSesionDeLaLanding()
  return (
    <Link
      href={puerta?.href ?? href}
      onClick={onClick}
      className={cn(className, pendiente && 'invisible')}
      aria-hidden={pendiente || undefined}
      tabIndex={pendiente ? -1 : undefined}
      data-sesion={sesion.estado}
    >
      {puerta?.etiqueta ?? etiqueta}
      {icono}
    </Link>
  )
}

/** Los CTA de la barra: «Ingresar» y «Registrarse» para el visitante; una sola puerta para quien ya tiene sesión. */
export function AccionesDeLaBarra({ movil = false, onNavigate }: { movil?: boolean; onNavigate?: () => void }) {
  const { sesion, puerta, pendiente } = useSesionDeLaLanding()
  const oculto = pendiente ? 'invisible' : undefined
  if (puerta) {
    return movil ? (
      <Link href={puerta.href} onClick={onNavigate} data-sesion={sesion.estado} className="block rounded-xl bg-primary px-3 py-2.5 text-center text-sm font-semibold text-primary-foreground shadow-glow">
        {puerta.etiqueta}
      </Link>
    ) : (
      <Link
        href={puerta.href}
        data-sesion={sesion.estado}
        className="group inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow transition-all hover:bg-primary hover:shadow-glow-strong active:scale-[0.98]"
      >
        {puerta.etiqueta}
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    )
  }
  return movil ? (
    <div className={cn('space-y-1.5', oculto)} aria-hidden={pendiente || undefined} data-sesion={sesion.estado}>
      <Link href="/login" onClick={onNavigate} tabIndex={pendiente ? -1 : undefined} className="block rounded-xl px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5">
        Ingresar
      </Link>
      <Link href="/registro/cuenta" onClick={onNavigate} tabIndex={pendiente ? -1 : undefined} className="block rounded-xl bg-primary px-3 py-2.5 text-center text-sm font-semibold text-primary-foreground shadow-glow">
        Registrarse
      </Link>
    </div>
  ) : (
    <div className={cn('flex items-center gap-2', oculto)} aria-hidden={pendiente || undefined} data-sesion={sesion.estado}>
      <Link href="/login" tabIndex={pendiente ? -1 : undefined} className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        Ingresar
      </Link>
      <Link
        href="/registro/cuenta"
        tabIndex={pendiente ? -1 : undefined}
        className="group inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow transition-all hover:bg-primary hover:shadow-glow-strong active:scale-[0.98]"
      >
        Registrarse
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </div>
  )
}

/** La columna «Tu cuenta» del pie: crear cuenta e ingresar para el visitante; la puerta a su espacio para quien ya tiene sesión. */
export function ColumnaDeCuentaDelPie({ claseEnlace }: { claseEnlace: string }) {
  const { sesion, puerta, pendiente } = useSesionDeLaLanding()
  return (
    <ul className={cn('space-y-2.5 text-sm', pendiente && 'invisible')} aria-hidden={pendiente || undefined} data-sesion={sesion.estado}>
      {puerta ? (
        <li>
          <Link href={puerta.href} className={claseEnlace}>
            {puerta.etiqueta}
          </Link>
        </li>
      ) : (
        <>
          <li>
            <Link href="/registro" tabIndex={pendiente ? -1 : undefined} className={claseEnlace}>
              Crear cuenta
            </Link>
          </li>
          <li>
            <Link href="/login" tabIndex={pendiente ? -1 : undefined} className={claseEnlace}>
              Ingresar
            </Link>
          </li>
        </>
      )}
    </ul>
  )
}

/** Algo que solo tiene sentido para quien no tiene sesión («Ya tengo cuenta»): con sesión desaparece. */
export function SoloVisitante({ children }: { children: ReactNode }) {
  const { sesion, puerta, pendiente } = useSesionDeLaLanding()
  if (puerta) return null
  return (
    <span className={cn('contents', pendiente && '[&>*]:invisible')} data-sesion={sesion.estado}>
      {children}
    </span>
  )
}
