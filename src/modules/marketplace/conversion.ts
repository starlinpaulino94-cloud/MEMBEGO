/**
 * Fase 4 · CONVERSIÓN DESDE EL MAPA (decisiones puras).
 *
 * Centraliza el CTA de la sección de planes según pertenencia y requisitos
 * (§15 del plan de geolocalización). En el modelo multi-tenant actual la
 * compra solo es posible en la empresa del usuario; las empresas ajenas quedan
 * informativas, y un car wash sin vehículo lleva al onboarding y regresa al
 * detalle (docs/GEOLOCALIZACION.md §8.2, Fase 4).
 */

export interface CtaPlanes {
  href: string
  label: string
  /** true → el CTA resuelve un requisito (vehículo) antes de ver los planes. */
  gating: boolean
}

export interface RequisitosCta {
  canProceed: boolean
  nextAction: 'START_VEHICLE_ONBOARDING' | 'START_PROFILE_COMPLETION' | null
}

/**
 * CTA de la sección de planes según pertenencia y requisitos.
 *
 * - Empresa ajena → null (planes informativos; la conversión solo aplica en la
 *   empresa del usuario — modelo multi-tenant actual).
 * - Empresa propia y requisitos cumplidos → "Ver planes".
 * - Empresa propia y falta vehículo → onboarding de vehículo (`rutaVehiculo`
 *   ya lleva el `next` para regresar al detalle).
 * - Requisitos sin resolver (perfil) → fallback a planes (fail-open).
 */
export function decisionCtaPlanes(args: {
  esMiEmpresa: boolean
  requisitos?: RequisitosCta | null
  rutaVehiculo: string
  rutaPlanes: string
}): CtaPlanes | null {
  const { esMiEmpresa, requisitos, rutaVehiculo, rutaPlanes } = args
  if (!esMiEmpresa) return null

  const ok = requisitos?.canProceed ?? true
  if (ok) return { href: rutaPlanes, label: 'Ver planes', gating: false }

  if (requisitos?.nextAction === 'START_VEHICLE_ONBOARDING') {
    return { href: rutaVehiculo, label: 'Registrar mi vehículo', gating: true }
  }
  return { href: rutaPlanes, label: 'Ver planes', gating: true }
}
