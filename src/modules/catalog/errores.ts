/**
 * COMMERCE CORE · catálogo — errores de dominio.
 *
 * Un `CatalogoError` lleva un mensaje que se puede enseñar tal cual a la
 * persona. Cualquier otro error (Prisma, red) se traduce en las actions a un
 * mensaje genérico para no filtrar detalles internos.
 *
 * Propio del catálogo y no el de Supply V2: Commerce Core no importa de
 * `supply-v2`.
 */
export class CatalogoError extends Error {
  readonly codigo: string
  constructor(codigo: string, mensaje: string) {
    super(mensaje)
    this.name = 'CatalogoError'
    this.codigo = codigo
  }
}

export function fallo(codigo: string, mensaje: string): never {
  throw new CatalogoError(codigo, mensaje)
}
