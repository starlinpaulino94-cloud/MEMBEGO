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
  resumen: ResumenCobrosEnLinea
}

const TOPE = 500

function texto(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export async function getCobrosEnLineaDelDia(
  companyId: string,
  fecha: string,
  timeZone: string,
  opciones: { sucursalId?: string | null } = {}
): Promise<CobrosEnLineaDelDia> {
  const items = await leerCobros(companyId, limiteDiaLocal(fecha, timeZone, false), limiteDiaLocal(fecha, timeZone, true), opciones)
  return { fecha, items, resumen: resumirCobrosEnLinea(items) }
}

/** Lo mismo para la ventana de un turno de caja (apertura → cierre). Solo el resumen: el detalle va en el cuadre del día. */
export async function getCobrosEnLineaDelTurno(
  companyId: string,
  desde: Date,
  hasta: Date
): Promise<{ cantidad: number; total: number; porCanal: { etiqueta: string; cantidad: number; total: number }[] }> {
  const items = await leerCobros(companyId, desde, hasta, {})
  const r = resumirCobrosEnLinea(items)
  return { cantidad: r.cantidad, total: r.total, porCanal: r.porCanal.map((c) => ({ etiqueta: c.etiqueta, cantidad: c.cantidad, total: c.total })) }
}

async function leerCobros(
  companyId: string,
  gte: Date,
  lt: Date,
  opciones: { sucursalId?: string | null }
): Promise<CobroEnLinea[]> {
  const filas = await conEmpresa(companyId, (tx) =>
    tx.transaction.findMany({
      where: {
        companyId,
        tipo: 'SALE',
        estado: 'APPLIED',
        metodoCobro: 'TARJETA',
        pagoIntentoId: { not: null },
        createdAt: { gte, lt },
        ...(opciones.sucursalId ? { sucursalId: opciones.sucursalId } : {}),
      },
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
      orderBy: { createdAt: 'asc' },
      take: TOPE,
    })
  )

  return filas.map((f): CobroEnLinea => {
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
}
