/**
 * COMMERCE CORE · inventario — errores de dominio.
 *
 * Un `InventarioError` lleva un mensaje que se puede enseñar tal cual a la
 * persona. Cualquier otro error (Prisma, red) se traduce en las actions a un
 * mensaje genérico para no filtrar detalles internos.
 *
 * Propio del inventario: Commerce Core no importa de `supply-v2` ni el
 * inventario del catálogo (la dependencia va en una sola dirección).
 */
export class InventarioError extends Error {
  readonly codigo: string
  constructor(codigo: string, mensaje: string) {
    super(mensaje)
    this.name = 'InventarioError'
    this.codigo = codigo
  }
}

export function fallo(codigo: string, mensaje: string): never {
  throw new InventarioError(codigo, mensaje)
}
