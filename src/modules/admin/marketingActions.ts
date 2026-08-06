'use server'

import { revalidatePath } from 'next/cache'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { conEmpresa } from '@/lib/tenant'
import type { MarketingCampaignEstado } from '@prisma/client'
import { esMarketingTipoValido, horaAMinutos } from '@/lib/marketing'

export interface MarketingState {
  error?: string
  success?: boolean
}

function s(fd: FormData, k: string): string {
  return String(fd.get(k) ?? '').trim()
}

function parse(fd: FormData): { data: MarketingData } | { error: string } {
  const tipo = s(fd, 'tipo')
  if (!esMarketingTipoValido(tipo)) return { error: 'Tipo de campaña inválido.' }

  const titulo = s(fd, 'titulo')
  const descripcion = s(fd, 'descripcion')
  if (!titulo) return { error: 'El título es obligatorio.' }
  if (!descripcion) return { error: 'La descripción es obligatoria.' }

  const fechaInicio = new Date(s(fd, 'fechaInicio'))
  const fechaFin = new Date(s(fd, 'fechaFin'))
  if (Number.isNaN(fechaInicio.getTime()) || Number.isNaN(fechaFin.getTime())) {
    return { error: 'Fechas inválidas.' }
  }
  if (fechaFin <= fechaInicio) return { error: 'La fecha de fin debe ser posterior al inicio.' }

  const horaInicioMin = horaAMinutos(s(fd, 'horaInicio'))
  const horaFinMin = horaAMinutos(s(fd, 'horaFin'))
  if ((horaInicioMin == null) !== (horaFinMin == null)) {
    return { error: 'Indica ambas horas (inicio y fin) o ninguna.' }
  }
  if (horaInicioMin != null && horaFinMin != null && horaFinMin <= horaInicioMin) {
    return { error: 'La hora de fin debe ser posterior a la de inicio.' }
  }

  const diasSemana = fd
    .getAll('diasSemana')
    .map((d) => Number(d))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)

  const maxRaw = s(fd, 'maxReclamos')
  const maxReclamos = maxRaw ? Math.max(0, Math.floor(Number(maxRaw))) : null
  if (maxRaw && (maxReclamos == null || Number.isNaN(maxReclamos))) {
    return { error: 'Cupos inválidos.' }
  }

  const prioridad = Math.max(0, Math.floor(Number(s(fd, 'prioridad') || '0')) || 0)

  return {
    data: {
      tipo,
      titulo: titulo.slice(0, 120),
      descripcion: descripcion.slice(0, 600),
      bannerUrl: s(fd, 'bannerUrl') || null,
      imagenUrl: s(fd, 'imagenUrl') || null,
      ctaTexto: s(fd, 'ctaTexto').slice(0, 40) || null,
      ctaHref: s(fd, 'ctaHref') || null,
      colorPrimario: s(fd, 'colorPrimario') || null,
      colorSecundario: s(fd, 'colorSecundario') || null,
      fechaInicio,
      fechaFin,
      horaInicioMin,
      horaFinMin,
      diasSemana,
      prioridad,
      destacada: fd.get('destacada') === 'on',
      maxReclamos,
    },
  }
}

interface MarketingData {
  tipo: string
  titulo: string
  descripcion: string
  bannerUrl: string | null
  imagenUrl: string | null
  ctaTexto: string | null
  ctaHref: string | null
  colorPrimario: string | null
  colorSecundario: string | null
  fechaInicio: Date
  fechaFin: Date
  horaInicioMin: number | null
  horaFinMin: number | null
  diasSemana: number[]
  prioridad: number
  destacada: boolean
  maxReclamos: number | null
}

function revalidar() {
  revalidatePath('/admin/marketing')
  revalidatePath('/mis-membresias')
}

export async function crearCampanaMarketing(
  _prev: MarketingState,
  fd: FormData
): Promise<MarketingState> {
  const user = await requireSection('marketing')
  if (!user) return { error: 'No autorizado.' }
  const companyId = (await resolveCompanyId(user, fd)) ?? ''
  if (!companyId) return { error: 'Empresa requerida.' }

  const parsed = parse(fd)
  if ('error' in parsed) return { error: parsed.error }

  try {
    // Se crea ACTIVA para que empiece a mostrarse dentro de su ventana; el
    // admin puede pausarla luego.
    await conEmpresa(companyId, (tx) =>
      tx.marketingCampaign.create({
        data: { companyId, estado: 'ACTIVA', ...parsed.data } as never,
      })
    )
    revalidar()
    return { success: true }
  } catch (e) {
    console.error('[marketing] crear', e)
    return { error: 'No se pudo crear la campaña.' }
  }
}

export async function actualizarCampanaMarketing(
  _prev: MarketingState,
  fd: FormData
): Promise<MarketingState> {
  const user = await requireSection('marketing')
  if (!user) return { error: 'No autorizado.' }
  const companyId = (await resolveCompanyId(user, fd)) ?? ''
  if (!companyId) return { error: 'Empresa requerida.' }
  const id = s(fd, 'id')
  if (!id) return { error: 'Campaña no encontrada.' }

  const existe = await conEmpresa(companyId, (tx) =>
    tx.marketingCampaign.findFirst({
      where: { id, companyId },
      select: { id: true },
    })
  )
  if (!existe) return { error: 'Campaña no encontrada.' }

  const parsed = parse(fd)
  if ('error' in parsed) return { error: parsed.error }

  try {
    await conEmpresa(companyId, (tx) =>
      tx.marketingCampaign.update({
        where: { id },
        data: parsed.data as never,
      })
    )
    revalidar()
    return { success: true }
  } catch (e) {
    console.error('[marketing] actualizar', e)
    return { error: 'No se pudo actualizar la campaña.' }
  }
}

export async function cambiarEstadoCampanaMarketing(
  id: string,
  estado: MarketingCampaignEstado
): Promise<{ ok: boolean }> {
  const user = await requireSection('marketing')
  if (!user) return { ok: false }
  const companyId = (await resolveCompanyId(user)) ?? ''
  if (!companyId) return { ok: false }

  const res = await conEmpresa(companyId, (tx) =>
    tx.marketingCampaign.updateMany({
      where: { id, companyId },
      data: { estado },
    })
  )
  revalidar()
  return { ok: res.count > 0 }
}

export async function eliminarCampanaMarketing(id: string): Promise<{ ok: boolean }> {
  const user = await requireSection('marketing')
  if (!user) return { ok: false }
  const companyId = (await resolveCompanyId(user)) ?? ''
  if (!companyId) return { ok: false }

  const res = await conEmpresa(companyId, (tx) =>
    tx.marketingCampaign.deleteMany({ where: { id, companyId } })
  )
  revalidar()
  return { ok: res.count > 0 }
}
