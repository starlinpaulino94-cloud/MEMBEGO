import type { SupplyV2MerchantApplicationStatus } from '@prisma/client'
import type { Transiciones } from '@/lib/commerce-primitives/estados'
import type { Capacidad } from '@/modules/capacidades/catalogo'
import { CAPACIDADES_DE_COMERCIO_MERCHANT } from './acceso-dominio'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · reglas puras de la solicitud
 * «Convertirme en empresa Membego» (§39–§41).
 *
 *   SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED | MORE_INFO_REQUIRED
 *   MORE_INFO_REQUIRED → SUBMITTED (el proveedor responde)
 *   SUBMITTED | UNDER_REVIEW | MORE_INFO_REQUIRED → WITHDRAWN (el proveedor retira)
 *
 * La aprobación enciende capacidades en la MISMA empresa: aquí se decide
 * cuáles. Nunca se crea una segunda organización (§41, §80).
 */

export const TRANSICIONES_SOLICITUD_MERCHANT: Transiciones<SupplyV2MerchantApplicationStatus> = {
  SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'MORE_INFO_REQUIRED', 'WITHDRAWN'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'MORE_INFO_REQUIRED', 'WITHDRAWN'],
  MORE_INFO_REQUIRED: ['SUBMITTED', 'WITHDRAWN'],
  APPROVED: [],
  REJECTED: [],
  WITHDRAWN: [],
}

export const ESTADOS_VIVOS_SOLICITUD: readonly SupplyV2MerchantApplicationStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED']

export const MERCHANT_APPLICATION_LABELS: Record<SupplyV2MerchantApplicationStatus, string> = {
  SUBMITTED: 'Enviada',
  UNDER_REVIEW: 'En revisión',
  MORE_INFO_REQUIRED: 'Falta información',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
  WITHDRAWN: 'Retirada',
}

/** Lo que el proveedor llena; llega prellenado desde su empresa y su ficha de proveedor. */
export interface DatosSolicitudMerchant {
  v: 1
  nombreComercial: string
  /** Vertical/tipo de negocio de la plataforma (`Company.type`). */
  tipoNegocio: string
  descripcion: string
  telefono: string
  direccion: string
  ciudad: string
  rnc: string
  sucursales: { nombre: string; direccion: string }[]
  /** Qué quiere vender en Membego (texto libre). */
  queVende: string
  notas: string
}

export const TIPOS_DE_NEGOCIO_SOLICITUD = ['restaurante', 'cafeteria', 'carwash', 'barberia', 'gym', 'tienda', 'servicios', 'excursiones', 'otro'] as const

export function prellenarSolicitud(e: {
  empresa: { name: string; type: string | null; description: string | null; telefono: string | null; direccion: string | null; ciudad: string | null; rnc?: string | null }
  proveedor: { commercialName?: string | null; legalName?: string | null; taxId?: string | null; phone?: string | null; address?: string | null }
  sucursales: { nombre: string; direccion: string | null }[]
}): DatosSolicitudMerchant {
  return {
    v: 1,
    nombreComercial: (e.proveedor.commercialName || e.empresa.name || '').trim(),
    tipoNegocio: e.empresa.type && e.empresa.type !== 'proveedor' ? e.empresa.type : 'restaurante',
    descripcion: (e.empresa.description ?? '').trim(),
    telefono: (e.empresa.telefono || e.proveedor.phone || '').trim(),
    direccion: (e.empresa.direccion || e.proveedor.address || '').trim(),
    ciudad: (e.empresa.ciudad ?? '').trim(),
    rnc: (e.empresa.rnc || e.proveedor.taxId || '').trim(),
    sucursales: e.sucursales.map((s) => ({ nombre: s.nombre, direccion: s.direccion ?? '' })),
    queVende: '',
    notas: '',
  }
}

/** Valida y normaliza lo que mandó el formulario. Devuelve los datos o el primer error. */
export function validarSolicitud(crudo: Partial<Record<keyof DatosSolicitudMerchant, unknown>>): { datos: DatosSolicitudMerchant } | { error: string } {
  const t = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
  const nombreComercial = t(crudo.nombreComercial, 120)
  if (nombreComercial.length < 2) return { error: 'Escribe el nombre comercial.' }
  const tipoNegocio = t(crudo.tipoNegocio, 40)
  if (!(TIPOS_DE_NEGOCIO_SOLICITUD as readonly string[]).includes(tipoNegocio)) return { error: 'Elige el tipo de negocio.' }
  const descripcion = t(crudo.descripcion, 1000)
  if (descripcion.length < 10) return { error: 'Cuéntanos qué es tu negocio (al menos 10 caracteres).' }
  const telefono = t(crudo.telefono, 40)
  if (telefono.replace(/\D/g, '').length < 7) return { error: 'Escribe un teléfono de contacto válido.' }
  const direccion = t(crudo.direccion, 200)
  if (direccion.length < 5) return { error: 'Escribe la dirección principal.' }
  const queVende = t(crudo.queVende, 1000)
  if (queVende.length < 5) return { error: 'Cuéntanos qué quieres vender en Membego.' }
  const rnc = t(crudo.rnc, 20)
  if (rnc && !/^\d{9}(\d{2})?$/.test(rnc.replace(/-/g, ''))) return { error: 'El RNC o cédula no tiene un formato válido (9 u 11 dígitos).' }
  const sucursalesCrudas = Array.isArray(crudo.sucursales) ? crudo.sucursales : []
  const sucursales = sucursalesCrudas
    .map((s) => (s && typeof s === 'object' ? { nombre: t((s as Record<string, unknown>).nombre, 80), direccion: t((s as Record<string, unknown>).direccion, 200) } : null))
    .filter((s): s is { nombre: string; direccion: string } => Boolean(s && s.nombre))
    .slice(0, 20)
  return {
    datos: { v: 1, nombreComercial, tipoNegocio, descripcion, telefono, direccion, ciudad: t(crudo.ciudad, 80), rnc, sucursales, queVende, notas: t(crudo.notas, 1000) },
  }
}

/**
 * Qué capacidades enciende una aprobación (§41): las de comercio del
 * Merchant. El resto del paquete base lo decide la categoría de la empresa
 * al quedar como Merchant: por eso también se LEVANTAN los apagados del
 * Supplier Lite que no sean de comercio, para que la categoría mande de nuevo.
 */
export function capacidadesQueEnciendeLaAprobacion(): readonly Capacidad[] {
  return CAPACIDADES_DE_COMERCIO_MERCHANT
}

/** Las decisiones del superadmin y qué exige cada una. */
export type DecisionSolicitud = 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'MORE_INFO_REQUIRED'

export function validarDecision(d: { decision: string; motivo: string; peticion: string }): { decision: DecisionSolicitud } | { error: string } {
  const decision = d.decision as DecisionSolicitud
  if (!['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'MORE_INFO_REQUIRED'].includes(decision)) return { error: 'Elige qué hacer con la solicitud.' }
  if (decision === 'REJECTED' && d.motivo.trim().length < 3) return { error: 'Rechazar exige un motivo que el proveedor pueda leer.' }
  if (decision === 'MORE_INFO_REQUIRED' && d.peticion.trim().length < 3) return { error: 'Di qué información falta.' }
  return { decision }
}
