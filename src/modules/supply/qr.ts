import 'server-only'

import { sinEmpresa } from '@/lib/tenant'
import { nuevoNonceQr } from './codigos'
import { MINUTOS_QR } from './minutos-qr'

/**
 * MEMBEGO SUPPLY · QR DINÁMICO (Fase 13).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ LLEVA EL QR
 *
 * Un nonce. Nada más. No el id del voucher, no el del cliente, no el precio,
 * no el lote. Quien fotografíe el código no aprende nada y no puede fabricar
 * otro: el nonce es la llave y todo lo demás se resuelve en el servidor.
 *
 * Meter datos dentro —aunque sea firmados— tiene un costo que no compensa:
 * cualquier dato en el código es un dato que hay que validar contra la base de
 * todos modos, y mientras tanto viaja en una pantalla que se comparte por
 * WhatsApp.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CINCO MINUTOS Y UN SOLO USO
 *
 * El voucher vive semanas; el QR, cinco minutos. Así una captura de pantalla
 * enviada a un amigo no vale nada pasado el rato, y el voucher sigue siendo
 * del titular. Dos defensas encima:
 *
 *   · `consumidoAt` no nulo invalida el segundo escaneo del MISMO código
 *     aunque el voucher siguiera activo (antireplay);
 *   · `nonce` es único en toda la tabla.
 */

export { MINUTOS_QR }

export interface SesionQr {
  id: string
  nonce: string
  expiraAt: Date
  voucherId: string
  sucursalId: string | null
}

/**
 * Abre una sesión de QR para un voucher del cliente.
 *
 * `clienteId` no es decorativo: es la comprobación de que quien pulsa «Usar
 * beneficio» es el titular. Sin ella, conocer un id de voucher bastaría para
 * generar un código válido.
 */
export async function abrirSesionQr(
  voucherId: string,
  clienteId: string,
  sucursalId?: string | null
): Promise<SesionQr> {
  return sinEmpresa('Membego Supply: el cliente abre su QR para canjear', async (tx) => {
    const voucher = await tx.supplyVoucher.findUnique({
      where: { id: voucherId },
      select: {
        id: true,
        estado: true,
        vigenteHasta: true,
        sucursalIds: true,
        derecho: { select: { clienteId: true, estado: true } },
      },
    })
    if (!voucher) throw new Error('Voucher no encontrado.')
    if (voucher.derecho.clienteId !== clienteId) {
      throw new Error('Este beneficio no es tuyo.')
    }
    if (voucher.estado !== 'ACTIVO' || voucher.derecho.estado !== 'ACTIVO') {
      throw new Error('Este beneficio ya no está disponible.')
    }
    if (voucher.vigenteHasta <= new Date()) {
      throw new Error('Este beneficio venció.')
    }
    if (sucursalId && voucher.sucursalIds.length > 0 && !voucher.sucursalIds.includes(sucursalId)) {
      throw new Error('Este beneficio no aplica en la sucursal elegida.')
    }

    // Las sesiones anteriores se invalidan al abrir una nueva: si no, el
    // cliente acumularía códigos vivos y podría enseñar uno viejo en una
    // sucursal y otro nuevo en otra dentro de la misma ventana de cinco
    // minutos. Se marcan consumidas, no se borran: el rastro queda.
    await tx.supplyQrSesion.updateMany({
      where: { voucherId, consumidoAt: null, expiraAt: { gt: new Date() } },
      data: { consumidoAt: new Date() },
    })

    const sesion = await tx.supplyQrSesion.create({
      data: {
        voucherId,
        nonce: nuevoNonceQr(),
        expiraAt: new Date(Date.now() + MINUTOS_QR * 60_000),
        sucursalId: sucursalId ?? null,
      },
      select: { id: true, nonce: true, expiraAt: true, voucherId: true, sucursalId: true },
    })
    return sesion
  })
}

export type ResolucionQr =
  | { ok: true; voucherId: string; sesionId: string; sucursalId: string | null }
  | { ok: false; motivo: 'DESCONOCIDO' | 'EXPIRADO' | 'YA_USADO'; mensaje: string }

/**
 * Resuelve un nonce escaneado SIN consumirlo.
 *
 * Separado de la redención a propósito: el escáner primero muestra qué es
 * (cliente, producto, sucursal, lote) y solo entrega cuando el empleado
 * confirma. Consumir el nonce al mostrarlo dejaría el voucher inutilizable si
 * el empleado se arrepiente o la pantalla se cae antes de confirmar.
 */
export async function resolverNonce(nonce: string): Promise<ResolucionQr> {
  return sinEmpresa('Membego Supply: el comercio escanea un QR', async (tx) => {
    const sesion = await tx.supplyQrSesion.findUnique({
      where: { nonce },
      select: { id: true, voucherId: true, expiraAt: true, consumidoAt: true, sucursalId: true },
    })
    if (!sesion) {
      return { ok: false, motivo: 'DESCONOCIDO', mensaje: 'Este código no es de Membego Supply.' }
    }
    if (sesion.consumidoAt) {
      return { ok: false, motivo: 'YA_USADO', mensaje: 'Este código ya se utilizó.' }
    }
    if (sesion.expiraAt <= new Date()) {
      return {
        ok: false,
        motivo: 'EXPIRADO',
        mensaje: 'El código caducó. Pídele al cliente que lo genere de nuevo.',
      }
    }
    return { ok: true, voucherId: sesion.voucherId, sesionId: sesion.id, sucursalId: sesion.sucursalId }
  })
}
