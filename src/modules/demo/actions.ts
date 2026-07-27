'use server'

/**
 * Administración de las empresas de DEMOSTRACIÓN (solo SUPERADMIN).
 *
 * Tres cosas y ninguna más:
 *   · marcar/desmarcar una empresa como de práctica,
 *   · reiniciarla para el siguiente entrenamiento,
 *   · saber, antes de reiniciar, cuánto se va a borrar.
 *
 * La creación de la empresa demo NO vive aquí: usa `crearEmpresa` de
 * `@/modules/empresas/actions` con la casilla "de demostración" marcada. Una
 * empresa de práctica tiene que nacer por el MISMO camino que una real —
 * mismo formulario, mismo administrador, mismos pasos— porque justo eso es lo
 * que se está entrenando. Duplicar el alta habría creado un segundo camino que
 * se desincroniza con el primero al tercer cambio.
 */

import { revalidatePath } from 'next/cache'
import type { AuditAccion, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import { purgarClienteRow } from '@/modules/superadmin/purgar'
// La acción y la pantalla cuentan lo mismo con el mismo código.
import { contarDatosDemo } from '@/modules/demo'

export interface DemoState {
  error?: string
  success?: boolean
  mensaje?: string
}

/** Guard sin redirect (estamos dentro de una server action). */
async function requireSuperadmin() {
  const user = await getUser()
  if (!user || user.metadata.role !== 'SUPERADMIN') return null
  return user
}

async function auditar(
  companyId: string,
  userId: string | null,
  accion: AuditAccion,
  payload: Record<string, unknown>
) {
  const meta = await getRequestMeta().catch(() => ({ ipAddress: null, userAgent: null }))
  await prisma.auditLog
    .create({
      data: {
        companyId,
        userId,
        accion,
        entidadTipo: 'Company',
        entidadId: companyId,
        payload: payload as Prisma.InputJsonValue,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    })
    .catch((e) => console.error('[demo] audit:', e))
}

/**
 * Marca o desmarca una empresa como de demostración.
 *
 * DESMARCAR ES LO PELIGROSO, no marcar. Una empresa que fue de práctica trae
 * dentro clientes inventados, cobros de mentira y números que no ocurrieron;
 * si se "asciende" a real, toda esa basura entra en las estadísticas de la
 * plataforma como si fuera negocio. Por eso desmarcar exige que esté vacía:
 * primero se reinicia, después se convierte.
 */
export async function marcarComoDemo(
  _prev: DemoState,
  formData: FormData
): Promise<DemoState> {
  try {
    const user = await requireSuperadmin()
    if (!user) return { error: 'No autorizado.' }

    const companyId = String(formData.get('companyId') ?? '').trim()
    const activar = String(formData.get('activar') ?? '') === '1'
    if (!companyId) return { error: 'Empresa no especificada.' }

    const empresa = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, isPublished: true },
    })
    if (!empresa) return { error: 'Empresa no encontrada.' }

    if (!activar) {
      const datos = await contarDatosDemo(companyId)
      const total = Object.values(datos).reduce((s, n) => s + n, 0)
      if (total > 0) {
        return {
          error:
            'Esta empresa todavía tiene datos de práctica. Reiníciala primero: si se convierte en real con ellos dentro, los números inventados pasan a contar como reales.',
        }
      }
    }

    await prisma.company.update({
      where: { id: companyId },
      data: {
        esDemo: activar,
        // Una empresa de práctica sale de la vitrina en el mismo movimiento.
        // Que se marque como demo y siga publicada sería exactamente el error
        // que esta función existe para evitar.
        ...(activar ? { isPublished: false } : {}),
      },
    })

    await auditar(companyId, user.metadata.dbUserId ?? null, 'EMPRESA_DEMO_CAMBIADA', {
      nombre: empresa.name,
      esDemo: activar,
      despublicada: activar && empresa.isPublished,
    })

    revalidatePath('/superadmin/demo')
    revalidatePath('/superadmin/dashboard')
    revalidatePath('/superadmin/empresas')
    revalidatePath('/empresas')
    return {
      success: true,
      mensaje: activar
        ? `"${empresa.name}" es ahora una empresa de demostración.`
        : `"${empresa.name}" vuelve a ser una empresa real.`,
    }
  } catch (e) {
    console.error('[demo] marcarComoDemo:', e)
    return {
      error:
        'No se pudo cambiar la marca. Si la columna esDemo todavía no está migrada, corre la migración 20260767_empresa_demo.',
    }
  }
}

/**
 * Deja la empresa de práctica lista para el siguiente grupo.
 *
 * QUÉ BORRA: lo que genera un entrenamiento — clientes, sus membresías,
 * compras, visitas y QR; los cobros y las sesiones de caja; y el trabajo de
 * pista (cola, incidencias, comisiones, turnos, cargos a flotas).
 *
 * QUÉ NO BORRA: la configuración. Planes, promociones, servicios, precios,
 * tipos de vehículo, bahías, empleados y capacidades se quedan. Es lo que
 * costó montar y lo que hace que el entrenamiento se parezca a la realidad;
 * borrarlo obligaría a rearmar la empresa cada vez y, a la tercera vez, nadie
 * la rearma y se entrena sobre la empresa de verdad.
 *
 * SOLO SOBRE EMPRESAS MARCADAS COMO DEMO. La comprobación se hace aquí dentro,
 * no en la pantalla: una pantalla se puede saltar.
 */
export async function reiniciarDemo(
  _prev: DemoState,
  formData: FormData
): Promise<DemoState> {
  try {
    const user = await requireSuperadmin()
    if (!user) return { error: 'No autorizado.' }

    const companyId = String(formData.get('companyId') ?? '').trim()
    if (!companyId) return { error: 'Empresa no especificada.' }

    const empresa = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, esDemo: true },
    })
    if (!empresa) return { error: 'Empresa no encontrada.' }
    if (!empresa.esDemo) {
      return {
        error: 'Esta empresa NO está marcada como de demostración. Reiniciar solo se permite sobre empresas de práctica.',
      }
    }

    // Confirmación escrita, verificada también en el servidor.
    if (String(formData.get('confirmacion') ?? '').trim().toUpperCase() !== 'REINICIAR') {
      return { error: 'Escribe REINICIAR para confirmar.' }
    }

    const antes = await contarDatosDemo(companyId)

    // ── Orden de borrado ────────────────────────────────────────────────────
    // De las hojas hacia la raíz. Lo que el esquema borra en cascada
    // (servicios de la cola, transiciones, impresiones, evidencias) no lleva
    // paso propio.

    // 1· Pista. Las incidencias van primero porque apuntan a entradas de cola.
    await prisma.incidencia.deleteMany({ where: { companyId } })
    await prisma.comision.deleteMany({ where: { companyId } })
    await prisma.cargoCuenta.deleteMany({ where: { cuenta: { companyId } } })
    await prisma.colaVehiculo.deleteMany({ where: { companyId } })
    await prisma.turno.deleteMany({ where: { companyId } })

    // 2· Dinero. Transacciones antes que las sesiones de caja que las agrupan.
    await prisma.transaction.deleteMany({ where: { companyId } })
    await prisma.movimientoCaja.deleteMany({ where: { companyId } })
    await prisma.cajaSesion.deleteMany({ where: { companyId } })
    await prisma.pagoIntento.deleteMany({ where: { companyId } }).catch(() => ({ count: 0 }))

    // 3· Compras y membresías que no cuelgan de un cliente (o que quedaron
    //    sueltas), antes de borrar a los clientes.
    await prisma.comprobante.deleteMany({ where: { membership: { companyId } } })
    await prisma.membership.deleteMany({ where: { companyId } })
    await prisma.productoCompra.deleteMany({ where: { companyId } })

    // 4· Clientes, uno a uno con la misma purga que usa el borrado individual.
    const clientes = await prisma.cliente.findMany({
      where: { companyId },
      select: { id: true },
    })
    for (const c of clientes) await purgarClienteRow(c.id)

    await auditar(companyId, user.metadata.dbUserId ?? null, 'EMPRESA_DEMO_REINICIADA', {
      nombre: empresa.name,
      borrado: antes,
    })

    revalidatePath('/superadmin/demo')
    revalidatePath('/superadmin/dashboard')
    return {
      success: true,
      mensaje: `"${empresa.name}" quedó limpia: ${antes.clientes} cliente(s) y ${antes.transacciones} cobro(s) de práctica borrados. La configuración se conservó.`,
    }
  } catch (e) {
    console.error('[demo] reiniciarDemo:', e)
    return { error: 'No se pudo reiniciar. Revisa el registro del servidor.' }
  }
}
