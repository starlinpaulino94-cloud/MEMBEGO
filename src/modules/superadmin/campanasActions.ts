'use server'

/**
 * Acciones de las CAMPAÑAS GLOBALES (solo SUPERADMIN).
 *
 * `aplicarCampana` es el motor de reparto: recorre las empresas participantes
 * y crea en cada una una promoción o un plan REAL. Es IDEMPOTENTE — si una
 * empresa ya recibió su copia no se duplica, así que se puede volver a aplicar
 * cuando entra una empresa nueva sin miedo. Los fallos se guardan POR EMPRESA:
 * que una falle no aborta el resto.
 */

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import {
  CAMPANA_TIPOS,
  leerPlantilla,
  type CampanaTipo,
  type PlantillaPlan,
  type PlantillaPromocion,
} from './campanasGlobales'
import { anotarFallo } from '@/lib/prisma-errors'

export interface CampanaActionState {
  error?: string
  success?: string
}

const RUTA = '/superadmin/campanas'

async function soloSuperadmin() {
  const user = await getUser()
  if (!user || user.metadata.role !== 'SUPERADMIN') return null
  return user
}

/** Crea la campaña en BORRADOR con sus empresas participantes. */
export async function crearCampanaGlobal(
  _prev: CampanaActionState,
  formData: FormData
): Promise<CampanaActionState> {
  try {
    const user = await soloSuperadmin()
    if (!user) return { error: 'Solo el superadmin puede crear campañas globales.' }

    const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 120)
    const tipo = String(formData.get('tipo') ?? '').trim() as CampanaTipo
    const descripcion = String(formData.get('descripcion') ?? '').trim().slice(0, 500)
    if (!nombre) return { error: 'Ponle un nombre a la campaña.' }
    if (formData.get('modo') !== 'CADENA' && !(CAMPANA_TIPOS as readonly string[]).includes(tipo)) {
      return { error: 'Elige qué se va a crear en cada empresa.' }
    }

    const modo = formData.get('modo') === 'CADENA' ? 'CADENA' : 'COPIA'
    const imagenUrl = String(formData.get('imagenUrl') ?? '').trim() || null

    // ── Campaña EN CADENA: cada empresa aporta un beneficio distinto ────────
    if (modo === 'CADENA') {
      // Los pasos llegan como arrays paralelos (paso_companyId[], paso_titulo[]…).
      const companies = formData.getAll('paso_companyId').map(String)
      const titulos = formData.getAll('paso_titulo').map((v) => String(v).trim())
      const descs = formData.getAll('paso_descripcion').map((v) => String(v).trim())
      const imgs = formData.getAll('paso_imagenUrl').map((v) => String(v).trim())
      const descuentos = formData.getAll('paso_descuento').map((v) => String(v).trim())
      const usos = formData.getAll('paso_usos').map((v) => String(v).trim())

      const pasos = companies
        .map((companyId, i) => ({
          companyId,
          orden: i + 1,
          titulo: titulos[i] || `Paso ${i + 1}`,
          descripcion: descs[i] || null,
          imagenUrl: imgs[i] || null,
          plantilla: {
            titulo: titulos[i] || `Paso ${i + 1}`,
            descripcion: descs[i] || '',
            tipo: 'general',
            descuento: Number(descuentos[i]) || null,
            imagenUrl: imgs[i] || imagenUrl,
            esComprable: false,
            usosPorCompra: Number(usos[i]) || 1,
          },
        }))
        .filter((p) => p.companyId)

      if (pasos.length < 2) {
        return {
          error:
            'Una campaña en cadena necesita al menos 2 empresas: el beneficio de la primera desbloquea el de la siguiente.',
        }
      }
      const empresasUnicas = new Set(pasos.map((p) => p.companyId))
      if (empresasUnicas.size !== pasos.length) {
        return { error: 'Cada empresa puede aparecer una sola vez en la cadena.' }
      }

      await prisma.campanaGlobal.create({
        data: {
          nombre,
          tipo: 'PROMOCION',
          modo: 'CADENA',
          imagenUrl,
          descripcion: descripcion || null,
          plantilla: {},
          todasLasEmpresas: false,
          creadaPorId: user.metadata.dbUserId ?? null,
          participantes: { create: pasos.map((p) => ({ companyId: p.companyId })) },
          pasos: {
            create: pasos.map((p) => ({
              companyId: p.companyId,
              orden: p.orden,
              titulo: p.titulo,
              descripcion: p.descripcion,
              imagenUrl: p.imagenUrl,
              plantilla: p.plantilla,
            })),
          },
        },
        select: { id: true },
      })

      revalidatePath(RUTA)
      return {
        success: `Cadena creada en borrador con ${pasos.length} eslabones. Revísala y aplícala cuando estés listo.`,
      }
    }

    const todas = formData.get('todasLasEmpresas') === 'on'
    const elegidas = formData.getAll('empresas').map(String).filter(Boolean)

    // Empresas destino: todas las activas, o las marcadas a mano.
    const empresas = todas
      ? await prisma.company.findMany({ where: { isActive: true }, select: { id: true } })
      : await prisma.company.findMany({
          where: { id: { in: elegidas } },
          select: { id: true },
        })
    if (empresas.length === 0) {
      return { error: 'Selecciona al menos una empresa participante.' }
    }

    // La plantilla se guarda tal cual la escribió el superadmin; `leerPlantilla`
    // la normaliza al aplicar, así que un campo vacío nunca rompe el reparto.
    const num = (k: string) => {
      const v = String(formData.get(k) ?? '').trim().replace(',', '.')
      if (!v) return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    const plantilla =
      tipo === 'PLAN'
        ? {
            nombre: String(formData.get('p_nombre') ?? '').trim() || nombre,
            precio: num('p_precio') ?? 0,
            lavadosIncluidos: num('p_lavados') ?? 0,
            esIlimitado: formData.get('p_ilimitado') === 'on',
            descripcion: String(formData.get('p_descripcion') ?? '').trim() || null,
            vigenciaDias: num('p_vigenciaDias') ?? 30,
            condiciones: String(formData.get('p_condiciones') ?? '').trim() || null,
          }
        : {
            titulo: String(formData.get('p_titulo') ?? '').trim() || nombre,
            descripcion: String(formData.get('p_descripcion') ?? '').trim(),
            tipo: String(formData.get('p_tipoPromo') ?? 'general').trim(),
            descuento: num('p_descuento'),
            imagenUrl: String(formData.get('p_imagenUrl') ?? '').trim() || null,
            vigenciaHasta: String(formData.get('p_vigenciaHasta') ?? '').trim() || null,
            esComprable: formData.get('p_comprable') === 'on',
            precio: num('p_precio'),
            usosPorCompra: num('p_usos') ?? 1,
          }

    await prisma.campanaGlobal.create({
      data: {
        nombre,
        tipo,
        modo: 'COPIA',
        imagenUrl,
        descripcion: descripcion || null,
        plantilla,
        todasLasEmpresas: todas,
        creadaPorId: user.metadata.dbUserId ?? null,
        participantes: {
          create: empresas.map((e) => ({ companyId: e.id })),
        },
      },
      select: { id: true },
    })

    revalidatePath(RUTA)
    return {
      success: `Campaña creada en borrador con ${empresas.length} empresa${empresas.length !== 1 ? 's' : ''}. Revísala y aplícala cuando estés listo.`,
    }
  } catch (e) {
    console.error('[campanas globales] crear:', e)
    return {
      error:
        'No se pudo crear. Si acabas de instalar esta versión, corre la migración 20260760_campanas_globales en la base de datos.',
    }
  }
}

/**
 * Reparte la campaña: crea la promoción o el plan en cada empresa que aún no
 * lo tenga. Idempotente y tolerante a fallos individuales.
 */
export async function aplicarCampanaGlobal(
  campanaId: string
): Promise<{ ok?: true; creadas?: number; fallos?: number; error?: string }> {
  try {
    const user = await soloSuperadmin()
    if (!user) return { error: 'Solo el superadmin puede aplicar campañas.' }

    const campana = await prisma.campanaGlobal.findUnique({
      where: { id: campanaId },
      include: { participantes: true },
    })
    if (!campana) return { error: 'Campaña no encontrada.' }
    if (campana.estado === 'ARCHIVADA') {
      return { error: 'Esta campaña está archivada.' }
    }

    // ── Cadena: cada eslabón genera SU promoción en SU empresa ─────────────
    if (campana.modo === 'CADENA') {
      const pasos = await prisma.campanaPaso.findMany({
        where: { campanaId, aplicadaAt: null },
        orderBy: { orden: 'asc' },
      })
      let creadasC = 0
      let fallosC = 0
      for (const paso of pasos) {
        try {
          const t = leerPlantilla('PROMOCION', paso.plantilla) as PlantillaPromocion
          const promo = await prisma.promocion.create({
            data: {
              companyId: paso.companyId,
              titulo: paso.titulo || t.titulo,
              descripcion: paso.descripcion ?? t.descripcion,
              tipo: t.tipo,
              descuento: t.descuento ?? null,
              imagenUrl: paso.imagenUrl ?? t.imagenUrl ?? campana.imagenUrl,
              vigenciaHasta: t.vigenciaHasta ? new Date(t.vigenciaHasta) : null,
              esComprable: false,
              precio: null,
              usosPorCompra: t.usosPorCompra ?? 1,
              // Solo el PRIMER eslabón se ofrece al público: los siguientes
              // llegan al cliente por la cadena, no se toman por su cuenta.
              visibilidad: paso.orden === 1 ? 'publica' : 'privada',
              activo: true,
            },
            select: { id: true },
          })
          await prisma.campanaPaso.update({
            where: { id: paso.id },
            data: { promocionId: promo.id, aplicadaAt: new Date(), error: null },
          })
          await prisma.campanaGlobalEmpresa.updateMany({
            where: { campanaId, companyId: paso.companyId },
            data: { promocionId: promo.id, aplicadaAt: new Date(), error: null },
          })
          creadasC++
        } catch (e) {
          fallosC++
          console.error('[campanas globales] paso', paso.orden, e)
          await prisma.campanaPaso
            .update({
              where: { id: paso.id },
              data: { error: e instanceof Error ? e.message.slice(0, 300) : 'Error desconocido' },
            })
            .catch(anotarFallo('superadmin:campanaPaso.update'))
        }
      }
      await prisma.campanaGlobal.update({
        where: { id: campanaId },
        data: { estado: 'APLICADA', aplicadaAt: new Date() },
      })
      revalidatePath(RUTA)
      revalidatePath(`${RUTA}/${campanaId}`)
      return { ok: true, creadas: creadasC, fallos: fallosC }
    }

    const tipo = campana.tipo as CampanaTipo
    const plantilla = leerPlantilla(tipo, campana.plantilla)

    // Si es "todas las empresas", incorpora las que se hayan creado después.
    if (campana.todasLasEmpresas) {
      const activas = await prisma.company.findMany({
        where: { isActive: true },
        select: { id: true },
      })
      const yaEstan = new Set(campana.participantes.map((p) => p.companyId))
      const nuevas = activas.filter((a) => !yaEstan.has(a.id))
      if (nuevas.length > 0) {
        await prisma.campanaGlobalEmpresa.createMany({
          data: nuevas.map((n) => ({ campanaId, companyId: n.id })),
          skipDuplicates: true,
        })
      }
    }

    const participantes = await prisma.campanaGlobalEmpresa.findMany({
      where: { campanaId, aplicadaAt: null },
      select: { id: true, companyId: true },
    })

    let creadas = 0
    let fallos = 0
    for (const p of participantes) {
      try {
        if (tipo === 'PLAN') {
          const t = plantilla as PlantillaPlan
          const plan = await prisma.plan.create({
            data: {
              companyId: p.companyId,
              nombre: t.nombre,
              precio: t.precio,
              lavadosIncluidos: t.lavadosIncluidos,
              esIlimitado: t.esIlimitado ?? false,
              descripcion: t.descripcion,
              beneficios: [],
              vigenciaDias: t.vigenciaDias ?? 30,
              condiciones: t.condiciones,
              activo: true,
            },
            select: { id: true },
          })
          await prisma.campanaGlobalEmpresa.update({
            where: { id: p.id },
            data: { planId: plan.id, aplicadaAt: new Date(), error: null },
          })
        } else {
          const t = plantilla as PlantillaPromocion
          const promo = await prisma.promocion.create({
            data: {
              companyId: p.companyId,
              titulo: t.titulo,
              descripcion: t.descripcion,
              tipo: t.tipo,
              descuento: t.descuento ?? null,
              imagenUrl: t.imagenUrl,
              vigenciaHasta: t.vigenciaHasta ? new Date(t.vigenciaHasta) : null,
              esComprable: t.esComprable ?? false,
              precio: t.esComprable ? (t.precio ?? 0) : null,
              usosPorCompra: t.usosPorCompra ?? 1,
              activo: true,
            },
            select: { id: true },
          })
          await prisma.campanaGlobalEmpresa.update({
            where: { id: p.id },
            data: { promocionId: promo.id, aplicadaAt: new Date(), error: null },
          })
        }
        creadas++
      } catch (e) {
        fallos++
        console.error('[campanas globales] aplicar a', p.companyId, e)
        await prisma.campanaGlobalEmpresa
          .update({
            where: { id: p.id },
            data: { error: e instanceof Error ? e.message.slice(0, 300) : 'Error desconocido' },
          })
          .catch(anotarFallo('superadmin:campanaGlobalEmpresa.update'))
      }
    }

    await prisma.campanaGlobal.update({
      where: { id: campanaId },
      data: { estado: 'APLICADA', aplicadaAt: new Date() },
    })

    const meta = await getRequestMeta()
    await prisma.auditLog
      .create({
        data: {
          companyId: null,
          userId: user.metadata.dbUserId ?? null,
          accion: 'NOTA_INTERNA',
          entidadTipo: 'CampanaGlobal',
          entidadId: campanaId,
          payload: { tipo: 'CAMPANA_GLOBAL_APLICADA', campana: campana.nombre, creadas, fallos },
          ...meta,
        },
      })
      .catch(anotarFallo('superadmin:auditLog.create'))

    revalidatePath(RUTA)
    revalidatePath(`${RUTA}/${campanaId}`)
    return { ok: true, creadas, fallos }
  } catch (e) {
    console.error('[campanas globales] aplicar:', e)
    return { error: 'No se pudo aplicar la campaña. Intenta de nuevo.' }
  }
}

/**
 * Archiva la campaña y DESACTIVA lo que generó en cada empresa (no lo borra:
 * el historial de canjes y compras debe sobrevivir).
 */
export async function archivarCampanaGlobal(
  campanaId: string
): Promise<{ ok?: true; error?: string }> {
  try {
    const user = await soloSuperadmin()
    if (!user) return { error: 'Solo el superadmin puede archivar campañas.' }

    const participantes = await prisma.campanaGlobalEmpresa.findMany({
      where: { campanaId },
      select: { promocionId: true, planId: true },
    })
    const pasos = await prisma.campanaPaso.findMany({
      where: { campanaId },
      select: { promocionId: true },
    })
    const promos = [
      ...participantes.map((p) => p.promocionId),
      ...pasos.map((p) => p.promocionId),
    ].filter((x): x is string => !!x)
    const planes = participantes.map((p) => p.planId).filter((x): x is string => !!x)

    if (promos.length > 0) {
      await prisma.promocion
        .updateMany({ where: { id: { in: promos } }, data: { activo: false } })
        .catch((e) => console.error('[campanas globales] desactivar promos:', e))
    }
    if (planes.length > 0) {
      await prisma.plan
        .updateMany({ where: { id: { in: planes } }, data: { activo: false } })
        .catch((e) => console.error('[campanas globales] desactivar planes:', e))
    }

    await prisma.campanaGlobal.update({
      where: { id: campanaId },
      data: { estado: 'ARCHIVADA' },
    })

    const meta = await getRequestMeta()
    await prisma.auditLog
      .create({
        data: {
          companyId: null,
          userId: user.metadata.dbUserId ?? null,
          accion: 'NOTA_INTERNA',
          entidadTipo: 'CampanaGlobal',
          entidadId: campanaId,
          payload: {
            tipo: 'CAMPANA_GLOBAL_ARCHIVADA',
            promocionesDesactivadas: promos.length,
            planesDesactivados: planes.length,
          },
          ...meta,
        },
      })
      .catch(anotarFallo('superadmin:auditoria-campana'))

    revalidatePath(RUTA)
    revalidatePath(`${RUTA}/${campanaId}`)
    return { ok: true }
  } catch (e) {
    console.error('[campanas globales] archivar:', e)
    return { error: 'No se pudo archivar la campaña.' }
  }
}
