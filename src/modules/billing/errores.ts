/**
 * COMMERCE CORE · Merchant Billing — errores de dominio.
 *
 * Un `FacturacionError` lleva un mensaje que se puede enseñar tal cual. Cualquier
 * otro error (Prisma, red) se traduce en las acciones a uno genérico.
 *
 * Propio de Merchant Billing: este módulo NO importa de `supply-v2` ni de los
 * pedidos (el servicio de pedidos le pasa lo que necesita).
 */
export class FacturacionError extends Error {
  readonly codigo: string
  constructor(codigo: string, mensaje: string) {
    super(mensaje)
    this.name = 'FacturacionError'
    this.codigo = codigo
  }
}

export function fallo(codigo: string, mensaje: string): never {
  throw new FacturacionError(codigo, mensaje)
}
