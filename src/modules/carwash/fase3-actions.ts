'use server'

/**
 * App Car Wash · Fase 3 — acciones de compras, activos y turnos.
 *
 * Misma regla de seguridad que la Fase 2: cada acción resuelve la empresa DEL
 * USUARIO y la usa en el WHERE. Nunca se confía en un id del formulario para
 * decidir a qué empresa pertenece algo.
 */

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/lib/auth'
import { ADMIN_ROLES } from '@/types'
import { companyFilter } from '@/modules/admin/queries'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import type { Capacidad } from '@/modules/capacidades/catalogo'
import { anotarFallo } from '@/lib/prisma-errors'
import {
  ORDEN_TRANSICIONES,
  puedeEditarLineas,
  siguienteNumero,
  totalDeLineas,
  cantidadAIngresar,
  type OrdenEstado,
} from './compras'
import { ACTIVO_ESTADOS, MANTENIMIENTO_TIPOS, calcularProximo } from './activos'

export interface Fase3State {
  error?: string
  success?: string
}

const RUTA_COMPRAS = '/admin/app/carwash/compras'
const RUTA_ACTIVOS = '/admin/app/carwash/activos'
const RUTA_TURNOS = '/admin/app/carwash/turnos'

async function contexto(
  capacidad: Capacidad
): Promise<{ companyId: string; userId: string | null } | { error: string }> {
  const user = await getUser()
  if (!user || !(ADMIN_ROLES as readonly string[]).includes(user.metadata.role)) {
    return { error: 'No autorizado.' }
  }
  const companyId = companyFilter(user) ?? user.metadata.companyId ?? null
  if (!companyId) return { error: 'Tu cuenta no está vinculada a una empresa.' }
  if (!(await tieneCapacidad(companyId, capacidad))) {
    return { error: 'Este módulo no está activado para tu negocio.' }
  }
  return { companyId, userId: user.metadata.dbUserId ?? null }
}

function texto(v: FormDataEntryValue | null, max = 200): string {
  return String(v ?? '').trim().slice(0, max)
}

function numero(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').trim().replace(/,/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// ── Proveedores ─────────────────────────────────────────────────────────────

export async function guardarProveedor(
  _prev: Fase3State,
  formData: FormData
): Promise<Fase3State> {
  try {
    const ctx = await contexto('COMPRAS')
    if ('error' in ctx) return ctx

    const id = texto(formData.get('id'), 40)
    const nombre = texto(formData.get('nombre'), 80)
    if (!nombre) return { error: 'Escribe el nombre del proveedor.' }

    const datos = {
      nombre,
      rnc: texto(formData.get('rnc'), 20) || null,
      contacto: texto(formData.get('contacto'), 80) || null,
      telefono: texto(formData.get('telefono'), 30) || null,
      email: texto(formData.get('email'), 120) || null,
      diasCredito: Math.max(0, Number(formData.get('diasCredito') ?? 0) || 0),
      notas: texto(formData.get('notas'), 500) || null,
    }

    if (id) {
      const upd = await prisma.proveedor.updateMany({
        where: { id, companyId: ctx.companyId },
        data: datos,
      })
      if (upd.count === 0) return { error: 'Proveedor no encontrado.' }
    } else {
      const existe = await prisma.proveedor.findFirst({
        where: { companyId: ctx.companyId, nombre: { equals: nombre, mode: 'insensitive' } },
        select: { id: true },
      })
      if (existe) return { error: `Ya tienes un proveedor llamado "${nombre}".` }
      await prisma.proveedor.create({ data: { companyId: ctx.companyId, ...datos } })
    }

    revalidatePath(RUTA_COMPRAS)
    return { success: id ? 'Proveedor actualizado.' : `Proveedor "${nombre}" creado.` }
  } catch (e) {
    console.error('[carwash f3] guardarProveedor:', e)
    return { error: 'No se pudo guardar. ¿Corriste la migración 20260765?' }
  }
}

export async function alternarProveedor(id: string): Promise<Fase3State> {
  try {
    const ctx = await contexto('COMPRAS')
    if ('error' in ctx) return ctx
    const p = await prisma.proveedor.findFirst({
      where: { id, companyId: ctx.companyId },
      select: { activo: true },
    })
    if (!p) return { error: 'Proveedor no encontrado.' }
    await prisma.proveedor.update({ where: { id }, data: { activo: !p.activo } })
    revalidatePath(RUTA_COMPRAS)
    return { success: p.activo ? 'Proveedor desactivado.' : 'Proveedor activado.' }
  } catch (e) {
    console.error('[carwash f3] alternarProveedor:', e)
    return { error: 'No se pudo cambiar el estado.' }
  }
}

// ── Órdenes de compra ───────────────────────────────────────────────────────

export async function crearOrden(_prev: Fase3State, formData: FormData): Promise<Fase3State> {
  try {
    const ctx = await contexto('COMPRAS')
    if ('error' in ctx) return ctx

    const proveedorId = texto(formData.get('proveedorId'), 40)
    const proveedor = await prisma.proveedor.findFirst({
      where: { id: proveedorId, companyId: ctx.companyId },
      select: { id: true, nombre: true },
    })
    if (!proveedor) return { error: 'Elige un proveedor.' }

    // El correlativo sale del MÁXIMO existente y no de un conteo: si alguna vez
    // se borra una orden, contar repetiría un número y el unique lo rechazaría.
    const ultima = await prisma.ordenCompra.findFirst({
      where: { companyId: ctx.companyId },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })

    const orden = await prisma.ordenCompra.create({
      data: {
        companyId: ctx.companyId,
        proveedorId: proveedor.id,
        numero: siguienteNumero(ultima?.numero),
        notas: texto(formData.get('notas'), 500) || null,
        creadaPorId: ctx.userId,
      },
      select: { numero: true },
    })

    revalidatePath(RUTA_COMPRAS)
    return { success: `Orden ${orden.numero} creada para ${proveedor.nombre}.` }
  } catch (e) {
    console.error('[carwash f3] crearOrden:', e)
    return { error: 'No se pudo crear la orden.' }
  }
}

export async function agregarLinea(_prev: Fase3State, formData: FormData): Promise<Fase3State> {
  try {
    const ctx = await contexto('COMPRAS')
    if ('error' in ctx) return ctx

    const ordenId = texto(formData.get('ordenId'), 40)
    const productoId = texto(formData.get('productoId'), 40)
    const cantidad = numero(formData.get('cantidad'))
    const costoUnitario = numero(formData.get('costoUnitario'))

    if (cantidad == null || cantidad <= 0) return { error: 'Indica una cantidad mayor que cero.' }
    if (costoUnitario == null) return { error: 'Indica el costo unitario.' }

    const [orden, producto] = await Promise.all([
      prisma.ordenCompra.findFirst({
        where: { id: ordenId, companyId: ctx.companyId },
        select: { id: true, estado: true },
      }),
      prisma.productoInventario.findFirst({
        where: { id: productoId, companyId: ctx.companyId },
        select: { id: true, nombre: true },
      }),
    ])
    if (!orden) return { error: 'Orden no encontrada.' }
    if (!producto) return { error: 'Producto no encontrado.' }
    // Una orden ya pedida no se edita: el proveedor tiene otra cosa en la mano.
    if (!puedeEditarLineas(orden.estado)) {
      return { error: 'Solo se pueden editar las líneas de un borrador.' }
    }

    await prisma.ordenCompraLinea.create({
      data: {
        ordenId: orden.id,
        productoId: producto.id,
        nombre: producto.nombre,
        cantidad,
        costoUnitario,
      },
    })

    revalidatePath(`${RUTA_COMPRAS}/${ordenId}`)
    return { success: `${producto.nombre} agregado.` }
  } catch (e) {
    console.error('[carwash f3] agregarLinea:', e)
    return { error: 'No se pudo agregar la línea.' }
  }
}

export async function quitarLinea(lineaId: string): Promise<Fase3State> {
  try {
    const ctx = await contexto('COMPRAS')
    if ('error' in ctx) return ctx
    const linea = await prisma.ordenCompraLinea.findFirst({
      where: { id: lineaId, orden: { companyId: ctx.companyId } },
      select: { ordenId: true, orden: { select: { estado: true } } },
    })
    if (!linea) return { error: 'Línea no encontrada.' }
    if (!puedeEditarLineas(linea.orden.estado)) {
      return { error: 'Solo se pueden editar las líneas de un borrador.' }
    }
    await prisma.ordenCompraLinea.delete({ where: { id: lineaId } })
    revalidatePath(`${RUTA_COMPRAS}/${linea.ordenId}`)
    return { success: 'Línea quitada.' }
  } catch (e) {
    console.error('[carwash f3] quitarLinea:', e)
    return { error: 'No se pudo quitar la línea.' }
  }
}

/**
 * Mueve la orden de estado. RECIBIDA es el caso especial: es lo único que
 * toca el stock.
 */
export async function moverOrden(ordenId: string, destino: string): Promise<Fase3State> {
  try {
    const ctx = await contexto('COMPRAS')
    if ('error' in ctx) return ctx

    const orden = await prisma.ordenCompra.findFirst({
      where: { id: ordenId, companyId: ctx.companyId },
      select: {
        id: true,
        numero: true,
        estado: true,
        lineas: { select: { id: true, cantidad: true, cantidadRecibida: true, costoUnitario: true, productoId: true, nombre: true } },
      },
    })
    if (!orden) return { error: 'Orden no encontrada.' }

    const actual = orden.estado as OrdenEstado
    if (!ORDEN_TRANSICIONES[actual]?.includes(destino as OrdenEstado)) {
      return { error: `No se puede pasar de "${actual}" a "${destino}".` }
    }
    if (destino === 'PEDIDA' && orden.lineas.length === 0) {
      return { error: 'La orden no tiene líneas: no hay nada que pedir.' }
    }

    if (destino !== 'RECIBIDA') {
      await prisma.ordenCompra.update({
        where: { id: ordenId },
        data: {
          estado: destino,
          ...(destino === 'PEDIDA' ? { pedidaAt: new Date() } : {}),
        },
      })
      revalidatePath(RUTA_COMPRAS)
      revalidatePath(`${RUTA_COMPRAS}/${ordenId}`)
      return { success: destino === 'PEDIDA' ? `Orden ${orden.numero} pedida.` : 'Orden cancelada.' }
    }

    // ── Recibir: la única puerta al stock ──────────────────────────────────
    // Todo dentro de UNA transacción, y el cambio de estado va condicionado a
    // que la orden siga en PEDIDA. Si dos personas le dan a "recibir" a la vez,
    // la segunda no encuentra la orden en PEDIDA y no vuelve a sumar el stock.
    const total = totalDeLineas(
      orden.lineas.map((l) => ({
        cantidad: cantidadAIngresar(Number(l.cantidad), l.cantidadRecibida == null ? null : Number(l.cantidadRecibida)),
        costoUnitario: Number(l.costoUnitario),
      }))
    )

    const resultado = await prisma.$transaction(async (tx) => {
      const marca = await tx.ordenCompra.updateMany({
        where: { id: ordenId, estado: 'PEDIDA' },
        data: { estado: 'RECIBIDA', recibidaAt: new Date(), total },
      })
      if (marca.count === 0) return { error: 'Esta orden ya fue recibida.' as const }

      let ingresadas = 0
      for (const l of orden.lineas) {
        const cantidad = cantidadAIngresar(
          Number(l.cantidad),
          l.cantidadRecibida == null ? null : Number(l.cantidadRecibida)
        )
        if (cantidad <= 0) continue

        const producto = await tx.productoInventario.findUnique({
          where: { id: l.productoId },
          select: { stock: true, companyId: true },
        })
        // Un producto de otra empresa no se toca ni por accidente.
        if (!producto || producto.companyId !== ctx.companyId) continue

        const nuevoStock = Math.round((Number(producto.stock) + cantidad) * 100) / 100
        await tx.productoInventario.update({
          where: { id: l.productoId },
          data: {
            stock: nuevoStock,
            // El costo del producto se actualiza al último pagado: es lo que
            // sirve para valorar el inventario de hoy, no el de hace un año.
            costo: Number(l.costoUnitario),
          },
        })
        await tx.movimientoInventario.create({
          data: {
            productoId: l.productoId,
            companyId: ctx.companyId,
            tipo: 'ENTRADA',
            cantidad,
            stockResultante: nuevoStock,
            motivo: `Orden de compra ${orden.numero}`,
            registradoPorId: ctx.userId,
            ordenCompraId: ordenId,
          },
        })
        ingresadas += 1
      }
      return { ingresadas }
    })

    if ('error' in resultado) return { error: resultado.error }

    revalidatePath(RUTA_COMPRAS)
    revalidatePath(`${RUTA_COMPRAS}/${ordenId}`)
    revalidatePath('/admin/app/carwash/inventario')
    return {
      success: `Orden ${orden.numero} recibida: ${resultado.ingresadas} producto(s) entraron al inventario.`,
    }
  } catch (e) {
    console.error('[carwash f3] moverOrden:', e)
    return { error: 'No se pudo actualizar la orden.' }
  }
}

/** Ajusta lo REALMENTE recibido de una línea, antes de dar por recibida la orden. */
export async function ajustarRecibido(
  _prev: Fase3State,
  formData: FormData
): Promise<Fase3State> {
  try {
    const ctx = await contexto('COMPRAS')
    if ('error' in ctx) return ctx

    const lineaId = texto(formData.get('lineaId'), 40)
    const recibida = numero(formData.get('cantidadRecibida'))

    const linea = await prisma.ordenCompraLinea.findFirst({
      where: { id: lineaId, orden: { companyId: ctx.companyId } },
      select: { ordenId: true, orden: { select: { estado: true } } },
    })
    if (!linea) return { error: 'Línea no encontrada.' }
    if (linea.orden.estado !== 'PEDIDA') {
      return { error: 'Solo se ajusta lo recibido de una orden que está pedida.' }
    }

    await prisma.ordenCompraLinea.update({
      where: { id: lineaId },
      data: { cantidadRecibida: recibida },
    })

    revalidatePath(`${RUTA_COMPRAS}/${linea.ordenId}`)
    return { success: 'Cantidad recibida actualizada.' }
  } catch (e) {
    console.error('[carwash f3] ajustarRecibido:', e)
    return { error: 'No se pudo actualizar.' }
  }
}

// ── Activos ─────────────────────────────────────────────────────────────────

export async function guardarActivo(_prev: Fase3State, formData: FormData): Promise<Fase3State> {
  try {
    const ctx = await contexto('ACTIVOS')
    if ('error' in ctx) return ctx

    const id = texto(formData.get('id'), 40)
    const nombre = texto(formData.get('nombre'), 80)
    if (!nombre) return { error: 'Escribe el nombre del equipo.' }

    const estadoCrudo = texto(formData.get('estado'), 20)
    const estado = (ACTIVO_ESTADOS as readonly string[]).includes(estadoCrudo)
      ? estadoCrudo
      : 'OPERATIVO'
    const frecuenciaDias = Math.max(0, Number(formData.get('frecuenciaDias') ?? 0) || 0)

    const datos = {
      nombre,
      categoria: texto(formData.get('categoria'), 60) || null,
      marca: texto(formData.get('marca'), 60) || null,
      modelo: texto(formData.get('modelo'), 60) || null,
      serie: texto(formData.get('serie'), 60) || null,
      ubicacion: texto(formData.get('ubicacion'), 60) || null,
      estado,
      frecuenciaDias,
      costo: numero(formData.get('costo')),
      notas: texto(formData.get('notas'), 500) || null,
    }

    if (id) {
      const upd = await prisma.activo.updateMany({
        where: { id, companyId: ctx.companyId },
        data: datos,
      })
      if (upd.count === 0) return { error: 'Equipo no encontrado.' }
    } else {
      await prisma.activo.create({
        data: {
          companyId: ctx.companyId,
          ...datos,
          // Un equipo nuevo con frecuencia arranca su cuenta desde hoy: si no,
          // nacería con el mantenimiento ya vencido.
          proximoMantenimiento: calcularProximo(new Date(), frecuenciaDias),
        },
      })
    }

    revalidatePath(RUTA_ACTIVOS)
    return { success: id ? 'Equipo actualizado.' : `Equipo "${nombre}" agregado.` }
  } catch (e) {
    console.error('[carwash f3] guardarActivo:', e)
    return { error: 'No se pudo guardar. ¿Corriste la migración 20260765?' }
  }
}

export async function cambiarEstadoActivo(id: string, estado: string): Promise<Fase3State> {
  try {
    const ctx = await contexto('ACTIVOS')
    if ('error' in ctx) return ctx
    if (!(ACTIVO_ESTADOS as readonly string[]).includes(estado)) {
      return { error: 'Estado no válido.' }
    }
    const upd = await prisma.activo.updateMany({
      where: { id, companyId: ctx.companyId },
      data: { estado, ...(estado === 'BAJA' ? { activo: false } : {}) },
    })
    if (upd.count === 0) return { error: 'Equipo no encontrado.' }
    revalidatePath(RUTA_ACTIVOS)
    return { success: 'Estado del equipo actualizado.' }
  } catch (e) {
    console.error('[carwash f3] cambiarEstadoActivo:', e)
    return { error: 'No se pudo actualizar.' }
  }
}

/**
 * Registra un mantenimiento y reprograma el siguiente.
 *
 * Además devuelve el equipo a OPERATIVO: quien acaba de arreglarlo no debería
 * tener que acordarse de un segundo clic para decir que ya sirve.
 */
export async function registrarMantenimiento(
  _prev: Fase3State,
  formData: FormData
): Promise<Fase3State> {
  try {
    const ctx = await contexto('ACTIVOS')
    if ('error' in ctx) return ctx

    const activoId = texto(formData.get('activoId'), 40)
    const tipo = texto(formData.get('tipo'), 20)
    const descripcion = texto(formData.get('descripcion'), 1000)
    if (!(MANTENIMIENTO_TIPOS as readonly string[]).includes(tipo)) {
      return { error: 'Elige el tipo de mantenimiento.' }
    }
    if (!descripcion) return { error: 'Describe qué se hizo.' }

    const activo = await prisma.activo.findFirst({
      where: { id: activoId, companyId: ctx.companyId },
      select: { id: true, frecuenciaDias: true },
    })
    if (!activo) return { error: 'Equipo no encontrado.' }

    const ahora = new Date()
    await prisma.$transaction(async (tx) => {
      await tx.mantenimiento.create({
        data: {
          activoId: activo.id,
          tipo,
          descripcion,
          costo: numero(formData.get('costo')),
          horasParado: numero(formData.get('horasParado')),
          proveedor: texto(formData.get('proveedor'), 80) || null,
          realizadoAt: ahora,
          hechoPorId: ctx.userId,
        },
      })
      await tx.activo.update({
        where: { id: activo.id },
        data: {
          estado: 'OPERATIVO',
          proximoMantenimiento: calcularProximo(ahora, activo.frecuenciaDias),
        },
      })
    })

    revalidatePath(RUTA_ACTIVOS)
    return { success: 'Mantenimiento registrado. El equipo quedó operativo.' }
  } catch (e) {
    console.error('[carwash f3] registrarMantenimiento:', e)
    return { error: 'No se pudo registrar el mantenimiento.' }
  }
}

// ── Turnos ──────────────────────────────────────────────────────────────────

/**
 * Marca la entrada de un empleado.
 *
 * El índice único parcial de la base impide dos turnos abiertos del mismo
 * empleado. Se comprueba antes para dar un mensaje claro, pero la garantía
 * real está en la base: entre el findFirst y el create cabe otra petición.
 */
export async function marcarEntrada(_prev: Fase3State, formData: FormData): Promise<Fase3State> {
  try {
    const ctx = await contexto('TURNOS')
    if ('error' in ctx) return ctx

    const userId = texto(formData.get('userId'), 40)
    const empleado = await prisma.user.findFirst({
      where: { id: userId, companyId: ctx.companyId, role: { not: 'CLIENTE' } },
      select: { id: true, name: true, email: true },
    })
    if (!empleado) return { error: 'Empleado no encontrado.' }

    const abierto = await prisma.turno.findFirst({
      where: { userId: empleado.id, salidaAt: null },
      select: { id: true },
    })
    if (abierto) return { error: 'Esa persona ya tiene un turno abierto.' }

    await prisma.turno.create({
      data: {
        companyId: ctx.companyId,
        userId: empleado.id,
        costoHora: numero(formData.get('costoHora')),
      },
    })

    revalidatePath(RUTA_TURNOS)
    return { success: `Entrada marcada para ${empleado.name || empleado.email}.` }
  } catch (e) {
    // El choque con el índice único cae aquí: es la carrera de dos pestañas.
    console.error('[carwash f3] marcarEntrada:', e)
    return { error: 'No se pudo marcar la entrada. ¿Ya tenía un turno abierto?' }
  }
}

export async function marcarSalida(turnoId: string): Promise<Fase3State> {
  try {
    const ctx = await contexto('TURNOS')
    if ('error' in ctx) return ctx

    // El filtro `salidaAt: null` hace que cerrar dos veces no mueva la hora de
    // salida ya registrada.
    const upd = await prisma.turno.updateMany({
      where: { id: turnoId, companyId: ctx.companyId, salidaAt: null },
      data: { salidaAt: new Date(), cerradoPorId: ctx.userId },
    })
    if (upd.count === 0) return { error: 'Ese turno ya está cerrado.' }

    revalidatePath(RUTA_TURNOS)
    return { success: 'Salida marcada.' }
  } catch (e) {
    console.error('[carwash f3] marcarSalida:', e)
    return { error: 'No se pudo marcar la salida.' }
  }
}

/** Corrige un turno a mano (se olvidaron de marcar, se marcó de más). */
export async function corregirTurno(_prev: Fase3State, formData: FormData): Promise<Fase3State> {
  try {
    const ctx = await contexto('TURNOS')
    if ('error' in ctx) return ctx

    const id = texto(formData.get('id'), 40)
    const entradaCruda = texto(formData.get('entradaAt'), 40)
    const salidaCruda = texto(formData.get('salidaAt'), 40)

    const entradaAt = entradaCruda ? new Date(entradaCruda) : null
    const salidaAt = salidaCruda ? new Date(salidaCruda) : null
    if (entradaAt && Number.isNaN(entradaAt.getTime())) return { error: 'Fecha de entrada no válida.' }
    if (salidaAt && Number.isNaN(salidaAt.getTime())) return { error: 'Fecha de salida no válida.' }
    // Un turno que sale antes de entrar daría horas negativas, y esas horas
    // acabarían restando en el costo por lavado.
    if (entradaAt && salidaAt && salidaAt <= entradaAt) {
      return { error: 'La salida tiene que ser después de la entrada.' }
    }

    const upd = await prisma.turno.updateMany({
      where: { id, companyId: ctx.companyId },
      data: {
        ...(entradaAt ? { entradaAt } : {}),
        salidaAt,
        costoHora: numero(formData.get('costoHora')),
        notas: texto(formData.get('notas'), 300) || null,
        cerradoPorId: ctx.userId,
      },
    })
    if (upd.count === 0) return { error: 'Turno no encontrado.' }

    revalidatePath(RUTA_TURNOS)
    return { success: 'Turno corregido.' }
  } catch (e) {
    console.error('[carwash f3] corregirTurno:', e)
    return { error: 'No se pudo corregir el turno.' }
  }
}

/** Elimina un turno registrado por error. */
export async function eliminarTurno(id: string): Promise<Fase3State> {
  try {
    const ctx = await contexto('TURNOS')
    if ('error' in ctx) return ctx
    const t = await prisma.turno.findFirst({
      where: { id, companyId: ctx.companyId },
      select: { id: true },
    })
    if (!t) return { error: 'Turno no encontrado.' }
    await prisma.turno.delete({ where: { id } }).catch(anotarFallo('carwash:turno.delete', { id }))
    revalidatePath(RUTA_TURNOS)
    return { success: 'Turno eliminado.' }
  } catch (e) {
    console.error('[carwash f3] eliminarTurno:', e)
    return { error: 'No se pudo eliminar.' }
  }
}
