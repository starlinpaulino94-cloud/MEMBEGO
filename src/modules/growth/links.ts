/**
 * Growth Engine 3.0 · Enlaces de invitación (GrowthLink).
 *
 * Server-internal (SIN 'use server'). Cada enlace compartido es su propia
 * campaña de adquisición: beneficio ofrecido, expiración configurable y embudo
 * propio. La expiración se calcula y VERIFICA en el servidor (req #3).
 */

import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { generarCodigo } from '@/lib/codes'
import { getGrowthConfig } from './config'

export interface CrearGrowthLinkInput {
  clienteId: string
  companyId: string
  promocionId?: string | null
  campanaId?: string | null
  canal?: string | null
  titulo?: string | null
  mensaje?: string | null
  /** Duración en horas; si se omite, usa la de la config de la empresa. */
  duracionHoras?: number | null
}

export interface GrowthLinkCreado {
  id: string
  code: string
  expiresAt: Date | null
}

/** Crea un enlace de invitación con su expiración calculada en servidor. */
export async function crearGrowthLink(
  input: CrearGrowthLinkInput
): Promise<GrowthLinkCreado> {
  const cfg = await getGrowthConfig(input.companyId)
  const horas =
    input.duracionHoras && input.duracionHoras > 0
      ? input.duracionHoras
      : cfg.duracionHorasDefault
  const expiresAt = horas > 0 ? new Date(Date.now() + horas * 60 * 60 * 1000) : null

  // Reintenta ante colisión del código único.
  for (let intento = 0; intento < 6; intento++) {
    const code = generarCodigo(7)
    try {
      const link = await conEmpresa(input.companyId, (tx) =>
        tx.growthLink.create({
          data: {
            code,
            clienteId: input.clienteId,
            companyId: input.companyId,
            promocionId: input.promocionId ?? null,
            campanaId: input.campanaId ?? null,
            canal: input.canal ?? null,
            titulo: input.titulo ?? null,
            mensaje: input.mensaje ?? null,
            duracionHoras: horas,
            expiresAt,
          },
          select: { id: true, code: true, expiresAt: true },
        })
      )
      return link
    } catch {
      // colisión de code: reintenta
    }
  }
  throw new Error('No se pudo generar el enlace de invitación.')
}

export interface GrowthLinkResuelto {
  id: string
  code: string
  companyId: string
  clienteId: string
  promocionId: string | null
  campanaId: string | null
  expiresAt: Date | null
  expirado: boolean
  activo: boolean
}

/**
 * Resuelve un enlace por su código y determina, EN SERVIDOR, si venció.
 * Devuelve null si el código no existe.
 */
export async function resolverGrowthLink(code: string): Promise<GrowthLinkResuelto | null> {
  const clean = code.trim().toUpperCase()
  if (!clean) return null
  const link = await sinEmpresa('growth: resolver enlace por código único global', (tx) =>
    tx.growthLink
      .findUnique({
        where: { code: clean },
        select: {
          id: true, code: true, companyId: true, clienteId: true,
          promocionId: true, campanaId: true, expiresAt: true, activo: true,
        },
      })
  ).catch(() => null)
  if (!link) return null
  const expirado = !!link.expiresAt && link.expiresAt.getTime() <= Date.now()
  return { ...link, expirado }
}

export interface GrowthLandingData {
  code: string
  companyId: string
  clienteId: string
  expiresAt: Date | null
  expirado: boolean
  referente: string
  /** Código de referido del referente (para preservar la atribución al registrar). */
  referenteCodigo: string
  empresa: { name: string; slug: string; logoUrl: string | null }
  titulo: string | null
  mensaje: string | null
  // Beneficio que recibirá el invitado (si el enlace ofrece uno).
  beneficio: {
    titulo: string
    descripcion: string | null
    imagenUrl: string | null
    tipo: string
    descuento: number | null
  } | null
  // Recompensa que recibirá quien invitó (regla REGISTRO para el REFERENTE).
  recompensaReferente: string | null
  // Prueba social: cuántas personas ya se unieron con enlaces de este referente.
  yaAprovecharon: number
}

/**
 * Datos para la Landing Page del referido (req #1). Solo se resuelve si el
 * enlace existe; la landing decide qué mostrar según `expirado`.
 */
export async function getGrowthLanding(code: string): Promise<GrowthLandingData | null> {
  const clean = code.trim().toUpperCase()
  if (!clean) return null
  const link = await sinEmpresa('growth: landing - resolver enlace por código único global', (tx) =>
    tx.growthLink
      .findUnique({
        where: { code: clean },
        select: {
          code: true, companyId: true, clienteId: true, expiresAt: true,
          titulo: true, mensaje: true,
          cliente: { select: { nombre: true, codigoReferido: true } },
          company: { select: { name: true, slug: true, logoUrl: true, isActive: true } },
          promocion: {
            select: {
              titulo: true, descripcion: true, imagenUrl: true, tipo: true, descuento: true,
            },
          },
        },
      })
  ).catch(() => null)
  if (!link || !link.company.isActive) return null

  const expirado = !!link.expiresAt && link.expiresAt.getTime() <= Date.now()

  // Recompensa del referente: primera regla activa REGISTRO que lo beneficia.
  const reglaReferente = await conEmpresa(link.companyId, (tx) =>
    tx.growthRule
      .findFirst({
        where: {
          companyId: link.companyId,
          trigger: 'REGISTRO',
          activo: true,
          beneficiario: { in: ['REFERENTE', 'AMBOS'] },
        },
        select: { nombre: true },
      })
  ).catch(() => null)

  // Prueba social: registros atribuidos a los enlaces de este referente.
  const yaAprovecharon = await conEmpresa(link.companyId, (tx) =>
    tx.referralEvent
      .count({
        where: { clienteId: link.clienteId, companyId: link.companyId, tipo: 'REGISTRO' },
      })
  ).catch(() => 0)

  return {
    code: link.code,
    companyId: link.companyId,
    clienteId: link.clienteId,
    expiresAt: link.expiresAt,
    expirado,
    referente: link.cliente.nombre,
    referenteCodigo: link.cliente.codigoReferido,
    empresa: {
      name: link.company.name,
      slug: link.company.slug,
      logoUrl: link.company.logoUrl,
    },
    titulo: link.titulo,
    mensaje: link.mensaje,
    beneficio: link.promocion
      ? {
          titulo: link.promocion.titulo,
          descripcion: link.promocion.descripcion,
          imagenUrl: link.promocion.imagenUrl,
          tipo: link.promocion.tipo,
          descuento: link.promocion.descuento,
        }
      : null,
    recompensaReferente: reglaReferente?.nombre ?? null,
    yaAprovecharon,
  }
}
