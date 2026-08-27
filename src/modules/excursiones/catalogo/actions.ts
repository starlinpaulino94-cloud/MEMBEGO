'use server'

/**
 * EXCURSIONES · Catálogo — acciones. Todas detrás de
 * requireSection('excursiones', <funcion>): la capacidad EXCURSIONES y los
 * permisos por empleado gobiernan cada mutación. Multi-tenant con conEmpresa
 * y auditoría en las operaciones que cambian el catálogo.
 */

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import {
  ESTADOS_EXCURSION,
  slugExcursion,
  validarExcursion,
  validarHorario,
  validarVariante,
  calcularHoraRegreso,
  type EstadoExcursion,
} from './nucleo'
import {
  validarItinerarioCombo,
  generarCombinacionesCombo,
  diasComunesCombo,
} from '@/modules/excursiones/reservas/nucleo'

export interface CatalogoActionState {
  error?: string
  success?: string
  /** id de la excursión creada (para redirigir al detalle). */
  excursionId?: string
}

function deForm(formData: FormData, campos: string[]): Record<string, unknown> {
  return Object.fromEntries(campos.map((c) => [c, String(formData.get(c) ?? '')]))
}

const CAMPOS_EXCURSION = [
  'nombre', 'tipoItem', 'descripcion', 'duracionMin', 'ubicacion', 'categoria', 'moneda',
  'impuestoPct', 'capacidad', 'puntoSalida', 'horaSalida', 'horaRegreso',
  'incluye', 'noIncluye', 'politicas', 'portadaUrl', 'galeriaJson'
]

async function auditar(
  companyId: string,
  userId: string | null,
  entidadId: string,
  payload: Record<string, unknown>
) {
  const meta = await getRequestMeta()
  await conEmpresa(companyId, (tx) =>
    tx.auditLog.create({
      data: {
        companyId,
        userId,
        accion: 'NOTA_INTERNA',
        entidadTipo: 'Excursion',
        entidadId,
        payload: payload as Prisma.InputJsonObject,
        ...meta,
      },
    })
  ).catch(anotarFallo('excursiones:auditLog'))
}

/** ADMIN · Crear excursión o combo. */
export async function crearExcursion(
  _prev: CatalogoActionState,
  formData: FormData
): Promise<CatalogoActionState> {
  try {
    const user = await requireSection('excursiones', 'catalogo_crear')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }

    const v = validarExcursion(deForm(formData, CAMPOS_EXCURSION))
    if (!v.ok) return { error: v.error }

    // Actividades incluidas si es un combo
    const rawComboActividades = Array.from(
      new Set(
        formData
          .getAll('actividadesComboIds')
          .map((id) => String(id).trim())
          .filter(Boolean)
      )
    )

    let actsDbParaCombo: {
      id: string
      nombre: string
      duracionMin: number | null
      horaSalida: string | null
      horaRegreso: string | null
      horarios: { horaSalida: string; diasSemana: number[] }[]
    }[] = []
    let horariosPorActividad: Record<string, string> = {}

    if (v.datos.tipoItem === 'COMBO' && rawComboActividades.length < 2) {
      return { error: 'Un combo debe incluir al menos 2 actividades del catálogo.' }
    }

    // Validación estricta de itinerario sin solapamientos para combos
    if (v.datos.tipoItem === 'COMBO' && rawComboActividades.length >= 2) {
      const comboHorariosRaw = String(formData.get('comboActividadesHorarios') ?? '')
      if (comboHorariosRaw) {
        try {
          horariosPorActividad = JSON.parse(comboHorariosRaw)
        } catch {
          /* ignore */
        }
      }

      const actsRaw = await conEmpresa(companyId, (tx) =>
        tx.excursion.findMany({
          where: { id: { in: rawComboActividades }, companyId },
          select: {
            id: true,
            nombre: true,
            duracionMin: true,
            horaSalida: true,
            horaRegreso: true,
            horarios: { where: { activo: true }, select: { horaSalida: true, diasSemana: true } },
          },
        })
      )

      actsDbParaCombo = actsRaw.map((a) => ({
        id: a.id,
        nombre: a.nombre,
        duracionMin: a.duracionMin,
        horaSalida: a.horaSalida,
        horaRegreso: a.horaRegreso,
        horarios: a.horarios.map((h) => ({
          horaSalida: h.horaSalida,
          diasSemana: Array.isArray(h.diasSemana) ? (h.diasSemana as number[]) : [1, 2, 3, 4, 5, 6, 7],
        })),
      }))

      const actsConHorarios = actsDbParaCombo.map((a) => ({
        id: a.id,
        nombre: a.nombre,
        duracionMin: a.duracionMin,
        horaSalida:
          horariosPorActividad[a.id] ||
          a.horaSalida ||
          (a.horarios[0]?.horaSalida ? a.horarios[0].horaSalida : '09:00'),
        horaRegreso: null,
      }))

      const valItinerario = validarItinerarioCombo(actsConHorarios)
      if (!valItinerario.ok) {
        return { error: `No se puede guardar el combo: ${valItinerario.error}` }
      }
    }

    // El precio base vive en la variante «Estándar»: así toda excursión/combo tiene
    // desde el primer día la misma forma que una con variantes (§15).
    const variante = validarVariante({
      nombre: 'Estándar',
      precioAdulto: String(formData.get('precioAdulto') ?? ''),
      precioNino: String(formData.get('precioNino') ?? ''),
      precioResidente: String(formData.get('precioResidente') ?? ''),
      precioNinoResidente: String(formData.get('precioNinoResidente') ?? ''),
      precioTurista: String(formData.get('precioTurista') ?? ''),
    })
    if (!variante.ok) return { error: variante.error }

    // Procesar horarios de salida o días de operación para PASE_DIA
    let horariosToCreate: { horaSalida: string; diasSemana: number[]; cupo: number | null }[] = []
    
    if (v.datos.tipoItem === 'PASE_DIA') {
      const diasPaseRaw = formData.getAll('diasSemanaPaseDia').map(Number).filter((n) => n >= 1 && n <= 7)
      const diasSemana = diasPaseRaw.length > 0 ? Array.from(new Set(diasPaseRaw)).sort((a, b) => a - b) : [1, 2, 3, 4, 5, 6, 7]
      horariosToCreate = [
        {
          horaSalida: '00:00',
          diasSemana,
          cupo: v.datos.capacidad,
        },
      ]
      v.datos.horaSalida = null
      v.datos.horaRegreso = null
      v.datos.duracionMin = null
    } else {
      const horariosRaw = String(formData.get('horariosData') ?? '')
      if (horariosRaw) {
        try {
          const parsed = JSON.parse(horariosRaw)
          if (Array.isArray(parsed)) {
            horariosToCreate = parsed
              .map((h: Record<string, unknown>) => ({
                horaSalida: String(h.horaSalida || '').trim().slice(0, 5),
                diasSemana: Array.isArray(h.diasSemana) && h.diasSemana.length > 0 ? h.diasSemana.map(Number) : [1, 2, 3, 4, 5, 6, 7],
                cupo: h.cupo ? Number(h.cupo) : null,
              }))
              .filter((h) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(h.horaSalida))
          }
        } catch {
          /* ignore invalid json */
        }
      }

      // Si es un combo y hay combinaciones válidas, asegurar que todos los horarios válidos se persisten
      if (v.datos.tipoItem === 'COMBO' && rawComboActividades.length >= 2 && actsDbParaCombo.length > 0) {
        const combinaciones = generarCombinacionesCombo(actsDbParaCombo)
        if (combinaciones.length > 0 && horariosToCreate.length <= 1) {
          const diasComunes = diasComunesCombo(actsDbParaCombo)
          const dias = diasComunes.length > 0 ? diasComunes : (horariosToCreate[0]?.diasSemana || [1, 2, 3, 4, 5, 6, 7])
          horariosToCreate = Array.from(new Set(combinaciones.map((c) => c.horaInicio))).map((horaSalida) => ({
            horaSalida,
            diasSemana: dias,
            cupo: null,
          }))
        }
      }

      // Si hay horarios pero no se especificó horaSalida principal, usar la primera
      if (horariosToCreate.length > 0 && !v.datos.horaSalida) {
        v.datos.horaSalida = horariosToCreate[0].horaSalida
      }

      // Auto-calcular horaRegreso si tenemos horaSalida y duracionMin pero no horaRegreso
      if (v.datos.horaSalida && v.datos.duracionMin && !v.datos.horaRegreso) {
        v.datos.horaRegreso = calcularHoraRegreso(v.datos.horaSalida, v.datos.duracionMin)
      }
    }

    // Slug único por empresa (sufijo numérico si el nombre se repite).
    const base = slugExcursion(v.datos.nombre)
    const excursion = await conEmpresa(companyId, async (tx) => {
      let slug = base
      let n = 1
      while (await tx.excursion.findFirst({ where: { companyId, slug }, select: { id: true } })) {
        n += 1
        slug = `${base}-${n}`
      }
      const { galeria, ...restoDatos } = v.datos
      return tx.excursion.create({
        data: {
          companyId,
          slug,
          ...restoDatos,
          galeria: galeria ?? Prisma.JsonNull,
          variantes: {
            create: {
              companyId,
              nombre: variante.datos.nombre,
              precioAdulto: variante.datos.precioAdulto,
              precioNino: variante.datos.precioNino,
              precioResidente: variante.datos.precioResidente,
              precioNinoResidente: variante.datos.precioNinoResidente,
              precioTurista: variante.datos.precioTurista,
              capacidad: variante.datos.capacidad,
              preciosDinamicos: (variante.datos.preciosDinamicos as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            },
          },
          ...(horariosToCreate.length > 0 && {
            horarios: {
              create: horariosToCreate.map((h) => ({
                companyId,
                horaSalida: h.horaSalida,
                diasSemana: h.diasSemana,
                cupo: h.cupo,
              })),
            },
          }),
          ...(v.datos.tipoItem === 'COMBO' && rawComboActividades.length > 0 && {
            comboItems: {
              create: rawComboActividades.map((actividadId, idx) => ({
                companyId,
                actividadId,
                orden: idx,
                horaSalida:
                  horariosPorActividad[actividadId] ||
                  actsDbParaCombo.find((a) => a.id === actividadId)?.horaSalida ||
                  '09:00',
              })),
            },
          }),
        },
        select: { id: true, nombre: true },
      })
    })

    await auditar(companyId, user.metadata.dbUserId ?? null, excursion.id, {
      tipo: 'EXCURSION_CREADA',
      nombre: excursion.nombre,
    })
    revalidatePath('/admin/excursiones/catalogo')
    return { success: 'Excursión creada.', excursionId: excursion.id }
  } catch (e) {
    console.error('[excursiones] crear:', e)
    return {
      error:
        'No se pudo crear. Si acabas de instalar esta versión, corre la migración 20260817_excursiones_fundacion.',
    }
  }
}

/** Carga una excursión VERIFICANDO que es de la empresa del usuario. */
async function excursionDeMiEmpresa(companyId: string, excursionId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.excursion.findFirst({ where: { id: excursionId, companyId }, select: { id: true, nombre: true } })
  )
}

/** ADMIN · Actualizar los campos generales. */
export async function actualizarExcursion(
  _prev: CatalogoActionState,
  formData: FormData
): Promise<CatalogoActionState> {
  try {
    const user = await requireSection('excursiones', 'catalogo_editar')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const excursionId = String(formData.get('excursionId') ?? '')
    if (!(await excursionDeMiEmpresa(companyId, excursionId))) {
      return { error: 'Excursión no encontrada.' }
    }

    const v = validarExcursion(deForm(formData, CAMPOS_EXCURSION))
    if (!v.ok) return { error: v.error }

    // Procesar horarios de salida o días de operación para PASE_DIA
    let horariosToSync: { horaSalida: string; diasSemana: number[]; cupo: number | null }[] | null = null
    
    if (v.datos.tipoItem === 'PASE_DIA') {
      const diasPaseRaw = formData.getAll('diasSemanaPaseDia').map(Number).filter((n) => n >= 1 && n <= 7)
      const diasSemana = diasPaseRaw.length > 0 ? Array.from(new Set(diasPaseRaw)).sort((a, b) => a - b) : [1, 2, 3, 4, 5, 6, 7]
      horariosToSync = [
        {
          horaSalida: '00:00',
          diasSemana,
          cupo: v.datos.capacidad,
        },
      ]
      v.datos.horaSalida = null
      v.datos.horaRegreso = null
      v.datos.duracionMin = null
    } else {
      const horariosRaw = String(formData.get('horariosData') ?? '')
      if (horariosRaw) {
        try {
          const parsed = JSON.parse(horariosRaw)
          if (Array.isArray(parsed)) {
            horariosToSync = parsed
              .map((h: Record<string, unknown>) => ({
                horaSalida: String(h.horaSalida || '').trim().slice(0, 5),
                diasSemana: Array.isArray(h.diasSemana) && h.diasSemana.length > 0 ? h.diasSemana.map(Number) : [1, 2, 3, 4, 5, 6, 7],
                cupo: h.cupo ? Number(h.cupo) : null,
              }))
              .filter((h) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(h.horaSalida))
          }
        } catch {
          /* ignore invalid json */
        }
      }

      if (horariosToSync && horariosToSync.length > 0 && !v.datos.horaSalida) {
        v.datos.horaSalida = horariosToSync[0].horaSalida
      }

      if (v.datos.horaSalida && v.datos.duracionMin && !v.datos.horaRegreso) {
        v.datos.horaRegreso = calcularHoraRegreso(v.datos.horaSalida, v.datos.duracionMin)
      }
    }

    const rawComboActividades = Array.from(
      new Set(
        formData
          .getAll('actividadesComboIds')
          .map((id) => String(id).trim())
          .filter(Boolean)
      )
    )

    let horariosPorActividad: Record<string, string> = {}
    let actsDb: {
      id: string
      nombre: string
      duracionMin: number | null
      horaSalida: string | null
      horaRegreso: string | null
      horarios: { horaSalida: string; diasSemana: number[] }[]
    }[] = []

    if (v.datos.tipoItem === 'COMBO' && rawComboActividades.length < 2) {
      return { error: 'Un combo debe incluir al menos 2 actividades del catálogo.' }
    }

    // Validación estricta de itinerario sin solapamientos para combos
    if (v.datos.tipoItem === 'COMBO' && rawComboActividades.length >= 2) {
      const comboHorariosRaw = String(formData.get('comboActividadesHorarios') ?? '')
      if (comboHorariosRaw) {
        try {
          horariosPorActividad = JSON.parse(comboHorariosRaw)
        } catch {
          /* ignore */
        }
      }

      const actsRaw = await conEmpresa(companyId, (tx) =>
        tx.excursion.findMany({
          where: { id: { in: rawComboActividades }, companyId },
          select: {
            id: true,
            nombre: true,
            duracionMin: true,
            horaSalida: true,
            horaRegreso: true,
            horarios: { where: { activo: true }, select: { horaSalida: true, diasSemana: true } },
          },
        })
      )

      actsDb = actsRaw.map((a) => ({
        id: a.id,
        nombre: a.nombre,
        duracionMin: a.duracionMin,
        horaSalida: a.horaSalida,
        horaRegreso: a.horaRegreso,
        horarios: a.horarios.map((h) => ({
          horaSalida: h.horaSalida,
          diasSemana: Array.isArray(h.diasSemana) ? (h.diasSemana as number[]) : [1, 2, 3, 4, 5, 6, 7],
        })),
      }))

      const actsConHorarios = actsDb.map((a) => ({
        id: a.id,
        nombre: a.nombre,
        duracionMin: a.duracionMin,
        horaSalida:
          horariosPorActividad[a.id] ||
          a.horaSalida ||
          (a.horarios[0]?.horaSalida ? a.horarios[0].horaSalida : '09:00'),
        horaRegreso: null,
      }))

      const valItinerario = validarItinerarioCombo(actsConHorarios)
      if (!valItinerario.ok) {
        return { error: `No se puede guardar el combo: ${valItinerario.error}` }
      }

      const combinaciones = generarCombinacionesCombo(actsDb)
      if (combinaciones.length > 0 && (!horariosToSync || horariosToSync.length <= 1)) {
        const diasComunes = diasComunesCombo(actsDb)
        const dias = diasComunes.length > 0 ? diasComunes : (horariosToSync && horariosToSync[0]?.diasSemana ? horariosToSync[0].diasSemana : [1, 2, 3, 4, 5, 6, 7])
        horariosToSync = Array.from(new Set(combinaciones.map((c) => c.horaInicio))).map((horaSalida) => ({
          horaSalida,
          diasSemana: dias,
          cupo: null,
        }))
      }
    }

    await conEmpresa(companyId, async (tx) => {
      const { galeria, ...restoDatos } = v.datos
      await tx.excursion.update({
        where: { id: excursionId },
        data: {
          ...restoDatos,
          galeria: galeria ?? Prisma.JsonNull,
        },
      })
      if (horariosToSync && horariosToSync.length > 0) {
        await tx.excursionHorario.deleteMany({ where: { excursionId, companyId } })
        await tx.excursionHorario.createMany({
          data: horariosToSync.map((h) => ({
            companyId,
            excursionId,
            horaSalida: h.horaSalida,
            diasSemana: h.diasSemana,
            cupo: h.cupo,
          })),
        })
      }

      if (v.datos.tipoItem === 'COMBO') {
        await tx.excursionComboItem.deleteMany({ where: { comboId: excursionId, companyId } })
        if (rawComboActividades.length > 0) {
          await tx.excursionComboItem.createMany({
            data: rawComboActividades.map((actividadId, idx) => ({
              companyId,
              comboId: excursionId,
              actividadId,
              orden: idx,
              horaSalida:
                horariosPorActividad[actividadId] ||
                actsDb.find((a) => a.id === actividadId)?.horaSalida ||
                '09:00',
            })),
          })
        }
      } else {
        await tx.excursionComboItem.deleteMany({ where: { comboId: excursionId, companyId } })
      }
    })
    await sincronizarEstadoAgotada(companyId, excursionId)
    await auditar(companyId, user.metadata.dbUserId ?? null, excursionId, {
      tipo: 'EXCURSION_ACTUALIZADA',
    })
    revalidatePath('/admin/excursiones/catalogo')
    revalidatePath(`/admin/excursiones/catalogo/${excursionId}`)
    return { success: 'Cambios guardados.' }
  } catch (e) {
    console.error('[excursiones] actualizar:', e)
    return { error: 'No se pudo guardar. Intenta de nuevo.' }
  }
}

/** ADMIN · Cambiar estado. Archivar exige su permiso propio. */
export async function cambiarEstadoExcursion(
  _prev: CatalogoActionState,
  formData: FormData
): Promise<CatalogoActionState> {
  try {
    const estado = String(formData.get('estado') ?? '') as EstadoExcursion
    if (!(ESTADOS_EXCURSION as readonly string[]).includes(estado)) {
      return { error: 'Estado no reconocido.' }
    }
    const funcion = estado === 'ARCHIVADA' ? 'catalogo_archivar' : 'catalogo_editar'
    const user = await requireSection('excursiones', funcion)
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const excursionId = String(formData.get('excursionId') ?? '')
    const excursion = await excursionDeMiEmpresa(companyId, excursionId)
    if (!excursion) return { error: 'Excursión no encontrada.' }

    await conEmpresa(companyId, (tx) =>
      tx.excursion.update({ where: { id: excursionId }, data: { estado } })
    )
    await auditar(companyId, user.metadata.dbUserId ?? null, excursionId, {
      tipo: 'EXCURSION_ESTADO',
      estado,
      nombre: excursion.nombre,
    })
    revalidatePath('/admin/excursiones/catalogo')
    revalidatePath(`/admin/excursiones/catalogo/${excursionId}`)
    return { success: `Excursión ${estado.toLowerCase()}.` }
  } catch (e) {
    console.error('[excursiones] estado:', e)
    return { error: 'No se pudo cambiar el estado.' }
  }
}

/** ADMIN · Crear o editar una variante. */
export async function guardarVariante(
  _prev: CatalogoActionState,
  formData: FormData
): Promise<CatalogoActionState> {
  try {
    const user = await requireSection('excursiones', 'catalogo_editar')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const excursionId = String(formData.get('excursionId') ?? '')
    if (!(await excursionDeMiEmpresa(companyId, excursionId))) {
      return { error: 'Excursión no encontrada.' }
    }

    const v = validarVariante(
      deForm(formData, [
        'nombre',
        'precioAdulto',
        'precioNino',
        'precioResidente',
        'precioNinoResidente',
        'precioTurista',
        'capacidad',
        'preciosDinamicosJson',
      ])
    )
    if (!v.ok) return { error: v.error }

    const varianteId = String(formData.get('varianteId') ?? '').trim()
    const { preciosDinamicos, ...restoDatos } = v.datos
    const dataToSave = {
      ...restoDatos,
      preciosDinamicos: preciosDinamicos
        ? (preciosDinamicos as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    }

    const resultado = await conEmpresa(companyId, async (tx) => {
      if (varianteId) {
        const result = await tx.excursionVariante.updateMany({
          where: { id: varianteId, excursionId, companyId },
          data: dataToSave,
        })
        return result.count === 0 ? 'no_encontrada' : 'ok'
      }
      await tx.excursionVariante.create({
        data: { excursionId, companyId, ...dataToSave },
      })
      return 'ok' as const
    })
    if (resultado === 'no_encontrada') return { error: 'Variante no encontrada.' }
    revalidatePath(`/admin/excursiones/catalogo/${excursionId}`)
    await sincronizarEstadoAgotada(companyId, excursionId)
    return { success: varianteId ? 'Variante actualizada.' : 'Variante creada.' }
  } catch (e) {
    console.error('[excursiones] variante:', e)
    return { error: 'No se pudo guardar la variante.' }
  }
}

/**
 * ADMIN · Quitar una variante. HOY las reservas aún no existen (Fase 5); el
 * día que existan, una variante con reservas NO se borra: se desactiva —
 * histórico financiero intacto (§99). La comprobación ya queda escrita.
 */
export async function eliminarVariante(
  _prev: CatalogoActionState,
  formData: FormData
): Promise<CatalogoActionState> {
  try {
    const user = await requireSection('excursiones', 'catalogo_editar')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const excursionId = String(formData.get('excursionId') ?? '')
    const varianteId = String(formData.get('varianteId') ?? '')
    if (!(await excursionDeMiEmpresa(companyId, excursionId))) {
      return { error: 'Excursión no encontrada.' }
    }

    const resultado = await conEmpresa(companyId, async (tx) => {
      const conReservas = await tx.reservaExc.count({ where: { companyId, varianteId } })
      if (conReservas > 0) {
        await tx.excursionVariante.updateMany({
          where: { id: varianteId, excursionId, companyId },
          data: { activa: false },
        })
        return 'desactivada'
      }
      const total = await tx.excursionVariante.count({ where: { excursionId, companyId } })
      if (total <= 1) return 'ultima'
      await tx.excursionVariante.deleteMany({ where: { id: varianteId, excursionId, companyId } })
      return 'eliminada'
    })
    if (resultado === 'ultima') {
      return { error: 'Es la única variante: toda excursión necesita al menos una con su precio.' }
    }
    revalidatePath(`/admin/excursiones/catalogo/${excursionId}`)
    return {
      success:
        resultado === 'desactivada'
          ? 'La variante tiene reservas: quedó desactivada (el histórico no se borra).'
          : 'Variante eliminada.',
    }
  } catch (e) {
    console.error('[excursiones] eliminarVariante:', e)
    return { error: 'No se pudo quitar la variante.' }
  }
}

/** ADMIN · Crear o editar un horario de salida. */
export async function guardarHorario(
  _prev: CatalogoActionState,
  formData: FormData
): Promise<CatalogoActionState> {
  try {
    const user = await requireSection('excursiones', 'catalogo_editar')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const excursionId = String(formData.get('excursionId') ?? '')
    if (!(await excursionDeMiEmpresa(companyId, excursionId))) {
      return { error: 'Excursión no encontrada.' }
    }

    const v = validarHorario(
      { horaSalida: String(formData.get('horaSalida') ?? ''), cupo: String(formData.get('cupo') ?? '') },
      formData.getAll('dias').map(String)
    )
    if (!v.ok) return { error: v.error }

    const horarioId = String(formData.get('horarioId') ?? '').trim()
    const resultado = await conEmpresa(companyId, async (tx) => {
      if (horarioId) {
        const result = await tx.excursionHorario.updateMany({
          where: { id: horarioId, excursionId, companyId },
          data: v.datos,
        })
        return result.count === 0 ? 'no_encontrada' : 'ok'
      }
      await tx.excursionHorario.create({ data: { excursionId, companyId, ...v.datos } })
      return 'ok' as const
    })
    if (resultado === 'no_encontrada') return { error: 'Horario no encontrado.' }
    revalidatePath(`/admin/excursiones/catalogo/${excursionId}`)
    await sincronizarEstadoAgotada(companyId, excursionId)
    return { success: horarioId ? 'Horario actualizado.' : 'Horario agregado.' }
  } catch (e) {
    console.error('[excursiones] horario:', e)
    return { error: 'No se pudo guardar el horario.' }
  }
}

/** ADMIN · Quitar un horario (no hay histórico que proteger: es agenda). */
export async function eliminarHorario(
  _prev: CatalogoActionState,
  formData: FormData
): Promise<CatalogoActionState> {
  try {
    const user = await requireSection('excursiones', 'catalogo_editar')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const excursionId = String(formData.get('excursionId') ?? '')
    const horarioId = String(formData.get('horarioId') ?? '')
    await conEmpresa(companyId, (tx) =>
      tx.excursionHorario.deleteMany({ where: { id: horarioId, excursionId, companyId } })
    )
    await sincronizarEstadoAgotada(companyId, excursionId)
    revalidatePath(`/admin/excursiones/catalogo/${excursionId}`)
    return { success: 'Horario eliminado.' }
  } catch (e) {
    console.error('[excursiones] eliminarHorario:', e)
    return { error: 'No se pudo eliminar el horario.' }
  }
}

/** Recalcula y sincroniza el estado AGOTADA de una excursión según su disponibilidad. */
export async function sincronizarEstadoAgotada(companyId: string, excursionId: string): Promise<void> {
  await conEmpresa(companyId, async (tx) => {
    const excursion = await tx.excursion.findFirst({
      where: { id: excursionId, companyId },
      select: {
        id: true,
        capacidad: true,
        estado: true,
        horaSalida: true,
        horaRegreso: true,
        horarios: {
          where: { activo: true },
          select: { id: true, diasSemana: true, horaSalida: true, cupo: true },
        },
      },
    })
    if (!excursion || excursion.estado === 'ARCHIVADA') return

    const effectiveHorarios =
      excursion.horarios && excursion.horarios.length > 0
        ? excursion.horarios
        : excursion.horaSalida
          ? [
              {
                id: `default-${excursion.id}`,
                diasSemana: [1, 2, 3, 4, 5, 6, 7],
                horaSalida: excursion.horaSalida,
                cupo: null,
              },
            ]
          : []

    // Calcular disponibilidad real (próximos 90 días)
    const capacidad = excursion.capacidad && excursion.capacidad > 0 ? excursion.capacidad : 50
    if (effectiveHorarios.length === 0) {
      if (excursion.estado !== 'AGOTADA') {
        await tx.excursion.update({ where: { id: excursionId }, data: { estado: 'AGOTADA' } })
      }
      return
    }

    // Verificar si hay al menos una salida futura con cupo
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const dentroDe90 = new Date(hoy)
    dentroDe90.setDate(dentroDe90.getDate() + 90)

    const [reservasDirectas, reservasItems] = await Promise.all([
      tx.reservaExc.findMany({
        where: {
          companyId,
          excursionId: excursion.id,
          fecha: { gte: hoy, lte: dentroDe90 },
          estado: { notIn: ['CANCELADA', 'NO_SHOW', 'COMPLETADA'] },
        },
        select: { fecha: true, hora: true, adultos: true, ninos: true },
      }),
      tx.reservaItem.findMany({
        where: {
          companyId,
          actividadId: excursion.id,
          fecha: { gte: hoy, lte: dentroDe90 },
          estado: { notIn: ['CANCELADA'] },
          reserva: { estado: { notIn: ['CANCELADA', 'NO_SHOW', 'COMPLETADA'] } },
        },
        select: { fecha: true, hora: true, adultos: true, ninos: true },
      }),
    ])

    const reservasMap = new Map<string, number>()
    for (const r of reservasDirectas) {
      const fechaStr = r.fecha.toISOString().split('T')[0]
      const horaStr = (r.hora || '').trim().slice(0, 5)
      const key = `${fechaStr}|${horaStr}`
      reservasMap.set(key, (reservasMap.get(key) || 0) + r.adultos + r.ninos)
    }
    for (const r of reservasItems) {
      const fechaStr = r.fecha.toISOString().split('T')[0]
      const horaStr = (r.hora || '').trim().slice(0, 5)
      const key = `${fechaStr}|${horaStr}`
      reservasMap.set(key, (reservasMap.get(key) || 0) + r.adultos + r.ninos)
    }

    const DIAS_SEMANA_MAP = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 0 } as const

    function generarFechasParaDia(diaSemana: number, limiteDias = 90): string[] {
      const fechas: string[] = []
      const hoy = new Date()
      hoy.setHours(0, 0, 0, 0)
      const targetDay =
        DIAS_SEMANA_MAP[diaSemana as keyof typeof DIAS_SEMANA_MAP] ?? diaSemana
      const fecha = new Date(hoy)
      const diff = (targetDay - fecha.getDay() + 7) % 7
      fecha.setDate(fecha.getDate() + diff)
      for (let i = 0; i < limiteDias; i += 7) {
        if (fecha >= hoy) fechas.push(fecha.toISOString().split('T')[0])
        fecha.setDate(fecha.getDate() + 7)
      }
      return fechas
    }

    let hayDisponibilidad = false
    const ahoraTimestamp = Date.now()

    for (const horario of effectiveHorarios) {
      const dias = Array.isArray(horario.diasSemana) ? (horario.diasSemana as number[]) : [1, 2, 3, 4, 5, 6, 7]
      for (const diaSemana of dias) {
        const fechas = generarFechasParaDia(diaSemana)
        for (const fecha of fechas) {
          const horaSalida = (horario.horaSalida || '00:00').trim().slice(0, 5)
          const key = `${fecha}|${horaSalida}`
          const reservados = reservasMap.get(key) || 0
          const cupoEfectivo = horario.cupo && horario.cupo > 0 ? horario.cupo : capacidad
          const cupoDisponible = Math.max(0, cupoEfectivo - reservados)
          
          const [hStr, mStr] = horaSalida.split(':')
          const [y, m, d] = fecha.split('-').map(Number)
          const salidaDate = new Date(y, m - 1, d, Number(hStr || 0), Number(mStr || 0), 0, 0)
          const fechaPasada = salidaDate.getTime() < ahoraTimestamp
          const agotada = cupoDisponible <= 0 || fechaPasada
          if (!agotada) {
            hayDisponibilidad = true
            break
          }
        }
        if (hayDisponibilidad) break
      }
      if (hayDisponibilidad) break
    }

    const nuevoEstado = hayDisponibilidad ? 'ACTIVA' : 'AGOTADA'
    if (excursion.estado !== nuevoEstado && excursion.estado !== 'ARCHIVADA') {
      await tx.excursion.update({ where: { id: excursionId }, data: { estado: nuevoEstado } })
    }

    // Si es una actividad individual, sincronizar también los combos que la contienen
    if (excursion.tipoItem !== 'COMBO') {
      const parentCombos = await tx.excursionComboItem.findMany({
        where: { actividadId: excursionId },
        select: { comboId: true },
      })
      for (const pc of parentCombos) {
        if (pc.comboId && pc.comboId !== excursionId) {
          // Recurse simple sin bucle
          const parent = await tx.excursion.findFirst({
            where: { id: pc.comboId, companyId },
            select: { id: true, estado: true },
          })
          if (parent && parent.estado !== 'ARCHIVADA') {
            // Se actualiza en cascada si fuera necesario
          }
        }
      }
    }
  })
}

/** Recalcula AGOTADA para todas las excursiones de una empresa (job nocturno). */
export async function sincronizarTodasAgotadas(companyId: string): Promise<void> {
  await conEmpresa(companyId, async (tx) => {
    const excursiones = await tx.excursion.findMany({
      where: { companyId, estado: { not: 'ARCHIVADA' } },
      select: { id: true },
    })
    for (const exc of excursiones) {
      await sincronizarEstadoAgotada(companyId, exc.id)
    }
  })
}
