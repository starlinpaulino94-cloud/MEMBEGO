import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { getPlatformTokenSecret } from '@/lib/env'
import { anotarConector } from '@/modules/connect/bitacora'
import { guardarCredencial, leerCredencial } from '@/modules/connect/credenciales'
import { anotarSalud } from '@/modules/connect/registro'
import {
  VIDA_ESTADO_S,
  firmarEstado,
  fusionarTokens,
  leerEstado,
  necesitaRefresco,
  nuevoPkce,
  urlDeAutorizacion,
  type ConfigOauthConector,
  type TokensOauth,
} from '@/modules/connect/oauthNucleo'

/**
 * GESTOR OAUTH de Membego Connect (Fase 5).
 *
 * Tres momentos: iniciar (mandar al usuario al proveedor), volver (canjear el
 * código por tokens) y mantener (refrescar antes de que venza).
 *
 * Los tokens NUNCA salen de aquí en claro hacia otra capa: se guardan sellados
 * con AES-256-GCM (`credenciales.ts`) y `accessTokenVigente` los devuelve solo
 * a quien va a llamar al proveedor en ese instante.
 */

/** Los proveedores viven en la config del conector, no en el código. */
// El tipo vive en el núcleo puro desde la Fase 10, para que el registro de
// proveedores lo pueda declarar sin importar esta capa. Se reexporta aquí para
// no romper a quien ya lo importaba de este módulo.
export type { ConfigOauthConector } from '@/modules/connect/oauthNucleo'

export type ResultadoInicio =
  | { ok: true; url: string }
  | { ok: false; motivo: 'sin_secreto_firma' | 'conexion_no_existe' }

/**
 * Prepara el flujo y devuelve a dónde mandar al usuario.
 *
 * El `code_verifier` de PKCE queda en la base y NO viaja: si viajara —en la
 * URL, en una cookie legible— PKCE dejaría de proteger.
 */
export async function iniciarOauth(input: {
  companyId: string
  conexionId: string
  conectorSlug: string
  config: ConfigOauthConector
  redirectUri: string
  iniciadoPor?: string | null
  volverA?: string | null
}): Promise<ResultadoInicio> {
  const secretoFirma = getPlatformTokenSecret()
  if (!secretoFirma) return { ok: false, motivo: 'sin_secreto_firma' }

  const conexion = await conEmpresa(input.companyId, (tx) =>
    tx.conexionEmpresa.findFirst({
      where: { id: input.conexionId, companyId: input.companyId },
      select: { id: true },
    })
  )
  if (!conexion) return { ok: false, motivo: 'conexion_no_existe' }

  const pkce = nuevoPkce()
  const fila = await conEmpresa(input.companyId, (tx) =>
    tx.estadoOAuth.create({
      data: {
        companyId: input.companyId,
        conexionId: input.conexionId,
        conectorSlug: input.conectorSlug,
        codeVerifier: pkce.verifier,
        iniciadoPor: input.iniciadoPor ?? null,
        volverA: input.volverA ?? null,
        expiraAt: new Date(Date.now() + VIDA_ESTADO_S * 1000),
      },
      select: { id: true },
    })
  )

  const state = firmarEstado(secretoFirma, { id: fila.id, iat: Math.floor(Date.now() / 1000) })
  return {
    ok: true,
    url: urlDeAutorizacion({
      proveedor: input.config,
      redirectUri: input.redirectUri,
      scopes: input.config.scopes,
      state,
      challenge: pkce.challenge,
    }),
  }
}

export type MotivoFalloCallback =
  | 'sin_secreto_firma'
  | 'estado_invalido'
  | 'estado_usado_o_vencido'
  | 'proveedor_rechazo'

export type ResultadoCallback =
  | { ok: true; companyId: string; conexionId: string; volverA: string | null }
  | { ok: false; motivo: MotivoFalloCallback }

/**
 * Cierra el flujo: valida el estado, lo CONSUME y canjea el código.
 *
 * El consumo es un `deleteMany` condicionado, y su `count` es la autorización:
 * si vale cero, otro ya canjeó ese estado (o caducó) y aquí no se sigue. No
 * hay lectura previa, así que no hay ventana entre comprobar y borrar — el
 * mismo mecanismo que el `jti` de un solo uso del SSO.
 */
export async function completarOauth(input: {
  state: string
  code: string
  redirectUri: string
  /** Resuelve la config del conector por su slug (la trae quien llama). */
  configDe: (slug: string) => ConfigOauthConector | null
}): Promise<ResultadoCallback> {
  const secretoFirma = getPlatformTokenSecret()
  if (!secretoFirma) return { ok: false, motivo: 'sin_secreto_firma' }

  // 1. La firma se mira ANTES que la base: basura en el callback no debe
  // costar una consulta.
  const lectura = leerEstado(secretoFirma, input.state)
  if (!lectura.ok) return { ok: false, motivo: 'estado_invalido' }

  // 2. Leer y CONSUMIR. El delete es la exclusión mutua.
  const fila = await sinEmpresa(
    'connect: estado OAuth por id (callback sin sesión de empresa)',
    (tx) =>
      tx.estadoOAuth.findUnique({
        where: { id: lectura.estado.id },
        select: {
          id: true,
          companyId: true,
          conexionId: true,
          conectorSlug: true,
          codeVerifier: true,
          volverA: true,
          expiraAt: true,
        },
      })
  ).catch(() => null)
  if (!fila || fila.expiraAt.getTime() <= Date.now()) {
    return { ok: false, motivo: 'estado_usado_o_vencido' }
  }

  const consumido = await sinEmpresa('connect: consumir el estado OAuth (uso único)', (tx) =>
    tx.estadoOAuth.deleteMany({ where: { id: fila.id } })
  ).catch(() => ({ count: 0 }))
  if (consumido.count === 0) return { ok: false, motivo: 'estado_usado_o_vencido' }

  const config = input.configDe(fila.conectorSlug)
  if (!config) return { ok: false, motivo: 'proveedor_rechazo' }

  // 3. Canjear el código. El `code_verifier` sale de la base, no del navegador.
  const tokens = await canjearCodigo({
    config,
    code: input.code,
    redirectUri: input.redirectUri,
    codeVerifier: fila.codeVerifier,
  })
  if (!tokens) {
    await anotarSalud({
      companyId: fila.companyId,
      conexionId: fila.conexionId,
      resultado: { ok: false, error: 'El proveedor rechazó el intercambio del código.' },
    })
    return { ok: false, motivo: 'proveedor_rechazo' }
  }

  await guardarTokens(fila.companyId, fila.conexionId, tokens.tokens, tokens.expiresAt)
  await anotarSalud({
    companyId: fila.companyId,
    conexionId: fila.conexionId,
    resultado: { ok: true },
  })
  await anotarConector({
    companyId: fila.companyId,
    origen: 'CONEXION',
    origenId: fila.conexionId,
    evento: 'oauth.conectado',
    detalle: { conector: fila.conectorSlug, scopes: tokens.tokens.scopes?.length ?? 0 },
  })

  return {
    ok: true,
    companyId: fila.companyId,
    conexionId: fila.conexionId,
    volverA: fila.volverA,
  }
}

interface RespuestaToken {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

/** POST al endpoint de token del proveedor. Devuelve null si no aprobó. */
async function canjearCodigo(input: {
  config: ConfigOauthConector
  code: string
  redirectUri: string
  codeVerifier: string
}): Promise<{ tokens: TokensOauth; expiresAt: Date | null } | null> {
  const secretoCliente = process.env[input.config.clientSecretEnv]
  if (!secretoCliente) {
    console.error('[connect] falta la variable', input.config.clientSecretEnv)
    return null
  }

  const cuerpo = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.config.clientId,
    client_secret: secretoCliente,
    code_verifier: input.codeVerifier,
  })

  return pedirTokens(input.config.urlToken, cuerpo)
}

async function pedirTokens(
  url: string,
  cuerpo: URLSearchParams
): Promise<{ tokens: TokensOauth; expiresAt: Date | null } | null> {
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: cuerpo.toString(),
      signal: AbortSignal.timeout(15_000),
    })
    if (!resp.ok) {
      // El cuerpo del proveedor NO se registra: en un error de OAuth puede
      // venir el código, o el propio token si el proveedor es descuidado.
      console.error('[connect] el proveedor rechazó el token:', resp.status)
      return null
    }
    const json = (await resp.json()) as RespuestaToken
    if (!json.access_token) return null
    return {
      tokens: {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? null,
        scopes: json.scope ? json.scope.split(' ').filter(Boolean) : undefined,
      },
      expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
    }
  } catch (e) {
    console.error('[connect] no se pudo contactar al proveedor de OAuth:', e)
    return null
  }
}

async function guardarTokens(
  companyId: string,
  conexionId: string,
  tokens: TokensOauth,
  expiresAt: Date | null
): Promise<void> {
  await guardarCredencial({
    companyId,
    conexionId,
    tipo: 'OAUTH_TOKENS',
    secreto: JSON.stringify(tokens),
    expiresAt,
    // En metadata solo lo que se puede enseñar sin abrir el sello.
    metadata: { scopes: tokens.scopes ?? [], tieneRefresh: Boolean(tokens.refreshToken) },
  })
}

export type ResultadoAccess =
  | { ok: true; accessToken: string }
  | { ok: false; motivo: 'sin_credencial' | 'ilegible' | 'refresco_fallido' | 'sin_refresh' }

/**
 * El access token LISTO PARA USAR: lo refresca solo si está a punto de vencer.
 *
 * Es la única puerta por la que un conector obtiene un token. Que el refresco
 * viva aquí —y no en cada conector— es lo que evita que el tercero que se
 * escriba en la Fase 6 se olvide de refrescar y funcione «casi siempre».
 */
export async function accessTokenVigente(input: {
  companyId: string
  conexionId: string
  config: ConfigOauthConector
}): Promise<ResultadoAccess> {
  const guardado = await leerCredencial({
    companyId: input.companyId,
    conexionId: input.conexionId,
    tipo: 'OAUTH_TOKENS',
  })
  if (!guardado.ok) {
    return { ok: false, motivo: guardado.motivo === 'no_existe' ? 'sin_credencial' : 'ilegible' }
  }

  let tokens: TokensOauth
  try {
    tokens = JSON.parse(guardado.secreto) as TokensOauth
  } catch {
    return { ok: false, motivo: 'ilegible' }
  }

  if (!necesitaRefresco(guardado.expiresAt)) return { ok: true, accessToken: tokens.accessToken }
  if (!tokens.refreshToken) {
    // Vencido y sin con qué refrescar: la conexión necesita que alguien vuelva
    // a autorizarla. Se marca para que se vea en el panel, no en un log.
    await anotarSalud({
      companyId: input.companyId,
      conexionId: input.conexionId,
      resultado: { ok: false, error: 'El permiso venció y hay que volver a conectar.' },
    })
    return { ok: false, motivo: 'sin_refresh' }
  }

  const secretoCliente = process.env[input.config.clientSecretEnv]
  if (!secretoCliente) return { ok: false, motivo: 'refresco_fallido' }

  const nuevos = await pedirTokens(
    input.config.urlToken,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: input.config.clientId,
      client_secret: secretoCliente,
    })
  )
  if (!nuevos) {
    await anotarSalud({
      companyId: input.companyId,
      conexionId: input.conexionId,
      resultado: { ok: false, error: 'No se pudo renovar el permiso con el proveedor.' },
    })
    return { ok: false, motivo: 'refresco_fallido' }
  }

  // `fusionarTokens` conserva el refresh token anterior cuando el proveedor no
  // manda uno nuevo. Sin eso, la conexión moriría al siguiente vencimiento.
  const fusionados = fusionarTokens(tokens, nuevos.tokens)
  await guardarTokens(input.companyId, input.conexionId, fusionados, nuevos.expiresAt)
  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: input.conexionId,
    evento: 'oauth.refresh',
  })
  return { ok: true, accessToken: fusionados.accessToken }
}

/** Purga de estados caducados (cron). Un estado viejo no sirve para nada. */
export async function purgarEstadosOauth(): Promise<number> {
  const r = await sinEmpresa('connect: purga de estados OAuth caducados (cron)', (tx) =>
    tx.estadoOAuth.deleteMany({ where: { expiraAt: { lt: new Date() } } })
  ).catch(anotarFallo('connect:oauth:purga'))
  return r?.count ?? 0
}
