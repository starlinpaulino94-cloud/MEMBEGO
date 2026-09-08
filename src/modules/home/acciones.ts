'use server'

import { revalidatePath } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import {
  ComposicionInput,
  HeroSlide,
} from '@/modules/home/esquema'
import { transicionPermitida, type EstadoHome } from '@/modules/home/composicion'
import { heroPublico } from '@/modules/home/hero-publico'

export interface HomeState {
  error?: string
  ok?: boolean
  revisionId?: string
}

async function contexto() {
  const user = await requireSection('personalizacion')
  if (!user) return null
  const companyId = await resolveCompanyId(user)
  if (!companyId) return null
  return { user, companyId }
}

/** El destino del CTA existe, está publicado y es de esta empresa. */
async function validarDestino(
  companyId: string,
  destino: { tipo: string; id: string }
): Promise<string | null> {
  return conEmpresa(companyId, async (tx) => {
    if (destino.tipo === 'promocion') {
      const p = await tx.promocion.findFirst({
        where: { id: destino.id, companyId },
        select: { activo: true, archivada: true },
      })
      if (!p) return 'Una diapositiva apunta a una promoción que no existe.'
      if (!p.activo || p.archivada) return 'Una diapositiva apunta a una promoción no publicada.'
      return null
    }
    if (destino.tipo === 'empresa') {
      if (destino.id !== companyId) return 'El hero solo muestra contenido de esta empresa.'
      return null
    }
    if (destino.tipo === 'plan') {
      const p = await tx.plan.findFirst({
        where: { id: destino.id, companyId },
        select: { activo: true },
      })
      if (!p) return 'Una diapositiva apunta a un plan que no existe.'
      if (!p.activo) return 'Una diapositiva apunta a un plan no publicado.'
      return null
    }
    const e = await tx.excursion.findFirst({
      where: { id: destino.id, companyId },
      select: { id: true },
    })
    if (!e) return 'Una diapositiva apunta a una excursión que no existe.'
    return null
  })
}

async function validarHero(
  companyId: string,
  slides: HeroSlide[]
): Promise<string | null> {
  for (const s of slides) {
    if (s.empresaId !== companyId) {
      return 'El hero solo muestra contenido de esta empresa.'
    }
    const error = await validarDestino(companyId, s.ctaDestino)
    if (error) return error
    if (!(await heroPublico(companyId, s))) return 'El banner debe enlazar contenido público vigente y usar imágenes de su empresa.'
  }
  return null
}

export async function guardarBorrador(
  input: unknown
): Promise<HomeState> {
  const ctx = await contexto()
  if (!ctx) return { error: 'No autorizado.' }
  const parsed = ComposicionInput.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Composición inválida.' }
  }
  const data = parsed.data

  try {
    const revision = await conEmpresa(ctx.companyId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM companies WHERE id = ${ctx.companyId} FOR UPDATE`
      const previa = await tx.homeRevision.findFirst({
        where: { companyId: ctx.companyId, estado: { in: ['BORRADOR', 'PROGRAMADA', 'PAUSADA'] } },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, estado: true },
      })
      const rev =
        previa && previa.estado === 'BORRADOR'
          ? previa
          : await tx.homeRevision.create({
              data: {
                companyId: ctx.companyId,
                territorio: data.territorio,
                estado: 'BORRADOR',
                createdById: ctx.user.metadata.dbUserId || null,
              },
              select: { id: true, estado: true },
            })
      await tx.homeBloque.deleteMany({ where: { revisionId: rev.id } })
      await tx.homeBloque.createMany({
        data: data.bloques.map((b, i) => ({
          revisionId: rev.id,
          tipo: b.tipo,
          orden: i,
          activo: b.tipo === 'CABECERA' ? true : b.activo,
          titulo: b.titulo,
          config:
            b.tipo === 'CABECERA'
              ? { ...(b.config as object), segmentacion: data.segmentacion }
              : (b.config as object),
        })),
      })
      if (rev.id !== previa?.id || data.territorio) {
        await tx.homeRevision.update({
          where: { id: rev.id },
          data: { territorio: data.territorio },
        })
      }
      await tx.auditLog.create({
        data: {
          companyId: ctx.companyId,
          userId: ctx.user.metadata.dbUserId || null,
          accion: 'COMPOSICION_GUARDADA',
          entidadTipo: 'HomeRevision',
          entidadId: rev.id,
          payload: { territorio: data.territorio },
        },
      })
      return rev
    })
    revalidatePath('/admin/personalizacion')
    return { ok: true, revisionId: revision.id }
  } catch (e) {
    console.error('[home] guardarBorrador:', e)
    return { error: 'No se pudo guardar el borrador.' }
  }
}

async function cambiarEstado(
  revisionId: string,
  hacia: EstadoHome,
  programadaPara?: Date | null
): Promise<HomeState> {
  const ctx = await contexto()
  if (!ctx) return { error: 'No autorizado.' }
  try {
    const rev = await conEmpresa(ctx.companyId, (tx) =>
      tx.homeRevision.findFirst({
        where: { id: revisionId, companyId: ctx.companyId },
        include: { bloques: true },
      })
    )
    if (!rev) return { error: 'Esa revisión ya no existe.' }
    if (!transicionPermitida(rev.estado as EstadoHome, hacia)) {
      return { error: 'Ese cambio de estado no está permitido.' }
    }
    if (hacia === 'PROGRAMADA' && (!programadaPara || programadaPara.getTime() <= Date.now())) {
      return { error: 'La programación es una fecha futura.' }
    }

    if (hacia === 'PUBLICADA' || hacia === 'PROGRAMADA') {
      const hero = rev.bloques.find((b) => b.tipo === 'HERO')
      const slides = HeroSlide.array()
        .min(1)
        .max(3)
        .safeParse((hero?.config as { slides?: unknown })?.slides ?? [])
      if (!slides.success || slides.data.length === 0) {
        return { error: 'El hero necesita 1–3 diapositivas válidas para publicarse.' }
      }
      const error = await validarHero(ctx.companyId, slides.data)
      if (error) return { error }
    }

    await conEmpresa(ctx.companyId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM companies WHERE id = ${ctx.companyId} FOR UPDATE`
      const cambio = await tx.homeRevision.updateMany({
        where: { id: rev.id, companyId: ctx.companyId, estado: rev.estado, updatedAt: rev.updatedAt },
        data: {
          estado: hacia,
          programadaPara: hacia === 'PROGRAMADA' ? (programadaPara ?? null) : null,
        },
      })
      if (cambio.count !== 1) throw new Error('La revisión cambió durante la publicación. Vuelve a cargarla.')
      await tx.auditLog.create({
        data: {
          companyId: ctx.companyId,
          userId: ctx.user.metadata.dbUserId || null,
          accion:
            hacia === 'PUBLICADA' || hacia === 'PROGRAMADA'
              ? 'COMPOSICION_PUBLICADA'
              : hacia === 'PAUSADA'
                ? 'COMPOSICION_PAUSADA'
                : 'COMPOSICION_ARCHIVADA',
          entidadTipo: 'HomeRevision',
          entidadId: rev.id,
          payload: { desde: rev.estado, hacia },
        },
      })
    })
    revalidatePath('/admin/personalizacion')
    revalidatePath('/cliente/inicio')
    return { ok: true, revisionId: rev.id }
  } catch (e) {
    console.error('[home] cambiarEstado:', e)
    return { error: 'No se pudo cambiar el estado.' }
  }
}

export async function publicarAhora(revisionId: string): Promise<HomeState> {
  return cambiarEstado(revisionId, 'PUBLICADA')
}

export async function programarPublicacion(
  revisionId: string,
  programadaPara: Date
): Promise<HomeState> {
  return cambiarEstado(revisionId, 'PROGRAMADA', programadaPara)
}

export async function pausarPublicacion(revisionId: string): Promise<HomeState> {
  return cambiarEstado(revisionId, 'PAUSADA')
}

export async function archivarRevision(revisionId: string): Promise<HomeState> {
  return cambiarEstado(revisionId, 'ARCHIVADA')
}

export async function reanudarPublicacion(revisionId: string): Promise<HomeState> {
  return cambiarEstado(revisionId, 'PUBLICADA')
}

export async function publicarEdicion(input: unknown, fecha?: Date): Promise<HomeState> {
  const guardado = await guardarBorrador(input)
  if (!guardado.ok || !guardado.revisionId) return guardado
  return fecha ? programarPublicacion(guardado.revisionId, fecha) : publicarAhora(guardado.revisionId)
}
