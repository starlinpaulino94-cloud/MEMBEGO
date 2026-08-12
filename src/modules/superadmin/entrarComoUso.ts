import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import { huellaToken, VENTANA_CANJE_MS } from './entrarComo'

/**
 * REGISTRAR QUE LA SUPLANTACIÓN OCURRIÓ.
 *
 * Lo llama `/confirmar` justo DESPUÉS de que el token se canjeó con éxito. Ese
 * orden importa: solo se registra lo que de verdad pasó, no cada vez que
 * alguien prueba un enlace caducado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ NO PUEDE HACER ESTA FUNCIÓN, PASE LO QUE PASE: romper el login.
 *
 * `/confirmar` es camino compartido — por ahí entra también quien acaba de
 * verificar su correo. Un fallo aquí (la base caída, la migración del enum sin
 * correr) no puede dejar a nadie fuera de su cuenta. De ahí el `try/catch` que
 * se lo traga todo y el `false` de retorno: si no se pudo registrar, se anota
 * en el log del servidor y la sesión sigue su curso.
 *
 * Es un fail-open consciente, y tiene su coste: en el peor momento —la base con
 * problemas— es cuando el rastro puede faltar. Se acepta porque la alternativa
 * es peor: que un error de escritura en la bitácora impida entrar a gente que
 * no tiene nada que ver con esto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A NOMBRE DE QUIÉN QUEDA.
 *
 * `userId` = el superadmin que generó el enlace. Es la corrección entera: la
 * bitácora tiene una línea cuyo autor es QUIEN SUPLANTA, no la persona
 * suplantada, y `entidadId` dice a quién. Todo lo que venga después seguirá
 * atribuido al suplantado —eso solo lo arreglaría marcar la sesión entera—,
 * pero ahora hay una línea con hora exacta e IP que dice desde cuándo hay que
 * leer lo demás con esa sospecha.
 */
export async function registrarUsoEntrarComo(
  hashedToken: string,
  contexto: { ip?: string | null; userAgent?: string | null } = {}
): Promise<boolean> {
  try {
    const huella = huellaToken(hashedToken)
    const desde = new Date(Date.now() - VENTANA_CANJE_MS)

    return await sinEmpresa(
      'superadmin: registrar que se usó un enlace de «entrar como»',
      async (tx) => {
        const generado = await tx.auditLog.findFirst({
          where: {
            accion: 'ENTRAR_COMO_GENERADO',
            createdAt: { gte: desde },
            payload: { path: ['huella'], equals: huella },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            companyId: true,
            userId: true,
            entidadId: true,
            createdAt: true,
            payload: true,
          },
        })

        // Lo normal: un enlace de verificación de correo corriente. No hay nada
        // que registrar y no se ha escrito nada.
        if (!generado) return false

        // El enlace es de un solo uso, así que un segundo canje no debería
        // llegar hasta aquí. Se comprueba igual: una línea repetida en un
        // registro de seguridad es justo lo que hace dudar del resto cuando se
        // está investigando algo.
        const yaRegistrado = await tx.auditLog.count({
          where: {
            accion: 'ENTRAR_COMO_USADO',
            payload: { path: ['enlaceId'], equals: generado.id },
          },
        })
        if (yaRegistrado > 0) return false

        const previo = (generado.payload ?? {}) as Record<string, unknown>
        await tx.auditLog.create({
          data: {
            companyId: generado.companyId,
            // Quien suplanta. La línea es SUYA.
            userId: generado.userId,
            accion: 'ENTRAR_COMO_USADO',
            entidadTipo: 'User',
            // A quién suplantó.
            entidadId: generado.entidadId,
            payload: {
              email: typeof previo.email === 'string' ? previo.email : null,
              por: typeof previo.por === 'string' ? previo.por : null,
              enlaceId: generado.id,
              generadoEn: generado.createdAt.toISOString(),
            },
            ipAddress: contexto.ip ?? null,
            userAgent: contexto.userAgent ?? null,
          },
        })
        return true
      }
    )
  } catch (e) {
    console.error('[entrar-como] no se pudo registrar el uso del enlace:', e)
    return false
  }
}
