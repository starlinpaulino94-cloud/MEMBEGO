'use server'

import { revalidatePath } from 'next/cache'
import { getUser } from '@/lib/auth'
import { asignarEntitlement, retirarEntitlement, FEATURES_CONNECT, type FeatureConnect } from '@/modules/connect/entitlements'
import { auditarConnect, cambiarEstadoConector } from '@/modules/connect/superadmin'
import { ESTADOS_CONECTOR, type EstadoConector } from '@/modules/connect/nucleo'

/**
 * Acciones del panel de Connect del superadmin (Fase 9).
 *
 * Guard NO-redirect DENTRO de cada acción: una server action se despacha por
 * su id desde cualquier path, así que el gate de la navegación no la protege.
 *
 * Conceder un límite es lo más consecuente que se hace aquí: `api_keys.max`
 * mayor que cero significa que esa empresa podrá entregar a un tercero una
 * llave que abre sus datos de clientes. Por eso queda auditado con quién y
 * cuándo, igual que las decisiones sobre la cola.
 */

async function superadmin(): Promise<{ dbUserId: string | null } | null> {
  const user = await getUser()
  if (user?.metadata.role !== 'SUPERADMIN') return null
  return { dbUserId: user.metadata.dbUserId ?? null }
}

export interface ConnectAdminState {
  error?: string
  success?: string
}

const RUTA = '/superadmin/connect'

export async function concederLimiteAction(
  _prev: ConnectAdminState,
  formData: FormData
): Promise<ConnectAdminState> {
  const quien = await superadmin()
  if (!quien) return { error: 'No autorizado.' }

  const companyId = String(formData.get('companyId') ?? '').trim()
  const feature = String(formData.get('feature') ?? '') as FeatureConnect
  const bruto = String(formData.get('limite') ?? '').trim()

  if (!companyId) return { error: 'Falta la empresa.' }
  if (!(feature in FEATURES_CONNECT)) return { error: 'Esa función no existe.' }

  // Vacío = volver al valor por defecto (se retira la fila). Es distinto de
  // conceder cero: uno dice «lo que traiga el sistema», el otro «ninguno», y
  // el día que el default cambie las dos cosas dejarán de coincidir.
  if (bruto === '') {
    await retirarEntitlement(companyId, feature)
    await auditarConnect('CONNECT_CONCEDIDO', companyId, quien.dbUserId, {
      feature,
      limite: null,
      accion: 'por_defecto',
    })
    revalidatePath(RUTA)
    return { success: 'Vuelve al valor por defecto.' }
  }

  const limite = Number(bruto)
  if (!Number.isInteger(limite) || limite < 0 || limite > 10_000) {
    return { error: 'Pon un número entero entre 0 y 10000, o déjalo vacío para el valor por defecto.' }
  }

  await asignarEntitlement({
    companyId,
    feature,
    limite,
    notas: `Concedido desde el panel por ${quien.dbUserId ?? 'superadmin'}.`,
  })
  await auditarConnect('CONNECT_CONCEDIDO', companyId, quien.dbUserId, {
    feature,
    limite,
    accion: 'concedido',
  })
  revalidatePath(RUTA)
  return { success: `Concedido: ${feature} = ${limite}.` }
}

export async function cambiarEstadoConectorAction(
  _prev: ConnectAdminState,
  formData: FormData
): Promise<ConnectAdminState> {
  const quien = await superadmin()
  if (!quien) return { error: 'No autorizado.' }

  const id = String(formData.get('id') ?? '').trim()
  const estado = String(formData.get('estado') ?? '') as EstadoConector
  if (!id) return { error: 'Falta el conector.' }
  if (!ESTADOS_CONECTOR.includes(estado)) return { error: 'Ese estado no existe.' }

  const res = await cambiarEstadoConector(id, estado)
  if (!res.ok) return { error: 'No se pudo cambiar. Recarga la página.' }

  await auditarConnect('CONNECT_CONECTOR_ESTADO', id, quien.dbUserId, { estado })
  revalidatePath(RUTA)
  return {
    success:
      estado === 'ACTIVE'
        ? 'Conector disponible para las empresas compatibles.'
        : estado === 'RETIRED'
          ? 'Conector retirado. Las conexiones existentes conservan su historial.'
          : `Conector en estado ${estado}.`,
  }
}
