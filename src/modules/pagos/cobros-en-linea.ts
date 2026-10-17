import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { limiteDiaLocal } from '@/modules/reportes/rango'
import { esCanalDeCobro } from '@/modules/pagos/comprobante-tarjeta'
import {
  SUCURSAL_EN_LINEA,
  resumirCobrosEnLinea,
  type CobroEnLinea,
  type ResumenCobrosEnLinea,
} from '@/modules/pagos/cobros-en-linea-resumen'

/**
 * COBROS EN LÍNEA DE UN DÍA — las ventas con tarjeta que entraron por la pasarela (app, web, renovación automática).
 *
 * Son ventas `SALE` con método TARJETA y `pagoIntentoId`: el cobro de la pasarela es lo que las distingue de un cobro
 * con tarjeta hecho en un datáfono del mostrador. No llevan `cajaSesionId` (nadie las cobró en una caja), así que ningún
 * arqueo las cuenta; este listado existe para que el personal las vea y las imprima el día del cuadre.
 */

export interface CobrosEnLineaDelDia {
  /** `YYYY-MM-DD` en la zona de la empresa. */
  fecha: string
  items: CobroEnLinea[]
  /** `cantidad` y `total` son SIEMPRE los del día completo; el desglose por canal y sucursal es el de `items`. */
  resumen: ResumenCobrosEnLinea
  /** `true` si el día tiene más cobros que los que caben en `items` (el total sigue siendo el real). */
  truncado: boolean
}

const TOPE = 500

const centavos = (n: number) => Math.round(n * 100) / 100

function texto(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * El resumen con la cuenta REAL: la lista se acota a `TOPE` filas, pero la cifra del cuadre no puede ser la de la lista
 * recortada —un día con más cobros que el tope daría un total menor al que entró y nadie lo notaría—.
 */
function conCuentaReal(items: CobroEnLinea[], real: { cantidad: number; total: number }): ResumenCobrosEnLinea {
  return { ...resumirCobrosEnLinea(items), cantidad: real.cantidad, total: centavos(real.total) }
}

export async function getCobrosEnLineaDelDia(
  companyId: string,
  fecha: string,
  timeZone: string,
  /** `tope`: menos filas que el máximo (las pruebas lo usan para forzar el recorte sin crear 500 cobros). */
  opciones: { sucursalId?: string | null; tope?: number } = {}
): Promise<CobrosEnLineaDelDia> {
  const lectura = await leerCobros(companyId, limiteDiaLocal(fecha, timeZone, false), limiteDiaLocal(fecha, timeZone, true), opciones)
  return { fecha, items: lectura.items, resumen: conCuentaReal(lectura.items, lectura), truncado: lectura.truncado }
}

/** Lo mismo para la ventana de un turno de caja (apertura → cierre). Solo el resumen: el detalle va en el cuadre del día. */
export async function getCobrosEnLineaDelTurno(
  companyId: string,
  desde: Date,
  hasta: Date
): Promise<{ cantidad: number; total: number; porCanal: { etiqueta: string; cantidad: number; total: number }[]; truncado: boolean }> {
  const lectura = await leerCobros(companyId, desde, hasta, {})
  const r = conCuentaReal(lectura.items, lectura)
  return {
    cantidad: r.cantidad,
    total: r.total,
    porCanal: r.porCanal.map((c) => ({ etiqueta: c.etiqueta, cantidad: c.cantidad, total: c.total })),
    truncado: lectura.truncado,
  }
}

/** Los pagos con tarjeta de la pasarela de UN cliente, del más reciente al más viejo: para reimprimir desde su ficha. */
export async function getCobrosConTarjetaDeCliente(companyId: string, clienteId: string, limite = 20): Promise<CobroEnLinea[]> {
  return (await leerCobros(companyId, null, null, { clienteId, masRecientesPrimero: true, tomar: limite })).items
}

async function leerCobros(
  companyId: string,
  gte: Date | null,
  lt: Date | null,
  opciones: { sucursalId?: string | null; clienteId?: string; masRecientesPrimero?: boolean; tomar?: number; tope?: number }
): Promise<{ items: CobroEnLinea[]; cantidad: number; total: number; truncado: boolean }> {
  const tope = Math.min(opciones.tomar ?? opciones.tope ?? TOPE, TOPE)
  const where = {
    companyId,
    tipo: 'SALE' as const,
    estado: 'APPLIED' as const,
    metodoCobro: 'TARJETA' as const,
    pagoIntentoId: { not: null },
    ...(gte && lt ? { createdAt: { gte, lt } } : {}),
    ...(opciones.clienteId ? { clienteId: opciones.clienteId } : {}),
    ...(opciones.sucursalId ? { sucursalId: opciones.sucursalId } : {}),
  }
  const [filas, real] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      tx.transaction.findMany({
        where,
        select: {
          id: true,
          codigo: true,
          ticketNumero: true,
          monto: true,
          createdAt: true,
          snapshot: true,
          sucursal: { select: { nombre: true } },
          _count: { select: { impresiones: true } },
        },
        orderBy: { createdAt: opciones.masRecientesPrimero ? 'desc' : 'asc' },
        take: tope,
      }),
      tx.transaction.aggregate({ where, _count: { _all: true }, _sum: { monto: true } }),
    ])
  )
  const cantidad = real._count._all
  const total = Number(real._sum.monto ?? 0)
  const truncado = cantidad > filas.length && opciones.tomar == null

  const items = filas.map((f): CobroEnLinea => {
    const s = (f.snapshot ?? {}) as Record<string, unknown>
    const canal = esCanalDeCobro(s.canalDeCobro) ? s.canalDeCobro : null
    return {
      id: f.id,
      codigo: f.codigo,
      ticketNumero: f.ticketNumero,
      creadoAt: f.createdAt,
      cliente: texto(s.cliente) || 'Cliente',
      detalle: texto(s.detalle) || 'Pago con tarjeta',
      monto: Number(f.monto ?? 0),
      formaDePago: texto(s.metodoCobroLabel) || 'Tarjeta',
      canal,
      autorizacion: texto(s.autorizacion) || null,
      sucursal: f.sucursal?.nombre ?? SUCURSAL_EN_LINEA,
      impresa: f._count.impresiones > 0,
    }
  })
  return { items, cantidad, total, truncado }
}
