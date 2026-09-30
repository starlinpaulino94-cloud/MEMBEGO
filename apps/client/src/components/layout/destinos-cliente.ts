export interface DestinoClienteNative {
  readonly id: 'inicio' | 'cuenta' | 'qr' | 'beneficios' | 'menu'
  readonly href: string
  readonly webHref: string
  readonly label: string
  readonly activePrefixes: readonly string[]
}

export const DESTINOS_CLIENTE_NATIVE: readonly DestinoClienteNative[] = [
  {
    id: 'inicio',
    href: '/(tabs)/inicio',
    webHref: '/cliente/inicio',
    label: 'Inicio',
    activePrefixes: [],
  },
  {
    id: 'beneficios',
    href: '/(tabs)/beneficios',
    webHref: '/cliente/promociones',
    label: 'Beneficios',
    activePrefixes: ['promociones', 'mis-promociones', 'ruleta', 'regalos', 'invita-y-gana', 'referidos'],
  },
  {
    id: 'qr',
    href: '/(tabs)/qr',
    webHref: '/cliente/qr',
    label: 'Mi QR',
    activePrefixes: ['membresia', 'mis-membresias'],
  },
  {
    id: 'cuenta',
    href: '/(tabs)/cuenta',
    webHref: '/cliente/perfil',
    label: 'Cuenta',
    activePrefixes: ['pagos', 'historial', 'ayuda', 'empresas', 'vehiculos', 'intereses', 'ajustes', 'citas'],
  },
  {
    id: 'menu',
    href: '/(tabs)/menu',
    webHref: '/cliente/menu',
    label: 'Menú',
    activePrefixes: ['menu'],
  },
]

export function esDestinoClienteActivo(
  pathname: string,
  destino: DestinoClienteNative
): boolean {
  const nativePath = `/${destino.id}`

  if (pathname === nativePath || pathname.startsWith(`${nativePath}/`)) {
    return true
  }

  if (pathname === destino.href || pathname.startsWith(`${destino.href}/`)) {
    return true
  }

  return destino.activePrefixes.some((prefix) => {
    const segment = `/${prefix}`
    return pathname === segment || pathname.startsWith(`${segment}/`)
  })
}
