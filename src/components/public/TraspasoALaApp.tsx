'use client'

import Link from 'next/link'
import { LogIn, ShoppingBag, UserPlus } from 'lucide-react'
import { rutaDeLogin, rutaDeRegistro } from '@/modules/comercio/rutas'
import { Button } from '@/components/ui/button'
import { useSesionLigera } from './useSesionLigera'

/**
 * EL TRASPASO: de la landing, que informa, a la app, donde se opera.
 *
 * La landing no tiene formularios de compra, reserva ni oferta. Donde antes los
 * había, hay esto: un enlace que lleva a la MISMA acción dentro de `/cliente`,
 * según quién mire.
 *
 *   · visitante  → iniciar sesión o crear cuenta, y volver al producto pedido;
 *   · cliente    → entrar directo a la ficha dentro de la app;
 *   · equipo     → ni un enlace de compra: es un administrador, empleado o
 *                  vendedor, que tiene su propio espacio. Se le dice y se le
 *                  ofrece su panel.
 *
 * `cargando` se pinta como visitante: esos enlaces funcionan para cualquiera
 * (`/login` devuelve en un solo salto a quien ya tiene sesión), así que la
 * página es útil sin JavaScript y sin esperar la respuesta.
 *
 * El estado de sesión solo decide qué enlace mostrar. Lo que cada persona puede
 * hacer lo siguen decidiendo el proxy y las acciones, no este componente.
 */

interface BloqueProps {
  /** La ruta DENTRO DE LA APP donde se hace la acción. */
  destino: string
  titulo: string
  descripcion: string
  /** El texto del botón para quien ya tiene sesión de cliente. */
  etiquetaCliente: string
}

export function TraspasoALaApp({ destino, titulo, descripcion, etiquetaCliente }: BloqueProps) {
  const sesion = useSesionLigera()
  return (
    <section className="rounded-lg border border-border p-4" aria-label={titulo} data-traspaso={sesion.estado}>
      <h2 className="flex items-center gap-2 text-h3 text-foreground">
        <ShoppingBag className="h-4 w-4" aria-hidden />
        {titulo}
      </h2>
      {sesion.estado === 'equipo' ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Tu cuenta es del equipo de un negocio. Los pedidos y reservas se hacen desde una cuenta de cliente.
          </p>
          <Button asChild variant="outline" className="mt-3">
            <Link href={sesion.casa}>Ir a mi panel</Link>
          </Button>
        </>
      ) : sesion.estado === 'cliente' ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">{descripcion}</p>
          <Button asChild className="mt-3">
            <Link href={destino}>{etiquetaCliente}</Link>
          </Button>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">{descripcion} Inicia sesión o crea tu cuenta y volverás aquí mismo.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild>
              <Link href={rutaDeLogin(destino)}>
                <LogIn className="mr-2 h-4 w-4" aria-hidden />
                Iniciar sesión
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={rutaDeRegistro(destino)}>
                <UserPlus className="mr-2 h-4 w-4" aria-hidden />
                Crear cuenta
              </Link>
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

/** La versión compacta, para una tarjeta de una lista: un solo enlace que sigue las mismas reglas. */
export function EnlaceDeTraspaso({ destino, etiqueta }: { destino: string; etiqueta: string }) {
  const sesion = useSesionLigera()
  if (sesion.estado === 'equipo') {
    return (
      <Button asChild variant="outline" className="w-full">
        <Link href={sesion.casa}>Ir a mi panel</Link>
      </Button>
    )
  }
  return (
    <Button asChild className="w-full" data-traspaso={sesion.estado}>
      <Link href={sesion.estado === 'cliente' ? destino : rutaDeLogin(destino)}>{etiqueta}</Link>
    </Button>
  )
}
