'use server'

/**
 * Acciones del catálogo del oficio (App Car Wash · Fase 1).
 *
 * Todo exige rol de administración y se acota SIEMPRE a la empresa del
 * usuario: un identificador manipulado no puede tocar el catálogo de otra.
 */

import { revalidatePath } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { ADMIN_ROLES } from '@/types'
import { companyFilter } from '@/modules/admin/queries'
import { anotarFallo } from '@/lib/prisma-errors'
import { clienteLocal } from '@/modules/plataforma/cliente-local'

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

    /*
     * NIVEL TARIFARIO. Es lo que decide si una membresía cubre este vehículo, y
     * hasta ahora no se podía tocar desde ninguna pantalla: todos los tipos
     * nacían en 1 y ahí se quedaban, de modo que cualquier plan cubría
     * cualquier carro y la cobertura por categoría no servía para nada.
     *
     * El tope de 9 atrapa el dedazo. Un 30 en vez de un 3 haría que ningún plan
     * cubriera este tipo y nadie sabría por qué: el cliente vería «no cubierto»
     * sin explicación posible.
     *
     * Si el campo no viene —un formulario viejo, una llamada que no lo manda—
     * NO se toca lo que había. Poner 1 por defecto en una edición bajaría el
     * nivel de un camión sin que nadie lo pidiera, y eso regala lavados.
     */
    const nivelCrudo = formData.get('nivelTarifario')
    const nivelPedido = nivelCrudo === null || String(nivelCrudo).trim() === ''
      ? null
      : Number(nivelCrudo)

    if (nivelPedido !== null &&
        (!Number.isInteger(nivelPedido) || nivelPedido < 1 || nivelPedido > 9)) {
      return { error: 'El nivel tarifario debe ser un número entero del 1 al 9.' }
    }

    if (id) {
      // La cláusula por companyId impide editar el tipo de otra empresa.
      const upd = await conEmpresa(companyId, (tx) =>
        tx.tipoVehiculo.updateMany({
          where: { id, companyId },
          data: {
            nombre,
            orden,
            ...(nivelPedido !== null ? { nivelTarifario: nivelPedido } : {}),
          },
        })
      )
      if (upd.count === 0) return { error: 'Tipo de vehículo no encontrado.' }
    } else {
      const existe = await conEmpresa(companyId, (tx) =>
        tx.tipoVehiculo.findFirst({
          where: { companyId, nombre: { equals: nombre, mode: 'insensitive' } },
          select: { id: true },
        })
      )
      if (existe) return { error: `Ya tienes un tipo llamado "${nombre}".` }
      await conEmpresa(companyId, (tx) =>
        tx.tipoVehiculo.create({
          data: { companyId, nombre, orden, nivelTarifario: nivelPedido ?? 1 },
        })
      )
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
    const tipo = await conEmpresa(companyId, (tx) =>
      tx.tipoVehiculo.findFirst({
        where: { id, companyId },
        select: { activo: true },
      })
    )
    if (!tipo) return { error: 'Tipo no encontrado.' }
    await conEmpresa(companyId, (tx) =>
      tx.tipoVehiculo.update({ where: { id }, data: { activo: !tipo.activo } })
    )
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
      const upd = await conEmpresa(companyId, (tx) =>
        tx.servicio.updateMany({
          where: { id, companyId },
          data: { nombre, descripcion, categoria, duracionMin, esAdicional, orden },
        })
      )
      if (upd.count === 0) return { error: 'Servicio no encontrado.' }
    } else {
      const existe = await conEmpresa(companyId, (tx) =>
        tx.servicio.findFirst({
          where: { companyId, nombre: { equals: nombre, mode: 'insensitive' } },
          select: { id: true },
        })
      )
      if (existe) return { error: `Ya tienes un servicio llamado "${nombre}".` }
      const creado = await conEmpresa(companyId, (tx) =>
        tx.servicio.create({
          data: { companyId, nombre, descripcion, categoria, duracionMin, esAdicional, orden },
          select: { id: true },
        })
      )
      servicioId = creado.id
    }

    // Precios por tipo de vehículo: campos `precio_<tipoVehiculoId>`.
    // Vacío = ese servicio NO aplica a ese tipo (se borra la tarifa).
    const tipos = await conEmpresa(companyId, (tx) =>
      tx.tipoVehiculo.findMany({
        where: { companyId },
        select: { id: true },
      })
    )
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

    await conEmpresa(companyId, (tx) =>
      Promise.all([
        ...(sinPrecio.length
          ? [
              tx.servicioPrecio.deleteMany({
                where: { servicioId, tipoVehiculoId: { in: sinPrecio } },
              }),
            ]
          : []),
        ...conPrecio.map((c) =>
          tx.servicioPrecio.upsert({
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
    )
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
    const s = await conEmpresa(companyId, (tx) =>
      tx.servicio.findFirst({ where: { id, companyId }, select: { activo: true } })
    )
    if (!s) return { error: 'Servicio no encontrado.' }
    await conEmpresa(companyId, (tx) =>
      tx.servicio.update({ where: { id }, data: { activo: !s.activo } })
    )
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
      // Por el CONTRATO (Fase 6): la lista de sucursales es del Core y el
      // vertical la pide, no la consulta. El día de la extracción no cambia.
      const { branches } = await clienteLocal(companyId).branches(companyId)
      const suc = branches.find((b) => b.id === sucursalIdRaw)
      if (!suc) return { error: 'Sucursal no válida.' }
      sucursalId = suc.id
    }

    if (id) {
      const upd = await conEmpresa(companyId, (tx) =>
        tx.bahia.updateMany({
          where: { id, companyId },
          data: { nombre, orden, sucursalId },
        })
      )
      if (upd.count === 0) return { error: 'Bahía no encontrada.' }
    } else {
      const existe = await conEmpresa(companyId, (tx) =>
        tx.bahia.findFirst({
          where: { companyId, nombre: { equals: nombre, mode: 'insensitive' } },
          select: { id: true },
        })
      )
      if (existe) return { error: `Ya tienes una bahía llamada "${nombre}".` }
      await conEmpresa(companyId, (tx) =>
        tx.bahia.create({ data: { companyId, nombre, orden, sucursalId } })
      )
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
    const b = await conEmpresa(companyId, (tx) =>
      tx.bahia.findFirst({ where: { id, companyId }, select: { activa: true } })
    )
    if (!b) return { error: 'Bahía no encontrada.' }
    await conEmpresa(companyId, (tx) =>
      tx.bahia.update({ where: { id }, data: { activa: !b.activa } })
    )
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

    const entrada = await conEmpresa(companyId, (tx) =>
      tx.colaVehiculo.findFirst({
        where: { id: colaId, companyId },
        select: { id: true },
      })
    )
    if (!entrada) return { error: 'Vehículo no encontrado en la cola.' }

    if (bahiaId) {
      const bahia = await conEmpresa(companyId, (tx) =>
        tx.bahia.findFirst({
          where: { id: bahiaId, companyId, activa: true },
          select: { id: true, nombre: true },
        })
      )
      if (!bahia) return { error: 'Bahía no válida.' }

      // Una bahía atiende un vehículo a la vez: si está ocupada, avisar en vez
      // de pisar silenciosamente al que ya estaba.
      const ocupada = await conEmpresa(companyId, (tx) =>
        tx.colaVehiculo.findFirst({
          where: { bahiaId, estado: 'EN_SERVICIO', id: { not: colaId } },
          select: { placa: true },
        })
      )
      if (ocupada) {
        return { error: `${bahia.nombre} está ocupada${ocupada.placa ? ` con ${ocupada.placa}` : ''}.` }
      }
    }

    await conEmpresa(companyId, (tx) =>
      tx.colaVehiculo.update({ where: { id: colaId }, data: { bahiaId } })
    )
    revalidatePath('/admin/app/carwash')
    revalidatePath('/admin/app/carwash/cola')
    return { success: bahiaId ? 'Vehículo asignado.' : 'Vehículo liberado de la bahía.' }
  } catch (e) {
    console.error('[carwash catalogo] asignar bahia:', e)
    return { error: 'No se pudo asignar.' }
  }
}
