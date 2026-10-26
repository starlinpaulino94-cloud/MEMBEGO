import type { EstadoVerificacion, NivelIdentidad } from '@/modules/identidad/identidadCore'

/**
 * REGLAS POR FUNCIÓN de la verificación de identidad (Fase 5) · núcleo PURO.
 *
 * La auditoría fija el principio: la identidad protege la SALIDA DE VALOR, no la compra. Por eso aquí hay dos listas
 * cerradas y no una configuración abierta:
 *
 *   · `OPERACIONES_CON_REGLA`: las únicas operaciones en las que se puede pedir identidad verificada. Hoy una: el pago a
 *     un proveedor de Supply (dinero que sale de Membego hacia un tercero), pidiendo la identidad de quien aceptó el
 *     contrato del proveedor. Nada se pide hasta que el equipo encienda la regla, con motivo, y apagada es el estado de serie.
 *   · `OPERACIONES_SIN_REGLA`: lo que NUNCA pide identidad —comprar, reservar, renovar, entrar con el QR…—. No es
 *     documentación: una prueba cruza esta lista con el código y con el CHECK de la base, y falla si alguien le abre a una
 *     compra la puerta de la identidad.
 *
 * Sin dependencias de base ni de red: la decisión es una función de unos hechos.
 */

// ── Operaciones ─────────────────────────────────────────────────────────────

export const ALCANCES_DE_REGLA = ['primer_pago', 'todos'] as const
export type AlcanceDeRegla = (typeof ALCANCES_DE_REGLA)[number]

export interface OperacionConRegla {
  clave: 'PAGO_A_PROVEEDOR'
  titulo: string
  /** Qué dinero sale y hacia quién: lo que justifica pedir identidad. */
  descripcion: string
  /** Quién es la persona a la que se le pide. */
  seVerificaA: string
  alcances: readonly { valor: AlcanceDeRegla; etiqueta: string; explicacion: string }[]
}

export const OPERACIONES_CON_REGLA = [
  {
    clave: 'PAGO_A_PROVEEDOR',
    titulo: 'Pago a un proveedor de Supply',
    descripcion: 'Dinero que Membego envía a un proveedor al confirmar un pago o una liquidación.',
    seVerificaA: 'La persona que aceptó el contrato del proveedor en su portal (quien obliga a la empresa).',
    alcances: [
      { valor: 'primer_pago', etiqueta: 'Solo el primer pago', explicacion: 'Se pide antes del primer pago confirmado a ese proveedor; los siguientes no vuelven a pedirlo.' },
      { valor: 'todos', etiqueta: 'Todos los pagos', explicacion: 'Se pide en cada pago: si la verificación vence o se retira, los pagos se detienen hasta que se renueve.' },
    ],
  },
] as const satisfies readonly OperacionConRegla[]

export type OperacionDeIdentidad = (typeof OPERACIONES_CON_REGLA)[number]['clave']

export function esOperacionConRegla(valor: unknown): valor is OperacionDeIdentidad {
  return OPERACIONES_CON_REGLA.some((o) => o.clave === valor)
}

export function esAlcanceDeRegla(valor: unknown): valor is AlcanceDeRegla {
  return ALCANCES_DE_REGLA.some((a) => a === valor)
}

export function operacionConRegla(clave: OperacionDeIdentidad): OperacionConRegla {
  return OPERACIONES_CON_REGLA.find((o) => o.clave === clave)!
}

/**
 * Lo que NUNCA pide identidad, en palabras del producto. Hay una prueba que impide que el código de estas operaciones
 * consulte las reglas y que la lista de arriba y el CHECK de la base las incluyan.
 */
export const OPERACIONES_SIN_REGLA = [
  { clave: 'COMPRA_MEMBRESIA', titulo: 'Comprar una membresía o un plan' },
  { clave: 'COMPRA_PROMOCION', titulo: 'Comprar una promoción o un producto' },
  { clave: 'RESERVA', titulo: 'Reservar una excursión o una cita' },
  { clave: 'RENOVACION', titulo: 'Renovar una membresía, también con tarjeta guardada' },
  { clave: 'PAGO_CON_TARJETA', titulo: 'Pagar con tarjeta o con transferencia' },
  { clave: 'CHECK_IN_QR', titulo: 'Entrar con el QR y usar lo comprado' },
  { clave: 'REGISTRO', titulo: 'Crear la cuenta o afiliarse a una empresa' },
] as const

// ── La regla y su decisión ──────────────────────────────────────────────────

export interface ReglaDeIdentidad {
  operacion: OperacionDeIdentidad
  activa: boolean
  alcance: AlcanceDeRegla
}

/** Sin fila en la base: la operación no pide nada. */
export function reglaPorDefecto(operacion: OperacionDeIdentidad): ReglaDeIdentidad {
  return { operacion, activa: false, alcance: 'primer_pago' }
}

/** Los niveles que cuentan como «identidad verificada» (el de contacto no es una verificación de la persona). */
const NIVELES_QUE_CUENTAN: readonly NivelIdentidad[] = ['documento_selfie', 'jce_oficial']

export interface HechosDelRepresentante {
  /** `User.id` de quien aceptó el contrato; `null` si nadie lo ha aceptado. */
  userId: string | null
  /** Para decirle al equipo a quién pedírselo (correo o nombre). */
  contacto: string | null
  estado: EstadoVerificacion | null
  nivel: NivelIdentidad | null
}

export interface HechosDelPago {
  /** ¿Se puede verificar ahora? (entorno completo + interruptor). Con la verificación apagada, las reglas se suspenden. */
  compuertaAbierta: boolean
  /** ¿Es el primer pago confirmado a este proveedor? */
  esPrimerPago: boolean
  representante: HechosDelRepresentante
}

export type MotivoDeRequisito = 'sin_representante' | 'no_verificada' | 'nivel_insuficiente'

export type DecisionDeRequisito =
  | { aplica: false; razon: 'sin_regla' | 'inactiva' | 'compuerta_cerrada' | 'fuera_de_alcance' }
  | { aplica: true; cumple: true }
  | { aplica: true; cumple: false; motivo: MotivoDeRequisito; mensaje: string }

const ESTADO_EN_PALABRAS: Record<EstadoVerificacion, string> = {
  no_verificada: 'no ha verificado su identidad',
  verificada: 'está verificada',
  expirada: 'tiene la verificación vencida',
  revocada: 'tiene la verificación retirada',
  requiere_revalidacion: 'tiene que revalidar su verificación',
}

export function mensajeDeRequisito(motivo: MotivoDeRequisito, hechos: HechosDelRepresentante): string {
  const quien = hechos.contacto ? `La persona que aceptó el contrato (${hechos.contacto})` : 'La persona que aceptó el contrato'
  if (motivo === 'sin_representante') {
    return 'Este proveedor no tiene a nadie que haya aceptado su contrato, así que no hay a quién pedirle la verificación de identidad. Pídele que lo acepte desde su portal.'
  }
  if (motivo === 'nivel_insuficiente') {
    return `${quien} no tiene una verificación con documento. Para pagarle al proveedor hace falta que la haga desde «Verificación de identidad» en su portal.`
  }
  const como = hechos.estado ? ESTADO_EN_PALABRAS[hechos.estado] : ESTADO_EN_PALABRAS.no_verificada
  return `${quien} ${como}. Para pagarle al proveedor hace falta que la haga desde «Verificación de identidad» en su portal; en cuanto quede verificada se puede confirmar el pago.`
}

/**
 * ¿Hay que pedir identidad para ESTE pago y, si se pide, se cumple? El orden importa: una regla apagada o una
 * verificación apagada nunca frenan un pago; solo una regla encendida, dentro de su alcance, con la verificación
 * disponible, puede decir que no.
 */
export function decidirRequisito(regla: ReglaDeIdentidad | null, hechos: HechosDelPago): DecisionDeRequisito {
  if (!regla) return { aplica: false, razon: 'sin_regla' }
  if (!regla.activa) return { aplica: false, razon: 'inactiva' }
  if (!hechos.compuertaAbierta) return { aplica: false, razon: 'compuerta_cerrada' }
  if (regla.alcance === 'primer_pago' && !hechos.esPrimerPago) return { aplica: false, razon: 'fuera_de_alcance' }
  const r = hechos.representante
  if (!r.userId) return { aplica: true, cumple: false, motivo: 'sin_representante', mensaje: mensajeDeRequisito('sin_representante', r) }
  if (r.estado !== 'verificada') return { aplica: true, cumple: false, motivo: 'no_verificada', mensaje: mensajeDeRequisito('no_verificada', r) }
  if (!r.nivel || !NIVELES_QUE_CUENTAN.includes(r.nivel)) {
    return { aplica: true, cumple: false, motivo: 'nivel_insuficiente', mensaje: mensajeDeRequisito('nivel_insuficiente', r) }
  }
  return { aplica: true, cumple: true }
}
