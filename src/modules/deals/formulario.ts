import type { DealDiscountType } from '@prisma/client'
import type { EntradaDeOferta } from './domain'

type CambiosDeOferta = Partial<EntradaDeOferta>

/**
 * COMMERCE CORE · ofertas — lo que llega del formulario de la empresa, convertido a lo que
 * entiende el servicio. Puro (sin Prisma ni Next): se prueba directo.
 *
 * El navegador manda TEXTO. Aquí se decide cómo se lee cada campo; el significado de los
 * valores (rangos, topes, coherencia) lo valida `validarOferta` en el dominio.
 */

/** Lo que envía el formulario. Todo opcional: al editar una oferta publicada solo viajan algunos campos. */
export interface FormularioDeOferta {
  title?: unknown
  description?: unknown
  promotionId?: unknown
  catalogVariantId?: unknown
  discountType?: unknown
  discountValue?: unknown
  /** `AAAA-MM-DD` (día en República Dominicana). Vacío = desde ya. */
  startsAt?: unknown
  /** `AAAA-MM-DD`: la oferta vale hasta el final de ese día. Vacío = sin fecha de fin. */
  endsAt?: unknown
  voucherDays?: unknown
  newCustomersOnly?: unknown
  maxClaims?: unknown
  budgetTotal?: unknown
}

const TIPOS: readonly DealDiscountType[] = ['PERCENT', 'AMOUNT_OFF', 'FIXED_PRICE']

/** La República Dominicana no tiene horario de verano: UTC−4 todo el año. */
const ZONA = '-04:00'

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')

/** `AAAA-MM-DD` real (no acepta 2026-02-31) → instante al inicio o al final de ese día dominicano. */
export function diaADate(dia: string, fin: boolean): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia)
  if (!m) return null
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const prueba = new Date(Date.UTC(a, mes - 1, d))
  if (prueba.getUTCFullYear() !== a || prueba.getUTCMonth() !== mes - 1 || prueba.getUTCDate() !== d) return null
  const hora = fin ? '23:59:59.999' : '00:00:00.000'
  const fecha = new Date(`${dia}T${hora}${ZONA}`)
  return Number.isNaN(fecha.getTime()) ? null : fecha
}

function entero(v: unknown): number | null {
  const t = texto(v)
  if (!/^\d{1,9}$/.test(t)) return null
  return Number(t)
}

/** Un número decimal escrito con punto (sin separadores de miles ni notación científica). Las columnas son DECIMAL(12,2): hasta 10 enteros. */
function decimalTexto(v: unknown): string | null {
  const t = texto(v)
  return /^\d{1,10}(\.\d{1,2})?$/.test(t) ? t : null
}

export type Leido<T> = { ok: true; valor: T } | { ok: false; error: string }

/** Una oferta NUEVA: todos los campos obligatorios salvo las fechas, los días del cupón y «nuevos clientes». */
export function leerOfertaNueva(f: FormularioDeOferta, ahora = new Date()): Leido<EntradaDeOferta> {
  if (typeof f !== 'object' || f === null) return { ok: false, error: 'Datos no válidos.' }
  if (f.promotionId !== undefined && typeof f.promotionId !== 'string') return { ok: false, error: 'La promoción seleccionada no es válida.' }
  const tipo = texto(f.discountType) as DealDiscountType
  if (!TIPOS.includes(tipo)) return { ok: false, error: 'Elige cómo se aplica el descuento.' }
  const valor = decimalTexto(f.discountValue)
  if (valor === null) return { ok: false, error: 'Escribe el descuento como un número (por ejemplo 20 o 150.50).' }
  const cupos = entero(f.maxClaims)
  if (cupos === null) return { ok: false, error: 'Escribe cuántos clientes pueden reclamarla (un número entero).' }
  const presupuesto = decimalTexto(f.budgetTotal)
  if (presupuesto === null) return { ok: false, error: 'Escribe el presupuesto como un número (por ejemplo 5000).' }

  const inicioTexto = texto(f.startsAt)
  const inicio = inicioTexto === '' ? ahora : diaADate(inicioTexto, false)
  if (!inicio) return { ok: false, error: 'La fecha de inicio no es válida.' }
  const finTexto = texto(f.endsAt)
  const fin = finTexto === '' ? null : diaADate(finTexto, true)
  if (finTexto !== '' && !fin) return { ok: false, error: 'La fecha de fin no es válida.' }

  const diasTexto = texto(f.voucherDays)
  const dias = diasTexto === '' ? undefined : entero(f.voucherDays)
  if (dias === null) return { ok: false, error: 'Los días para canjear tienen que ser un número entero.' }

  return {
    ok: true,
    valor: {
      title: texto(f.title),
      description: texto(f.description) || null,
      promotionId: texto(f.promotionId) || null,
      catalogVariantId: texto(f.catalogVariantId),
      discountType: tipo,
      discountValue: valor,
      startsAt: inicio,
      endsAt: fin,
      voucherDays: dias,
      newCustomersOnly: f.newCustomersOnly === true || f.newCustomersOnly === 'on' || f.newCustomersOnly === 'true',
      maxClaims: cupos,
      budgetTotal: presupuesto,
    },
  }
}

/**
 * Los cambios de una edición: solo los campos presentes. Un campo presente pero mal escrito es
 * un error (no se ignora en silencio); `endsAt` vacío SÍ es válido y quita la fecha de fin.
 */
export function leerCambiosDeOferta(f: FormularioDeOferta): Leido<CambiosDeOferta> {
  if (typeof f !== 'object' || f === null) return { ok: false, error: 'Datos no válidos.' }
  const c: CambiosDeOferta = {}
  if (f.title !== undefined) c.title = texto(f.title)
  if (f.description !== undefined) c.description = texto(f.description) || null
  if (f.catalogVariantId !== undefined) c.catalogVariantId = texto(f.catalogVariantId)
  if (f.discountType !== undefined) {
    const t = texto(f.discountType) as DealDiscountType
    if (!TIPOS.includes(t)) return { ok: false, error: 'Elige cómo se aplica el descuento.' }
    c.discountType = t
  }
  if (f.discountValue !== undefined) {
    const v = decimalTexto(f.discountValue)
    if (v === null) return { ok: false, error: 'Escribe el descuento como un número.' }
    c.discountValue = v
  }
  if (f.startsAt !== undefined) {
    const t = texto(f.startsAt)
    const d = t === '' ? null : diaADate(t, false)
    if (!d) return { ok: false, error: 'La fecha de inicio no es válida.' }
    c.startsAt = d
  }
  if (f.endsAt !== undefined) {
    const t = texto(f.endsAt)
    if (t === '') c.endsAt = null
    else {
      const d = diaADate(t, true)
      if (!d) return { ok: false, error: 'La fecha de fin no es válida.' }
      c.endsAt = d
    }
  }
  if (f.voucherDays !== undefined) {
    const n = entero(f.voucherDays)
    if (n === null) return { ok: false, error: 'Los días para canjear tienen que ser un número entero.' }
    c.voucherDays = n
  }
  if (f.newCustomersOnly !== undefined) c.newCustomersOnly = f.newCustomersOnly === true || f.newCustomersOnly === 'on' || f.newCustomersOnly === 'true'
  if (f.maxClaims !== undefined) {
    const n = entero(f.maxClaims)
    if (n === null) return { ok: false, error: 'Los cupos tienen que ser un número entero.' }
    c.maxClaims = n
  }
  if (f.budgetTotal !== undefined) {
    const v = decimalTexto(f.budgetTotal)
    if (v === null) return { ok: false, error: 'Escribe el presupuesto como un número.' }
    c.budgetTotal = v
  }
  return { ok: true, valor: c }
}

/** El día dominicano (`AAAA-MM-DD`) de un instante: lo contrario de `diaADate`. */
export function dateADia(d: Date): string {
  return new Date(d.getTime() - 4 * 3_600_000).toISOString().slice(0, 10)
}
