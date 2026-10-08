/**
 * POS CONECTADO A COMMERCE CORE · errores de dominio.
 *
 * Un `PosError` lleva un mensaje que se puede enseñar tal cual a quien cobra. Cualquier otro error
 * (Prisma, red) se traduce en las acciones a uno genérico para no filtrar detalles internos.
 */
export class PosError extends Error {
  readonly codigo: string
  constructor(codigo: string, mensaje: string) {
    super(mensaje)
    this.name = 'PosError'
    this.codigo = codigo
  }
}

export function fallo(codigo: string, mensaje: string): never {
  throw new PosError(codigo, mensaje)
}
