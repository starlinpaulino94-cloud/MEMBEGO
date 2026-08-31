import 'server-only'
import { conEmpresa } from '@/lib/tenant'

/**
 * ENTITLEMENTS de Membego Connect: qué tiene concedido cada empresa.
 *
 * Decisión D6 (Fase 0): existen ANTES que el sistema de planes. Hoy los
 * asigna el superadmin; cuando exista un plan comercial, el plan escribirá
 * estas filas — y NADA de lo que las lee cambiará.
 *
 * SIN FILA = EL DEFAULT, y los defaults son deliberadamente generosos en lo
 * gratis y cerrados en lo que costará dinero de verdad: las features que
 * consumen servicios externos de pago nacen apagadas y se encienden empresa a
 * empresa. Eso evita el clásico «lanzamos y a los tres días todo el mundo
 * tenía WhatsApp ilimitado».
 */

/**
 * Vocabulario de features. Vive aquí y no en la base: dar de alta una feature
 * nueva es añadir una línea y su default, sin migrar nada.
 */
export const FEATURES_CONNECT = {
  /** Cuántas conexiones a conectores puede tener la empresa. */
  'conexiones.max': { default: 2 },
  /** Cuántas claves de API activas puede tener la empresa. */
  'api_keys.max': { default: 0 },
  /** Cuántas suscripciones de webhook salientes (Fase 3). */
  'webhooks.max': { default: 0 },
} as const

export type FeatureConnect = keyof typeof FEATURES_CONNECT

/**
 * Límite EFECTIVO de una feature: la fila si existe, el default si no.
 * Null en `limite` de una fila existente = sin límite (concesión explícita).
 */
export async function limiteDe(companyId: string, feature: FeatureConnect): Promise<number | null> {
  const fila = await conEmpresa(companyId, (tx) =>
    tx.entitlementEmpresa.findUnique({
      where: { companyId_feature: { companyId, feature } },
      select: { limite: true },
    })
  )
  if (!fila) return FEATURES_CONNECT[feature].default
  return fila.limite
}

/**
 * ¿Puede la empresa sumar UNO más? La pregunta que las escrituras hacen antes
 * de crear (una conexión, una clave…). `enUso` lo cuenta el llamador, que
 * sabe qué contar; aquí solo se compara contra el límite efectivo.
 */
export async function dentroDelLimite(
  companyId: string,
  feature: FeatureConnect,
  enUso: number
): Promise<boolean> {
  const limite = await limiteDe(companyId, feature)
  return limite === null || enUso < limite
}

/** Los entitlements de una empresa, para el panel del superadmin. */
export async function entitlementsDeEmpresa(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.entitlementEmpresa.findMany({ where: { companyId }, orderBy: { feature: 'asc' } })
  )
}

/**
 * Concede o ajusta (upsert). La capa que llame (server action del superadmin,
 * o el futuro sistema de planes) es quien autoriza; esto solo escribe.
 */
export async function asignarEntitlement(input: {
  companyId: string
  feature: FeatureConnect
  limite: number | null
  notas?: string
}): Promise<void> {
  await conEmpresa(input.companyId, (tx) =>
    tx.entitlementEmpresa.upsert({
      where: { companyId_feature: { companyId: input.companyId, feature: input.feature } },
      create: {
        companyId: input.companyId,
        feature: input.feature,
        limite: input.limite,
        notas: input.notas ?? null,
      },
      update: { limite: input.limite, notas: input.notas ?? null },
    })
  )
}

/** Vuelve al default (borra la fila). */
export async function retirarEntitlement(companyId: string, feature: FeatureConnect): Promise<void> {
  await conEmpresa(companyId, (tx) =>
    tx.entitlementEmpresa.deleteMany({ where: { companyId, feature } })
  )
}
