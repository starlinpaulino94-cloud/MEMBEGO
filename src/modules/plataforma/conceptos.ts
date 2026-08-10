/**
 * DOMINIO DE PLATAFORMA · Fase 1 — LOS TRES CONCEPTOS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA QUE RESUELVE
 *
 * `modules/capacidades/catalogo.ts` tiene hoy DIECINUEVE valores en una sola
 * lista llamada `CAPACIDADES`, y son dos cosas distintas metidas en el mismo
 * saco:
 *
 *   · `POS_CAJA`, `RULETA`, `PAGO_CARDNET`  → funciones de MembeGo que una
 *     empresa enciende o apaga. Viven en el Core para siempre.
 *
 *   · `COLA_VEHICULOS`, `COMISIONES`, `TURNOS` → módulos del vertical Car
 *     Wash. El día que Car Wash salga del monolito, estos se van con él.
 *
 * Y el estándar de integración necesita un TERCER concepto que todavía no
 * existe: qué necesita un SISTEMA del Core (`CUSTOMER_LOOKUP`,
 * `BENEFIT_REDEMPTION`). El encargo lo llama «capability», que es justo la
 * palabra que ya estaba ocupada.
 *
 * Con un vertical la mezcla se aguanta. Con diez son doscientos valores en un
 * enum del Core que nadie puede leer entero, y la Regla §6 —«no hardcodear
 * categorías por todo el Core»— se incumple por acumulación, no por decisión.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ HACE ESTE ARCHIVO, Y QUÉ NO
 *
 * CLASIFICA. No renombra ni migra nada.
 *
 * `companies.capacidades` guarda hoy en producción JSON del tipo
 * `{ overrides: { COLA_VEHICULOS: true } }`. Renombrar el tipo obligaría a
 * migrar esos datos antes de saber siquiera si el diseño aguanta. Aquí se
 * declara a qué concepto pertenece cada valor existente; la separación FÍSICA
 * (mover los módulos del vertical fuera del Core) llega cuando Car Wash salga,
 * y para entonces la frontera ya estará escrita y probada.
 *
 * `tests/plataforma-conceptos.test.ts` exige que toda `Capacidad` esté
 * clasificada: una nueva sin clasificar no compila el sentido, falla la
 * prueba. Es la guardia que impide que la lista vuelva a crecer mezclada.
 */

import { CAPACIDADES, type Capacidad, type CategoriaNegocio } from '@/modules/capacidades/catalogo'

// ── Concepto 1 · FUNCIÓN DE EMPRESA ─────────────────────────────────────────

/**
 * Qué puede hacer una EMPRESA dentro de MembeGo.
 *
 * Es el concepto que `Capacidad` ya modela bien. Vive en el Core, se enciende
 * por empresa y no se va a ninguna parte.
 */
export const FUNCIONES_EMPRESA = [
  'NAVEGACION_V2',
  'CITAS',
  'SEGUIMIENTO',
  'RULETA',
  'GIFT_CARDS',
  'CITA_ANTES_DEL_QR',
  'POS_CAJA',
  'PAGO_TRANSFERENCIA',
  'PAGO_CARDNET',
] as const satisfies readonly Capacidad[]

export type FuncionEmpresa = (typeof FUNCIONES_EMPRESA)[number]

// ── Concepto 2 · MÓDULO DE VERTICAL ─────────────────────────────────────────

/**
 * Qué módulos tiene un VERTICAL. Hoy viven en el Core porque Car Wash está
 * embebido; se van con él cuando salga.
 *
 * El `vertical` de cada uno NO es decorativo: es lo que permite comprobar por
 * prueba que el Core no los referencia. El día que Restaurant traiga `MESAS` y
 * `COCINA`, entrarán aquí y no en la lista de funciones de empresa.
 */
export const MODULOS_VERTICAL = {
  INVENTARIO: 'CAR_WASH',
  COLA_VEHICULOS: 'CAR_WASH',
  EVIDENCIA_FOTOS: 'CAR_WASH',
  CUENTAS_CORPORATIVAS: 'CAR_WASH',
  COMISIONES: 'CAR_WASH',
  INCIDENCIAS: 'CAR_WASH',
  COMPRAS: 'CAR_WASH',
  ACTIVOS: 'CAR_WASH',
  TURNOS: 'CAR_WASH',
} as const satisfies Partial<Record<Capacidad, CategoriaNegocio>>

export type ModuloVertical = keyof typeof MODULOS_VERTICAL

/** ¿Este valor pertenece a un vertical (y a cuál)? */
export function verticalDelModulo(c: Capacidad): CategoriaNegocio | null {
  return (MODULOS_VERTICAL as Record<string, CategoriaNegocio>)[c] ?? null
}

/** Clasificación de cualquier `Capacidad` existente. */
export type Concepto = 'FUNCION_EMPRESA' | 'MODULO_VERTICAL'

export function conceptoDe(c: Capacidad): Concepto {
  return (FUNCIONES_EMPRESA as readonly string[]).includes(c)
    ? 'FUNCION_EMPRESA'
    : 'MODULO_VERTICAL'
}

/** Toda `Capacidad` clasificada, para que la prueba pueda exigir cobertura. */
export const CLASIFICACION: Record<Capacidad, Concepto> = Object.fromEntries(
  CAPACIDADES.map((c) => [c, conceptoDe(c)])
) as Record<Capacidad, Concepto>

// ── Concepto 3 · CAPABILITY DE INTEGRACIÓN ──────────────────────────────────

/**
 * Qué necesita un SISTEMA del Core. Es el contrato de integración: lo que un
 * vertical declara en su manifest y lo que sus credenciales autorizan.
 *
 * EN INGLÉS A PROPÓSITO, y es la única parte de este archivo que lo está.
 * Estos valores viajan por el cable: van en el manifest JSON, en los scopes de
 * la credencial y en la documentación que lee quien construye un satélite.
 * Un identificador de protocolo no se traduce — el resto del dominio sí, y por
 * eso el resto de este archivo está en español.
 */
export const CAPABILITIES = [
  'CUSTOMER_LOOKUP',
  'MEMBERSHIP_LOOKUP',
  'BENEFIT_EVALUATION',
  'BENEFIT_REDEMPTION',
  'PROMOTION_LOOKUP',
  'QR_VALIDATION',
  'BRANCH_LOOKUP',
  'VISIT_SYNC',
  'TRANSACTION_SYNC',
  'LOYALTY_EVENT',
] as const

export type Capability = (typeof CAPABILITIES)[number]

/**
 * Scope OAuth que cada capability exige. Un sistema que declara
 * `BENEFIT_REDEMPTION` obtiene `benefits:redeem` y nada más — Regla §26:
 * concesión mínima, no un permiso general de «integración».
 */
export const SCOPES_POR_CAPABILITY: Record<Capability, readonly string[]> = {
  CUSTOMER_LOOKUP: ['customers:read'],
  MEMBERSHIP_LOOKUP: ['memberships:read'],
  BENEFIT_EVALUATION: ['benefits:read'],
  BENEFIT_REDEMPTION: ['benefits:read', 'benefits:redeem'],
  PROMOTION_LOOKUP: ['promotions:read'],
  QR_VALIDATION: ['qr:validate'],
  BRANCH_LOOKUP: ['branches:read'],
  VISIT_SYNC: ['visits:write'],
  TRANSACTION_SYNC: ['transactions:write'],
  LOYALTY_EVENT: ['events:publish'],
}

/** Scopes que corresponden a un conjunto de capabilities, sin repetidos. */
export function scopesDe(capabilities: readonly Capability[]): string[] {
  return [...new Set(capabilities.flatMap((c) => SCOPES_POR_CAPABILITY[c]))].sort()
}

/** Todos los scopes que el estándar reconoce. */
export const SCOPES = scopesDe(CAPABILITIES)
