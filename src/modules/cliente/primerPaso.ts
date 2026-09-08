/**
 * EL PRIMER PASO DE QUIEN TODAVÍA NO TIENE NADA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Desde que un cliente puede existir sin empresa, el estado vacío del Inicio
 * es lo primero que ve todo el que acaba de registrarse. Mandarlo a
 * `/cliente/planes` —el catálogo de LA EMPRESA ACTIVA— es un callejón sin
 * salida de dos pantallas: sin empresa, esa pantalla responde con su propio
 * estado vacío.
 *
 * Las OFERTAS sí son globales, y reclamar una da de alta a la persona en esa
 * empresa (`asegurarClienteEnEmpresa`). De ahí sale su primera ficha, su
 * primer beneficio y su primera membresía posible: es el único primer paso
 * que de verdad avanza.
 *
 * Vive aquí, y no dentro de la pantalla, para que la regla se pueda probar
 * por comportamiento en vez de buscando texto en un archivo de UI — y para que
 * sobreviva a que el Inicio se reescriba (ya pasó una vez).
 */

export interface ContextoPrimerPaso {
  /** Empresa activa de la persona. `null` = todavía no es cliente de nadie. */
  readonly companyId: string | null | undefined
  /** Con una sola empresa publicada no hay marketplace que explorar. */
  readonly marcaUnica: boolean
}

export interface PrimerPaso {
  readonly href: string
  readonly etiqueta: string
}

export function primerPaso({ companyId, marcaUnica }: ContextoPrimerPaso): PrimerPaso {
  if (!companyId) return { href: '/cliente/promociones', etiqueta: 'Ver ofertas' }
  if (!marcaUnica) return { href: '/cliente/explorar', etiqueta: 'Explorar empresas' }
  return { href: '/cliente/planes', etiqueta: 'Ver planes' }
}
