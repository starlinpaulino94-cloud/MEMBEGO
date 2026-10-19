/**
 * COBROS EN LÍNEA DEL DÍA — la cuenta, en una función PURA.
 *
 * Un pago con tarjeta hecho en la app o en la web no pasa por la gaveta: el dinero no entra a la caja, entra a la
 * cuenta de la pasarela. Por eso NO forma parte del arqueo (que cuenta efectivo) y por eso el personal necesita verlo
 * aparte el día del cuadre: «¿cuánto se cobró hoy con tarjeta fuera de la caja y a qué ventas corresponde?».
 *
 * Este módulo no toca la base ni importa Next: recibe las filas ya leídas y devuelve el resumen que pintan la pantalla
 * de la caja, el reporte del día y el cierre. Así la regla («no se mezcla con el efectivo») se prueba sin PostgreSQL.
 */
import { ETIQUETA_CANAL, esCanalDeCobro, type CanalDeCobro } from '@/modules/pagos/comprobante-tarjeta'

/** Texto cuando el pago no pertenece a ninguna sucursal (lo normal en la app: nadie estaba en un mostrador). */
export const SUCURSAL_EN_LINEA = 'En línea'

export interface CobroEnLinea {
  /** `transactions.id`: lo que imprime `FacturaPrintDialog`. */
  id: string
  codigo: string
  ticketNumero: string
  /** Instante en que se registró la venta. */
  creadoAt: Date
  cliente: string
  /** Qué se pagó: «Membresía Plan Oro». */
  detalle: string
  monto: number
  /** «Tarjeta VISA ••••4242 (en la app)». */
  formaDePago: string
  canal: CanalDeCobro | null
  autorizacion: string | null
  /** Nombre de la sucursal, o `SUCURSAL_EN_LINEA`. */
  sucursal: string
  /** Si el comprobante ya se imprimió alguna vez. */
  impresa: boolean
}

export interface ResumenDeCanal {
  /** `null` = cobros anteriores a que se guardara el canal. */
  canal: CanalDeCobro | null
  etiqueta: string
  cantidad: number
  total: number
}

export interface ResumenCobrosEnLinea {
  cantidad: number
  total: number
  porCanal: ResumenDeCanal[]
  porSucursal: { sucursal: string; cantidad: number; total: number }[]
}

/** Redondeo a centavos: la coma flotante no puede inventar una diferencia en el cuadre. */
const centavos = (n: number) => Math.round(n * 100) / 100

const ETIQUETA_SIN_CANAL = 'canal no registrado'

export function resumirCobrosEnLinea(items: readonly CobroEnLinea[]): ResumenCobrosEnLinea {
  const canales = new Map<CanalDeCobro | null, ResumenDeCanal>()
  const sucursales = new Map<string, { sucursal: string; cantidad: number; total: number }>()
  let total = 0
  for (const i of items) {
    total += i.monto
    const canal = esCanalDeCobro(i.canal) ? i.canal : null
    const c = canales.get(canal) ?? { canal, etiqueta: canal ? ETIQUETA_CANAL[canal] : ETIQUETA_SIN_CANAL, cantidad: 0, total: 0 }
    c.cantidad += 1
    c.total += i.monto
    canales.set(canal, c)
    const s = sucursales.get(i.sucursal) ?? { sucursal: i.sucursal, cantidad: 0, total: 0 }
    s.cantidad += 1
    s.total += i.monto
    sucursales.set(i.sucursal, s)
  }
  const redondear = <T extends { total: number }>(x: T): T => ({ ...x, total: centavos(x.total) })
  return {
    cantidad: items.length,
    total: centavos(total),
    porCanal: [...canales.values()].map(redondear).sort((a, b) => b.total - a.total),
    porSucursal: [...sucursales.values()].map(redondear).sort((a, b) => b.total - a.total),
  }
}

/**
 * Lo que entra al arqueo de la caja: SOLO efectivo. Existe para dejar escrito, y probado, que los cobros en línea no se
 * suman a la gaveta: si alguien lo cambia, el cuadre del día dejaría de cuadrar con el dinero físico.
 */
export function efectivoEsperadoSinCobrosEnLinea(efectivoDelTurno: number, _enLinea: ResumenCobrosEnLinea): number {
  return centavos(efectivoDelTurno)
}
