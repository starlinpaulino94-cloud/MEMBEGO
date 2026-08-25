'use server'

/**
 * EXCURSIONES · Reservas — acción del CLIENTE.
 *
 * Variante simplificada de crearReserva (admin): el cliente se reserva
 * directamente sin intermediación de un vendedor. El precio se lee del
 * catálogo en el servidor, nunca del formulario.
 * Si hay cookie de atribución de vendedor válida, se atribuye la reserva.
 */

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { conEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { cookies } from 'next/headers'
import { anotarFallo } from '@/lib/prisma-errors'
import { generarCodigo } from '@/lib/codes'
import {
  calcularTotales,
  numeroReserva,
  validarReserva,
  validarDisponibilidad,
  validarDisponibilidadCombo,
} from './nucleo'
import { sincronizarEstadoAgotada } from '../catalogo/actions'
import { resolverEnlace, vendedorParaCliente, VENDEDOR_COOKIE } from '../atribucion/registrar'
import { procesarVentaYComisionInterna } from '../ventas/actions'
import { asegurarClienteEnEmpresa } from '@/modules/cliente/afiliacion'

export interface ReservaClienteState {
  error?: string
  success?: string
  reservaId?: string
  numero?: string
}

/** CLIENTE · Crear reserva directa (puede tener vendedor por cookie). */
export async function reservarExcursion(
  _prev: ReservaClienteState,
  formData: FormData
): Promise<ReservaClienteState> {
  try {
    const user = await getUser()
    if (!user) return { error: 'Debes iniciar sesión para reservar.' }

    const companyId = String(formData.get('companyId') ?? '')
    const excursionId = String(formData.get('excursionId') ?? '')
    const varianteId = String(formData.get('varianteId') ?? '')

    // Leer cookie de atribución de vendedor (server-side)
    let vendedorId: string | null = null
    let cookieSlug: string | null = null
    try {
      const store = await cookies()
      cookieSlug = store.get(VENDEDOR_COOKIE)?.value?.trim().toLowerCase() || null
      if (cookieSlug) {
        const enlace = await resolverEnlace(cookieSlug)
        if (enlace && enlace.companyId === companyId) {
          vendedorId = enlace.vendedorId
        }
      }
    } catch {
      /* ignore: sin cookie o error al resolver -> reserva sin vendedor */
    }

    // Resolver o auto-afiliar el clienteId del usuario autenticado en esta empresa
    const resCliente = await asegurarClienteEnEmpresa(
      user.supabaseId,
      user.email,
      companyId,
      cookieSlug
    )
    if ('error' in resCliente) {
      return { error: resCliente.error }
    }
    const clienteId = resCliente.clienteId

    // Si no vino por cookie o se consumió en el registro, resolver desde los hechos del cliente
    if (!vendedorId && clienteId) {
      vendedorId = await vendedorParaCliente(companyId, clienteId)
    }

    const v = validarReserva({
      fecha: String(formData.get('fecha') ?? ''),
      hora: String(formData.get('hora') ?? ''),
      adultos: String(formData.get('adultos') ?? '0'),
      ninos: String(formData.get('ninos') ?? '0'),
      descuento: '0',
      notas: String(formData.get('notas') ?? ''),
      canal: 'ONLINE',
    })
    if (!v.ok) return { error: v.error }

    // Precios del catálogo, nunca del formulario.
    const excursion = await conEmpresa(companyId, (tx) =>
      tx.excursion.findFirst({
        where: { id: excursionId, companyId, estado: 'ACTIVA' },
        select: {
          id: true,
          nombre: true,
          moneda: true,
          impuestoPct: true,
          variantes: {
            where: { activa: true },
            select: { id: true, nombre: true, precioAdulto: true, precioNino: true },
            orderBy: { orden: 'asc' },
          },
        },
      })
    )
    if (!excursion) return { error: 'Esa excursión no está disponible.' }

    const variante =
      excursion.variantes.find((x) => x.id === varianteId) ?? excursion.variantes[0]
    if (!variante) return { error: 'Esa excursión no tiene variantes activas.' }

    // Validar disponibilidad: fecha, horario y cupo (y de sus actividades si es un combo)
    const excursionCompleta = await conEmpresa(companyId, (tx) =>
      tx.excursion.findFirst({
        where: { id: excursionId, companyId, estado: 'ACTIVA' },
        select: {
          id: true,
          nombre: true,
          tipoItem: true,
          capacidad: true,
          horaSalida: true,
          horarios: {
            where: { activo: true },
            select: { id: true, diasSemana: true, horaSalida: true, cupo: true },
          },
          comboItems: {
            include: {
              actividad: {
                select: {
                  id: true,
                  nombre: true,
                  capacidad: true,
                  horaSalida: true,
                  horarios: {
                    where: { activo: true },
                    select: { id: true, diasSemana: true, horaSalida: true, cupo: true },
                  },
                },
              },
            },
          },
        },
      })
    )
    if (!excursionCompleta) return { error: 'Esa excursión no está disponible.' }

    if (excursionCompleta.tipoItem === 'COMBO' && excursionCompleta.comboItems.length > 0) {
      let itinerarioComboCustom: Record<string, string> = {}
      const rawItinerarioCombo = String(formData.get('itinerarioComboJson') ?? '')
      if (rawItinerarioCombo) {
        try {
          itinerarioComboCustom = JSON.parse(rawItinerarioCombo)
        } catch {
          /* ignore */
        }
      }

      const dispCombo = validarDisponibilidadCombo(
        v.datos.fecha,
        v.datos.hora,
        v.datos.adultos + v.datos.ninos,
        {
          nombre: excursionCompleta.nombre,
          capacidad: excursionCompleta.capacidad,
          horaSalida: excursionCompleta.horaSalida,
          horarios: excursionCompleta.horarios.map((h) => ({
            id: h.id,
            diasSemana: Array.isArray(h.diasSemana) ? (h.diasSemana as number[]) : [],
            horaSalida: h.horaSalida,
            cupo: h.cupo,
          })),
          actividades: excursionCompleta.comboItems.map((ci) => ({
            nombre: ci.actividad.nombre,
            capacidad: ci.actividad.capacidad,
            horaSalida:
              itinerarioComboCustom[ci.actividad.id] ||
              ci.actividad.horaSalida ||
              ci.actividad.horarios[0]?.horaSalida ||
              '09:00',
            horarios: ci.actividad.horarios.map((h) => ({
              id: h.id,
              diasSemana: Array.isArray(h.diasSemana) ? (h.diasSemana as number[]) : [],
              horaSalida: h.horaSalida,
              cupo: h.cupo,
            })),
          })),
        }
      )
      if (!dispCombo.ok) return { error: dispCombo.error }

      // Anotar el desglose de turnos en las notas de la reserva si hubo personalización
      if (Object.keys(itinerarioComboCustom).length > 0) {
        const resumenTurnos = dispCombo.itinerario
          .map((b) => `${b.nombre}: ${b.inicio}→${b.fin}`)
          .join(' | ')
        v.datos.notas = v.datos.notas
          ? `${v.datos.notas}\n[Itinerario: ${resumenTurnos}]`
          : `[Itinerario: ${resumenTurnos}]`
      }
    } else {
      const disp = validarDisponibilidad(
        v.datos.fecha,
        v.datos.hora,
        v.datos.adultos + v.datos.ninos,
        {
          capacidad: excursionCompleta.capacidad,
          horaSalida: excursionCompleta.horaSalida,
          horarios: excursionCompleta.horarios.map((h) => ({
            id: h.id,
            diasSemana: Array.isArray(h.diasSemana) ? (h.diasSemana as number[]) : [],
            horaSalida: h.horaSalida,
            cupo: h.cupo,
          })),
        }
      )
      if (!disp.ok) return { error: disp.error }
    }

    const totales = calcularTotales({
      adultos: v.datos.adultos,
      ninos: v.datos.ninos,
      precioAdulto: Number(variante.precioAdulto),
      precioNino: variante.precioNino != null ? Number(variante.precioNino) : null,
      descuento: 0,
      impuestoPct: excursion.impuestoPct != null ? Number(excursion.impuestoPct) : null,
    })

    const anio = v.datos.fecha.getUTCFullYear()
    const metodoPago = String(formData.get('metodoPago') ?? 'DESTINO')
    const esPagoOnline = metodoPago === 'ONLINE_SIMULADO'
    const checkinToken = generarCodigo(24)

    const creada = await conEmpresa(companyId, async (tx) => {
      const desde = new Date(Date.UTC(anio, 0, 1))
      const hasta = new Date(Date.UTC(anio + 1, 0, 1))
      let intento =
        (await tx.reservaExc.count({
          where: { companyId, fecha: { gte: desde, lt: hasta } },
        })) + 1

      for (let i = 0; i < 5; i++) {
        try {
          return await tx.reservaExc.create({
            data: {
              companyId,
              numero: numeroReserva('EXC', anio, intento),
              clienteId,
              vendedorId,
              excursionId: excursion.id,
              varianteId: variante.id,
              fecha: v.datos.fecha,
              hora: v.datos.hora,
              adultos: v.datos.adultos,
              ninos: v.datos.ninos,
              subtotal: totales.subtotal,
              descuento: totales.descuento,
              impuestos: totales.impuestos,
              total: totales.total,
              moneda: excursion.moneda,
              estado: esPagoOnline ? 'PAGADA' : 'PENDIENTE',
              canal: 'ONLINE',
              notas: v.datos.notas,
              checkinToken,
              pasajeros: {
                createMany: {
                  data: [
                    ...Array.from({ length: v.datos.adultos }, () => ({
                      companyId,
                      tipo: 'ADULTO',
                    })),
                    ...Array.from({ length: v.datos.ninos }, () => ({
                      companyId,
                      tipo: 'NINO',
                    })),
                  ],
                },
              },
            },
            select: { id: true, numero: true, vendedorId: true },
          })
        } catch (e: unknown) {
          if (
            e instanceof Error &&
            e.message.includes('Unique constraint') &&
            e.message.includes('numero')
          ) {
            intento++
            continue
          }
          throw e
        }
      }
      throw new Error('No se pudo generar el número de reserva tras varios intentos.')
    })

    // Si pagó en línea simulado, registrar el cobro y procesar la venta/comisión
    if (esPagoOnline) {
      await conEmpresa(companyId, (tx) =>
        tx.reservaPago.create({
          data: {
            companyId,
            reservaId: creada.id,
            monto: totales.total,
            moneda: excursion.moneda,
            metodo: 'TARJETA_SIMULADA',
            referencia: `SIM-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
            estado: 'REGISTRADO',
          },
        })
      )
      await procesarVentaYComisionInterna(companyId, creada.id, user.metadata.dbUserId ?? null).catch(
        anotarFallo('excursiones:reservarExcursion:procesarVenta')
      )
    }

    // Atribución de vendedor: etapa RESERVA (hecho inmutable para comisión)
    if (vendedorId && creada.vendedorId) {
      await conEmpresa(companyId, (tx) =>
        tx.vendedorAtribucion.create({
          data: {
            companyId,
            vendedorId: vendedorId,
            clienteId,
            etapa: esPagoOnline ? 'COMPRA' : 'RESERVA',
          },
        })
      ).catch(anotarFallo('excursiones:reservarExcursion:atribucion'))
    }

    revalidatePath('/cliente/mis-excursiones')
    revalidatePath('/cliente/excursiones')

    // Sincronizar estado AGOTADA tras crear reserva
    await sincronizarEstadoAgotada(companyId, excursionId)

    // Consumir cookie de atribución (un solo uso)
    if (vendedorId) {
      try {
        const store = await cookies()
        store.delete(VENDEDOR_COOKIE)
      } catch {
        /* ignore */
      }
    }

    return {
      success: esPagoOnline
        ? '¡Pago procesado con éxito! Tu reserva está confirmada con acceso y boleto listos.'
        : 'Reserva agendada exitosamente. Recuerda realizar tu pago el día de la excursión.',
      reservaId: creada.id,
      numero: creada.numero,
    }
  } catch (e) {
    anotarFallo('excursiones:reservarExcursion')(e)
    return { error: 'Error al crear la reserva. Intenta de nuevo.' }
  }
}

export interface CartItemPayload {
  excursionId: string
  varianteId: string
  fecha: string
  horaSalida: string
  adultos: number
  ninos: number
  notas?: string
}

/** CLIENTE · Reservar todos los ítems del carrito en una sola operación */
export async function reservarCarritoAction(
  items: CartItemPayload[],
  metodoPago?: 'DESTINO' | 'ONLINE_SIMULADO'
) {
  try {
    const user = await getUser()
    if (!user) return { error: 'Debes iniciar sesión para reservar.' }
    if (!items || items.length === 0) return { error: 'El carrito está vacío.' }

    const primerItem = await prisma.excursion.findUnique({
      where: { id: items[0].excursionId },
      select: { companyId: true },
    })
    if (!primerItem) return { error: 'Excursión no válida.' }

    const companyId = primerItem.companyId

    // Leer cookie de atribución de vendedor (server-side)
    let vendedorId: string | null = null
    let cookieSlug: string | null = null
    try {
      const store = await cookies()
      cookieSlug = store.get(VENDEDOR_COOKIE)?.value?.trim().toLowerCase() || null
      if (cookieSlug) {
        const enlace = await resolverEnlace(cookieSlug)
        if (enlace && enlace.companyId === companyId) {
          vendedorId = enlace.vendedorId
        }
      }
    } catch {
      // ignore
    }

    // Resolver o auto-afiliar el clienteId del usuario autenticado en esta empresa
    const resCliente = await asegurarClienteEnEmpresa(
      user.supabaseId,
      user.email,
      companyId,
      cookieSlug
    )
    if ('error' in resCliente) {
      return { error: resCliente.error }
    }
    const clienteId = resCliente.clienteId

    if (!vendedorId) {
      vendedorId = await vendedorParaCliente(companyId, clienteId)
    }

    const esPagoOnline = metodoPago === 'ONLINE_SIMULADO'
    const nuevasReservas = []

    for (const item of items) {
      const exc = await prisma.excursion.findFirst({
        where: { id: item.excursionId, estado: 'ACTIVA' },
        include: {
          variantes: { where: { id: item.varianteId, activa: true } },
          horarios: {
            where: { activo: true },
            select: { id: true, diasSemana: true, horaSalida: true, cupo: true },
          },
          comboItems: {
            include: {
              actividad: {
                select: {
                  id: true,
                  nombre: true,
                  capacidad: true,
                  horaSalida: true,
                  horarios: {
                    where: { activo: true },
                    select: { id: true, diasSemana: true, horaSalida: true, cupo: true },
                  },
                },
              },
            },
          },
        },
      })

      if (!exc || exc.variantes.length === 0) continue

      const fechaObj = new Date(`${item.fecha}T12:00:00.000Z`)
      const fechaValida = isNaN(fechaObj.getTime()) ? new Date() : fechaObj

      if (exc.tipoItem === 'COMBO' && exc.comboItems.length > 0) {
        const dispCombo = validarDisponibilidadCombo(
          fechaValida,
          item.horaSalida || null,
          item.adultos + item.ninos,
          {
            nombre: exc.nombre,
            capacidad: exc.capacidad,
            horaSalida: exc.horaSalida,
            horarios: exc.horarios.map((h) => ({
              id: h.id,
              diasSemana: Array.isArray(h.diasSemana) ? (h.diasSemana as number[]) : [],
              horaSalida: h.horaSalida,
              cupo: h.cupo,
            })),
            actividades: exc.comboItems.map((ci) => ({
              nombre: ci.actividad.nombre,
              capacidad: ci.actividad.capacidad,
              horaSalida: ci.actividad.horaSalida,
              horarios: ci.actividad.horarios.map((h) => ({
                id: h.id,
                diasSemana: Array.isArray(h.diasSemana) ? (h.diasSemana as number[]) : [],
                horaSalida: h.horaSalida,
                cupo: h.cupo,
              })),
            })),
          }
        )
        if (!dispCombo.ok) return { error: dispCombo.error }
      }

      const v = exc.variantes[0]
      const totales = calcularTotales({
        precioAdulto: v.precioAdulto.toNumber(),
        precioNino: v.precioNino ? v.precioNino.toNumber() : null,
        impuestoPct: exc.impuestoPct?.toNumber() ?? 0,
        adultos: item.adultos,
        ninos: item.ninos,
        descuento: 0,
      })

      const anio = isNaN(fechaObj.getTime())
        ? new Date().getUTCFullYear()
        : fechaObj.getUTCFullYear()
      const prefijo = exc.nombre.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, 'E') || 'EXC'
      const checkinToken = `EXC:${Math.random().toString(36).substring(2, 10).toUpperCase()}`

      const reserva = await conEmpresa(exc.companyId, async (tx) => {
        const desde = new Date(Date.UTC(anio, 0, 1))
        const hasta = new Date(Date.UTC(anio + 1, 0, 1))
        let intento =
          (await tx.reservaExc.count({
            where: { companyId: exc.companyId, fecha: { gte: desde, lt: hasta } },
          })) + 1

        for (let i = 0; i < 5; i++) {
          try {
            return await tx.reservaExc.create({
              data: {
                companyId: exc.companyId,
                numero: numeroReserva(prefijo, anio, intento),
                excursionId: exc.id,
                varianteId: v.id,
                clienteId,
                vendedorId,
                fecha: fechaValida,
                hora: item.horaSalida || null,
                adultos: item.adultos,
                ninos: item.ninos,
                moneda: exc.moneda,
                subtotal: totales.subtotal,
                descuento: totales.descuento,
                impuestos: totales.impuestos,
                total: totales.total,
                estado: esPagoOnline ? 'PAGADA' : 'PENDIENTE',
                canal: 'ONLINE',
                notas: item.notas || null,
                checkinToken: esPagoOnline ? checkinToken : null,
                pasajeros: {
                  createMany: {
                    data: [
                      ...Array.from({ length: item.adultos }, () => ({
                        companyId: exc.companyId,
                        tipo: 'ADULTO',
                      })),
                      ...Array.from({ length: item.ninos }, () => ({
                        companyId: exc.companyId,
                        tipo: 'NINO',
                      })),
                    ],
                  },
                },
              },
              select: { id: true, numero: true },
            })
          } catch (e: unknown) {
            const esUnique =
              e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2002'
            if (!esUnique || i === 4) throw e
            intento += 1
          }
        }
        throw new Error('No se pudo generar el número de reserva tras varios intentos.')
      })

      if (reserva && esPagoOnline) {
        await conEmpresa(exc.companyId, (tx) =>
          tx.reservaPago.create({
            data: {
              companyId,
              reservaId: reserva.id,
              monto: totales.total,
              moneda: exc.moneda,
              metodo: 'TARJETA_SIMULADA',
              referencia: `SIM-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
              estado: 'REGISTRADO',
            },
          })
        )
        await procesarVentaYComisionInterna(
          exc.companyId,
          reserva.id,
          user.metadata.dbUserId ?? null
        ).catch(anotarFallo('excursiones:reservarCarrito:procesarVenta'))
      }

      if (reserva && vendedorId) {
        await conEmpresa(exc.companyId, (tx) =>
          tx.vendedorAtribucion.create({
            data: {
              companyId: exc.companyId,
              vendedorId: vendedorId!,
              clienteId,
              etapa: esPagoOnline ? 'COMPRA' : 'RESERVA',
            },
          })
        ).catch(() => {})
      }

      if (reserva) nuevasReservas.push(reserva)
      await sincronizarEstadoAgotada(exc.companyId, exc.id)
    }

    revalidatePath('/cliente/mis-excursiones')
    revalidatePath('/cliente/excursiones')

    if (vendedorId) {
      try {
        const store = await cookies()
        store.delete(VENDEDOR_COOKIE)
      } catch {}
    }

    return {
      success: esPagoOnline
        ? `¡Pago procesado con éxito! Has reservado y pagado ${nuevasReservas.length} ${nuevasReservas.length === 1 ? 'excursión' : 'excursiones'}.`
        : `Has reservado exitosamente ${nuevasReservas.length} ${nuevasReservas.length === 1 ? 'excursión' : 'excursiones'}. Recuerda pagar el día del tour.`,
      redirectUrl: '/cliente/mis-excursiones',
    }
  } catch (e) {
    anotarFallo('excursiones:reservarCarrito')(e)
    return { error: 'Error al procesar el carrito. Intenta de nuevo.' }
  }
}
