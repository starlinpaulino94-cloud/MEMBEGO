import type { NextRequest } from 'next/server'
import { sinEmpresa } from '@/lib/tenant'
import { verificarTokenSSO } from '@/modules/integraciones/nucleo'
import { autenticar, autorizarEmpresa, esFallo } from '@/modules/plataforma/api'
import { errorApi, respuestaApi } from '@/modules/plataforma/errores'
import { marcarTokenUsado } from '@/modules/plataforma/sso'

export const dynamic = 'force-dynamic'

/**
 * POST /api/platform/v1/sso/redeem — canjear un token SSO de MembeGo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE, SI EL SATÉLITE YA PUEDE VERIFICAR EL TOKEN SOLO
 *
 * Puede, y seguirá pudiendo. Pero verificando por su cuenta **no hay uso
 * único**: MembeGo no se entera de esa verificación, así que el mismo token
 * vale las veces que se use durante sus 90 segundos. Quien capture la URL —el
 * historial del navegador, un `Referer`, un log de proxy— entra.
 *
 * Canjeando aquí, el `jti` se registra en MembeGo: el primero gana y el segundo
 * recibe `SSO_TOKEN_ALREADY_USED`. Es la única forma de que la garantía sea
 * nuestra y no una promesa de cada satélite.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * COMPATIBLE A PROPÓSITO
 *
 * El camino antiguo no se rompe ni se avisa con un plazo: un satélite migra
 * cuando quiere. Lo que cambia es que **el que migra gana algo**, en vez de
 * tener que cambiar para seguir igual.
 */

interface Cuerpo {
  token?: string
}

export async function POST(req: NextRequest) {
  // Sin scope: canjear el token que MembeGo acaba de emitir PARA ESTE sistema
  // no es un recurso de ninguna empresa, es la relación del sistema con MembeGo.
  const ctx = await autenticar(req, null)
  if (esFallo(ctx)) return ctx.fallo

  const cuerpo = (await req.json().catch(() => ({}))) as Cuerpo
  const token = cuerpo.token?.trim() ?? ''
  if (!token) {
    return errorApi('INVALID_REQUEST', ctx.requestId, { message: 'token is required.' })
  }

  const secreto = await sinEmpresa(
    'sso: secreto del sistema que canjea su propio token (catálogo global)',
    (tx) =>
      tx.sistemaConectado.findUnique({
        where: { id: ctx.sistemaId },
        select: { secreto: true },
      })
  ).catch(() => null)
  if (!secreto) return errorApi('INTERNAL_ERROR', ctx.requestId)

  // Se verifica con el secreto de QUIEN LLAMA, no con el del sistema que
  // aparezca en el token. Un sistema no puede canjear un token emitido para
  // otro: no lo verificaría, porque no es su firma.
  const datos = verificarTokenSSO(secreto.secreto, token)
  if (!datos) {
    console.warn('[sso-redeem] token inválido o vencido:', ctx.sistemaSlug, ctx.requestId)
    return errorApi('SSO_TOKEN_INVALID', ctx.requestId)
  }

  // La empresa del token, contra las habilitaciones. El token la lleva firmada
  // por nosotros, así que no puede haber sido manipulada — pero la habilitación
  // pudo revocarse en los 90 segundos que lleva vivo, y esa es la comprobación
  // que importa.
  const empresa = await autorizarEmpresa(ctx, datos.companyId)
  if (esFallo(empresa)) return empresa.fallo

  if (!datos.jti) {
    // Tokens emitidos antes de la Fase 5. Se canjean, y se avisa: sin `jti` no
    // hay nada que registrar y el uso único no se puede garantizar.
    console.warn('[sso-redeem] token sin jti (sin uso único):', ctx.sistemaSlug)
  } else {
    const canje = await marcarTokenUsado({
      jti: datos.jti,
      sistemaId: ctx.sistemaId,
      companyId: datos.companyId,
      direccion: 'SALIENTE',
      expiraAt: new Date(datos.exp * 1000),
    })
    if (canje === 'YA_USADO') {
      console.warn('[sso-redeem] token ya canjeado:', ctx.sistemaSlug, datos.jti)
      return errorApi('SSO_TOKEN_ALREADY_USED', ctx.requestId)
    }
  }

  return respuestaApi(
    {
      sub: datos.sub,
      email: datos.email,
      nombre: datos.nombre ?? null,
      /** Rol en MembeGo. NO es el puesto dentro del vertical. */
      membegoRole: datos.rol,
      /** Puesto dentro del vertical. `null` si nadie se lo asignó. */
      systemRole: datos.systemRole ?? null,
      permisos: datos.permisos ?? null,
      companyId: datos.companyId,
      returnUrl: datos.returnUrl ?? null,
      expiresAt: new Date(datos.exp * 1000).toISOString(),
    },
    ctx.requestId
  )
}
