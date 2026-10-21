/**
 * LAS COLAS DE PAGO, SIN BASE DE DATOS (auditoría admin · fase 5, tarea 5.2).
 *
 * Lo que `pagos/page.tsx` hacía en memoria con lo que traían las consultas, sacado a funciones puras para poder probarlo con
 * un reloj fijo y sin Prisma, y para que la página deje de ser un archivo de 1 000 líneas. Es MOVIMIENTO de código, no
 * cambio de comportamiento: cada función conserva la regla de la página de la que sale (`tests/pagos-colas-mezcla.test.ts`
 * las compara con esa lógica original escrita aparte).
 *
 * Esta pantalla mueve dinero, así que lo que importa aquí es lo aburrido: que el monto esperado, el recorte de las colas
 * mixtas y el orden sean exactamente los de antes.
 */

import type { Paginacion } from '@/lib/paginacion'

/** Las cinco colas, en el orden de las pestañas. */
export const COLAS = [
  { clave: 'sucursal', label: 'En sucursal' },
  { clave: 'transferencias', label: 'Transferencias' },
  { clave: 'compras', label: 'Compras' },
  { clave: 'cambios', label: 'Cambios de plan' },
  { clave: 'seguimiento', label: 'Sin completar' },
] as const
export type Cola = (typeof COLAS)[number]['clave']

/** El orden en que se prefiere abrir Pagos cuando la URL no dice la cola: la primera que tiene trabajo. */
const ORDEN_DE_APERTURA: readonly Cola[] = ['transferencias', 'sucursal', 'compras', 'cambios']

/**
 * La cola en la que abre Pagos (prototipo aprobado, decisión 3).
 *
 * Antes abría SIEMPRE en «En sucursal», aunque lo urgente fueran transferencias: el aviso del Resumen decía «5 por validar» y
 * el usuario caía en una cola vacía. Ahora, si la URL trae una cola válida se respeta; si no, se abre en la primera con trabajo
 * por este orden —transferencias (dinero declarado), sucursal, compras, cambios—; y si no hay nada pendiente, en «En sucursal»
 * como siempre. Es una regla de diseño, no del modelo: se cambia aquí, en un solo sitio.
 */
export function colaInicial(
  pedida: string | undefined,
  conteos: Record<Cola, number>
): Cola {
  if (COLAS.some((c) => c.clave === pedida)) return pedida as Cola
  return ORDEN_DE_APERTURA.find((c) => conteos[c] > 0) ?? 'sucursal'
}

/**
 * Monto esperado de una membresía: el precio del plan menos el descuento de bienvenida, que SOLO aplica si la membresía nunca
 * se activó (O-13: el descuento está congelado hasta la primera activación). Nunca baja de cero.
 */
export function descuentoDeBienvenidaVigente(descuento: unknown, fechaInicio: Date | null): number {
  return fechaInicio == null ? Number(descuento ?? 0) : 0
}
export function montoEsperado(precio: unknown, descuento: unknown, fechaInicio: Date | null): number {
  return Math.max(0, Number(precio) - descuentoDeBienvenidaVigente(descuento, fechaInicio))
}

/** Días transcurridos desde una fecha (0 = hoy). */
export function diasDesde(d: Date, ahora: number = Date.now()): number {
  return Math.max(0, Math.floor((ahora - d.getTime()) / 86_400_000))
}

/** Enlace de WhatsApp desde un teléfono local (es-DO: antepone 1 si falta). */
export function waLink(telefono: string | null): string | null {
  if (!telefono) return null
  let digits = telefono.replace(/\D/g, '')
  if (digits.length === 10 && !digits.startsWith('1')) digits = `1${digits}`
  return digits.length >= 10 ? `https://wa.me/${digits}` : null
}

export const esImagen = (url: string): boolean => /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(url)

/** Hasta dónde llega la ventana visible de una cola mixta: crece con la página pedida, no con el tamaño de la cola. */
export const ventanaDe = (p: Pick<Paginacion, 'saltar' | 'tomar'>): number => p.saltar + p.tomar

/**
 * EN SUCURSAL junta dos listas (membresías y compras) numeradas como una sola, membresías primero. Cada una llegó ya filtrada
 * de la base con hasta el FINAL de la ventana visible, así que el corte de aquí es exacto para cualquier página.
 */
export function cortarSucursal<M, C>(
  membresias: readonly M[],
  compras: readonly C[],
  totalMembresias: number,
  pag: Pick<Paginacion, 'saltar' | 'tomar'>
): { membresias: M[]; compras: C[] } {
  const enSucursal = membresias.slice(pag.saltar, pag.saltar + pag.tomar)
  const restoVentana = Math.max(0, pag.tomar - enSucursal.length)
  const saltarCompras = Math.max(0, pag.saltar - totalMembresias)
  return { membresias: enSucursal, compras: compras.slice(saltarCompras, saltarCompras + restoVentana) }
}

interface ClienteSeguimiento {
  nombre: string
  email: string
  telefono: string | null
  company: { name: string }
}

export interface FilaSeguimiento {
  key: string
  clienteId: string
  cliente: ClienteSeguimiento
  concepto: string
  monto: number
  situacion: string
  fecha: Date
}

/**
 * SEGUIMIENTO: iniciaron un pago y no lo completaron (transferencia sin comprobante, solicitud sin método, o rechazado sin
 * reintento). Membresías y compras en una sola lista, los más antiguos primero, ya recortada a la página pedida.
 */
export function unirSeguimiento(
  membresias: readonly {
    id: string
    estado: string
    clienteId: string
    updatedAt: Date
    descuentoBienvenida: unknown
    fechaInicio: Date | null
    rechazadoReason: string | null
    metodoPago: { tipo: string } | null
    cliente: ClienteSeguimiento
    plan: { nombre: string; precio: unknown }
  }[],
  compras: readonly {
    id: string
    estado: string
    clienteId: string
    updatedAt: Date
    precioCongelado: unknown
    rechazadoReason: string | null
    cliente: ClienteSeguimiento
    promocion: { titulo: string; precio: unknown } | null
  }[],
  pag: Pick<Paginacion, 'saltar' | 'tomar'>
): FilaSeguimiento[] {
  const todas: FilaSeguimiento[] = [
    ...membresias.map((m) => ({
      key: `m-${m.id}`,
      clienteId: m.clienteId,
      cliente: m.cliente,
      concepto: `Plan ${m.plan.nombre}`,
      monto: montoEsperado(m.plan.precio, m.descuentoBienvenida, m.fechaInicio),
      situacion:
        m.estado === 'RECHAZADA'
          ? `Pago rechazado sin reintento${m.rechazadoReason ? ` (${m.rechazadoReason})` : ''}`
          : m.metodoPago?.tipo === 'TRANSFERENCIA'
            ? 'Eligió transferencia y no ha enviado el comprobante'
            : 'Solicitó el plan y no ha completado el pago',
      fecha: m.updatedAt,
    })),
    ...compras.map((c) => ({
      key: `c-${c.id}`,
      clienteId: c.clienteId,
      cliente: c.cliente,
      concepto: `Promoción ${c.promocion?.titulo ?? '—'}`,
      monto: Number(c.precioCongelado ?? c.promocion?.precio ?? 0),
      situacion:
        c.estado === 'RECHAZADA'
          ? `Pago rechazado sin reintento${c.rechazadoReason ? ` (${c.rechazadoReason})` : ''}`
          : c.estado === 'PENDIENTE_PAGO'
            ? 'Eligió transferencia y no ha enviado el comprobante'
            : 'Solicitó la promoción y no ha completado el pago',
      fecha: c.updatedAt,
    })),
  ].sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
  return todas.slice(pag.saltar, pag.saltar + pag.tomar)
}
