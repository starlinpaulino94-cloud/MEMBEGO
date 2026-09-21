import 'server-only'
import { conEmpresa } from '@/lib/tenant'
import { detectarIntencionExcursiones } from '@/modules/mensajeria/intenciones'
import { enviarTextoEnConversacion } from '@/modules/mensajeria/salientes'

/**
 * AUTO-REPLY DE MENSAJERÍA (portado de `connect/autoReply.ts`, eliminado en
 * la reconciliación). Responde por WhatsApp a un mensaje entrante según las
 * `AutoReplyConfig` activas de la empresa: keyword → bienvenida (primer
 * mensaje) → intención de excursiones (catálogo).
 *
 * El envío SIEMPRE pasa por `mensajeria/salientes.ts` (`origen:
 * 'auto-reply'`), que comprueba la ventana de 24 h — abierta justo después de
 * un entrante — y persiste el `Mensaje` SALIENTE con los campos actuales.
 * Este módulo no persiste nada a mano.
 *
 * Fire-and-safe: las búsquedas devuelven null ante errores de DB y el
 * orquestador nunca lanza.
 */

export interface AutoReplyConfigLigera {
  id: string
  nombre: string
  contenido: string
  tipoRespuesta: string
  catalogoPath: string | null
}

export interface AutoReplyMatch {
  config: AutoReplyConfigLigera
}

// ── Normalización para keyword matching ─────────────────────────────────────

/**
 * Minúsculas + NFD + strip acentos. Mismo patrón que
 * `detectarIntencionExcursiones`: "Reservación" matchea "reservar".
 */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

// ── URL base pública de la app ───────────────────────────────────────────────

function urlBase(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    'http://127.0.0.1:3000'
  )
}

/**
 * Resuelve `catalogoPath` a una URL usable:
 * - Absoluta (http:// o https://) → tal cual.
 * - Relativa → `${urlBase()}${path}`.
 * null si el path está vacío.
 */
function resolverUrl(catalogoPath: string | null): string | null {
  if (!catalogoPath || !catalogoPath.trim()) return null
  if (/^https?:\/\//i.test(catalogoPath)) return catalogoPath
  return `${urlBase()}${catalogoPath}`
}

// ── Buscar config de auto-reply ─────────────────────────────────────────────

/**
 * Primera config activa (por `orden`) cuyas keywords matcheen el texto
 * entrante. Las de `esBienvenida` solo se usan como primer mensaje (fuera de
 * aquí). Match case-insensitive con normalización NFD.
 */
export async function buscarAutoReply(
  companyId: string,
  texto: string
): Promise<AutoReplyMatch | null> {
  if (!companyId || !texto) return null

  const configs = await conEmpresa(companyId, (tx) =>
    tx.autoReplyConfig.findMany({
      where: { companyId, activa: true },
      orderBy: { orden: 'asc' },
      select: {
        id: true,
        nombre: true,
        keywords: true,
        esBienvenida: true,
        contenido: true,
        tipoRespuesta: true,
        catalogoPath: true,
      },
    })
  ).catch(() => null)

  if (!configs || configs.length === 0) return null

  const textoNorm = normalizar(texto)

  for (const cfg of configs) {
    if (cfg.esBienvenida) continue
    if (cfg.keywords.length === 0) continue

    const match = cfg.keywords.some((kw) => {
      const kwNorm = normalizar(kw)
      return kwNorm.length > 0 && textoNorm.includes(kwNorm)
    })

    if (match) {
      return {
        config: {
          id: cfg.id,
          nombre: cfg.nombre,
          contenido: cfg.contenido,
          tipoRespuesta: cfg.tipoRespuesta,
          catalogoPath: cfg.catalogoPath,
        },
      }
    }
  }

  return null
}

// ── Bienvenida y catálogo por empresa ───────────────────────────────────────

/** La config activa de bienvenida (`esBienvenida=true`) de menor `orden`. */
export async function buscarBienvenida(
  companyId: string
): Promise<AutoReplyMatch | null> {
  if (!companyId) return null

  const cfg = await conEmpresa(companyId, (tx) =>
    tx.autoReplyConfig.findFirst({
      where: { companyId, activa: true, esBienvenida: true },
      orderBy: { orden: 'asc' },
      select: {
        id: true,
        nombre: true,
        contenido: true,
        tipoRespuesta: true,
        catalogoPath: true,
      },
    })
  ).catch(() => null)

  if (!cfg) return null

  return {
    config: {
      id: cfg.id,
      nombre: cfg.nombre,
      contenido: cfg.contenido,
      tipoRespuesta: cfg.tipoRespuesta,
      catalogoPath: cfg.catalogoPath,
    },
  }
}

/**
 * URL resuelta del catálogo de la empresa: primera config activa
 * `tipoRespuesta === 'CATALOGO'` con `catalogoPath` no vacío (orden asc).
 * null si no hay ninguna.
 */
export async function resolverUrlCatalogo(
  companyId: string
): Promise<string | null> {
  if (!companyId) return null

  const configs = await conEmpresa(companyId, (tx) =>
    tx.autoReplyConfig.findMany({
      where: { companyId, activa: true, tipoRespuesta: 'CATALOGO' },
      orderBy: { orden: 'asc' },
      select: { catalogoPath: true },
    })
  ).catch(() => null)

  for (const cfg of configs ?? []) {
    const url = resolverUrl(cfg.catalogoPath)
    if (url) return url
  }
  return null
}

// ── Enviar ──────────────────────────────────────────────────────────────────

/**
 * Reemplaza variables de plantilla y, para `tipoRespuesta === 'CATALOGO'` con
 * `catalogoPath`, anexa la URL resuelta (`contenido` + `\n` + URL).
 * Fire-and-safe: si la empresa no se puede leer, se usa el contenido crudo.
 */
async function construirContenido(
  companyId: string,
  config: AutoReplyConfigLigera
): Promise<string> {
  let contenido = config.contenido

  const empresa = await conEmpresa(companyId, (tx) =>
    tx.company.findUnique({
      where: { id: companyId },
      select: { name: true, slug: true },
    })
  ).catch(() => null)
  if (empresa) {
    contenido = contenido
      .replace(/\{empresa_slug\}/g, empresa.slug)
      .replace(/\{nombre_empresa\}/g, empresa.name)
  }

  if (config.tipoRespuesta === 'CATALOGO') {
    const url = resolverUrl(config.catalogoPath)
    if (url) contenido = `${contenido}\n${url}`
  }

  return contenido
}

/** Envío vía `salientes`; fire-and-safe: nunca lanza, devuelve si salió. */
async function enviarTextoFireAndSafe(input: {
  companyId: string
  conversacionId: string
  texto: string
}): Promise<boolean> {
  try {
    const r = await enviarTextoEnConversacion({
      companyId: input.companyId,
      conversacionId: input.conversacionId,
      texto: input.texto,
      enviadoPorId: null,
      origen: 'auto-reply',
    })
    if (!r.ok && r.motivo !== 'ventana_cerrada') {
      console.error('[mensajeria] auto-reply: envío no salió', r.motivo, r.detalle)
    }
    return r.ok
  } catch (e) {
    console.error('[mensajeria] auto-reply: envío falló', e)
    return false
  }
}

/**
 * Responde a un entrante ya persistido, en el mismo orden que el webhook de
 * la rama: (1) keyword matcheado → su contenido; (2) si es el primer mensaje
 * del contacto y no matcheó → bienvenida; (3) si no e intención de
 * excursiones → catálogo (config `CATALOGO`, o `/{base}/empresas/{slug}/
 * excursiones` como respaldo). Fire-and-safe: nunca lanza.
 */
export async function responderAutoReply(input: {
  companyId: string
  conversacionId: string
  texto: string
  telefono: string
  esNueva: boolean
}): Promise<void> {
  try {
    const match = await buscarAutoReply(input.companyId, input.texto)
    if (match) {
      const contenido = await construirContenido(input.companyId, match.config)
      await enviarTextoFireAndSafe({
        companyId: input.companyId,
        conversacionId: input.conversacionId,
        texto: contenido,
      })
      return
    }

    if (input.esNueva) {
      const bienvenida = await buscarBienvenida(input.companyId)
      if (bienvenida) {
        const contenido = await construirContenido(input.companyId, bienvenida.config)
        await enviarTextoFireAndSafe({
          companyId: input.companyId,
          conversacionId: input.conversacionId,
          texto: contenido,
        })
        return
      }
    }

    if (detectarIntencionExcursiones(input.texto)) {
      let url = await resolverUrlCatalogo(input.companyId)
      if (!url) {
        // Respaldo sin config CATALOGO: catálogo de excursiones por slug.
        const empresa = await conEmpresa(input.companyId, (tx) =>
          tx.company.findUnique({
            where: { id: input.companyId },
            select: { slug: true },
          })
        ).catch(() => null)
        if (empresa?.slug) url = `${urlBase()}/empresas/${empresa.slug}/excursiones`
      }
      if (url) {
        await enviarTextoFireAndSafe({
          companyId: input.companyId,
          conversacionId: input.conversacionId,
          texto: `¡Hola! 🌴 Aquí tienes nuestro catálogo de actividades:\n${url}\n\n¿Tienes alguna pregunta? Responde aquí y te ayudamos.`,
        })
      }
    }
  } catch (e) {
    console.error('[mensajeria] auto-reply: responderAutoReply', e)
  }
}
