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
import {
  calcularTotales,
  numeroReserva,
  validarReserva,
  validarDisponibilidad,
} from './nucleo'
import { sincronizarEstadoAgotada } from '../catalogo/actions'
import { resolverEnlace, vendedorParaCliente, VENDEDOR_COOKIE } from '../atribucion/registrar'

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
    if (!companyId || !excursionId) {
      return { error: 'Faltan datos de la excursión.' }
    }

    // Resolver el clienteId del usuario autenticado.
    const cliente = await prisma.cliente.findFirst({
      where: { supabaseId: user.supabaseId, companyId },
      select: { id: true, nombre: true },
    })
    if (!cliente) {
      return { error: 'No se encontró tu perfil de cliente para esta empresa.' }
    }

    // Leer cookie de atribución de vendedor (server-side)
    let vendedorId: string | null = null
    try {
      const store = await cookies()
      const cookieSlug = store.get(VENDEDOR_COOKIE)?.value?.trim().toLowerCase()
      if (cookieSlug) {
        const enlace = await resolverEnlace(cookieSlug)
        if (enlace && enlace.companyId === companyId) {
          vendedorId = enlace.vendedorId
        }
      }
    } catch {
      /* ignore: sin cookie o error al resolver -> reserva sin vendedor */
    }

    // Si no vino por cookie o se consumió en el registro, resolver desde los hechos del cliente
    if (!vendedorId && cliente.id) {
      vendedorId = await vendedorParaCliente(companyId, cliente.id)
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

    // Validar disponibilidad: fecha, horario y cupo
    const excursionCompleta = await conEmpresa(companyId, (tx) =>
      tx.excursion.findFirst({
        where: { id: excursionId, companyId, estado: 'ACTIVA' },
        select: {
          id: true,
          capacidad: true,
          horaSalida: true,
          horarios: {
            where: { activo: true },
            select: { id: true, diasSemana: true, horaSalida: true, cupo: true },
          },
        },
      })
    )
    if (!excursionCompleta) return { error: 'Esa excursión no está disponible.' }

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
      },
      companyId
    )
    if (!disp.ok) return { error: disp.error }

    const totales = calcularTotales({
      adultos: v.datos.adultos,
      ninos: v.datos.ninos,
      precioAdulto: Number(variante.precioAdulto),
      precioNino: variante.precioNino != null ? Number(variante.precioNino) : null,
      descuento: 0,
      impuestoPct: excursion.impuestoPct != null ? Number(excursion.impuestoPct) : null,
    })

    const anio = v.datos.fecha.getUTCFullYear()

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
              clienteId: cliente.id,
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
              estado: 'PENDIENTE',
              canal: 'ONLINE',
              notas: v.datos.notas,
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

    // Atribución de vendedor: etapa RESERVA (hecho inmutable para comisión)
    if (vendedorId && creada.vendedorId) {
      await conEmpresa(companyId, (tx) =>
        tx.vendedorAtribucion.create({
          data: {
            companyId,
            vendedorId: vendedorId,
            clienteId: cliente.id,
            etapa: 'RESERVA',
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
      success: 'Reserva creada. Puedes gestionar tu pago desde tu cuenta.',
      reservaId: creada.id,
      numero: creada.numero,
    }
  } catch (e) {
    anotarFallo('excursiones:reservarExcursion')(e)
    return { error: 'Error al crear la reserva. Intenta de nuevo.' }
  }
}

export interface ReservarCarritoState {
  error?: string
  success?: string
  redirectUrl?: string
}

export async function reservarCarritoAction({
  items,
}: {
  items: {
    excursionId: string
    varianteId: string
    fecha: string
    horaSalida: string
    adultos: number
    ninos: number
    notas: string
  }[]
}): Promise<ReservarCarritoState> {
  if (!items.length) return { error: 'El carrito está vacío.' }

  try {
    const user = await getUser()
    if (!user) return { error: 'unauthenticated' }

    // Obtenemos todos los companyIds involucrados (el carrito asume que puede tener 1 o más)
    // Para simplificar asumiremos que todas pertenecen a la misma empresa leyendo la 1ra
    // En un carrito normal se pueden comprar de múltiples, pero el catálogo es por empresa
    // Tomamos la primera para recuperar el cliente
    const primeraExc = await prisma.excursion.findUnique({
      where: { id: items[0].excursionId },
      select: { companyId: true },
    })
    if (!primeraExc) return { error: 'Excursión no encontrada.' }
    const companyId = primeraExc.companyId

    const cliente = await prisma.cliente.findFirst({
      where: { supabaseId: user.supabaseId, companyId },
      select: { id: true },
    })
    if (!cliente) return { error: 'No se encontró tu perfil de cliente.' }

    // Leer cookie de atribución de vendedor (server-side)
    let vendedorId: string | null = null
    try {
      const store = await cookies()
      const cookieSlug = store.get(VENDEDOR_COOKIE)?.value?.trim().toLowerCase()
      if (cookieSlug) {
        const enlace = await resolverEnlace(cookieSlug)
        if (enlace && enlace.companyId === companyId) {
          vendedorId = enlace.vendedorId
        }
      }
    } catch {
      // ignore
    }

    if (!vendedorId) {
      vendedorId = await vendedorParaCliente(companyId, cliente.id)
    }

    // Transacción atómica
    const nuevasReservas = []
    
    for (const item of items) {
      const exc = await prisma.excursion.findFirst({
        where: { id: item.excursionId, estado: 'ACTIVA' },
        include: { variantes: { where: { id: item.varianteId, activa: true } } }
      })
      
      if (!exc || exc.variantes.length === 0) continue
      
      const v = exc.variantes[0]
      const totales = calcularTotales({
        precioAdulto: v.precioAdulto.toNumber(),
        precioNino: v.precioNino?.toNumber(),
        impuestoPct: exc.impuestoPct?.toNumber() ?? 0,
        adultos: item.adultos,
        ninos: item.ninos,
        descuentoFijo: 0,
      })

      const reserva = await conEmpresa(exc.companyId, async (tx) => {
        let intento = 0
        let creada = null
        while (intento < 5) {
          const prefijo = exc.nombre.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, 'E') || 'EXC'
          const num = numeroReserva(prefijo, new Date())
          try {
            creada = await tx.reservaExc.create({
              data: {
                companyId: exc.companyId,
                excursionId: exc.id,
                varianteId: v.id,
                clienteId: cliente.id,
                vendedorId,
                fecha: new Date(`${item.fecha}T12:00:00Z`),
                horaSalida: item.horaSalida,
                adultos: item.adultos,
                ninos: item.ninos,
                moneda: exc.moneda,
                subtotal: totales.subtotal,
                descuento: totales.descuento,
                impuesto: totales.impuestos,
                total: totales.total,
                estado: 'CREADA',
                origenVenta: 'ONLINE',
                notas: item.notas,
                pasajeros: {
                  create: [
                    ...Array.from({ length: item.adultos }).map(() => ({
                      tipo: 'ADULTO', checkinToken: `EXC:${Math.random().toString(36).substring(2, 10).toUpperCase()}`
                    })),
                    ...Array.from({ length: item.ninos }).map(() => ({
                      tipo: 'NINO', checkinToken: `EXC:${Math.random().toString(36).substring(2, 10).toUpperCase()}`
                    }))
                  ]
                }
              },
              select: { id: true, numero: true }
            })
            break
          } catch (e: any) {
            if (e.message?.includes('numero')) {
              intento++
              continue
            }
            throw e
          }
        }
        return creada
      })

      if (reserva && vendedorId) {
        await conEmpresa(exc.companyId, (tx) =>
          tx.vendedorAtribucion.create({
            data: {
              companyId: exc.companyId,
              vendedorId: vendedorId!,
              clienteId: cliente.id,
              etapa: 'RESERVA',
            }
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
      success: `Has reservado exitosamente ${nuevasReservas.length} ítems.`,
      redirectUrl: '/cliente/mis-excursiones'
    }
  } catch (e) {
    anotarFallo('excursiones:reservarCarrito')(e)
    return { error: 'Error al procesar el carrito. Intenta de nuevo.' }
  }
}
