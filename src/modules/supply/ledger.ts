import type { SupplyCubeta, SupplyMovimientoTipo } from '@prisma/client'
import { CUBETAS_TERMINALES, SUPPLY_CUBETAS } from './catalogo'

/**
 * MEMBEGO SUPPLY · EL LEDGER DE DERECHOS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO HAY UN CAMPO `restantes`
 *
 * Un número editable no se puede auditar. Si un lote dice 742 y nadie sabe por
 * qué, la única respuesta posible ante «¿cuántas pizzas me quedan?» es «lo que
 * diga la pantalla». Aquí la respuesta sale de sumar asientos, y cada asiento
 * tiene fecha, actor y motivo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARTIDA DOBLE, NO SIGNOS
 *
 * Un asiento es un TRASLADO: `cantidad` unidades salen de `origen` y entran en
 * `destino`. `origen` nulo = entran al lote desde fuera (compra); `destino`
 * nulo = salen del lote (transferencia a otro lote).
 *
 * La alternativa —cantidades con signo— parece más simple y no lo es: con
 * signos, «-200 ASIGNACION» no dice de dónde salieron esas 200 ni a dónde
 * fueron, así que el invariante deja de ser aritmética y pasa a depender de
 * que cada escritor recuerde actualizar las dos cubetas correctas. Con
 * traslados, el invariante se cumple SOLO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL INVARIANTE (Fase 78)
 *
 *   comprado = DISPONIBLE + ASIGNADO + RETENIDO + EMITIDO + REDIMIDO + CERRADO
 *
 * donde comprado = Σ(entradas al lote) − Σ(salidas del lote).
 *
 * PURO: sin Prisma en ejecución, sin base de datos. Lo que escribe en la base
 * es `movimientos.ts`; esto decide QUÉ es válido y CUÁNTO queda.
 */

// ── Qué traslada cada tipo de asiento ───────────────────────────────────────

/**
 * Traslados PERMITIDOS por tipo de asiento. `null` = fuera del lote.
 *
 * Esta tabla es la fuente de verdad ejecutable del §3.2 de la arquitectura: si
 * un tipo de movimiento no declara aquí su traslado, `validarMovimiento` lo
 * rechaza. Añadir un tipo nuevo empieza y termina en esta constante.
 */
export const MOVIMIENTO_TRASLADO: Record<
  SupplyMovimientoTipo,
  readonly { origen: SupplyCubeta | null; destino: SupplyCubeta | null }[]
> = {
  COMPRA: [{ origen: null, destino: 'DISPONIBLE' }],
  ASIGNACION: [{ origen: 'DISPONIBLE', destino: 'ASIGNADO' }],
  LIBERACION_ASIGNACION: [{ origen: 'ASIGNADO', destino: 'DISPONIBLE' }],
  RETENCION: [
    { origen: 'DISPONIBLE', destino: 'RETENIDO' },
    { origen: 'ASIGNADO', destino: 'RETENIDO' },
  ],
  LIBERACION_RETENCION: [
    { origen: 'RETENIDO', destino: 'DISPONIBLE' },
    { origen: 'RETENIDO', destino: 'ASIGNADO' },
  ],
  EMISION: [
    { origen: 'DISPONIBLE', destino: 'EMITIDO' },
    { origen: 'ASIGNADO', destino: 'EMITIDO' },
    { origen: 'RETENIDO', destino: 'EMITIDO' },
  ],
  DEVOLUCION_EMISION: [
    { origen: 'EMITIDO', destino: 'DISPONIBLE' },
    { origen: 'EMITIDO', destino: 'ASIGNADO' },
  ],
  REDENCION: [{ origen: 'EMITIDO', destino: 'REDIMIDO' }],
  REVERSA_REDENCION: [{ origen: 'REDIMIDO', destino: 'EMITIDO' }],
  EXPIRACION: [
    { origen: 'DISPONIBLE', destino: 'CERRADO' },
    { origen: 'ASIGNADO', destino: 'CERRADO' },
    { origen: 'RETENIDO', destino: 'CERRADO' },
    { origen: 'EMITIDO', destino: 'CERRADO' },
  ],
  CANCELACION: [
    { origen: 'DISPONIBLE', destino: 'CERRADO' },
    { origen: 'ASIGNADO', destino: 'CERRADO' },
    { origen: 'RETENIDO', destino: 'CERRADO' },
    { origen: 'EMITIDO', destino: 'CERRADO' },
  ],
  /**
   * AJUSTE es el único comodín, y lo es a propósito: una enmienda que amplía el
   * contrato entra como `null → DISPONIBLE`, y un descuadre corregido a mano
   * mueve entre dos cubetas cualesquiera. Exige `motivo` (lo comprueba
   * `validarMovimiento`) porque un ajuste sin explicación es exactamente el
   * número editable que este módulo existe para eliminar.
   */
  AJUSTE: [],
  TRANSFERENCIA: [
    { origen: 'DISPONIBLE', destino: null },
    { origen: null, destino: 'DISPONIBLE' },
  ],
}

/** Tipos que exigen `motivo` por escrito. */
export const MOVIMIENTOS_CON_MOTIVO_OBLIGATORIO: readonly SupplyMovimientoTipo[] = [
  'AJUSTE',
  'REVERSA_REDENCION',
  'CANCELACION',
]

// ── Saldo por cubetas ───────────────────────────────────────────────────────

export type SaldoCubetas = Record<SupplyCubeta, number>

export interface AsientoLedger {
  tipo: SupplyMovimientoTipo
  origen: SupplyCubeta | null
  destino: SupplyCubeta | null
  cantidad: number
}

export function saldoVacio(): SaldoCubetas {
  return {
    DISPONIBLE: 0,
    ASIGNADO: 0,
    RETENIDO: 0,
    EMITIDO: 0,
    REDIMIDO: 0,
    CERRADO: 0,
  }
}

/**
 * Suma los asientos y devuelve las seis cubetas. Es LA función del módulo:
 * todo contador materializado tiene que poder reproducirse con esto, y la
 * conciliación (Fase 32) compara justamente eso.
 */
export function saldoDeAsientos(asientos: readonly AsientoLedger[]): SaldoCubetas {
  const saldo = saldoVacio()
  for (const a of asientos) {
    if (a.origen) saldo[a.origen] -= a.cantidad
    if (a.destino) saldo[a.destino] += a.cantidad
  }
  return saldo
}

/** Unidades que entraron al lote menos las que salieron: lo COMPRADO. */
export function compradoDeAsientos(asientos: readonly AsientoLedger[]): number {
  let total = 0
  for (const a of asientos) {
    if (a.origen === null) total += a.cantidad
    if (a.destino === null) total -= a.cantidad
  }
  return total
}

/** Suma de las seis cubetas. Debe coincidir con `compradoDeAsientos`. */
export function totalCubetas(saldo: SaldoCubetas): number {
  return SUPPLY_CUBETAS.reduce((t, c) => t + saldo[c], 0)
}

// ── Validación ──────────────────────────────────────────────────────────────

export interface MovimientoPropuesto extends AsientoLedger {
  motivo?: string | null
}

export type ResultadoValidacion = { ok: true } | { ok: false; error: string }

/**
 * ¿Es legal este asiento sobre este saldo?
 *
 * Comprueba, en este orden:
 *   1. cantidad entera y positiva (el signo lo da el traslado);
 *   2. el traslado está declarado para ese tipo;
 *   3. hay saldo en la cubeta de origen — aquí es donde se impide el sobregiro;
 *   4. los tipos que exigen motivo lo traen.
 *
 * No se apoya en el frontend ni en «lo normal»: la última unidad se pelea aquí
 * y en el `FOR UPDATE` de `movimientos.ts`, no en un `if` de una pantalla.
 */
export function validarMovimiento(
  saldo: SaldoCubetas,
  mov: MovimientoPropuesto
): ResultadoValidacion {
  if (!Number.isInteger(mov.cantidad) || mov.cantidad <= 0) {
    return { ok: false, error: 'La cantidad de un movimiento tiene que ser un entero positivo.' }
  }
  if (mov.origen === null && mov.destino === null) {
    return { ok: false, error: 'Un movimiento tiene que entrar o salir de alguna cubeta.' }
  }

  if (mov.tipo !== 'AJUSTE') {
    const permitidos = MOVIMIENTO_TRASLADO[mov.tipo]
    const encaja = permitidos.some((t) => t.origen === mov.origen && t.destino === mov.destino)
    if (!encaja) {
      return {
        ok: false,
        error: `El movimiento ${mov.tipo} no puede ir de ${mov.origen ?? 'fuera'} a ${mov.destino ?? 'fuera'}.`,
      }
    }
  }

  if (mov.origen !== null && saldo[mov.origen] < mov.cantidad) {
    return {
      ok: false,
      error: `No hay suficientes unidades en ${mov.origen}: quedan ${saldo[mov.origen]} y se piden ${mov.cantidad}.`,
    }
  }

  if (MOVIMIENTOS_CON_MOTIVO_OBLIGATORIO.includes(mov.tipo) && !(mov.motivo ?? '').trim()) {
    return { ok: false, error: `Un movimiento ${mov.tipo} exige un motivo por escrito.` }
  }

  return { ok: true }
}

/** Aplica el asiento a una copia del saldo. No muta la entrada. */
export function aplicarMovimiento(saldo: SaldoCubetas, mov: AsientoLedger): SaldoCubetas {
  const nuevo = { ...saldo }
  if (mov.origen) nuevo[mov.origen] -= mov.cantidad
  if (mov.destino) nuevo[mov.destino] += mov.cantidad
  return nuevo
}

// ── Invariante ──────────────────────────────────────────────────────────────

export interface ResultadoInvariante {
  cuadra: boolean
  comprado: number
  suma: number
  diferencia: number
  cubetas: SaldoCubetas
  /** Cubetas con saldo negativo: nunca debería haber ninguna. */
  negativas: SupplyCubeta[]
}

/**
 * La prueba de la Fase 78, ejecutable sobre cualquier colección de asientos.
 *
 * Se llama desde la conciliación y desde las pruebas. Devuelve la diferencia
 * en vez de lanzar: un descuadre es un HALLAZGO que hay que investigar, no una
 * excepción que tumba la pantalla del superadmin y le impide verlo.
 */
export function comprobarInvariante(asientos: readonly AsientoLedger[]): ResultadoInvariante {
  const cubetas = saldoDeAsientos(asientos)
  const comprado = compradoDeAsientos(asientos)
  const suma = totalCubetas(cubetas)
  const negativas = SUPPLY_CUBETAS.filter((c) => cubetas[c] < 0)
  return {
    cuadra: comprado === suma && negativas.length === 0,
    comprado,
    suma,
    diferencia: suma - comprado,
    cubetas,
    negativas,
  }
}

// ── Lecturas derivadas ──────────────────────────────────────────────────────

/**
 * Unidades que Membego todavía puede comprometer: las disponibles más las
 * asignadas a campañas que no han emitido.
 *
 * No incluye RETENIDO: un hold vivo es de alguien que está pagando ahora mismo.
 */
export function utilizables(saldo: SaldoCubetas): number {
  return saldo.DISPONIBLE + saldo.ASIGNADO
}

/** Unidades cuyo desenlace todavía no se conoce (exposición viva). */
export function expuestas(saldo: SaldoCubetas): number {
  return saldo.ASIGNADO + saldo.RETENIDO + saldo.EMITIDO
}

/** ¿El lote ya no tiene nada que entregar? */
export function agotado(saldo: SaldoCubetas): boolean {
  return saldo.DISPONIBLE === 0 && saldo.ASIGNADO === 0 && saldo.RETENIDO === 0 && saldo.EMITIDO === 0
}

/** Cubetas que todavía pueden moverse (no terminales) con saldo vivo. */
export function cubetasVivas(saldo: SaldoCubetas): SupplyCubeta[] {
  return SUPPLY_CUBETAS.filter((c) => !CUBETAS_TERMINALES.includes(c) && saldo[c] > 0)
}
