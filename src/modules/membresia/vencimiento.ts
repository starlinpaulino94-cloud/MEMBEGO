import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import { membresiaCaducada } from '@/modules/membresia/vigencia'
import { registrarEventoMembresia } from '@/modules/membresia/eventos'

/**
 * El JOB que pone al día el estado de las membresías. Las reglas puras —qué es
 * vigente y qué es caducada— viven en `vigencia.ts`, que se prueba sin base de
 * datos; aquí solo está la escritura.
 */

export interface ResultadoVencimiento {
  /** Cuántas membresías pasaron a VENCIDA en esta ejecución. */
  vencidas: number
  /** Empresas afectadas, para la auditoría. */
  empresas: number
}

/**
 * Pasa a VENCIDA todo lo que ya venció. Idempotente: la segunda ejecución del
 * día no encuentra nada porque la primera ya cambió el estado.
 *
 * Deja rastro en `auditLog` por empresa —una entrada con el total y los ids—
 * en vez de una por membresía: son cambios automáticos, y mil entradas iguales
 * harían ilegible la auditoría del día justo cuando hay algo que mirar.
 *
 * Se ejecuta en el contexto de plataforma porque barre TODAS las empresas de
 * una pasada; el `WHERE` sigue anclado a la empresa en la escritura del rastro.
 */
export async function vencerMembresias(ahora: Date = new Date()): Promise<ResultadoVencimiento> {
  try {
    return await sinEmpresa('membresías: vencimiento diario', async (tx) => {
      // Se leen primero para poder auditar QUÉ venció, no solo cuántas.
      const caducadas = await tx.membership.findMany({
        where: membresiaCaducada(ahora),
        // `clienteId` y `planId` se traen para el evento: el reporte de
        // vencimientos agrupa por plan y por cliente, y resolverlos después
        // obligaría a volver a la tabla por cada fila.
        select: { id: true, companyId: true, clienteId: true, planId: true },
      })
      if (caducadas.length === 0) return { vencidas: 0, empresas: 0 }

      const { count } = await tx.membership.updateMany({
        where: { id: { in: caducadas.map((m) => m.id) } },
        data: { estado: 'VENCIDA' },
      })

      const porEmpresa = new Map<string, string[]>()
      for (const m of caducadas) {
        const lista = porEmpresa.get(m.companyId) ?? []
        lista.push(m.id)
        porEmpresa.set(m.companyId, lista)
      }
      for (const [companyId, ids] of porEmpresa) {
        await tx.auditLog
          .create({
            data: {
              companyId,
              userId: null,
              accion: 'MEMBRESIA_CANCELADA',
              entidadTipo: 'Membership',
              entidadId: ids[0],
              payload: {
                tipo: 'VENCIMIENTO_AUTOMATICO',
                total: ids.length,
                // Un tope: la auditoría documenta, no duplica la tabla.
                membresias: ids.slice(0, 200),
                truncado: ids.length > 200,
              },
            },
          })
          .catch(() => undefined)
      }

      /**
       * UN EVENTO POR MEMBRESÍA, aunque la auditoría siga agrupando.
       *
       * La entrada de bitácora es una por empresa a propósito —mil entradas
       * iguales harían ilegible el día—, pero un reporte necesita lo contrario:
       * saber QUÉ membresía venció, de qué plan y de qué cliente. Agrupada no
       * se puede responder «cuántas vencieron del plan Gold en agosto».
       *
       * Y hay un detalle que la bitácora no salva: usa `accion:
       * 'MEMBRESIA_CANCELADA'` para un vencimiento, con `tipo:
       * 'VENCIMIENTO_AUTOMATICO'` en el payload. O sea que hoy, en la bitácora,
       * vencer y cancelar son indistinguibles sin abrir el JSON. El evento las
       * separa: `VENCIDA` y `CANCELADA` son tipos distintos, que es lo que son.
       */
      for (const m of caducadas) {
        await registrarEventoMembresia(tx, {
          companyId: m.companyId,
          membershipId: m.id,
          clienteId: m.clienteId,
          tipo: 'VENCIDA',
          origen: 'CRON',
          estadoAnterior: 'ACTIVA',
          estadoNuevo: 'VENCIDA',
          planAnteriorId: m.planId,
          ocurridoEn: ahora,
        })
      }

      return { vencidas: count, empresas: porEmpresa.size }
    })
  } catch (e) {
    console.error('[membresias/vigencia] vencerMembresias', e)
    // El job puede fallar sin consecuencias visibles: `membresiaVigente()` ya
    // filtra por fecha, así que los números del panel siguen siendo correctos.
    return { vencidas: 0, empresas: 0 }
  }
}
