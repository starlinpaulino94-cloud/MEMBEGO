import { sumarDias } from '@/modules/reportes/rango'
import { DIAS_AVISO_POR_DEFECTO, estadoDeLote } from './lotes'
import { FILAS_POR_PAGINA_REPORTES } from './reportes'

/**
 * COMMERCE CORE · inventario — INV-5b1: lo que VENCE PRONTO. PURO: sin base de datos ni servidor, para que lo usen las lecturas, las
 * pantallas, el aviso del barrido y las pruebas.
 *
 * QUÉ ES UNA FILA. Un lote EN UNA SUCURSAL con existencias (vendibles o apartadas) cuyo día de vencimiento ya pasó o llega dentro de
 * la ventana que se pide. Lo que ya está dañado no cuenta: ya salió de lo vendible (el barrido de 5a lo pasó ahí). Un lote que vence
 * HOY todavía se vende: por vencer, no vencido (`estadoDeLote` es quien lo decide, con las mismas reglas que la venta).
 *
 * LAS UNIDADES. Lo que se cuenta es lo VENDIBLE (lo que hay menos lo apartado): es lo que todavía se puede vender o mover. Lo apartado
 * ya está comprometido con un pedido y se enseña aparte.
 *
 * LOS DÍAS son los del calendario de la empresa (`hoy` lo da quien llama, ya en su zona horaria): este módulo nunca mira el reloj.
 */

/** Las ventanas que se pueden elegir, en días. */
export const VENTANAS_DIAS = [7, 15, 30, 60, 90] as const
export const VENTANA_POR_DEFECTO = DIAS_AVISO_POR_DEFECTO

/** La ventana pedida si es una de las que hay; si no, la de siempre. */
export function ventanaValida(v: unknown): number {
  const n = typeof v === 'string' ? Number(v.trim()) : typeof v === 'number' ? v : Number.NaN
  return (VENTANAS_DIAS as readonly number[]).includes(n) ? n : VENTANA_POR_DEFECTO
}

/** El último día que entra en una ventana de `dias` días que empieza hoy (ambos extremos incluidos). */
export function limiteDeVentana(hoy: string, dias: number): string {
  return sumarDias(hoy, dias)
}

export type ClaseVencimiento = 'VENCIDO' | 'POR_VENCER'

export const ETIQUETA_CLASE_VENCIMIENTO: Record<ClaseVencimiento, string> = {
  VENCIDO: 'Vencidos',
  POR_VENCER: 'Por vencer',
}

export const CLASES_VENCIMIENTO = Object.keys(ETIQUETA_CLASE_VENCIMIENTO) as ClaseVencimiento[]

export function esClaseVencimiento(v: unknown): v is ClaseVencimiento {
  return typeof v === 'string' && (CLASES_VENCIMIENTO as string[]).includes(v)
}

/** Vencido (su día ya pasó), por vencer (dentro de la ventana) o `null` (no vence, o vence más adelante: no entra en el informe). */
export function claseDeVencimiento(vencimiento: string | null, hoy: string, dias: number): ClaseVencimiento | null {
  const e = estadoDeLote(vencimiento, hoy, dias)
  return e === 'VENCIDO' || e === 'POR_VENCER' ? e : null
}

/** Con esta cantidad de días (o menos) para vencer, el lote es urgente. */
export const DIAS_URGENTE = 7

export type Urgencia = 'VENCIDO' | 'URGENTE' | 'PRONTO'

export const ETIQUETA_URGENCIA: Record<Urgencia, string> = {
  VENCIDO: 'Vencido',
  URGENTE: 'Urgente',
  PRONTO: 'Por vencer',
}

/** `diasRestantes` es negativo si ya venció, 0 si vence hoy. */
export function urgenciaDe(diasRestantes: number): Urgencia {
  if (diasRestantes < 0) return 'VENCIDO'
  return diasRestantes <= DIAS_URGENTE ? 'URGENTE' : 'PRONTO'
}

/** Lo vendible de un saldo por lote: lo que hay menos lo apartado (nunca negativo). */
export function vendibleDeLote(l: { onHand: number; reserved: number }): number {
  return Math.max(0, l.onHand - l.reserved)
}

// ── Filtros del informe ──────────────────────────────────────────────────────

export interface FiltrosVencimientos {
  /** La ventana, en días. */
  dias: number
  clase?: ClaseVencimiento
  sucursalId?: string
  /** Producto (nombre, SKU, código de barras) o código de lote. */
  q?: string
  pagina: number
}

export const FILAS_POR_PAGINA_VENCIMIENTOS = FILAS_POR_PAGINA_REPORTES

// ── Avisos ───────────────────────────────────────────────────────────────────

/**
 * La semana ISO de un día `YYYY-MM-DD` (`2027-W24`): la clave con la que el aviso de «por vencer» no se repite más de una vez por
 * semana. La semana ISO va de lunes a domingo y su año puede no ser el del día (el 1 de enero puede ser de la semana 52 o 53 del año
 * anterior).
 */
export function semanaIso(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`)
  // El jueves de esa semana decide el año ISO y el número de semana.
  const diaSemana = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  d.setUTCDate(d.getUTCDate() + 4 - diaSemana)
  const anio = d.getUTCFullYear()
  const primerDia = new Date(Date.UTC(anio, 0, 1, 12))
  const semana = Math.ceil(((d.getTime() - primerDia.getTime()) / 86_400_000 + 1) / 7)
  return `${anio}-W${String(semana).padStart(2, '0')}`
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

export interface AvisoDeVencimientos {
  titulo: string
  mensaje: string
}

/** El aviso semanal de lo que está por vencer. `urgentes` son los que vencen dentro de `DIAS_URGENTE` días o menos. */
export function avisoPorVencer(r: { lotes: number; urgentes: number; unidades: number; dias: number }): AvisoDeVencimientos {
  const urgentes = r.urgentes > 0 ? `, ${r.urgentes === 1 ? '1 de ellos dentro de' : `${r.urgentes} de ellos dentro de`} ${DIAS_URGENTE} días` : ''
  return {
    titulo: r.urgentes > 0 ? 'Lotes por vencer: hay urgentes' : 'Lotes por vencer',
    mensaje: `${plural(r.lotes, 'lote vence', 'lotes vencen')} en los próximos ${r.dias} días${urgentes}, con ${plural(r.unidades, 'unidad vendible', 'unidades vendibles')}. Véndelos primero o decide qué hacer con ellos.`,
  }
}

/** El aviso de lo que el barrido acaba de sacar de lo vendible por haber vencido. */
export function avisoVencidos(r: { lotes: number; unidades: number }): AvisoDeVencimientos {
  return {
    titulo: 'Mercancía vencida',
    mensaje: `Venció ${plural(r.lotes, 'lote', 'lotes')} y ${plural(r.unidades, 'unidad pasó', 'unidades pasaron')} de vendible a dañado (motivo «Vencido»). Revisa qué hacer con ellas.`,
  }
}
