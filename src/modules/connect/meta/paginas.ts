import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { anotarConector } from '@/modules/connect/bitacora'
import { abrirDeActivo, guardarCredencial, leerCredencial, sellarParaActivo } from '@/modules/connect/credenciales'
import { activosDeConexion, reclamarActivo } from '@/modules/connect/meta/activos'
import {
  claseDeRespuestaGraph,
  llamarGraph,
  type RespuestaGraph,
  type ResultadoGraph,
} from '@/modules/connect/meta/graph'
import { inspeccionarToken } from '@/modules/connect/meta/salud'
import { faltanPermisos } from '@/modules/connect/meta/tokensNucleo'
import { PERMISOS_META_PAGINAS, configMetaPaginasDesdeEntorno } from '@/modules/connect/metaNucleo'
import { anotarSalud } from '@/modules/connect/registro'
import type { ClaseError } from '@/modules/connect/proveedores/tipos'

/**
 * PÁGINAS DE FACEBOOK E INSTAGRAM (Meta · Fase 3), lado servidor.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CAMINO DE UN LOGIN
 *
 *   1. CANJE     el código del diálogo → token de usuario (corto)
 *                GET /oauth/access_token?client_id&client_secret&code
 *   2. LARGA     → token de usuario de larga duración (~60 días)
 *                GET /oauth/access_token?grant_type=fb_exchange_token&…
 *   3. DEBUG     `debug_token`: válido, permisos concedidos DE VERDAD,
 *                caducidades (del token y del acceso a datos)
 *   4. GUARDAR   sellado como OAUTH_TOKENS con su `expiresAt`. Facebook no
 *                tiene refresco de servidor: cuando caduque, reconectar.
 *   5. PÁGINAS   GET /me/accounts → id, name, access_token, tasks. La empresa
 *                elige cuáles; por cada una, su token de Página (larga
 *                duración, sin caducidad) se sella EN EL ACTIVO, y se busca su
 *                cuenta de Instagram (GET /{page}?fields=instagram_business_account).
 *   6. AVISOS    POST /{page}/subscribed_apps?subscribed_fields=… con el
 *                token de Página.
 *
 * Ningún token baja al navegador: la lista de Páginas que ve la empresa lleva
 * id, nombre y tareas, nada más.
 */

const CAMPOS_SUSCRIPCION = 'messages,messaging_postbacks,message_deliveries,message_reads'

export type FalloPaginas = { ok: false; fase: string; detalle: string; clase: ClaseError }

function fallo(fase: string, detalle: string, r?: RespuestaGraph): FalloPaginas {
  return { ok: false, fase, detalle, clase: r ? claseDeRespuestaGraph(r) : 'CONFIGURATION' }
}

interface TokensGuardados {
  accessToken: string
  refreshToken: null
  scopes?: string[]
}

// ─── 1–4 · Del código al token guardado ─────────────────────────────────────

export async function completarLoginPaginas(input: {
  companyId: string
  conexionId: string
  code: string
}): Promise<{ ok: true; nombreUsuario: string | null } | FalloPaginas> {
  const config = configMetaPaginasDesdeEntorno()
  if (!config) return fallo('config', 'La conexión con Facebook no está configurada aquí.')
  const secreto = process.env[config.appSecretEnv] ?? ''

  // 1 · Canje. El secreto va en la query porque así lo documenta Meta; la URL
  //     no se registra en ningún sitio (el cliente Graph no la anota).
  const canje = await llamarGraph<{ access_token?: string; expires_in?: number }>({
    ruta: '/oauth/access_token',
    query: { client_id: config.appId, client_secret: secreto, code: input.code },
  })
  if (!canje.ok || !canje.datos.access_token) {
    return fallo('canje', 'La autorización no se pudo canjear.', canje.ok ? undefined : canje.respuesta)
  }

  // 2 · Larga duración.
  const larga = await llamarGraph<{ access_token?: string; expires_in?: number }>({
    ruta: '/oauth/access_token',
    query: {
      grant_type: 'fb_exchange_token',
      client_id: config.appId,
      client_secret: secreto,
      fb_exchange_token: canje.datos.access_token,
    },
  })
  if (!larga.ok || !larga.datos.access_token) {
    return fallo('larga_duracion', 'No se pudo obtener un acceso duradero.', larga.ok ? undefined : larga.respuesta)
  }
  const token = larga.datos.access_token

  // 3 · Qué concedió de verdad.
  const inspeccion = await inspeccionarToken(token)
  if (!inspeccion.ok) return fallo('verificacion', 'No pudimos verificar la autorización con Meta.', inspeccion.respuesta)
  if (!inspeccion.datos.valido) return fallo('verificacion', 'Meta no da por válida la autorización.')
  const faltan = faltanPermisos(inspeccion.datos, PERMISOS_META_PAGINAS)
  if (faltan.length > 0) {
    return { ok: false, fase: 'verificacion', detalle: 'Faltan permisos por conceder. Vuelve a intentarlo y acepta todas las casillas.', clase: 'PERMISSIONS' }
  }
  // La caducidad que manda es la más cercana: la del token o la del acceso a
  // datos. `expires_in` del canje es la fuente si debug_token no la dio.
  const candidatas = [
    inspeccion.datos.caducaAt,
    inspeccion.datos.accesoDatosCaducaAt,
    larga.datos.expires_in ? new Date(Date.now() + larga.datos.expires_in * 1000) : null,
  ].filter((d): d is Date => d instanceof Date)
  const expiresAt = candidatas.length ? new Date(Math.min(...candidatas.map((d) => d.getTime()))) : null

  // Quién es, para enseñarlo (no para decidir nada).
  const yo = await llamarGraph<{ id?: string; name?: string }>({ ruta: '/me', query: { fields: 'id,name' }, token })
  const nombreUsuario = yo.ok && typeof yo.datos.name === 'string' ? yo.datos.name : null

  // 4 · Guardar sellado. Mismo formato que el resto de OAUTH_TOKENS.
  const tokens: TokensGuardados = { accessToken: token, refreshToken: null, scopes: inspeccion.datos.permisos }
  const guardada = await guardarCredencial({
    companyId: input.companyId,
    conexionId: input.conexionId,
    tipo: 'OAUTH_TOKENS',
    secreto: JSON.stringify(tokens),
    expiresAt,
    metadata: {
      scopes: inspeccion.datos.permisos,
      tieneRefresh: false,
      usuario: nombreUsuario,
      accesoDatosCaducaAt: inspeccion.datos.accesoDatosCaducaAt?.toISOString() ?? null,
    },
  })
  if (!guardada.ok) {
    return fallo('guardado', guardada.motivo === 'sin_clave_maestra' ? 'El almacén de credenciales no está configurado en este despliegue.' : 'No se encontró la conexión.')
  }
  await anotarSalud({ companyId: input.companyId, conexionId: input.conexionId, resultado: { ok: true } })
  return { ok: true, nombreUsuario }
}

// ─── 5 · Páginas ─────────────────────────────────────────────────────────────

async function tokenDeUsuario(companyId: string, conexionId: string): Promise<string | null> {
  const cred = await leerCredencial({ companyId, conexionId, tipo: 'OAUTH_TOKENS' })
  if (!cred.ok) return null
  try {
    const t = JSON.parse(cred.secreto) as { accessToken?: string }
    return typeof t.accessToken === 'string' ? t.accessToken : null
  } catch {
    return null
  }
}

export interface PaginaDisponible {
  id: string
  nombre: string
  /** Tareas que la persona tiene sobre la Página (MODERATE hace falta para mensajes). */
  tareas: string[]
  puedeMensajes: boolean
  /** Ya elegida en esta conexión. */
  elegida: boolean
}

interface PaginaGraph {
  id?: string
  name?: string
  access_token?: string
  tasks?: string[]
}

async function paginasDeMeta(token: string): Promise<{ ok: true; paginas: PaginaGraph[] } | { ok: false; respuesta: RespuestaGraph }> {
  type Lote = { data?: PaginaGraph[]; paging?: { cursors?: { after?: string }; next?: string } }
  const paginas: PaginaGraph[] = []
  let despues: string | null = null
  for (let i = 0; i < 10; i++) {
    const query: Record<string, string> = { fields: 'id,name,access_token,tasks' }
    if (despues) query.after = despues
    const r: ResultadoGraph<Lote> = await llamarGraph<Lote>({ ruta: '/me/accounts', query, token })
    if (!r.ok) return r
    paginas.push(...(r.datos.data ?? []))
    const siguiente: string | null = r.datos.paging?.next ? (r.datos.paging.cursors?.after ?? null) : null
    if (!siguiente) break
    despues = siguiente
  }
  return { ok: true, paginas }
}

/** Las Páginas que la persona administra, SIN tokens: lo que ve la pantalla. */
export async function paginasDisponibles(input: {
  companyId: string
  conexionId: string
}): Promise<{ ok: true; paginas: PaginaDisponible[] } | FalloPaginas> {
  const token = await tokenDeUsuario(input.companyId, input.conexionId)
  if (!token) return fallo('credencial', 'No encontramos la autorización de Facebook. Vuelve a conectar.')
  const r = await paginasDeMeta(token)
  if (!r.ok) return fallo('paginas', 'Meta no devolvió tus Páginas.', r.respuesta)
  const elegidas = new Set(
    (await activosDeConexion(input.companyId, input.conexionId))
      .filter((a) => a.tipo === 'PAGE')
      .map((a) => a.idExterno)
  )
  return {
    ok: true,
    paginas: r.paginas
      .filter((p): p is PaginaGraph & { id: string } => typeof p.id === 'string')
      .map((p) => ({
        id: p.id,
        nombre: p.name ?? p.id,
        tareas: Array.isArray(p.tasks) ? p.tasks : [],
        // Messenger exige una persona con la tarea MODERATE sobre la Página.
        puedeMensajes: Array.isArray(p.tasks) && p.tasks.includes('MODERATE'),
        elegida: elegidas.has(p.id),
      })),
  }
}

// ─── 5–6 · Elegir Páginas: reclamar, Instagram, suscribir ───────────────────

export async function elegirPaginas(input: {
  companyId: string
  conexionId: string
  paginaIds: string[]
}): Promise<{ ok: true; paginas: number; instagram: number; avisos: string[] } | FalloPaginas> {
  const token = await tokenDeUsuario(input.companyId, input.conexionId)
  if (!token) return fallo('credencial', 'No encontramos la autorización de Facebook. Vuelve a conectar.')
  const r = await paginasDeMeta(token)
  if (!r.ok) return fallo('paginas', 'Meta no devolvió tus Páginas.', r.respuesta)

  const elegidas = r.paginas.filter(
    (p): p is PaginaGraph & { id: string; access_token: string } =>
      typeof p.id === 'string' && typeof p.access_token === 'string' && input.paginaIds.includes(p.id)
  )
  if (elegidas.length === 0) return fallo('paginas', 'Elige al menos una Página que administres.')

  const avisos: string[] = []
  let instagram = 0

  for (const p of elegidas) {
    // La Página es de UNA empresa.
    const activo = await reclamarActivo({
      companyId: input.companyId,
      conexionId: input.conexionId,
      tipo: 'PAGE',
      idExterno: p.id,
      nombre: p.name ?? null,
      metadata: { tareas: p.tasks ?? [] },
    })
    if (!activo.ok) {
      if (activo.motivo === 'otra_empresa') {
        return fallo('reclamo', `La Página «${p.name ?? p.id}» ya está conectada a otro negocio en Membego. Desconéctala allí primero.`)
      }
      return fallo('reclamo', 'No se pudo preparar la conexión.')
    }

    // El token de Página, sellado en el activo (AAD = el activo).
    const sellado = await sellarParaActivo(activo.id, p.access_token)
    if (!sellado.ok) return fallo('guardado', 'El almacén de credenciales no está configurado en este despliegue.')
    await conEmpresa(input.companyId, (tx) =>
      tx.activoMeta.update({ where: { id: activo.id }, data: { sellado: sellado.sellado, keyVersion: sellado.keyVersion } })
    )

    // Su cuenta de Instagram, si la tiene.
    const ig = await llamarGraph<{ instagram_business_account?: { id?: string; username?: string } }>({
      ruta: `/${encodeURIComponent(p.id)}`,
      query: { fields: 'instagram_business_account{id,username}' },
      token: p.access_token,
    })
    const cuentaIg = ig.ok ? ig.datos.instagram_business_account : undefined
    if (cuentaIg && typeof cuentaIg.id === 'string') {
      const activoIg = await reclamarActivo({
        companyId: input.companyId,
        conexionId: input.conexionId,
        tipo: 'IG_ACCOUNT',
        idExterno: cuentaIg.id,
        nombre: cuentaIg.username ?? null,
        padreId: activo.id,
      })
      if (activoIg.ok) instagram++
      else avisos.push(`La cuenta de Instagram de «${p.name ?? p.id}» ya está conectada a otro negocio.`)
    }

    // Los avisos de la Página (y de su Instagram, que van por la Página).
    const sus = await llamarGraph({
      ruta: `/${encodeURIComponent(p.id)}/subscribed_apps`,
      metodo: 'POST',
      query: { subscribed_fields: CAMPOS_SUSCRIPCION },
      token: p.access_token,
    })
    if (sus.ok) {
      await conEmpresa(input.companyId, (tx) =>
        tx.activoMeta.update({ where: { id: activo.id }, data: { suscritoAt: new Date() } })
      )
    } else {
      avisos.push(`No pudimos activar los avisos de «${p.name ?? p.id}» (Meta respondió ${sus.respuesta.status}).`)
    }
  }

  // Lo que se deselecciona se retira.
  await conEmpresa(input.companyId, (tx) =>
    tx.activoMeta.updateMany({
      where: { companyId: input.companyId, conexionId: input.conexionId, tipo: 'PAGE', idExterno: { notIn: elegidas.map((p) => p.id) } },
      data: { estado: 'REMOVED' },
    })
  )

  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: input.conexionId,
    evento: 'meta.paginas_elegidas',
    detalle: { paginas: elegidas.length, instagram },
  })
  return { ok: true, paginas: elegidas.length, instagram, avisos }
}

/** El token de Página de un activo PAGE (o del padre de un IG_ACCOUNT). */
export async function tokenDePagina(companyId: string, activoId: string): Promise<string | null> {
  const activo = await conEmpresa(companyId, (tx) =>
    tx.activoMeta.findFirst({
      where: { id: activoId, companyId },
      select: { id: true, tipo: true, padreId: true, sellado: true, estado: true },
    })
  )
  if (!activo || activo.estado !== 'ACTIVE') return null
  const pagina =
    activo.tipo === 'PAGE'
      ? activo
      : activo.padreId
        ? await conEmpresa(companyId, (tx) =>
            tx.activoMeta.findFirst({ where: { id: activo.padreId!, companyId }, select: { id: true, tipo: true, padreId: true, sellado: true, estado: true } })
          )
        : null
  if (!pagina?.sellado) return null
  const abierto = await abrirDeActivo(pagina.id, pagina.sellado)
  return abierto.ok ? abierto.secreto : null
}

// ─── Desconectar ─────────────────────────────────────────────────────────────

/**
 * Al desconectar: revocar cada permiso concedido
 * (`DELETE /{user-id}/permissions/{permission}`, documentado) mientras el
 * token de usuario aún vale. Best-effort.
 */
export async function revocarPermisosPaginas(input: { companyId: string; conexionId: string }): Promise<number> {
  const token = await tokenDeUsuario(input.companyId, input.conexionId)
  if (!token) return 0
  let revocados = 0
  for (const permiso of PERMISOS_META_PAGINAS) {
    const r = await llamarGraph({ ruta: `/me/permissions/${permiso}`, metodo: 'DELETE', token })
    if (r.ok) revocados++
  }
  await anotarConector({
    companyId: input.companyId,
    origen: 'CONEXION',
    origenId: input.conexionId,
    nivel: revocados === PERMISOS_META_PAGINAS.length ? 'INFO' : 'WARN',
    evento: revocados > 0 ? 'oauth.revocado' : 'oauth.revocacion_fallida',
    detalle: { revocados, de: PERMISOS_META_PAGINAS.length },
  })
  return revocados
}
