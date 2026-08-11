'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import { ADMIN_ROLES, type AppRole } from '@/types'
import { resolverUmbrales, UMBRALES_POR_DEFECTO } from '@/modules/riesgo/semaforo'
import { UMBRALES_TAG } from '@/modules/riesgo/umbrales'

/**
 * Guarda los umbrales del semáforo de ESTA empresa.
 *
 * Lo edita el admin del negocio y no el superadmin, al contrario que las
 * capacidades: aquí no se enciende ni se apaga nada, solo se declara cada
 * cuánto es normal que un cliente aparezca. Quien sabe eso es quien está en el
 * mostrador.
 */

export interface UmbralesActionState {
  error?: string
  success?: string
}

export async function guardarUmbralesRetencion(
  _prev: UmbralesActionState,
  formData: FormData
): Promise<UmbralesActionState> {
  try {
    const user = await getUser()
    const rol = user?.metadata.role as AppRole | undefined
    if (!user || !rol || !ADMIN_ROLES.includes(rol)) {
      return { error: 'No tienes permiso para cambiar estos ajustes.' }
    }
    const companyId = user.metadata.companyId
    if (!companyId) return { error: 'Tu cuenta no está vinculada a una empresa.' }

    // `resolverUmbrales` ya acota el rango y separa dormido de riesgo: si
    // alguien escribe 400 días o pone dormido antes que riesgo, se corrige en
    // vez de guardarse mal. Un formulario mal rellenado no debería poder apagar
    // un estado entero del semáforo.
    const umbrales = resolverUmbrales({
      riesgoDias: formData.get('riesgoDias'),
      dormidoDias: formData.get('dormidoDias'),
      perdidoDias: formData.get('perdidoDias'),
      venceDias: formData.get('venceDias'),
    })

    // Si coinciden con los de fábrica no se guarda nada: así, el día que los
    // valores por defecto cambien, esta empresa los hereda sola.
    const esPorDefecto = (Object.keys(UMBRALES_POR_DEFECTO) as Array<keyof typeof umbrales>).every(
      (k) => umbrales[k] === UMBRALES_POR_DEFECTO[k]
    )

    const meta = await getRequestMeta()
    await conEmpresa(companyId, (tx) =>
      tx.company.update({
        where: { id: companyId },
        data: { retencionConfig: esPorDefecto ? Prisma.DbNull : { ...umbrales } },
      })
    )
    await conEmpresa(companyId, (tx) =>
      tx.auditLog.create({
        data: {
          companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'NOTA_INTERNA',
          entidadTipo: 'Company',
          entidadId: companyId,
          payload: { tipo: 'UMBRALES_RETENCION', ...umbrales },
          ...meta,
        },
      })
    ).catch(anotarFallo('retencion:auditLog.create'))

    revalidateTag(UMBRALES_TAG, 'max')
    revalidatePath('/admin/retencion')
    revalidatePath('/admin/clientes')
    revalidatePath('/admin/riesgo')
    return { success: 'Umbrales guardados. El semáforo ya usa los nuevos.' }
  } catch (e) {
    console.error('[retencion] guardar umbrales:', e)
    return {
      error:
        'No se pudo guardar. Si acabas de instalar esta versión, corre la migración 20260808_semaforo_retencion.',
    }
  }
}
