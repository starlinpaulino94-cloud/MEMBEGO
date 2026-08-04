import { createHash } from 'node:crypto'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { generarCodigo } from '@/lib/codes'
import type { ReferralEventTipo } from '@prisma/client'

/**
 * Motor del programa de referidos (Referidos 2.0).
 * Puntos, niveles de embajador, logros y utilidades de tracking.
 * Todo aislado por empresa: los puntos/niveles/ranking de un cliente solo
 * consideran eventos de SU empresa.
 */

/** Puntos por cada evento del embudo (los eventos guardan su valor al crearse:
 *  cambiar estas constantes NUNCA reescribe la historia). */
export const PUNTOS: Record<ReferralEventTipo, number> = {
  LINK: 0, // generación del enlace: métrica, no gamificación
  SHARE: 2,
  CLICK: 5,
  LANDING_VIEW: 0, // Growth Engine 3.0: vista de la landing del referido (embudo)
  REGISTRO_INICIADO: 0, // landing de registro con atribución: solo embudo
  REGISTRO: 20,
  VERIFICADO: 10,
  MEMBRESIA: 200,
  COMPRA: 0, // métrica de compra; la conversión por promoción pasa 200 override
  PRIMER_USO: 0, // Growth Engine 3.0: primer canje del beneficio (embudo)
  RECOMPENSA: 0,
  FRAUDE: 0,
  // Centro global MembeGo: referidos que se unen a OTRA empresa de la plataforma.
  REGISTRO_GLOBAL: 20,
  MEMBRESIA_GLOBAL: 100,
}

/** Tipos que cuentan PUNTOS del programa de la EMPRESA (nivel/gamificación). */
export const TIPOS_EMPRESA: ReferralEventTipo[] = [
  'SHARE', 'CLICK', 'REGISTRO', 'VERIFICADO', 'MEMBRESIA', 'COMPRA',
]
/** Tipos del programa global MembeGo. */
export const TIPOS_GLOBAL: ReferralEventTipo[] = ['REGISTRO_GLOBAL', 'MEMBRESIA_GLOBAL']

/** Cookie de atribución del Centro global MembeGo. */
export const REF_COOKIE = 'mg_ref'
export const REF_COOKIE_DIAS = 30

/** Fase E6 · Attribution Tracking: cookie del identificador anónimo de
 *  visitante. Se siembra en el clic (/r/[code]) y se lee al registrarse:
 *  permite visitas ÚNICAS reales y unir clic → registro → conversión. */
export const VISITOR_COOKIE = 'mg_vid'
export const VISITOR_COOKIE_DIAS = 365

/**
 * Huella anónima de IP para anti-fraude: hash truncado, nunca se guarda la IP
 * en claro. Suficiente para detectar registros repetidos desde la misma red.
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  return createHash('sha256').update(`membego:${ip}`).digest('hex').slice(0, 16)
}

export interface NivelEmbajador {
  id: string
  nombre: string
  emoji: string
  minPuntos: number
  descripcion: string
}

/** Niveles de embajador, en orden ascendente por puntos. */
export const NIVELES: NivelEmbajador[] = [
  { id: 'explorador', nombre: 'Explorador', emoji: '🌱', minPuntos: 0, descripcion: 'Tus primeros pasos como promotor.' },
  { id: 'promotor', nombre: 'Promotor', emoji: '🤝', minPuntos: 100, descripcion: 'Ya estás generando interés real.' },
  { id: 'embajador', nombre: 'Embajador', emoji: '⭐', minPuntos: 400, descripcion: 'Refieres clientes de forma constante.' },
  { id: 'premium', nombre: 'Embajador Premium', emoji: '💎', minPuntos: 1000, descripcion: 'Alta conversión y constancia.' },
  { id: 'elite', nombre: 'Embajador Elite', emoji: '👑', minPuntos: 2500, descripcion: 'Uno de los mejores promotores de la empresa.' },
]

export function calcularNivel(puntos: number): {
  nivel: NivelEmbajador
  siguiente: NivelEmbajador | null
  progresoPct: number
} {
  let nivel = NIVELES[0]
  for (const n of NIVELES) {
    if (puntos >= n.minPuntos) nivel = n
  }
  const idx = NIVELES.indexOf(nivel)
  const siguiente = NIVELES[idx + 1] ?? null
  const progresoPct = siguiente
    ? Math.min(
        100,
        Math.round(
          ((puntos - nivel.minPuntos) / (siguiente.minPuntos - nivel.minPuntos)) * 100
        )
      )
    : 100
  return { nivel, siguiente, progresoPct }
}

export interface Logro {
  id: string
  nombre: string
  emoji: string
  descripcion: string
  desbloqueado: boolean
}

export function calcularLogros(stats: {
  registros: number
  membresias: number
  clicks: number
  recompensas: number
  nivelId: string
}): Logro[] {
  const conversion = stats.clicks >= 10 ? stats.membresias / stats.clicks : 0
  return [
    { id: 'primero', nombre: 'Primer referido', emoji: '🏅', descripcion: 'Tu primer amigo registrado.', desbloqueado: stats.registros >= 1 },
    { id: 'primera-membresia', nombre: 'Primera conversión', emoji: '🎯', descripcion: 'Un referido activó su membresía.', desbloqueado: stats.membresias >= 1 },
    { id: 'diez', nombre: '10 referidos', emoji: '🔥', descripcion: '10 amigos registrados con tu enlace.', desbloqueado: stats.registros >= 10 },
    { id: 'cincuenta', nombre: '50 referidos', emoji: '🚀', descripcion: '50 registros. Imparable.', desbloqueado: stats.registros >= 50 },
    { id: 'conversion', nombre: 'Conversión +30%', emoji: '🧲', descripcion: 'Más del 30% de tus clics se convierten (mín. 10 clics).', desbloqueado: conversion >= 0.3 },
    { id: 'recompensado', nombre: 'Recompensado', emoji: '🎁', descripcion: 'Obtuviste tu primera recompensa.', desbloqueado: stats.recompensas >= 1 },
    { id: 'elite', nombre: 'Embajador Elite', emoji: '👑', descripcion: 'Alcanzaste el nivel máximo.', desbloqueado: stats.nivelId === 'elite' },
  ]
}

/**
 * Devuelve el código corto del cliente para /r/XXXXXX, generándolo la primera
 * vez (con reintentos ante colisión).
 */
export async function ensureCodigoCorto(clienteId: string): Promise<string> {
  const cliente = await sinEmpresa('codigo-corto-lookup', (tx) =>
    tx.cliente.findUnique({
      where: { id: clienteId },
      select: { codigoCorto: true, companyId: true },
    })
  )
  if (cliente?.codigoCorto) return cliente.codigoCorto

  for (let intento = 0; intento < 5; intento++) {
    const code = generarCodigo(6)
    try {
      if (cliente?.companyId) {
        await conEmpresa(cliente.companyId, (tx) =>
          tx.cliente.update({ where: { id: clienteId }, data: { codigoCorto: code } })
        )
      }
      // Fase E6: la generación del enlace es la primera etapa del embudo.
      if (cliente) {
        await logReferralEvent({
          clienteId,
          companyId: cliente.companyId,
          tipo: 'LINK',
          meta: { codigoCorto: code },
        })
      }
      return code
    } catch {
      // Colisión con el unique: reintenta con otro código.
    }
  }
  throw new Error('No se pudo generar el código corto de referido.')
}

/**
 * Registra un evento del embudo con sus puntos. Nunca lanza: el tracking jamás
 * debe romper el flujo principal (registro, activación, compartir).
 */
export async function logReferralEvent(params: {
  clienteId: string
  companyId: string
  tipo: ReferralEventTipo
  canal?: string | null
  /** Fase E6: identificador anónimo del visitante (attribution tracking). */
  visitorId?: string | null
  /** Fase E6: referido al que pertenece el evento (cuando ya hay cuenta). */
  referidoClienteId?: string | null
  /** Growth Engine 3.0: enlace de invitación que originó el evento. */
  growthLinkId?: string | null
  meta?: Record<string, unknown>
  /** Override de puntos (p. ej. 0 para eventos marcados como sospechosos). */
  puntos?: number
}): Promise<void> {
  try {
    await conEmpresa(params.companyId, (tx) =>
      tx.referralEvent.create({
        data: {
          clienteId: params.clienteId,
          companyId: params.companyId,
          tipo: params.tipo,
          puntos: params.puntos ?? PUNTOS[params.tipo],
          canal: params.canal ?? null,
          visitorId: params.visitorId ?? null,
          referidoClienteId: params.referidoClienteId ?? null,
          growthLinkId: params.growthLinkId ?? null,
          meta: (params.meta ?? {}) as object,
        },
      })
    )
  } catch (e) {
    console.error('[referidos] logReferralEvent error:', e)
  }
}
