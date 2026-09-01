import 'server-only'
import { createHash } from 'crypto'
import type { NextRequest, NextResponse } from 'next/server'
import { sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { getPlatformTokenSecret } from '@/lib/env'
import { createRateLimiter } from '@/lib/rate-limit'
import { scopesEfectivos } from '@/modules/plataforma/credenciales'
import { errorApi, nuevoRequestId, type CodigoError } from '@/modules/plataforma/errores'
import { tokenDeCabecera, verificarToken } from '@/modules/plataforma/token'
import { accesoASistema } from '@/modules/plataforma/registro'

/**
 * PLATAFORMA · Fase 2 — LA GUARDIA DE LA API v1.
 *
 * Toda ruta bajo `/api/platform/v1` empieza aquí. Es el único sitio donde se
 * decide quién entra, con qué permisos y sobre qué empresa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE NO SE PUEDE ROMPER
 *
 * **El `companyId` que llega por la red no se cree nunca.**
 *
 * Un satélite manda `?companyId=…` porque tiene que decir de qué empresa habla;
 * eso no lo autoriza a hablar de ella. `autorizarEmpresa` comprueba, en cada
 * petición, que ese sistema tiene esa empresa habilitada — con la misma regla
 * de la Fase 1b que usan el SSO y el despacho de eventos.
 *
 * Sin esa comprobación, el sistema del restaurante de la esquina pediría
 * `?companyId=<el del car wash>` y leería sus clientes. No haría falta ningún
 * fallo: sería el comportamiento.
 *
 * Por eso el token NO lleva la empresa dentro (ver `token.ts`): si viajara
 * firmada, saltarse esta comprobación parecería razonable.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES BARRERAS, EN ESTE ORDEN
 *
 *   1. ¿Quién eres?      token válido + credencial ACTIVE
 *   2. ¿Puedes hacerlo?  scope requerido ∈ scopes efectivos
 *   3. ¿Sobre quién?     la empresa está habilitada para tu sistema
 *
 * El orden importa: sin (1) no hay a quién contarle nada de (2), y contestar
 * (3) antes que (2) le diría a un sistema sin permisos qué empresas existen.
 */

/**
 * Límite por credencial. Generoso —un satélite en hora punta consulta mucho— y
 * suficiente para que un bucle roto no se lleve la base por delante.
 *
 * Se cuenta por `clientId` y no por IP: los satélites viven en plataformas
 * serverless donde la IP cambia en cada invocación, así que limitar por IP no
 * limitaría nada.
 */
const limitePlataforma = createRateLimiter({
  interval: 60_000,
  maxRequests: 600,
  name: 'platform-api',
})

export interface ContextoApi {
  requestId: string
  credencialId: string
  clientId: string
  sistemaId: string
  sistemaSlug: string
  /** Scopes del token ∩ los concedidos hoy a la credencial. */
  scopes: string[]
}

type Fallo = { fallo: NextResponse; requestId: string }

function esFallo(r: unknown): r is Fallo {
  return typeof r === 'object' && r !== null && 'fallo' in r
}

/**
 * Autentica la petición y comprueba UN scope.
 *
 * Devuelve el contexto o la respuesta de error ya construida — quien llama solo
 * tiene que devolverla. Es a propósito: una guardia que devuelve `null` obliga
 * a cada ruta a inventarse el error, y basta una que se equivoque de código
 * para que el satélite ramifique mal.
 *
 * `scopeRequerido: null` significa «basta con estar autenticado», y está
 * reservado a los recursos que describen la RELACIÓN del sistema con MembeGo
 * —quién eres, qué empresas tienes habilitadas, cómo se llama y en qué moneda
 * cobra una de ellas—. Pedir un scope para eso sería pedir uno que todo
 * manifest incluiría siempre: un permiso que tiene todo el mundo no es un
 * permiso, es ruido en la revisión.
 */
export async function autenticar(
  req: NextRequest,
  scopeRequerido: string | null
): Promise<ContextoApi | Fallo> {
  const requestId = nuevoRequestId()
  const negar = (code: CodigoError, extra?: { requiredScope?: string }) => ({
    fallo: errorApi(code, requestId, extra),
    requestId,
  })

  const secretoFirma = getPlatformTokenSecret()
  if (!secretoFirma) return negar('PLATFORM_API_UNCONFIGURED')

  const token = tokenDeCabecera(req.headers.get('authorization'))
  if (!token) return negar('INVALID_TOKEN')

  const verificado = verificarToken(secretoFirma, token)
  if (!verificado.ok) {
    // DIAG TEMPORAL: la huella del secreto que ESTE handler usó para verificar,
    // para compararla con la que usó /oauth/token al firmar. Si difieren, el
    // token se firmó y se verificó con secretos distintos. Borrar tras el fix.
    const verifyFp = createHash('sha256').update(secretoFirma).digest('hex').slice(0, 12)
    return {
      fallo: errorApi(verificado.fallo === 'EXPIRED' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN', requestId, {
        reason: `verify_fp=${verifyFp} fallo=${verificado.fallo}`,
      }),
      requestId,
    }
  }

  // El límite se cuenta ANTES de tocar la base y DESPUÉS de verificar la firma:
  // antes de la firma, cualquiera podría gastar la cuota de un `clientId` ajeno
  // mandando basura con su nombre.
  if (!(await limitePlataforma(`platform:${verificado.datos.cid}`))) {
    return negar('RATE_LIMITED')
  }

  // Estado y scopes se releen en CADA petición. Revocar una credencial o
  // recortarle permisos tiene que cerrar la puerta ya, no cuando caduque el
  // token que alguien pidió hace catorce minutos.
  const credencial = await leerCredencial(verificado.datos.cid)
  if (!credencial) return negar('INVALID_TOKEN')

  const scopes = scopesEfectivos(verificado.datos.scopes, credencial.scopes)
  if (scopeRequerido !== null && !scopes.includes(scopeRequerido)) {
    return negar('INSUFFICIENT_SCOPE', { requiredScope: scopeRequerido })
  }

  return {
    requestId,
    credencialId: credencial.id,
    clientId: credencial.clientId,
    sistemaId: credencial.sistemaId,
    sistemaSlug: credencial.sistemaSlug,
    scopes,
  }
}

export interface CredencialViva {
  id: string
  clientId: string
  sistemaId: string
  sistemaSlug: string
  scopes: string[]
}

/**
 * Credencial utilizable AHORA: existe, está ACTIVE y no ha caducado.
 *
 * `sinEmpresa` porque una credencial pertenece a un sistema, no a un inquilino:
 * el sistema atiende a muchas empresas y esta lectura ocurre antes de saber de
 * cuál se va a hablar. El aislamiento no se juega aquí, se juega en
 * `autorizarEmpresa`.
 */
export async function leerCredencial(clientId: string): Promise<CredencialViva | null> {
  try {
    const c = await sinEmpresa(
      'api de plataforma: credencial del sistema llamante (previa a conocer la empresa)',
      (tx) =>
        tx.credencialSistema.findUnique({
          where: { clientId },
          select: {
            id: true,
            clientId: true,
            sistemaId: true,
            estado: true,
            scopes: true,
            expiresAt: true,
            sistema: { select: { slug: true } },
          },
        })
    )
    if (!c || c.estado !== 'ACTIVE') return null
    if (c.expiresAt && c.expiresAt.getTime() <= Date.now()) return null
    return {
      id: c.id,
      clientId: c.clientId,
      sistemaId: c.sistemaId,
      sistemaSlug: c.sistema.slug,
      scopes: c.scopes,
    }
  } catch (e) {
    console.error('[platform-api] no se pudo leer la credencial:', e)
    return null
  }
}

/**
 * ¿Puede este sistema hablar de esta empresa?
 *
 * Reutiliza `accesoASistema` de la Fase 1b, así que la respuesta es exactamente
 * la misma que da el SSO y la que usa el despacho de eventos: quitarle la
 * habilitación a una empresa la saca de los tres caminos a la vez.
 *
 * El motivo concreto va al log y NO a la respuesta. Al satélite se le dice solo
 * `COMPANY_NOT_ENTITLED`: distinguir «esa empresa no existe» de «existe pero no
 * es tuya» convertiría la API en una forma de enumerar los clientes de MembeGo.
 */
export async function autorizarEmpresa(
  ctx: ContextoApi,
  companyId: string | null | undefined
): Promise<{ companyId: string } | Fallo> {
  if (!companyId || !/^[a-z0-9_-]{1,64}$/i.test(companyId)) {
    return { fallo: errorApi('INVALID_REQUEST', ctx.requestId, {
      message: 'companyId is required and must be a valid identifier.',
    }), requestId: ctx.requestId }
  }

  const { decision } = await accesoASistema(ctx.sistemaSlug, companyId)
  if (!decision.permitido) {
    console.warn(
      '[platform-api] empresa no habilitada:',
      ctx.sistemaSlug, '→', companyId, decision.motivo, ctx.requestId
    )
    return { fallo: errorApi('COMPANY_NOT_ENTITLED', ctx.requestId), requestId: ctx.requestId }
  }
  return { companyId }
}

/**
 * Autenticar y autorizar la empresa de un tirón — el caso de casi todas las
 * rutas. Existe para que ninguna se olvide del segundo paso: la forma más fácil
 * de escribir una fuga es llamar a `autenticar` y usar el `companyId` de la
 * query directamente.
 */
export async function autenticarSobreEmpresa(
  req: NextRequest,
  scopeRequerido: string | null,
  companyId: string | null | undefined
): Promise<{ ctx: ContextoApi; companyId: string } | Fallo> {
  const ctx = await autenticar(req, scopeRequerido)
  if (esFallo(ctx)) return ctx

  const empresa = await autorizarEmpresa(ctx, companyId)
  if (esFallo(empresa)) return empresa

  return { ctx, companyId: empresa.companyId }
}

export { esFallo }

/**
 * Sella el último uso de la credencial. Se llama al EMITIR el token, no en cada
 * petición: con tokens de quince minutos eso es una escritura por satélite cada
 * cuarto de hora en vez de una por llamada, y para lo que sirve el dato —«¿sigue
 * vivo este satélite o puedo revocar la credencial?»— la diferencia no existe.
 *
 * Best-effort: un fallo aquí no puede tumbar la emisión de un token.
 */
export function anotarUso(credencialId: string): void {
  void sinEmpresa('api de plataforma: sello de último uso de la credencial', (tx) =>
    tx.credencialSistema.update({
      where: { id: credencialId },
      data: { lastUsedAt: new Date() },
    })
  ).catch(anotarFallo('platform-api:ultimo-uso', { credencialId }))
}
