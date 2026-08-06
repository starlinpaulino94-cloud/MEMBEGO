/**
 * Onboarding v2 · FLUJOS DECLARATIVOS POR TIPO DE NEGOCIO (Fase 1 · puro).
 *
 * Qué pasos completa un cliente según la categoría del negocio al que llega.
 * Es la respuesta estructural al `if (isCarwash)` del registro actual: las
 * pantallas no preguntan "¿es car wash?", preguntan "¿qué pasos tiene este
 * flujo?". Agregar un tipo de negocio = agregar una entrada aquí, sin tocar
 * el asistente.
 *
 * Reutiliza `CategoriaNegocio` de `capacidades/catalogo.ts` —la fuente de
 * verdad existente de tipos de negocio— en vez de inventar otra taxonomía.
 *
 * MINIMIZACIÓN DE DATOS: cada paso existe porque una funcionalidad real lo
 * consume. Por eso BARBERIA/RESTAURANTE/GYM solo piden el perfil general: no
 * se piden "preferencias" hasta que exista el módulo que las use.
 *
 * REGLA DE COMPATIBILIDAD (grandfathering): un flujo describe el CAMINO DE
 * ENTRADA de un registro/compra nuevos. Nunca se evalúa retroactivamente:
 * el cliente ya registrado —con o sin vehículo— no "debe" ningún paso por el
 * hecho de existir, y su membresía activa funciona sin pasar por aquí.
 */

import type { CategoriaNegocio } from '@/modules/capacidades/catalogo'

// ── Pasos ────────────────────────────────────────────────────────────────────

export type PasoOnboardingId =
  /** Datos generales de la persona (nombre, contacto, credenciales). */
  | 'PERFIL_GENERAL'
  /** Registro de vehículo (categoría→marca→modelo→año→color→placa). */
  | 'VEHICULO'

export interface PasoOnboarding {
  id: PasoOnboardingId
  /** false = se puede saltar y completar después. */
  requerido: boolean
}

export interface FlujoOnboarding {
  /** Sube cuando cambia la ESTRUCTURA del flujo: un cliente a medias retoma
   *  contra la versión que empezó, no contra una lista que ya no coincide. */
  version: number
  pasos: PasoOnboarding[]
}

// ── Flujos por categoría ─────────────────────────────────────────────────────

/**
 * El flujo de cada categoría de negocio. CAR_WASH exige vehículo porque sus
 * membresías y precios dependen de la categoría del vehículo; el resto solo
 * pide el perfil (un salón JAMÁS pregunta por una placa).
 */
export const FLUJOS_ONBOARDING: Record<CategoriaNegocio, FlujoOnboarding> = {
  CAR_WASH: {
    version: 1,
    pasos: [
      { id: 'PERFIL_GENERAL', requerido: true },
      { id: 'VEHICULO', requerido: true },
    ],
  },
  BARBERIA: {
    version: 1,
    pasos: [{ id: 'PERFIL_GENERAL', requerido: true }],
  },
  RESTAURANTE: {
    version: 1,
    pasos: [{ id: 'PERFIL_GENERAL', requerido: true }],
  },
  GYM: {
    version: 1,
    pasos: [{ id: 'PERFIL_GENERAL', requerido: true }],
  },
}

/**
 * Registro GENERAL (sin empresa): solo el perfil. Los requisitos específicos
 * (p. ej. vehículo) se piden cuando el cliente intente una acción que los
 * necesite — no por adelantado.
 */
export const FLUJO_GENERAL: FlujoOnboarding = {
  version: 1,
  pasos: [{ id: 'PERFIL_GENERAL', requerido: true }],
}

/** Flujo efectivo para un contexto de entrada (empresa o registro general). */
export function flujoParaCategoria(categoria: CategoriaNegocio | null): FlujoOnboarding {
  if (!categoria) return FLUJO_GENERAL
  return FLUJOS_ONBOARDING[categoria] ?? FLUJO_GENERAL
}

/**
 * ¿Este flujo incluye el paso de vehículo como requerido? Es el reemplazo
 * tipado del `isCarwash` que hoy viaja como prop hasta el formulario.
 */
export function flujoRequiereVehiculo(categoria: CategoriaNegocio | null): boolean {
  return flujoParaCategoria(categoria).pasos.some((p) => p.id === 'VEHICULO' && p.requerido)
}

// ── Contrato del motor de requisitos (lo implementa la Fase 3) ───────────────

/**
 * Requisitos que una ACCIÓN puede exigir. Códigos estables: los consumen la
 * UI (para redirigir al paso correcto) y las pruebas.
 */
export type RequisitoCodigo =
  | 'PROFILE_REQUIRED'
  | 'VEHICLE_REQUIRED'
  | 'LICENSE_PLATE_REQUIRED'
  | 'VEHICLE_CATEGORY_REQUIRED'

/** Adónde se manda al cliente para resolver lo que falta. */
export type AccionSiguiente =
  | 'START_PROFILE_COMPLETION'
  | 'START_VEHICLE_ONBOARDING'

/**
 * Resultado uniforme del motor de requisitos (§15): las páginas no inventan
 * redirecciones — leen `nextAction`. `canProceed: true` con lista vacía es el
 * ÚNICO estado que permite continuar.
 */
export interface EvaluacionRequisitos {
  canProceed: boolean
  missingRequirements: RequisitoCodigo[]
  nextAction: AccionSiguiente | null
}

/** Mapa requisito → paso que lo resuelve (el primero faltante decide). */
export const ACCION_POR_REQUISITO: Record<RequisitoCodigo, AccionSiguiente> = {
  PROFILE_REQUIRED: 'START_PROFILE_COMPLETION',
  VEHICLE_REQUIRED: 'START_VEHICLE_ONBOARDING',
  LICENSE_PLATE_REQUIRED: 'START_VEHICLE_ONBOARDING',
  VEHICLE_CATEGORY_REQUIRED: 'START_VEHICLE_ONBOARDING',
}

/** Construye la evaluación uniforme a partir de los requisitos faltantes. */
export function evaluarRequisitos(faltantes: RequisitoCodigo[]): EvaluacionRequisitos {
  if (faltantes.length === 0) {
    return { canProceed: true, missingRequirements: [], nextAction: null }
  }
  return {
    canProceed: false,
    missingRequirements: [...faltantes],
    nextAction: ACCION_POR_REQUISITO[faltantes[0]],
  }
}
