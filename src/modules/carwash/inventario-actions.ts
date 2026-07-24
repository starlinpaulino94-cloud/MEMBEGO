'use server'

/**
 * App Car Wash · E5 — acciones del INVENTARIO.
 * Sección 'app' + capacidad INVENTARIO + pertenencia a la empresa. El stock
 * solo cambia dentro de una transacción que crea el movimiento con el stock
 * resultante congelado (auditoría permanente).
 */

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireSection } from '@/lib/auth/guards'
import { getRequestMeta } from '@/lib/server-utils'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import { MOV_TIPOS, type MovTipo } from './inventario'

const RUTA_INVENTARIO = '/admin/app/carwash/inventario'

export interface InventarioActionState {
  error?: string
  success?: string
}

async function contextoInventario() {
  const user = await requireSection('app')
  if (!user) return { error: 'No tienes permisos para administrar el inventario.' as const }
  const companyId = user.metadata.companyId
  if (!companyId) return { error: 'Tu cuenta no está vinculada a una empresa.' as const }
  if (!(await tieneCapacidad(companyId, 'INVENTARIO'))) {
    return { error: 'El inventario no está activado para tu negocio.' as const }
  }
  return { user, companyId }
}

/** Número no negativo con hasta 2 decimales; null si el texto no es válido. */
function parseCantidad(raw: FormDataEntryValue | null): number | null {
  const n = Number(String(raw ?? '').trim().replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

export async function guardarProducto(
  _prev: InventarioActionState,
  formData: FormData
): Promise<InventarioActionState> {
  try {
    const ctx = await contextoInventario()
    if ('error' in ctx) return { error: ctx.error }

    const id = String(formData.get('id') ?? '').trim()
    const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 120)
    const categoria = String(formData.get('categoria') ?? '').trim().slice(0, 60)
    const unidad = String(formData.get('unidad') ?? '').trim().slice(0, 30) || 'unidad'
    const notas = String(formData.get('notas') ?? '').trim().slice(0, 300)
    const stockMinimo = parseCantidad(formData.get('stockMinimo')) ?? 0
    const costoRaw = String(formData.get('costo') ?? '').trim()
    const costo = costoRaw ? parseCantidad(costoRaw) : null
    if (!nombre) return { error: 'El nombre del producto es obligatorio.' }
    if (costoRaw && costo == null) return { error: 'El costo no es válido.' }

    const base = {
      nombre,
      categoria: categoria || null,
      unidad,
      stockMinimo,
      costo,
      notas: notas || null,
    }

    if (id) {
      const existente = await prisma.productoInventario.findUnique({
        where: { id },
        select: { companyId: true },
      })
      if (!existente || existente.companyId !== ctx.companyId) {
        return { error: 'Producto no encontrado.' }
      }
      const activo = formData.get('activo') === 'on'
      await prisma.productoInventario.update({ where: { id }, data: { ...base, activo } })
    } else {
      const stockInicial = parseCantidad(formData.get('stockInicial')) ?? 0
      await prisma.$transaction(async (tx) => {
        const producto = await tx.productoInventario.create({
          data: { ...base, companyId: ctx.companyId, stock: stockInicial },
          select: { id: true },
        })
        if (stockInicial > 0) {
          await tx.movimientoInventario.create({
            data: {
              productoId: producto.id,
              companyId: ctx.companyId,
              tipo: 'ENTRADA',
              cantidad: stockInicial,
              stockResultante: stockInicial,
              motivo: 'Stock inicial',
              registradoPorId: ctx.user.metadata.dbUserId ?? null,
            },
          })
        }
      })
    }

    revalidatePath(RUTA_INVENTARIO)
    return { success: id ? 'Producto actualizado.' : 'Producto creado.' }
  } catch (e) {
    console.error('[inventario] guardar producto:', e)
    return {
      error:
        'No se pudo guardar. Si acabas de instalar esta versión, corre la migración 20260759_e5_carwash en la base de datos.',
    }
  }
}

export async function registrarMovimiento(
  _prev: InventarioActionState,
  formData: FormData
): Promise<InventarioActionState> {
  try {
    const ctx = await contextoInventario()
    if ('error' in ctx) return { error: ctx.error }

    const productoId = String(formData.get('productoId') ?? '').trim()
    const tipo = String(formData.get('tipo') ?? '').trim() as MovTipo
    const cantidad = parseCantidad(formData.get('cantidad'))
    const motivo = String(formData.get('motivo') ?? '').trim().slice(0, 200)
    if (!productoId || !(MOV_TIPOS as readonly string[]).includes(tipo)) {
      return { error: 'Movimiento no válido.' }
    }
    if (cantidad == null || (tipo !== 'AJUSTE' && cantidad <= 0)) {
      return { error: 'Indica una cantidad válida.' }
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const producto = await tx.productoInventario.findUnique({
        where: { id: productoId },
        select: { companyId: true, stock: true, nombre: true, unidad: true },
      })
      if (!producto || producto.companyId !== ctx.companyId) {
        return { error: 'Producto no encontrado.' as const }
      }
      const stockActual = Number(producto.stock)
      const nuevoStock =
        tipo === 'ENTRADA'
          ? stockActual + cantidad
          : tipo === 'SALIDA'
            ? stockActual - cantidad
            : cantidad // AJUSTE fija el stock en la cantidad indicada
      if (nuevoStock < 0) {
        return {
          error: `Stock insuficiente: quedan ${stockActual} ${producto.unidad}.` as const,
        }
      }
      await tx.productoInventario.update({
        where: { id: productoId },
        data: { stock: nuevoStock },
      })
      await tx.movimientoInventario.create({
        data: {
          productoId,
          companyId: ctx.companyId,
          tipo,
          cantidad,
          stockResultante: nuevoStock,
          motivo: motivo || null,
          registradoPorId: ctx.user.metadata.dbUserId ?? null,
        },
      })
      return { nombre: producto.nombre }
    })
    if ('error' in resultado) return { error: resultado.error }

    const meta = await getRequestMeta()
    await prisma.auditLog
      .create({
        data: {
          companyId: ctx.companyId,
          userId: ctx.user.metadata.dbUserId ?? null,
          accion: 'NOTA_INTERNA',
          entidadTipo: 'ProductoInventario',
          entidadId: productoId,
          payload: { tipo: 'INVENTARIO_MOVIMIENTO', movimiento: tipo, cantidad, motivo },
          ...meta,
        },
      })
      .catch(() => {})

    revalidatePath(RUTA_INVENTARIO)
    return { success: `Movimiento registrado en ${resultado.nombre}.` }
  } catch (e) {
    console.error('[inventario] movimiento:', e)
    return { error: 'No se pudo registrar el movimiento. Intenta de nuevo.' }
  }
}
