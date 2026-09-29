/**
 * MEMBEGO SUPPLY 2.0 · errores de dominio.
 *
 * Un `SupplyV2Error` lleva un mensaje que se puede enseñar tal cual a la
 * persona. Cualquier otro error (Prisma, red) se traduce en las actions a un
 * mensaje genérico para no filtrar detalles internos.
 */
export class SupplyV2Error extends Error {
  readonly codigo: string
  constructor(codigo: string, mensaje: string) {
    super(mensaje)
    this.name = 'SupplyV2Error'
    this.codigo = codigo
  }
}

export function fallo(codigo: string, mensaje: string): never {
  throw new SupplyV2Error(codigo, mensaje)
}
