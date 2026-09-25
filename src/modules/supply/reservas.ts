import 'server-only'

import { sinEmpresa, type Tx } from '@/lib/tenant'
import {
  diaLocal,
  evaluarCapacidad,
  franjasDelDia,
  ventanaDeTexto,
  type FranjaDisponible,
  type VeredictoCapacidad,
} from './capacidad'

/**
 * MEMBEGO SUPPLY · RESERVAS DE RECOGIDA (Fase 17).
 *
 * El cliente elige sucursal, día y hora, y Membego comprueba contra la
 * capacidad que el proveedor comprometió en el contrato. Es lo que impide que
 * un acuerdo por 1.000 unidades se convierta en 700 personas un sábado.
 *
 * LA OCUPACIÓN SE CUENTA DENTRO DE LA TRANSACCIÓN, después de contar las
 * reservas vivas. Comprobar fuera y escribir después es exactamente cómo se
 * cuelan las dos reservas número 51 de un cupo de 50.
 */

export interface DatosReserva {
  derechoId: string
  sucursalId: string
  /** `yyyy-mm-dd` en la zona del comercio. */
  dia: string
  hora?: number | null
  clienteId: string
}

export type ResultadoReserva =
  | { ok: true; reservaId: string; inicioAt: Date }
  | { ok: false; mensaje: string }

/** Ocupación comprometida de un proveedor en un día (y en una hora). */
export async function ocupacion(
  tx: Tx,
  proveedorId: string,
  dia: string,
  hora?: number | null
): Promise<{ delDia: number; deLaHora: number }> {
  const [delDia, deLaHora] = await Promise.all([
    tx.supplyReserva.count({ where: { proveedorId, dia, estado: 'CONFIRMADA' } }),
    hora == null
      ? Promise.resolve(0)
      : tx.supplyReserva.count({ where: { proveedorId, dia, hora, estado: 'CONFIRMADA' } }),
  ])
  return { delDia, deLaHora }
}

/**
 * Reserva (o reprograma) la recogida de un derecho.
 *
 * Reprogramar CANCELA la reserva anterior y crea otra, en vez de mover la
 * existente: así el histórico conserva que hubo un cambio, y el índice único
 * parcial (una reserva CONFIRMADA por derecho) sigue siendo el que impide dos
 * cupos ocupados por la misma persona.
 */
export async function reservar(d: DatosReserva): Promise<ResultadoReserva> {
  const res = await reservarEnTx(d)
  if (res.ok) {
    const { avisarReservaConfirmada } = await import('./notificar')
    await avisarReservaConfirmada(res.reservaId)
  }
  return res
}

async function reservarEnTx(d: DatosReserva): Promise<ResultadoReserva> {
  return sinEmpresa('Membego Supply: el cliente aparta su recogida', async (tx) => {
    const derecho = await tx.supplyDerecho.findUnique({
      where: { id: d.derechoId },
      select: {
        id: true,
        estado: true,
        clienteId: true,
        proveedorId: true,
        lote: {
          select: {
            inicioAt: true,
            venceAt: true,
            snapshotTipo: true,
            snapshotCapacidadDiaria: true,
            snapshotCapacidadHoraria: true,
            snapshotSucursalIds: true,
            acuerdo: { select: { diasBloqueados: true } },
          },
        },
      },
    })
    if (!derecho) return { ok: false, mensaje: 'Beneficio no encontrado.' }
    if (derecho.clienteId !== d.clienteId) return { ok: false, mensaje: 'Este beneficio no es tuyo.' }
    if (derecho.estado !== 'ACTIVO') return { ok: false, mensaje: 'Este beneficio ya no está disponible.' }

    const lote = derecho.lote
    if (lote.snapshotSucursalIds.length > 0 && !lote.snapshotSucursalIds.includes(d.sucursalId)) {
      return { ok: false, mensaje: 'Este beneficio no aplica en la sucursal elegida.' }
    }

    const ocupada = await ocupacion(tx, derecho.proveedorId, d.dia, d.hora)
    const veredicto = evaluarCapacidad({
      dia: d.dia,
      hora: d.hora,
      tipo: lote.snapshotTipo,
      limites: {
        diaria: lote.snapshotCapacidadDiaria,
        horaria: lote.snapshotCapacidadHoraria,
        diasBloqueados: lote.acuerdo.diasBloqueados,
      },
      ocupacion: ocupada,
      vigenteDesde: lote.inicioAt,
      vigenteHasta: lote.venceAt,
    })
    if (!veredicto.cabe) return { ok: false, mensaje: veredicto.mensaje }

    await tx.supplyReserva.updateMany({
      where: { derechoId: d.derechoId, estado: 'CONFIRMADA' },
      data: { estado: 'CANCELADA', canceladaAt: new Date() },
    })

    // `inicioAt` es la marca absoluta para ordenar y avisar; `dia`/`hora` son
    // la verdad del cupo. Se guardan las dos porque responden preguntas
    // distintas y derivar una de otra obliga a conocer la zona en cada lectura.
    const inicioAt = new Date(`${d.dia}T${String(d.hora ?? 12).padStart(2, '0')}:00:00`)

    const reserva = await tx.supplyReserva.create({
      data: {
        derechoId: d.derechoId,
        proveedorId: derecho.proveedorId,
        sucursalId: d.sucursalId,
        dia: d.dia,
        hora: d.hora ?? null,
        inicioAt,
        estado: 'CONFIRMADA',
      },
      select: { id: true },
    })
    return { ok: true, reservaId: reserva.id, inicioAt }
  })
}

/** Cancela la reserva viva de un derecho (sin tocar el derecho). */
export async function cancelarReserva(derechoId: string, clienteId: string): Promise<void> {
  await sinEmpresa('Membego Supply: el cliente cancela su recogida', async (tx) => {
    const derecho = await tx.supplyDerecho.findUnique({
      where: { id: derechoId },
      select: { clienteId: true },
    })
    if (!derecho || derecho.clienteId !== clienteId) throw new Error('Reserva no encontrada.')
    await tx.supplyReserva.updateMany({
      where: { derechoId, estado: 'CONFIRMADA' },
      data: { estado: 'CANCELADA', canceladaAt: new Date() },
    })
  })
}

export interface DisponibilidadDia {
  dia: string
  cupoDiarioRestante: number | null
  franjas: FranjaDisponible[]
  bloqueado: boolean
}

/**
 * Qué horas quedan libres un día, para pintar el selector.
 *
 * Devuelve las horas llenas marcadas en vez de esconderlas: una lista que se
 * encoge sin explicación parece un sitio roto.
 */
export async function disponibilidadDelDia(
  derechoId: string,
  dia: string
): Promise<DisponibilidadDia | null> {
  return sinEmpresa('Membego Supply: horarios disponibles de una recogida', async (tx) => {
    const derecho = await tx.supplyDerecho.findUnique({
      where: { id: derechoId },
      select: {
        proveedorId: true,
        lote: {
          select: {
            snapshotCapacidadDiaria: true,
            snapshotCapacidadHoraria: true,
            snapshotTipo: true,
            inicioAt: true,
            venceAt: true,
            acuerdo: { select: { diasBloqueados: true, horarioTexto: true } },
          },
        },
      },
    })
    if (!derecho) return null

    const lote = derecho.lote
    const limites = {
      diaria: lote.snapshotCapacidadDiaria,
      horaria: lote.snapshotCapacidadHoraria,
      diasBloqueados: lote.acuerdo.diasBloqueados,
    }

    const reservas = await tx.supplyReserva.findMany({
      where: { proveedorId: derecho.proveedorId, dia, estado: 'CONFIRMADA' },
      select: { hora: true },
    })
    const porHora: Record<number, number> = {}
    for (const r of reservas) {
      if (r.hora != null) porHora[r.hora] = (porHora[r.hora] ?? 0) + 1
    }

    const cupoDiarioRestante =
      limites.diaria == null ? null : Math.max(0, limites.diaria - reservas.length)
    const ventana = ventanaDeTexto(lote.acuerdo.horarioTexto)

    return {
      dia,
      cupoDiarioRestante,
      bloqueado: (limites.diasBloqueados ?? []).includes(dia),
      franjas: franjasDelDia(ventana.desde, ventana.hasta, limites, porHora, cupoDiarioRestante),
    }
  })
}

/** Uso de hoy de un proveedor, para su portal ("27 / 50"). */
export async function usoDeHoy(
  tx: Tx,
  proveedorId: string,
  capacidadDiaria: number | null
): Promise<{ dia: string; usadas: number; capacidad: number | null }> {
  const dia = diaLocal(new Date())
  const [reservas, entregas] = await Promise.all([
    tx.supplyReserva.count({ where: { proveedorId, dia, estado: 'CONFIRMADA' } }),
    tx.supplyRedencion.count({
      where: {
        proveedorId,
        reversadaAt: null,
        createdAt: { gte: new Date(`${dia}T00:00:00`), lte: new Date(`${dia}T23:59:59`) },
      },
    }),
  ])
  // Las entregas SIN reserva también consumen la jornada del comercio: contar
  // solo reservas diría "0 / 50" en un local que lleva cuarenta pizzas hechas.
  return { dia, usadas: Math.max(reservas, entregas), capacidad: capacidadDiaria }
}

export type { VeredictoCapacidad }
