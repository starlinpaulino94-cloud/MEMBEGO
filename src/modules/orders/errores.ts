/**
 * COMMERCE CORE · pedidos Membego — errores de dominio.
 *
 * Un `PedidoError` lleva un mensaje que se puede enseñar tal cual a la persona.
 * Cualquier otro error (Prisma, red) se traduce en las acciones a un mensaje
 * genérico para no filtrar detalles internos.
 *
 * Propio de los pedidos: Commerce Core no importa de `supply-v2` (la dependencia
 * va en una sola dirección: el puente de Supply llama a los pedidos).
 */
export class PedidoError extends Error {
  readonly codigo: string
  constructor(codigo: string, mensaje: string) {
    super(mensaje)
    this.name = 'PedidoError'
    this.codigo = codigo
  }
}

export function fallo(codigo: string, mensaje: string): never {
  throw new PedidoError(codigo, mensaje)
}
