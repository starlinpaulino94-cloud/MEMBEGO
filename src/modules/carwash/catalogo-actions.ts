'use server'

/**
 * Acciones del catálogo del oficio (App Car Wash · Fase 1).
 *
 * Todo exige rol de administración y se acota SIEMPRE a la empresa del
 * usuario: un identificador manipulado no puede tocar el catálogo de otra.
 */

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { ADMIN_ROLES } from '@/types'
import { companyFilter } from '@/modules/admin/queries'
import { anotarFallo } from '@/lib/prisma-errors'

export interface CatalogoState {
  error?: string
  success?: string
}

const RUTA = '/admin/app/carwash/catalogo'

/** Devuelve el companyId sobre el que puede operar quien llama, o null. */
async function empresaDelAdmin(): Promise<string | null> {
  const user = await getUser()
  if (!user || !(ADMIN_ROLES as readonly string[]).includes(user.metadata.role)) return null
  return companyFilter(user) ?? user.metadata.companyId ?? null
}

function numero(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// ── Tipos de vehículo ───────────────────────────────────────────────────────

export async function guardarTipoVehiculo(
  _prev: CatalogoState,
  formData: FormData
): Promise<CatalogoState> {
  try {
    const companyId = await empresaDelAdmin()
    if (!companyId) return { error: 'No autorizado.' }

    const id = String(formData.get('id') ?? '').trim()
    const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 60)
    const orden = Number(formData.get('orden') ?? 0) || 0
    if (!nombre) return { error: 'Escribe el nombre del tipo de vehículo.' }

    if (id) {
      // La cláusula por companyId impide editar el tipo de otra empresa.
      const upd = await prisma.tipoVehiculo.updateMany({
        where: { id, companyId },
        data: { nombre, orden },
      })
      if (upd.count === 0) return { error: 'Tipo de vehículo no encontrado.' }
    } else {
      const existe = await prisma.tipoVehiculo.findFirst({
        where: { companyId, nombre: { equals: nombre, mode: 'insensitive' } },
        select: { id: true },
      })
      if (existe) return { error: `Ya tienes un tipo llamado "${nombre}".` }
      await prisma.tipoVehiculo.create({ data: { companyId, nombre, orden } })
    }

    revalidatePath(RUTA)
    return { success: id ? 'Tipo actualizado.' : `Tipo "${nombre}" agregado.` }
  } catch (e) {
    console.error('[carwash catalogo] tipo:', e)
    return { error: 'No se pudo guardar. Intenta de nuevo.' }
  }
}

export async function alternarTipoVehiculo(id: string): Promise<CatalogoState> {
  try {
    const companyId = await empresaDelAdmin()
    if (!companyId) return { error: 'No autorizado.' }
    const tipo = await prisma.tipoVehiculo.findFirst({
      where: { id, companyId },
      select: { activo: true },
    })
    if (!tipo) return { error: 'Tipo no encontrado.' }
    await prisma.tipoVehiculo.update({ where: { id }, data: { activo: !tipo.activo } })
    revalidatePath(RUTA)
    return { success: tipo.activo ? 'Tipo desactivado.' : 'Tipo activado.' }
  } catch (e) {
    console.error('[carwash catalogo] alternar tipo:', e)
    return { error: 'No se pudo cambiar el estado.' }
  }
}

// ── Servicios ───────────────────────────────────────────────────────────────

export async function guardarServicio(
  _prev: CatalogoState,
  formData: FormData
): Promise<CatalogoState> {
  try {
    const companyId = await empresaDelAdmin()
    if (!companyId) return { error: 'No autorizado.' }

    const id = String(formData.get('id') ?? '').trim()
    const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 80)
    const descripcion = String(formData.get('descripcion') ?? '').trim().slice(0, 300) || null
    const categoria = String(formData.get('categoria') ?? '').trim().slice(0, 40) || null
    const duracionMin = Math.max(1, Number(formData.get('duracionMin') ?? 30) || 30)
    const esAdicional = formData.get('esAdicional') === 'on'
    const orden = Number(formData.get('orden') ?? 0) || 0
    if (!nombre) return { error: 'Escribe el nombre del servicio.' }

    let servicioId = id
    if (id) {
      const upd = await prisma.servicio.updateMany({
        where: { id, companyId },
        data: { nombre, descripcion, categoria, duracionMin, esAdicional, orden },
      })
      if (upd.count === 0) return { error: 'Servicio no encontrado.' }
    } else {
      const existe = await prisma.servicio.findFirst({
        where: { companyId, nombre: { equals: nombre, mode: 'insensitive' } },
        select: { id: true },
      })
      if (existe) return { error: `Ya tienes un servicio llamado "${nombre}".` }
      const creado = await prisma.servicio.create({
        data: { companyId, nombre, descripcion, categoria, duracionMin, esAdicional, orden },
        select: { id: true },
      })
      servicioId = creado.id
    }

    // Precios por tipo de vehículo: campos `precio_<tipoVehiculoId>`.
    // Vacío = ese servicio NO aplica a ese tipo (se borra la tarifa).
    const tipos = await prisma.tipoVehiculo.findMany({
      where: { companyId },
      select: { id: true },
    })
    // Auditoría de producción · Fase 4. Antes era un `await` por tipo de
    // vehículo dentro del bucle: con ocho tipos, ocho viajes de ida y vuelta a
    // la base en serie, cada uno pagando la latencia completa. No es
    // catastrófico porque los tipos son pocos y acotados, pero es gratis
    // arreglarlo y el patrón se copia.
    //
    // Va en UNA transacción, además, porque guardar la mitad de las tarifas de
    // un servicio es peor que no guardar ninguna: el precio de un tipo de
    // vehículo quedaría del formulario nuevo y el de otro del viejo, y nadie
    // lo notaría hasta cobrar de menos.
    const sinPrecio: string[] = []
    const conPrecio: { tipoVehiculoId: string; precio: number }[] = []
    for (const t of tipos) {
      const precio = numero(formData.get(`precio_${t.id}`))
      if (precio === null) sinPrecio.push(t.id)
      else conPrecio.push({ tipoVehiculoId: t.id, precio })
    }

    await prisma
      .$transaction([
        ...(sinPrecio.length
          ? [
              prisma.servicioPrecio.deleteMany({
                where: { servicioId, tipoVehiculoId: { in: sinPrecio } },
              }),
            ]
          : []),
        ...conPrecio.map((c) =>
          prisma.servicioPrecio.upsert({
            where: {
              servicioId_tipoVehiculoId: {
                servicioId,
                tipoVehiculoId: c.tipoVehiculoId,
              },
            },
            create: { servicioId, tipoVehiculoId: c.tipoVehiculoId, precio: c.precio },
            update: { precio: c.precio },
          })
        ),
      ])
      .catch(anotarFallo('carwash:servicioPrecio.guardar'))

    revalidatePath(RUTA)
    return { success: id ? 'Servicio actualizado.' : `Servicio "${nombre}" agregado.` }
  } catch (e) {
    console.error('[carwash catalogo] servicio:', e)
    return { error: 'No se pudo guardar. Intenta de nuevo.' }
  }
}

export async function alternarServicio(id: string): Promise<CatalogoState> {
  try {
    const companyId = await empresaDelAdmin()
    if (!companyId) return { error: 'No autorizado.' }
    const s = await prisma.servicio.findFirst({ where: { id, companyId }, select: { activo: true } })
    if (!s) return { error: 'Servicio no encontrado.' }
    await prisma.servicio.update({ where: { id }, data: { activo: !s.activo } })
    revalidatePath(RUTA)
    return { success: s.activo ? 'Servicio desactivado.' : 'Servicio activado.' }
  } catch (e) {
    console.error('[carwash catalogo] alternar servicio:', e)
    return { error: 'No se pudo cambiar el estado.' }
  }
}

// ── Bahías ──────────────────────────────────────────────────────────────────

export async function guardarBahia(
  _prev: CatalogoState,
  formData: FormData
): Promise<CatalogoState> {
  try {
    const companyId = await empresaDelAdmin()
    if (!companyId) return { error: 'No autorizado.' }

    const id = String(formData.get('id') ?? '').trim()
    const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 40)
    const orden = Number(formData.get('orden') ?? 0) || 0
    const sucursalIdRaw = String(formData.get('sucursalId') ?? '').trim()
    if (!nombre) return { error: 'Escribe el nombre de la bahía.' }

    // Una sucursal de otra empresa no puede colarse por el formulario.
    let sucursalId: string | null = null
    if (sucursalIdRaw) {
      const suc = await prisma.sucursal.findFirst({
        where: { id: sucursalIdRaw, companyId },
        select: { id: true },
      })
      if (!suc) return { error: 'Sucursal no válida.' }
      sucursalId = suc.id
    }

    if (id) {
      const upd = await prisma.bahia.updateMany({
        where: { id, companyId },
        data: { nombre, orden, sucursalId },
      })
      if (upd.count === 0) return { error: 'Bahía no encontrada.' }
    } else {
      const existe = await prisma.bahia.findFirst({
        where: { companyId, nombre: { equals: nombre, mode: 'insensitive' } },
        select: { id: true },
      })
      if (existe) return { error: `Ya tienes una bahía llamada "${nombre}".` }
      await prisma.bahia.create({ data: { companyId, nombre, orden, sucursalId } })
    }

    revalidatePath(RUTA)
    revalidatePath('/admin/app/carwash')
    return { success: id ? 'Bahía actualizada.' : `Bahía "${nombre}" agregada.` }
  } catch (e) {
    console.error('[carwash catalogo] bahia:', e)
    return { error: 'No se pudo guardar. Intenta de nuevo.' }
  }
}

export async function alternarBahia(id: string): Promise<CatalogoState> {
  try {
    const companyId = await empresaDelAdmin()
    if (!companyId) return { error: 'No autorizado.' }
    const b = await prisma.bahia.findFirst({ where: { id, companyId }, select: { activa: true } })
    if (!b) return { error: 'Bahía no encontrada.' }
    await prisma.bahia.update({ where: { id }, data: { activa: !b.activa } })
    revalidatePath(RUTA)
    revalidatePath('/admin/app/carwash')
    return { success: b.activa ? 'Bahía desactivada.' : 'Bahía activada.' }
  } catch (e) {
    console.error('[carwash catalogo] alternar bahia:', e)
    return { error: 'No se pudo cambiar el estado.' }
  }
}

// ── Asignación en pista ─────────────────────────────────────────────────────

/** Mueve un vehículo de la cola a una bahía (o lo saca de ella con null). */
export async function asignarBahia(
  colaId: string,
  bahiaId: string | null
): Promise<CatalogoState> {
  try {
    const companyId = await empresaDelAdmin()
    if (!companyId) return { error: 'No autorizado.' }

    const entrada = await prisma.colaVehiculo.findFirst({
      where: { id: colaId, companyId },
      select: { id: true },
    })
    if (!entrada) return { error: 'Vehículo no encontrado en la cola.' }

    if (bahiaId) {
      const bahia = await prisma.bahia.findFirst({
        where: { id: bahiaId, companyId, activa: true },
        select: { id: true, nombre: true },
      })
      if (!bahia) return { error: 'Bahía no válida.' }

      // Una bahía atiende un vehículo a la vez: si está ocupada, avisar en vez
      // de pisar silenciosamente al que ya estaba.
      const ocupada = await prisma.colaVehiculo.findFirst({
        where: { bahiaId, estado: 'EN_SERVICIO', id: { not: colaId } },
        select: { placa: true },
      })
      if (ocupada) {
        return { error: `${bahia.nombre} está ocupada${ocupada.placa ? ` con ${ocupada.placa}` : ''}.` }
      }
    }

    await prisma.colaVehiculo.update({ where: { id: colaId }, data: { bahiaId } })
    revalidatePath('/admin/app/carwash')
    revalidatePath('/admin/app/carwash/cola')
    return { success: bahiaId ? 'Vehículo asignado.' : 'Vehículo liberado de la bahía.' }
  } catch (e) {
    console.error('[carwash catalogo] asignar bahia:', e)
    return { error: 'No se pudo asignar.' }
  }
}
