/**
 * Growth Engine · Reglas de recompensa — NÚCLEO PURO.
 *
 * Por qué existe: el formulario embebido validaba dentro de la server action y,
 * cuando algo no cuadraba, hacía `return` sin decir nada. El administrador
 * llenaba la regla, pulsaba «Crear» y no pasaba absolutamente nada: ni regla ni
 * error. Aquí la validación se separa de la base de datos para poder probarla y
 * para que SIEMPRE devuelva un motivo legible.
 *
 * Sin Prisma ni React: solo entra un FormData y sale o los datos limpios o un
 * mensaje para la persona que está mirando la pantalla.
 */

import type { GrowthTrigger, GrowthRewardTipo, GrowthBeneficiario } from '@prisma/client'

export const TRIGGERS: GrowthTrigger[] = [
  'LINK_ABIERTO',
  'REGISTRO',
  'VERIFICADO',
  'MEMBRESIA',
  'COMPRA',
  'PRIMER_USO',
  'N_REFERIDOS',
]

export const TIPOS_RECOMPENSA: GrowthRewardTipo[] = [
  'PUNTOS',
  'CREDITOS',
  'BENEFICIO',
  'LAVADOS_GRATIS',
  'DESCUENTO_PORCENTAJE',
  'DESCUENTO_MONTO',
]

export const BENEFICIARIOS: GrowthBeneficiario[] = ['REFERENTE', 'REFERIDO', 'AMBOS']

export const TRIGGER_LABEL: Record<GrowthTrigger, string> = {
  LINK_ABIERTO: 'Abre el enlace',
  REGISTRO: 'Se registra',
  VERIFICADO: 'Verifica su correo',
  MEMBRESIA: 'Adquiere una membresía',
  COMPRA: 'Hace una compra',
  PRIMER_USO: 'Usa su beneficio por primera vez',
  N_REFERIDOS: 'Alcanza N referidos',
}

export const TIPO_LABEL: Record<GrowthRewardTipo, string> = {
  PUNTOS: 'Puntos',
  CREDITOS: 'Créditos (RD$)',
  BENEFICIO: 'Beneficio digital',
  LAVADOS_GRATIS: 'Lavados gratis',
  DESCUENTO_PORCENTAJE: 'Descuento (%)',
  DESCUENTO_MONTO: 'Descuento (RD$)',
}

export const BENEFICIARIO_LABEL: Record<GrowthBeneficiario, string> = {
  REFERENTE: 'Quien invita',
  REFERIDO: 'El invitado',
  AMBOS: 'Ambos',
}

export interface DatosRegla {
  nombre: string
  trigger: GrowthTrigger
  valorCondicion: number
  planId: string | null
  beneficiario: GrowthBeneficiario
  recompensaTipo: GrowthRewardTipo
  recompensaValor: number
  recompensaPromocionId: string | null
}

export type LecturaRegla =
  | { ok: true; datos: DatosRegla }
  | { ok: false; error: string; campo?: keyof DatosRegla }

/** Lee un campo de texto del formulario, ya recortado. */
function texto(fd: FormData, campo: string): string {
  return String(fd.get(campo) ?? '').trim()
}

/**
 * Valida y normaliza el formulario de una regla.
 *
 * Reglas de negocio que se hacen cumplir aquí:
 * - Un beneficio digital sin promoción elegida no premia nada: se rechaza en
 *   vez de guardar una regla que nunca entregará el beneficio.
 * - Los demás tipos exigen un valor mayor que cero, por el mismo motivo.
 * - El umbral solo tiene sentido en «alcanza N referidos»; en el resto se
 *   normaliza a 1 para que no quede basura guardada.
 * - Un descuento porcentual por encima de 100 sería regalar de más por error.
 */
export function leerRegla(fd: FormData): LecturaRegla {
  const nombre = texto(fd, 'nombre')
  if (!nombre) return { ok: false, error: 'Ponle un nombre a la regla.', campo: 'nombre' }
  if (nombre.length > 80) {
    return { ok: false, error: 'El nombre no puede pasar de 80 caracteres.', campo: 'nombre' }
  }

  const trigger = texto(fd, 'trigger') as GrowthTrigger
  if (!TRIGGERS.includes(trigger)) {
    return { ok: false, error: 'Elige cuándo se entrega la recompensa.', campo: 'trigger' }
  }

  const beneficiario = texto(fd, 'beneficiario') as GrowthBeneficiario
  if (!BENEFICIARIOS.includes(beneficiario)) {
    return { ok: false, error: 'Elige a quién se recompensa.', campo: 'beneficiario' }
  }

  const recompensaTipo = texto(fd, 'recompensaTipo') as GrowthRewardTipo
  if (!TIPOS_RECOMPENSA.includes(recompensaTipo)) {
    return { ok: false, error: 'Elige el tipo de recompensa.', campo: 'recompensaTipo' }
  }

  const promocionElegida = texto(fd, 'recompensaPromocionId') || null
  const esBeneficio = recompensaTipo === 'BENEFICIO'
  if (esBeneficio && !promocionElegida) {
    return {
      ok: false,
      error: 'Elige qué beneficio digital se entrega.',
      campo: 'recompensaPromocionId',
    }
  }

  const valorCrudo = Number(fd.get('recompensaValor') ?? 0)
  const recompensaValor = esBeneficio ? 0 : valorCrudo
  if (!esBeneficio) {
    if (!Number.isFinite(recompensaValor) || recompensaValor <= 0) {
      return {
        ok: false,
        error: 'El valor de la recompensa debe ser mayor que cero.',
        campo: 'recompensaValor',
      }
    }
    if (recompensaTipo === 'DESCUENTO_PORCENTAJE' && recompensaValor > 100) {
      return {
        ok: false,
        error: 'Un descuento en porcentaje no puede pasar de 100.',
        campo: 'recompensaValor',
      }
    }
  }

  const umbralCrudo = Number(fd.get('valorCondicion') ?? 1)
  if (trigger === 'N_REFERIDOS' && (!Number.isFinite(umbralCrudo) || umbralCrudo < 1)) {
    return {
      ok: false,
      error: 'Indica cuántos referidos hacen falta (mínimo 1).',
      campo: 'valorCondicion',
    }
  }
  const valorCondicion =
    trigger === 'N_REFERIDOS' ? Math.floor(umbralCrudo) : 1

  return {
    ok: true,
    datos: {
      nombre,
      trigger,
      valorCondicion,
      planId: texto(fd, 'planId') || null,
      beneficiario,
      recompensaTipo,
      recompensaValor,
      // Guardar una promoción en una regla que no entrega beneficios dejaría un
      // dato fantasma que confunde al editar.
      recompensaPromocionId: esBeneficio ? promocionElegida : null,
    },
  }
}

/** Frase corta que describe la regla en la lista («Se registra → 50 Puntos»). */
export function resumirRegla(r: {
  trigger: string
  valorCondicion: number
  recompensaTipo: string
  recompensaValor: number
  recompensaPromocion?: string | null
  beneficiario: string
}): string {
  const cuando =
    TRIGGER_LABEL[r.trigger as GrowthTrigger] ?? r.trigger
  const umbral = r.trigger === 'N_REFERIDOS' ? ` (${r.valorCondicion})` : ''
  const premio =
    r.recompensaTipo === 'BENEFICIO'
      ? (r.recompensaPromocion ?? 'Beneficio digital')
      : `${r.recompensaValor} · ${TIPO_LABEL[r.recompensaTipo as GrowthRewardTipo] ?? r.recompensaTipo}`
  const paraQuien =
    BENEFICIARIO_LABEL[r.beneficiario as GrowthBeneficiario] ?? r.beneficiario
  return `${cuando}${umbral} → ${premio} · para ${paraQuien}`
}
