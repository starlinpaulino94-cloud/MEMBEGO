/**
 * COMMERCE CORE · ofertas con presupuesto (Deals) — errores de dominio.
 *
 * Un `OfertaError` lleva un mensaje que se puede enseñar tal cual a la persona. Cualquier
 * otro error (Prisma, red) se traduce en las acciones a un mensaje genérico para no filtrar
 * detalles internos.
 */
export class OfertaError extends Error {
  readonly codigo: string
  /** Datos que la capa de arriba puede necesitar (p. ej. el reclamo que ya existía). */
  readonly datos?: Record<string, string>
  constructor(codigo: string, mensaje: string, datos?: Record<string, string>) {
    super(mensaje)
    this.name = 'OfertaError'
    this.codigo = codigo
    this.datos = datos
  }
}

export function fallo(codigo: string, mensaje: string, datos?: Record<string, string>): never {
  throw new OfertaError(codigo, mensaje, datos)
}
