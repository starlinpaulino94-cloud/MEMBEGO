import 'server-only'
import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { enviarWhatsapp } from '@/modules/connect/whatsapp'

/**
 * AUTO-REPLY ENGINE — respuestas automáticas por WhatsApp (Fase 3).
 *
 * Busca la config activa que matchee keywords contra el texto entrante,
 * verifica si es el primer mensaje del contacto y envía la respuesta.
 *
 * Fire-and-safe: nunca lanza, devuelve null si algo falla.
 */

export interface AutoReplyMatch {
  config: {
    id: string
    nombre: string
    contenido: string
    tipoRespuesta: string
    catalogoPath: string | null
  }
}

export type ResultadoAutoReply =
  | { config: AutoReplyMatch['config']; enviado: boolean }
  | null

// ── Normalización para keyword matching ─────────────────────────────────────

/**
 * Normaliza texto: minúsculas + NFD + strip acentos.
 * Mismo patrón que detectarIntencionExcursiones en whatsappInboundNucleo.ts.
 */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

// ── Resolver URL de catálogo ────────────────────────────────────────────────

/**
 * Resuelve `catalogoPath` a una URL usable:
 * - Absoluta (http:// o https://) → tal cual.
 * - Relativa → `${NEXT_PUBLIC_APP_URL ?? NEXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3000'}${path}`.
 * Devuelve null si el path está vacío.
 */
function resolverUrl(catalogoPath: string | null): string | null {
  if (!catalogoPath || !catalogoPath.trim()) return null
  if (/^https?:\/\//i.test(catalogoPath)) return catalogoPath

  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    'http://127.0.0.1:3000'
  return `${base}${catalogoPath}`
}

// ── Buscar config de auto-reply ─────────────────────────────────────────────

/**
 * Busca entre las configs activas de auto-reply cuál matchea keywords
 * contra el texto del mensaje. Devuelve la primera (por `orden`).
 *
 * Match case-insensitive con NFD normalization: "Reservación" matchea "reservar".
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
    // esBienvenida solo se activa cuando es primer mensaje (fuera de aquí)
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

// ── Primer mensaje ──────────────────────────────────────────────────────────

/**
 * ¿Es la primera vez que este número escribe a esta empresa?
 * Comprueba si existe alguna conversación WHATSAPP para el teléfono.
 */
export async function esPrimerMensaje(
  companyId: string,
  telefono: string
): Promise<boolean> {
  if (!companyId || !telefono) return false

  const existe = await conEmpresa(companyId, (tx) =>
    tx.conversacion.findFirst({
      where: {
        companyId,
        canal: 'WHATSAPP',
        lead: { telefono },
      },
      select: { id: true },
    })
  ).catch(() => null)

  return existe === null
}

// ── Enviar auto-reply ───────────────────────────────────────────────────────

/**
 * Construye el mensaje de respuesta y lo envía por WhatsApp.
 *
 * Reemplaza variables en la plantilla:
 * - `{empresa_slug}` → slug de la empresa
 * - `{nombre_empresa}` → nombre de la empresa
 *
 * Para `tipoRespuesta === 'CATALOGO'` con `catalogoPath`, anexa la URL resuelta
 * (`contenido` + `\n` + URL). Tras enviar persiste un Mensaje SALIENTE y
 * actualiza la conversación (patrón de whatsappInbound). Fire-and-safe: si el
 * persist falla, devuelve igual el resultado del envío.
 */
export async function enviarAutoReply(
  companyId: string,
  telefono: string,
  config: AutoReplyMatch['config'],
  conversacionId: string
): Promise<ResultadoAutoReply> {
  if (!companyId || !telefono || !config || !conversacionId) return null

  // Cargar datos de la empresa para variables de plantilla
  const empresa = await conEmpresa(companyId, (tx) =>
    tx.company.findUnique({
      where: { id: companyId },
      select: { name: true, slug: true },
    })
  ).catch(() => null)

  let contenido = config.contenido
  if (empresa) {
    contenido = contenido
      .replace(/\{empresa_slug\}/g, empresa.slug)
      .replace(/\{nombre_empresa\}/g, empresa.name)
  }

  if (config.tipoRespuesta === 'CATALOGO') {
    const url = resolverUrl(config.catalogoPath)
    if (url) contenido = `${contenido}\n${url}`
  }

  const resultado = await enviarWhatsapp({
    companyId,
    telefono,
    texto: contenido,
  })

  // Persistir Mensaje SALIENTE + actualizar conversación (patrón whatsappInbound.ts:86-110)
  await conEmpresa(companyId, (tx) =>
    tx.mensaje.create({
      data: {
        conversacionId,
        direccion: 'SALIENTE',
        tipo: 'TEXTO',
        contenido,
        proveedorMsgId: resultado.ok ? resultado.mensajeId : null,
        metadata: { whatsapp_auto_reply: config.nombre } as Prisma.InputJsonValue,
        estado: resultado.ok ? 'ENVIADO' : 'FALLIDO',
      },
    })
  ).catch(() => null)

  await conEmpresa(companyId, (tx) =>
    tx.conversacion.update({
      where: { id: conversacionId },
      data: {
        ultimoMensaje: contenido.slice(0, 200),
        ultimaFecha: new Date(),
      },
    })
  ).catch(() => null)

  return { config, enviado: resultado.ok }
}

// ── Bienvenida y catálogo por empresa ───────────────────────────────────────

/**
 * Busca la config activa de bienvenida (esBienvenida=true) de la empresa,
 * la de menor `orden`. Mismo shape `{ config }` que `buscarAutoReply`.
 */
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
