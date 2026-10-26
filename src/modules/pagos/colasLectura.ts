import type { Tx } from '@/lib/tenant'
import type { Paginacion } from '@/lib/paginacion'
import {
  whereCambiosDePlan,
  whereComprasEnSucursal,
  whereComprasEnValidacion,
  whereComprasSinCompletar,
  whereMembresiasEnSucursal,
  whereMembresiasSinCompletar,
  whereTransferencias,
} from './colas'
import { ventanaDe, type Cola } from './colasMezcla'

/**
 * LAS CONSULTAS DE LAS COLAS DE PAGO (auditoría admin · fase 5, tarea 5.2).
 *
 * Sacadas SIN CAMBIO de `admin/pagos/page.tsx`: mismos `where` (los de `colas.ts`, que son el único criterio de qué es cada
 * cola), mismos `select`, mismos órdenes y mismos topes. Lo único nuevo es que se lee SOLO la cola que se está mirando: antes
 * la página lanzaba las ocho consultas siempre, aunque se viera una sola pestaña.
 *
 * `null` = la consulta falló, y se distingue de `[]` = no hay nada: si se tragara el error como lista vacía el administrador
 * dejaría de validar pagos sin darse cuenta (la página enseña un aviso). Cada una cae a `null` por separado.
 */

const cae = (nombre: string) => (e: unknown) => {
  console.error(`[admin-pagos] ${nombre} query`, e)
  return null
}

const CLIENTE = { nombre: true, email: true, company: { select: { name: true } } } as const
const CLIENTE_CONTACTO = { nombre: true, email: true, telefono: true, company: { select: { name: true } } } as const

/** Transferencias con comprobante enviado, esperando visto bueno. */
export const leerTransferencias = (tx: Tx, companyId: string, pag: Paginacion) =>
  tx.membership
    .findMany({
      where: whereTransferencias(companyId),
      select: {
        id: true,
        estado: true,
        clienteId: true,
        updatedAt: true,
        comprobanteUrl: true,
        comprobanteNota: true,
        adminNota: true,
        descuentoBienvenida: true,
        fechaInicio: true,
        cliente: { select: CLIENTE },
        plan: { select: { nombre: true, precio: true } },
        metodoPago: { select: { nombre: true } },
      },
      orderBy: { updatedAt: 'desc' },
      skip: pag.saltar,
      take: pag.tomar,
    })
    .catch(cae('pendientes'))

/** Cambios de plan solicitados sobre una membresía que sigue activa. */
export const leerCambios = (tx: Tx, companyId: string, pag: Paginacion) =>
  tx.membership
    .findMany({
      where: whereCambiosDePlan(companyId),
      select: {
        id: true,
        clienteId: true,
        updatedAt: true,
        comprobanteUrl: true,
        comprobanteNota: true,
        cliente: { select: CLIENTE },
        plan: { select: { nombre: true } },
        planSolicitado: { select: { nombre: true, precio: true } },
      },
      orderBy: { updatedAt: 'desc' },
      skip: pag.saltar,
      take: pag.tomar,
    })
    .catch(cae('cambios'))

/** Fase E5: compras de promociones esperando validación del pago. */
export const leerCompras = (tx: Tx, companyId: string, pag: Paginacion) =>
  tx.productoCompra
    .findMany({
      where: whereComprasEnValidacion(companyId),
      select: {
        id: true,
        clienteId: true,
        updatedAt: true,
        comprobanteUrl: true,
        comprobanteNota: true,
        transferenciaFecha: true,
        precioCongelado: true,
        cliente: { select: CLIENTE },
        promocion: { select: { titulo: true } },
        metodoPago: { select: { nombre: true } },
      },
      orderBy: { updatedAt: 'desc' },
      skip: pag.saltar,
      take: pag.tomar,
    })
    .catch(cae('compras'))

/**
 * Pagos EN SUCURSAL: el cliente vino a pagar al local y nadie ha cobrado todavía. La condición vive en `colas.ts` y se aplica en
 * la BASE, no en memoria. Dos listas (membresías y compras) que la página numera como una sola; cada una trae hasta el FINAL
 * de la ventana visible y el corte se hace después (`cortarSucursal`).
 */
export const leerSucursalMembresias = (tx: Tx, companyId: string, pag: Paginacion) =>
  tx.membership
    .findMany({
      where: whereMembresiasEnSucursal(companyId),
      select: {
        id: true,
        estado: true,
        clienteId: true,
        createdAt: true,
        updatedAt: true,
        referencia: true,
        descuentoBienvenida: true,
        fechaInicio: true,
        rechazadoReason: true,
        sucursalPago: { select: { nombre: true } },
        metodoPago: { select: { nombre: true, tipo: true } },
        cliente: { select: CLIENTE_CONTACTO },
        plan: { select: { nombre: true, precio: true } },
      },
      orderBy: { updatedAt: 'asc' },
      take: ventanaDe(pag),
    })
    .catch(cae('sucursal membresías'))

export const leerSucursalCompras = (tx: Tx, companyId: string, pag: Paginacion) =>
  tx.productoCompra
    .findMany({
      where: whereComprasEnSucursal(companyId),
      select: {
        id: true,
        estado: true,
        clienteId: true,
        createdAt: true,
        updatedAt: true,
        referencia: true,
        precioCongelado: true,
        rechazadoReason: true,
        sucursalPago: { select: { nombre: true } },
        metodoPago: { select: { nombre: true, tipo: true } },
        cliente: { select: CLIENTE_CONTACTO },
        promocion: { select: { titulo: true, precio: true } },
      },
      orderBy: { updatedAt: 'asc' },
      take: ventanaDe(pag),
    })
    .catch(cae('sucursal compras'))

/** Cuántas membresías hay en sucursal: el punto donde la lista numerada pasa de membresías a compras. */
export const contarSucursalMembresias = (tx: Tx, companyId: string) =>
  tx.membership.count({ where: whereMembresiasEnSucursal(companyId) }).catch(() => 0)

/** SEGUIMIENTO: empezaron y no completaron. Misma regla de ventana que sucursal. */
export const leerSeguimientoMembresias = (tx: Tx, companyId: string, pag: Paginacion) =>
  tx.membership
    .findMany({
      where: whereMembresiasSinCompletar(companyId),
      select: {
        id: true,
        estado: true,
        clienteId: true,
        updatedAt: true,
        descuentoBienvenida: true,
        fechaInicio: true,
        rechazadoReason: true,
        metodoPago: { select: { tipo: true } },
        cliente: { select: CLIENTE_CONTACTO },
        plan: { select: { nombre: true, precio: true } },
      },
      orderBy: { updatedAt: 'asc' },
      take: ventanaDe(pag),
    })
    .catch(cae('seguimiento membresías'))

export const leerSeguimientoCompras = (tx: Tx, companyId: string, pag: Paginacion) =>
  tx.productoCompra
    .findMany({
      where: whereComprasSinCompletar(companyId),
      select: {
        id: true,
        estado: true,
        clienteId: true,
        updatedAt: true,
        precioCongelado: true,
        rechazadoReason: true,
        cliente: { select: CLIENTE_CONTACTO },
        promocion: { select: { titulo: true, precio: true } },
      },
      orderBy: { updatedAt: 'asc' },
      take: ventanaDe(pag),
    })
    .catch(cae('seguimiento compras'))

// Los tipos de fila salen de las propias consultas: no se escriben a mano, no se pueden desfasar.
type Fila<F extends (...a: never[]) => Promise<unknown>> = NonNullable<Awaited<ReturnType<F>>> extends (infer R)[] ? R : never
export type FilaTransferencia = Fila<typeof leerTransferencias>
export type FilaCambio = Fila<typeof leerCambios>
export type FilaCompra = Fila<typeof leerCompras>
export type FilaSucursalMembresia = Fila<typeof leerSucursalMembresias>
export type FilaSucursalCompra = Fila<typeof leerSucursalCompras>
export type FilaSeguimientoMembresia = Fila<typeof leerSeguimientoMembresias>
export type FilaSeguimientoCompra = Fila<typeof leerSeguimientoCompras>

export interface PaginacionesColas {
  tr: Paginacion
  pr: Paginacion
  cp: Paginacion
  suc: Paginacion
  seg: Paginacion
}

/** Lo que trajo la cola que se está mirando. `fallo` = alguna consulta de ESA cola falló. */
export type DatosCola =
  | { cola: 'transferencias'; filas: FilaTransferencia[]; fallo: boolean }
  | { cola: 'cambios'; filas: FilaCambio[]; fallo: boolean }
  | { cola: 'compras'; filas: FilaCompra[]; fallo: boolean }
  | { cola: 'sucursal'; membresias: FilaSucursalMembresia[]; compras: FilaSucursalCompra[]; totalMembresias: number; fallo: boolean }
  | { cola: 'seguimiento'; membresias: FilaSeguimientoMembresia[]; compras: FilaSeguimientoCompra[]; fallo: boolean }

/** Lee SOLO la cola pedida, dentro de la transacción de empresa que ya está abierta. */
export async function leerCola(tx: Tx, companyId: string, cola: Cola, p: PaginacionesColas): Promise<DatosCola> {
  switch (cola) {
    case 'transferencias': {
      const filas = await leerTransferencias(tx, companyId, p.tr)
      return { cola, filas: filas ?? [], fallo: filas === null }
    }
    case 'cambios': {
      const filas = await leerCambios(tx, companyId, p.cp)
      return { cola, filas: filas ?? [], fallo: filas === null }
    }
    case 'compras': {
      const filas = await leerCompras(tx, companyId, p.pr)
      return { cola, filas: filas ?? [], fallo: filas === null }
    }
    case 'sucursal': {
      const [membresias, compras, totalMembresias] = await Promise.all([
        leerSucursalMembresias(tx, companyId, p.suc),
        leerSucursalCompras(tx, companyId, p.suc),
        contarSucursalMembresias(tx, companyId),
      ])
      return { cola, membresias: membresias ?? [], compras: compras ?? [], totalMembresias, fallo: membresias === null || compras === null }
    }
    case 'seguimiento': {
      const [membresias, compras] = await Promise.all([
        leerSeguimientoMembresias(tx, companyId, p.seg),
        leerSeguimientoCompras(tx, companyId, p.seg),
      ])
      return { cola, membresias: membresias ?? [], compras: compras ?? [], fallo: membresias === null || compras === null }
    }
  }
}

