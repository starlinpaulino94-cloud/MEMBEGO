import { randomUUID } from 'crypto'
import type { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { generarCodigo } from '@/lib/codes'
import {
  prefijoDeEmpresa,
  codigoVendedor,
} from '@/modules/excursiones/vendedores/nucleo'
import { calcularTotales, calcularSaldo } from '@/modules/excursiones/reservas/nucleo'
import { numeroReserva } from '@/modules/excursiones/reservas/nucleo'
import { numeroVenta, baseComisionable } from '@/modules/excursiones/ventas/nucleo'
import {
  reglaAplicable,
  calcularComision,
  netoComision,
  type ReglaComision,
} from '@/modules/excursiones/comisiones/nucleo'
import { numeroLiquidacion, totalLiquidacion } from '@/modules/excursiones/liquidaciones/nucleo'
import {
  EXCURSIONES_DEMO,
  VENDEDORES_DEMO,
  CLIENTES_DEMO,
  RESERVAS_DEMO,
  METAS_DEMO,
} from './guion'

/**
 * EXCURSIONES · Sembrar la demostración.
 *
 * Escribe la historia del guion en una empresa marcada como DEMO. Dos cosas
 * que este archivo NO hace, a propósito:
 *
 * - No inventa cifras. Las comisiones las calcula el MISMO motor que las de
 *   producción, con sus reglas y su snapshot: si la demo enseña «10% sobre
 *   2.500», es porque el motor lo calculó, no porque alguien lo escribió.
 * - No toca empresas reales. El llamador comprueba `esDemo`, y esa marca ya
 *   excluye a la empresa del marketplace y de las métricas de la plataforma.
 *
 * Los clientes se crean como los de MOSTRADOR (`esLocal`, con `supabaseId`
 * prefijado `local:`): Supabase solo emite UUID, así que un id con ese prefijo
 * jamás puede venir de una sesión real y ninguno de estos clientes puede
 * iniciar sesión ni por accidente.
 */

/** Un día concreto a las 8:00 hora local (UTC−4), a N días de hoy. */
function diaRelativo(dias: number, hora = 12): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + dias)
  d.setUTCHours(hora, 0, 0, 0)
  return d
}

export interface ResultadoSiembra {
  excursiones: number
  vendedores: number
  clientes: number
  reservas: number
  ventas: number
  comisiones: number
  liquidaciones: number
}

/** ¿Esta empresa ya tiene datos de Excursiones? (para no sembrar dos veces) */
export async function yaTieneExcursiones(companyId: string): Promise<boolean> {
  const n = await conEmpresa(companyId, (tx) => tx.excursion.count({ where: { companyId } }))
  return n > 0
}

export async function sembrarExcursionesDemo(
  companyId: string,
  nombreEmpresa: string
): Promise<ResultadoSiembra> {
  const prefijo = prefijoDeEmpresa(nombreEmpresa)
  const anio = new Date().getUTCFullYear()

  // ── Catálogo ──────────────────────────────────────────────────────────────
  const excursiones: { id: string; variantes: { id: string; precioAdulto: number; precioNino: number | null }[]; impuestoPct: number }[] = []
  for (const [i, e] of EXCURSIONES_DEMO.entries()) {
    const creada = await conEmpresa(companyId, (tx) =>
      tx.excursion.create({
        data: {
          companyId,
          nombre: e.nombre,
          slug: `demo-${i + 1}-${generarCodigo(5).toLowerCase()}`,
          descripcion: e.descripcion,
          ubicacion: e.ubicacion,
          duracionMin: e.duracionMin,
          impuestoPct: e.impuestoPct,
          capacidad: e.capacidad,
          puntoSalida: e.puntoSalida,
          horaSalida: e.horaSalida,
          horaRegreso: e.horaRegreso,
          incluye: e.incluye,
          moneda: 'DOP',
          estado: 'ACTIVA',
          variantes: {
            create: e.variantes.map((v) => ({
              companyId,
              nombre: v.nombre,
              precioAdulto: v.precioAdulto,
              precioNino: v.precioNino,
              capacidad: v.capacidad,
            })),
          },
          horarios: {
            create: [{ companyId, diasSemana: e.dias, horaSalida: e.horaSalida, cupo: e.capacidad }],
          },
        },
        select: {
          id: true,
          impuestoPct: true,
          variantes: { select: { id: true, precioAdulto: true, precioNino: true }, orderBy: { createdAt: 'asc' } },
        },
      })
    )
    excursiones.push({
      id: creada.id,
      impuestoPct: Number(creada.impuestoPct ?? 0),
      variantes: creada.variantes.map((v) => ({
        id: v.id,
        precioAdulto: Number(v.precioAdulto),
        precioNino: v.precioNino != null ? Number(v.precioNino) : null,
      })),
    })
  }

  // ── Vendedores con su enlace ──────────────────────────────────────────────
  const vendedores: { id: string }[] = []
  for (const [i, v] of VENDEDORES_DEMO.entries()) {
    const creado = await conEmpresa(companyId, (tx) =>
      tx.vendedor.create({
        data: {
          companyId,
          codigo: codigoVendedor(prefijo, i + 1),
          nombre: v.nombre,
          apellido: v.apellido,
          telefono: v.telefono,
          tipo: v.tipo,
          estado: 'ACTIVO',
          enlaces: { create: { companyId, slug: generarCodigo(10).toLowerCase() } },
        },
        select: { id: true },
      })
    )
    vendedores.push(creado)
  }

  // ── Clientes de mostrador ─────────────────────────────────────────────────
  const clientes: { id: string }[] = []
  for (const [i, nombre] of CLIENTES_DEMO.entries()) {
    const creado = await conEmpresa(companyId, (tx) =>
      tx.cliente.create({
        data: {
          companyId,
          supabaseId: `local:${randomUUID()}`,
          nombre,
          email: '',
          telefono: `809-555-${String(2000 + i).slice(-4)}`,
          esLocal: true,
        },
        select: { id: true },
      })
    )
    clientes.push(creado)
  }

  // ── Atribución: cada vendedor trajo a los suyos ───────────────────────────
  let siguiente = 0
  const clienteDeVendedor = new Map<number, string[]>()
  for (const [i, v] of VENDEDORES_DEMO.entries()) {
    const suyos: string[] = []
    for (let n = 0; n < v.captados && siguiente < clientes.length; n++) {
      suyos.push(clientes[siguiente].id)
      siguiente += 1
    }
    clienteDeVendedor.set(i, suyos)

    for (const [n, clienteId] of suyos.entries()) {
      const cuando = diaRelativo(-20 + n * 2)
      await conEmpresa(companyId, (tx) =>
        tx.vendedorAtribucion.createMany({
          data: [
            {
              companyId,
              vendedorId: vendedores[i].id,
              etapa: 'VISITA',
              canal: n % 2 === 0 ? 'QR' : 'ENLACE',
              visitorId: randomUUID(),
              createdAt: cuando,
            },
            {
              companyId,
              vendedorId: vendedores[i].id,
              etapa: 'REGISTRO',
              clienteId,
              canal: n % 2 === 0 ? 'QR' : 'ENLACE',
              createdAt: cuando,
            },
          ],
        })
      )
    }
  }

  // ── Reglas de comisión: una general y una mejor para el hotel ─────────────
  await conEmpresa(companyId, (tx) =>
    tx.comisionRegla.create({
      data: { companyId, ambito: 'GENERAL', tipoCalculo: 'PORCENTAJE', valor: 10, activa: true },
    })
  )
  await conEmpresa(companyId, (tx) =>
    tx.comisionRegla.create({
      data: {
        companyId,
        ambito: 'VENDEDOR',
        vendedorId: vendedores[1].id,
        tipoCalculo: 'PORCENTAJE',
        valor: 15,
        activa: true,
      },
    })
  )
  const reglasCrudas = await conEmpresa(companyId, (tx) =>
    tx.comisionRegla.findMany({ where: { companyId, activa: true } })
  )
  const reglas: ReglaComision[] = reglasCrudas.map((r) => ({
    id: r.id,
    ambito: r.ambito,
    tipoCalculo: r.tipoCalculo,
    valor: Number(r.valor),
    escalones: r.escalones,
    activa: r.activa,
    excursionId: r.excursionId,
    vendedorId: r.vendedorId,
    categoria: r.categoria,
    vigenciaDesde: r.vigenciaDesde,
    vigenciaHasta: r.vigenciaHasta,
    createdAt: r.createdAt,
  }))

  // ── Reservas, cobros, ventas y comisiones ─────────────────────────────────
  const comisionesPorVendedor = new Map<string, { id: string; neto: number }[]>()
  let nVenta = 0
  let ventas = 0
  let comisiones = 0

  for (const [i, r] of RESERVAS_DEMO.entries()) {
    const exc = excursiones[r.excursion]
    const variante = exc.variantes[r.variante] ?? exc.variantes[0]
    const vendedorId = r.vendedor !== null ? vendedores[r.vendedor].id : null
    const fecha = diaRelativo(r.dia, 8)
    const creadaEn = diaRelativo(r.dia - 6)

    const totales = calcularTotales({
      adultos: r.adultos,
      ninos: r.ninos,
      precioAdulto: variante.precioAdulto,
      precioNino: variante.precioNino,
      impuestoPct: exc.impuestoPct,
    })

    const reserva = await conEmpresa(companyId, (tx) =>
      tx.reservaExc.create({
        data: {
          companyId,
          numero: numeroReserva('EXC', anio, i + 1),
          clienteId: clientes[r.cliente].id,
          vendedorId,
          excursionId: exc.id,
          varianteId: variante.id,
          fecha,
          hora: '08:00',
          adultos: r.adultos,
          ninos: r.ninos,
          subtotal: totales.subtotal,
          descuento: totales.descuento,
          impuestos: totales.impuestos,
          total: totales.total,
          moneda: 'DOP',
          estado: 'PENDIENTE',
          createdAt: creadaEn,
          checkinToken: generarCodigo(24),
          pasajeros: {
            create: [
              ...Array.from({ length: r.adultos }, () => ({ companyId, tipo: 'ADULTO' })),
              ...Array.from({ length: r.ninos }, () => ({ companyId, tipo: 'NINO' })),
            ],
          },
        },
        select: { id: true, pasajeros: { select: { id: true } } },
      })
    )

    // Cobros
    const aCobrar =
      r.cobro === 'COMPLETO' ? totales.total : r.cobro === 'ABONO' ? Math.round(totales.total * 0.4 * 100) / 100 : 0
    if (aCobrar > 0) {
      await conEmpresa(companyId, (tx) =>
        tx.reservaPago.create({
          data: {
            companyId,
            reservaId: reserva.id,
            monto: aCobrar,
            moneda: 'DOP',
            metodo: i % 3 === 0 ? 'EFECTIVO' : i % 3 === 1 ? 'TARJETA' : 'TRANSFERENCIA',
            referencia: i % 3 === 1 ? `AUT-${1000 + i}` : null,
            createdAt: creadaEn,
          },
        })
      )
    }
    const { saldo } = calcularSaldo(totales.total, [{ monto: aCobrar, estado: 'REGISTRADO' }])
    const estadoReserva = r.cancelada
      ? 'CANCELADA'
      : r.vendida
        ? 'COMPLETADA'
        : saldo <= 0
          ? 'PAGADA'
          : aCobrar > 0
            ? 'PARCIALMENTE_PAGADA'
            : 'PENDIENTE'

    // Embarque
    const embarcados = r.embarcados ?? 0
    if (embarcados > 0) {
      const ids = reserva.pasajeros.slice(0, embarcados).map((p) => p.id)
      await conEmpresa(companyId, (tx) =>
        tx.reservaPasajero.updateMany({
          where: { id: { in: ids }, companyId },
          data: { presente: true, checkinAt: fecha },
        })
      )
    }

    await conEmpresa(companyId, (tx) =>
      tx.reservaExc.update({
        where: { id: reserva.id },
        data: {
          estado: estadoReserva,
          ...(embarcados > 0 ? { checkinAt: fecha } : {}),
          ...(r.cancelada ? { notas: '[CANCELADA] El cliente canceló por lluvia.' } : {}),
        },
      })
    )

    // Venta + comisión, con el MOTOR real
    if (r.vendida && !r.cancelada) {
      nVenta += 1
      const venta = await conEmpresa(companyId, (tx) =>
        tx.ventaExc.create({
          data: {
            companyId,
            numero: numeroVenta('SAL', nVenta),
            reservaId: reserva.id,
            clienteId: clientes[r.cliente].id,
            vendedorId,
            excursionId: exc.id,
            pasajeros: r.adultos + r.ninos,
            total: totales.total,
            moneda: 'DOP',
            estado: 'CONFIRMADA',
            confirmadaAt: fecha,
            createdAt: fecha,
          },
          select: { id: true },
        })
      )
      ventas += 1

      if (vendedorId) {
        await conEmpresa(companyId, (tx) =>
          tx.vendedorAtribucion.create({
            data: {
              companyId,
              vendedorId,
              clienteId: clientes[r.cliente].id,
              etapa: 'COMPRA',
              createdAt: fecha,
            },
          })
        )

        const ctx = {
          vendedorId,
          excursionId: exc.id,
          categoria: null,
          total: totales.total,
          baseComisionable: baseComisionable(totales.total, totales.impuestos),
          adultos: r.adultos,
          ninos: r.ninos,
          fecha,
        }
        const regla = reglaAplicable(reglas, ctx)
        if (regla) {
          const c = calcularComision(regla, ctx)
          const creada = await conEmpresa(companyId, (tx) =>
            tx.comisionEntrada.create({
              data: {
                companyId,
                ventaId: venta.id,
                vendedorId,
                base: c.base,
                monto: c.monto,
                moneda: 'DOP',
                reglaSnapshot: c.snapshot as unknown as Prisma.InputJsonObject,
                desglose: c.desglose,
                estado: 'APROBADA',
                createdAt: fecha,
              },
              select: { id: true },
            })
          )
          comisiones += 1
          const previas = comisionesPorVendedor.get(vendedorId) ?? []
          previas.push({ id: creada.id, neto: netoComision(c.monto, []) })
          comisionesPorVendedor.set(vendedorId, previas)
        }
      }
    }
  }

  // ── Una liquidación ya pagada, para que el módulo no esté vacío ───────────
  let liquidaciones = 0
  const delPrimero = comisionesPorVendedor.get(vendedores[0].id) ?? []
  if (delPrimero.length > 0) {
    const total = totalLiquidacion(delPrimero.map((c) => c.neto))
    const liquidacion = await conEmpresa(companyId, (tx) =>
      tx.liquidacion.create({
        data: {
          companyId,
          numero: numeroLiquidacion('PAY', anio, 1),
          vendedorId: vendedores[0].id,
          periodoDesde: diaRelativo(-30),
          periodoHasta: diaRelativo(-1),
          total,
          moneda: 'DOP',
          estado: 'PAGADA',
          metodo: 'TRANSFERENCIA',
          referencia: 'TRX-884120',
          pagadaAt: diaRelativo(-1),
          createdAt: diaRelativo(-1),
        },
        select: { id: true },
      })
    )
    await conEmpresa(companyId, (tx) =>
      tx.comisionEntrada.updateMany({
        where: { id: { in: delPrimero.map((c) => c.id) }, companyId },
        data: { liquidacionId: liquidacion.id, estado: 'PAGADA' },
      })
    )
    liquidaciones = 1
  }

  // ── Metas del mes ─────────────────────────────────────────────────────────
  for (const m of METAS_DEMO) {
    await conEmpresa(companyId, (tx) =>
      tx.vendedorMeta.create({
        data: {
          companyId,
          vendedorId: vendedores[m.vendedor].id,
          periodo: 'MENSUAL',
          metaRegistros: m.metaRegistros,
          metaVentas: m.metaVentas,
          metaIngresos: m.metaIngresos,
          activa: true,
        },
      })
    )
  }

  return {
    excursiones: excursiones.length,
    vendedores: vendedores.length,
    clientes: clientes.length,
    reservas: RESERVAS_DEMO.length,
    ventas,
    comisiones,
    liquidaciones,
  }
}
