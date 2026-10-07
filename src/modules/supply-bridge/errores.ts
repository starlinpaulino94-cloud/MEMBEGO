/**
 * SUPPLY BRIDGE · errores de dominio. Un `PuenteError` lleva un mensaje que se
 * puede enseñar tal cual al superadmin; cualquier otro error se traduce a uno
 * genérico en las acciones.
 */
export class PuenteError extends Error {
  readonly codigo: string
  constructor(codigo: string, mensaje: string) {
    super(mensaje)
    this.name = 'PuenteError'
    this.codigo = codigo
  }
}

export function fallo(codigo: string, mensaje: string): never {
  throw new PuenteError(codigo, mensaje)
}
