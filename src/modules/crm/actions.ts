'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminUser } from '@/lib/auth/guards'
import { esEtapa, esTipoSeguimiento } from '@/modules/crm/nucleo'
import { cambiarEtapa, convertirEnCliente, guardarNotas } from '@/modules/crm/prospectos'
import { crearSeguimiento, marcarSeguimientoHecho } from '@/modules/crm/seguimientos'

/**
 * ACCIONES DEL CRM (Meta · Fase 6). Mismo contrato que las de la bandeja:
 * admin pleno sin redirección, empresa de la sesión —nunca del formulario—,
 * ids validados por forma y cruzados con `companyId` en cada consulta.
 */

const RUTA = '/admin/crm'
const ID_VALIDO = /^[a-z0-9]{10,40}$/i

export interface EstadoCrm {
  error?: string
  success?: string
  hechoAt?: number
}

async function quien(): Promise<{ companyId: string; usuarioId: string } | null> {
  const user = await requireAdminUser()
  if (!user?.metadata.companyId) return null
  return { companyId: user.metadata.companyId, usuarioId: user.metadata.dbUserId }
}

function refrescar(prospectoId?: string) {
  revalidatePath(RUTA)
  revalidatePath(`${RUTA}/seguimientos`)
  revalidatePath(`${RUTA}/metricas`)
  if (prospectoId) revalidatePath(`${RUTA}/prospectos/${prospectoId}`)
}

export async function cambiarEtapaAction(prospectoId: string, etapa: string): Promise<{ ok: boolean; error?: string }> {
  const yo = await quien()
  if (!yo) return { ok: false, error: 'No autorizado.' }
  if (!ID_VALIDO.test(prospectoId) || !esEtapa(etapa)) return { ok: false, error: 'Etapa no válida.' }
  const ok = await cambiarEtapa(yo.companyId, prospectoId, etapa)
  refrescar(prospectoId)
  return ok ? { ok: true } : { ok: false, error: 'Este prospecto ya no existe.' }
}

export async function guardarNotasAction(_prev: EstadoCrm, formData: FormData): Promise<EstadoCrm> {
  const yo = await quien()
  if (!yo) return { error: 'No autorizado.' }
  const prospectoId = String(formData.get('prospectoId') ?? '')
  if (!ID_VALIDO.test(prospectoId)) return { error: 'Prospecto no válido.' }
  const notas = String(formData.get('notas') ?? '').trim().slice(0, 4000)
  const ok = await guardarNotas(yo.companyId, prospectoId, notas)
  refrescar(prospectoId)
  return ok ? { success: 'Notas guardadas.', hechoAt: Date.now() } : { error: 'Este prospecto ya no existe.' }
}

export async function convertirEnClienteAction(_prev: EstadoCrm, formData: FormData): Promise<EstadoCrm> {
  const yo = await quien()
  if (!yo) return { error: 'No autorizado.' }
  const prospectoId = String(formData.get('prospectoId') ?? '')
  if (!ID_VALIDO.test(prospectoId)) return { error: 'Prospecto no válido.' }
  const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 120)
  const telefono = String(formData.get('telefono') ?? '').trim().slice(0, 30) || null
  const email = String(formData.get('email') ?? '').trim().slice(0, 160) || null
  if (!nombre) return { error: 'El cliente necesita un nombre.' }
  const r = await convertirEnCliente(yo.companyId, prospectoId, { nombre, telefono, email })
  refrescar(prospectoId)
  if (!r.ok) return { error: r.error }
  return {
    success: r.creado ? 'Cliente creado y prospecto cerrado.' : 'Ya existía una ficha con esos datos: se enlazó y el prospecto quedó cerrado.',
    hechoAt: Date.now(),
  }
}

export async function crearSeguimientoAction(_prev: EstadoCrm, formData: FormData): Promise<EstadoCrm> {
  const yo = await quien()
  if (!yo) return { error: 'No autorizado.' }
  const prospectoId = String(formData.get('prospectoId') ?? '')
  const tipo = String(formData.get('tipo') ?? '')
  const nota = String(formData.get('nota') ?? '').trim().slice(0, 2000)
  const cuando = String(formData.get('programadoAt') ?? '').trim()
  const hecho = formData.get('hecho') === 'on'
  if (!ID_VALIDO.test(prospectoId)) return { error: 'Elige un prospecto.' }
  if (!esTipoSeguimiento(tipo)) return { error: 'Elige el tipo de seguimiento.' }
  if (!nota) return { error: 'Escribe qué vas a hacer o qué hiciste.' }
  let programadoAt: Date | null = null
  if (cuando) {
    const d = new Date(cuando)
    if (Number.isNaN(d.getTime())) return { error: 'La fecha no es válida.' }
    programadoAt = d
  }
  const r = await crearSeguimiento({
    companyId: yo.companyId,
    prospectoId,
    tipo,
    nota,
    programadoAt,
    hecho,
    creadoPorId: yo.usuarioId,
  })
  refrescar(prospectoId)
  return r.ok ? { success: hecho ? 'Seguimiento registrado.' : 'Seguimiento programado.', hechoAt: Date.now() } : { error: r.error }
}

export async function marcarSeguimientoHechoAction(seguimientoId: string): Promise<{ ok: boolean; error?: string }> {
  const yo = await quien()
  if (!yo) return { ok: false, error: 'No autorizado.' }
  if (!ID_VALIDO.test(seguimientoId)) return { ok: false, error: 'Seguimiento no válido.' }
  const ok = await marcarSeguimientoHecho(yo.companyId, seguimientoId)
  refrescar()
  return ok ? { ok: true } : { ok: false, error: 'Este seguimiento ya estaba hecho o no existe.' }
}
