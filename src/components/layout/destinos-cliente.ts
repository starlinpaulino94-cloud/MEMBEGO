/**
 * LOS DESTINOS DEL CLIENTE — una sola fuente (contrato Stitch S01).
 *
 * Inicio · Cuenta · Mi QR · Beneficios · Menú, siempre los mismos y en el
 * mismo orden para todas las empresas y en todos los tamaños de pantalla.
 *
 * Eran cuatro hasta que «Beneficios» se sumó con el rediseño del Inicio. Lo
 * que NO cambia —y es lo que esta lista existe para garantizar— es que sean
 * los mismos para todo el mundo: la barra de la app no puede significar cosas
 * distintas según el negocio en el que estés. La disponibilidad por
 * empresa o capacidad se decide DENTRO de esas pantallas (Menú y Cuenta filtran
 * sus filas), nunca cambiando los destinos: la barra de la app no puede
 * significar cosas distintas según el negocio en el que estés.
 *
 * El dock móvil (`BottomNav`) y la fila de pestañas de escritorio
 * (`TabsEscritorio`) leen esta lista, para que no puedan separarse.
 */

export interface DestinoCliente {
  readonly href: string
  readonly label: string
  /** Prefijos extra que también marcan este destino como activo. */
  readonly match?: readonly string[]
}

export const DESTINOS_CLIENTE: readonly DestinoCliente[] = [
  { href: '/cliente/inicio', label: 'Inicio' },
  {
    href: '/cliente/perfil',
    label: 'Cuenta',
    match: [
      '/cliente/pagos',
      '/cliente/historial',
      '/cliente/ayuda',
      '/cliente/empresas',
      '/cliente/vehiculos',
      '/cliente/intereses',
    ],
  },
  {
    href: '/cliente/qr',
    label: 'Mi QR',
    match: ['/membresia', '/mis-membresias', '/cliente/mis-promociones'],
  },
  { href: '/cliente/promociones', label: 'Beneficios' },
  { href: '/cliente/menu', label: 'Menú' },
]

/** Una ruta activa el destino si es él o cuelga de él (o de sus prefijos). */
export function esDestinoActivo(pathname: string, destino: DestinoCliente): boolean {
  const bajo = (base: string) => pathname === base || pathname.startsWith(base + '/')
  return bajo(destino.href) || (destino.match ?? []).some(bajo)
}
