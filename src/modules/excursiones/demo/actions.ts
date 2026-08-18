'use server'

/**
 * EXCURSIONES · Sembrar la demostración — acción del superadmin.
 *
 * La guardia importante no es el rol: es que la empresa esté marcada como
 * DEMO. Sembrar veintiuna reservas inventadas en una empresa real le mete
 * basura a su contabilidad y a sus comisiones, y eso no se deshace con un
 * botón — por eso aquí se comprueba antes de escribir una sola fila.
 */

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import { capacidadesDeEmpresa } from '@/modules/capacidades/catalogo'
import { sembrarExcursionesDemo, yaTieneExcursiones } from './sembrar'

export interface SiembraActionState {
  error?: string
  success?: string
}

export async function sembrarDemoExcursiones(
  _prev: SiembraActionState,
  formData: FormData
): Promise<SiembraActionState> {
  try {
    const user = await requireRole(['SUPERADMIN'])
    const companyId = String(formData.get('companyId') ?? '')
    if (!companyId) return { error: 'Empresa requerida.' }

    const empresa = await conEmpresa(companyId, (tx) =>
      tx.company.findUnique({
        where: { id: companyId },
        select: { id: true, name: true, esDemo: true, capacidades: true, type: true, tipoNegocioCodigo: true },
      })
    )
    if (!empresa) return { error: 'Empresa no encontrada.' }

    // La condición que protege a las empresas reales.
    if (!empresa.esDemo) {
      return {
        error:
          'Esta empresa no está marcada como demo. Márcala primero: los datos de demostración no deben mezclarse con los de una empresa real.',
      }
    }

    const { activas } = capacidadesDeEmpresa(empresa)
    if (!activas.has('EXCURSIONES')) {
      return { error: 'Activa la capacidad Excursiones en esta empresa antes de sembrar.' }
    }

    if (await yaTieneExcursiones(companyId)) {
      return {
        error:
          'Esta empresa ya tiene excursiones. Sembrar otra vez duplicaría la demostración; usa una empresa demo limpia.',
      }
    }

    const r = await sembrarExcursionesDemo(companyId, empresa.name)

    const meta = await getRequestMeta()
    await conEmpresa(companyId, (tx) =>
      tx.auditLog.create({
        data: {
          companyId,
          userId: user.metadata.dbUserId ?? null,
          accion: 'NOTA_INTERNA',
          entidadTipo: 'Company',
          entidadId: companyId,
          payload: { tipo: 'DEMO_EXCURSIONES_SEMBRADA', ...r },
          ...meta,
        },
      })
    ).catch(anotarFallo('excursiones:demo:auditLog'))

    revalidatePath(`/superadmin/empresas/${companyId}`)
    return {
      success: `Listo: ${r.excursiones} excursiones, ${r.vendedores} vendedores, ${r.clientes} clientes, ${r.reservas} reservas, ${r.ventas} ventas con sus comisiones y ${r.liquidaciones} liquidación pagada.`,
    }
  } catch (e) {
    console.error('[excursiones] sembrarDemoExcursiones:', e)
    return { error: 'No se pudo sembrar la demostración. Revisa el log.' }
  }
}
