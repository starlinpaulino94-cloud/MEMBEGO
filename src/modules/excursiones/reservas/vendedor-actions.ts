'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { conEmpresa } from '@/lib/tenant'
import { requireRole } from '@/lib/auth/guards'
import { vendedorDeUsuario } from '@/modules/excursiones/panel/queries'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import {
  calcularTotales,
  numeroReserva,
  validarReserva,
  validarDisponibilidad,
  validarDisponibilidadCombo,
  validarDisponibilidadComboMultiFecha,
  calcularPrecioEfectivo,
  normalizarHora,
  type ReglaPrecioDinamico,
} from './nucleo'
import { verificarYBloquearCupoActividad } from './queries'
import { sincronizarEstadoAgotada } from '../catalogo/actions'
import { ensureEmailIdentity } from '@/lib/supabase/identity'
import { createAdminClient } from '@/lib/supabase/admin'
import { correoBienvenidaClienteVendedor } from '@/lib/email/plantillas-excursiones'
import { sendEmail } from '@/lib/email'
import { randomBytes } from 'crypto'
import { generarCodigo } from '@/lib/codes'

export interface ReservaVendedorState {
  error?: string
  success?: string
  reservaId?: string
}

export async function crearReservaVendedor(
  _prev: ReservaVendedorState,
  formData: FormData
): Promise<ReservaVendedorState> {
  try {
    const user = await requireRole(['VENDEDOR'])
    if (!user || !user.metadata.dbUserId) return { error: 'No autorizado.' }

    const vendedor = await vendedorDeUsuario(user.metadata.dbUserId)
    if (!vendedor) {
      return { error: 'Tu perfil de vendedor no está disponible.' }
    }

    const companyId = vendedor.companyId
    const excursionId = String(formData.get('excursionId') ?? '')
    const varianteId = String(formData.get('varianteId') ?? '')
    const clienteNombre = String(formData.get('clienteNombre') ?? '').trim()
    const clienteEmail = String(formData.get('clienteEmail') ?? '').trim().toLowerCase()

    if (!excursionId || !varianteId) {
      return { error: 'Selecciona una excursión y una opción de tarifa.' }
    }

    if (!clienteNombre || !clienteEmail) {
      return { error: 'El nombre y el correo del cliente son requeridos.' }
    }

    const v = validarReserva({
      fecha: String(formData.get('fecha') ?? ''),
      hora: String(formData.get('hora') ?? ''),
      adultos: String(formData.get('adultos') ?? '1'),
      ninos: String(formData.get('ninos') ?? '0'),
      notas: String(formData.get('notas') ?? ''),
      voucherAgencia: String(formData.get('voucherAgencia') ?? ''),
      hotelRecogida: String(formData.get('hotelRecogida') ?? ''),
      lobbyRecogida: String(formData.get('lobbyRecogida') ?? ''),
      horaRecogida: String(formData.get('horaRecogida') ?? ''),
      habitacion: String(formData.get('habitacion') ?? ''),
    })
    if (!v.ok) return { error: v.error }

    const excursion = await conEmpresa(companyId, (tx) =>
      tx.excursion.findFirst({
        where: { id: excursionId, companyId, estado: { not: 'ARCHIVADA' } },
        select: {
          id: true,
          nombre: true,
          moneda: true,
          impuestoPct: true,
          capacidad: true,
          tipoItem: true,
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
                  tipoItem: true,
                  capacidad: true,
                  horaSalida: true,
                  duracionMin: true,
                  horaRegreso: true,
                  horarios: {
                    where: { activo: true },
                    select: { id: true, diasSemana: true, horaSalida: true, cupo: true },
                  },
                },
              },
            },
          },
          variantes: {
            where: { id: varianteId, activa: true },
            select: { id: true, precioAdulto: true, precioNino: true, precioResidente: true, precioNinoResidente: true, preciosDinamicos: true },
          },
        },
      })
    )
    if (!excursion || excursion.variantes.length === 0) {
      return { error: 'La excursión o la opción seleccionada no está disponible.' }
    }

    const comboItinerarioRaw = String(formData.get('comboItinerarioJson') ?? '')
    let comboItinerarioParsed: { actividadId: string; fecha: string; hora: string | null }[] = []
    if (comboItinerarioRaw) {
      try {
        comboItinerarioParsed = JSON.parse(comboItinerarioRaw)
      } catch {
        /* ignore */
      }
    }

    let itemsComboAGuardar: { actividadId: string; fecha: Date; hora: string | null }[] = []

    if (excursion.tipoItem === 'COMBO' && excursion.comboItems.length > 0) {
      if (comboItinerarioParsed.length > 0) {
        const itemsParaValidar = comboItinerarioParsed.map((item) => {
          const [y, m, d] = item.fecha.split('-').map(Number)
          return {
            actividadId: item.actividadId,
            fecha: new Date(Date.UTC(y, m - 1, d)),
            hora: item.hora ? normalizarHora(item.hora) : null,
          }
        })
        itemsComboAGuardar = itemsParaValidar

        const dispComboMulti = validarDisponibilidadComboMultiFecha(
          v.datos.adultos + v.datos.ninos,
          {
            nombre: excursion.nombre,
            capacidad: excursion.capacidad,
            actividades: excursion.comboItems.map((ci) => ({
              id: ci.actividad.id,
              nombre: ci.actividad.nombre,
              tipoItem: ci.actividad.tipoItem,
              capacidad: ci.actividad.capacidad,
              horaSalida: ci.actividad.horaSalida,
              duracionMin: ci.actividad.duracionMin,
              horaRegreso: ci.actividad.horaRegreso,
              horarios: ci.actividad.horarios.map((h) => ({
                id: h.id,
                diasSemana: Array.isArray(h.diasSemana) ? (h.diasSemana as number[]) : [],
                horaSalida: h.horaSalida,
                cupo: h.cupo,
              })),
              permitirSolapamiento: ci.permitirSolapamiento,
            })),
          },
          itemsParaValidar
        )
        if (!dispComboMulti.ok) return { error: dispComboMulti.error }
      } else {
        itemsComboAGuardar = excursion.comboItems.map((ci) => ({
          actividadId: ci.actividad.id,
          fecha: v.datos.fecha,
          hora: ci.actividad.tipoItem === 'PASE_DIA' ? null : ci.actividad.horaSalida || v.datos.hora,
        }))

        const dispCombo = validarDisponibilidadCombo(
          v.datos.fecha,
          v.datos.hora,
          v.datos.adultos + v.datos.ninos,
          {
            nombre: excursion.nombre,
            capacidad: excursion.capacidad,
            horaSalida: excursion.horaSalida,
            horarios: excursion.horarios.map((h) => ({
              id: h.id,
              diasSemana: Array.isArray(h.diasSemana) ? (h.diasSemana as number[]) : [],
              horaSalida: h.horaSalida,
              cupo: h.cupo,
            })),
            actividades: excursion.comboItems.map((ci) => ({
              id: ci.actividad.id,
              nombre: ci.actividad.nombre,
              tipoItem: ci.actividad.tipoItem,
              capacidad: ci.actividad.capacidad,
              horaSalida: ci.actividad.horaSalida,
              duracionMin: ci.actividad.duracionMin,
              horaRegreso: ci.actividad.horaRegreso,
              horarios: ci.actividad.horarios.map((h) => ({
                id: h.id,
                diasSemana: Array.isArray(h.diasSemana) ? (h.diasSemana as number[]) : [],
                horaSalida: h.horaSalida,
                cupo: h.cupo,
              })),
              permitirSolapamiento: ci.permitirSolapamiento,
            })),
          }
        )
        if (!dispCombo.ok) return { error: dispCombo.error }
      }
    } else {
      const disp = validarDisponibilidad(
        v.datos.fecha,
        v.datos.hora,
        v.datos.adultos + v.datos.ninos,
        {
          capacidad: excursion.capacidad,
          tipoItem: excursion.tipoItem,
          horaSalida: excursion.horaSalida,
          horarios: excursion.horarios.map((h) => ({
            id: h.id,
            diasSemana: Array.isArray(h.diasSemana) ? (h.diasSemana as number[]) : [],
            horaSalida: h.horaSalida,
            cupo: h.cupo,
          })),
        }
      )
      if (!disp.ok) return { error: disp.error }
    }

    const variante = excursion.variantes[0]
    const reglasDin = variante.preciosDinamicos
      ? (variante.preciosDinamicos as unknown as ReglaPrecioDinamico[])
      : null
    // Sin `as any`: los dos campos están en el `select` de esta consulta.
    const baseResidente = variante.precioResidente != null ? variante.precioResidente.toNumber() : null
    const baseNinoResidente =
      variante.precioNinoResidente != null ? variante.precioNinoResidente.toNumber() : null
    const { precioAdulto, precioNino } = calcularPrecioEfectivo(
      v.datos.fecha,
      v.datos.hora,
      variante.precioAdulto.toNumber(),
      variante.precioNino != null ? variante.precioNino.toNumber() : null,
      reglasDin,
      v.datos.esResidente,
      baseResidente,
      baseNinoResidente
    )

    const totales = calcularTotales({
      precioAdulto,
      precioNino,
      impuestoPct: excursion.impuestoPct?.toNumber() ?? 0,
      adultos: v.datos.adultos,
      ninos: v.datos.ninos,
      descuento: 0,
    })

    // Auto-provisión de cuenta
    const supabaseAdmin = createAdminClient()
    let targetClienteId: string

    // 1. Verificar si el usuario ya existe por email
    const userRow = await prisma.user.findUnique({ where: { email: clienteEmail } })
    
    if (userRow) {
      // Verificar si ya tiene perfil de cliente en esta empresa
      const clienteRow = await prisma.cliente.findUnique({
        where: { supabaseId_companyId: { supabaseId: userRow.supabaseId, companyId } }
      })
      
      if (clienteRow) {
        targetClienteId = clienteRow.id
      } else {
        // Crear perfil de cliente para el usuario existente
        const nuevoCliente = await conEmpresa(companyId, tx => 
          tx.cliente.create({
            data: {
              companyId,
              email: clienteEmail,
              nombre: clienteNombre,
              supabaseId: userRow!.supabaseId,
            }
          })
        )
        targetClienteId = nuevoCliente.id
      }
    } else {
      // 2. Usuario no existe, aprovisionar
      const password = randomBytes(12).toString('base64')
      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: clienteEmail,
        password: password,
        email_confirm: true,
        user_metadata: { role: 'CLIENTE', source: 'vendor_provisioning', name: clienteNombre }
      })

      if (authErr || !authData.user) {
        console.error('[excursiones] crearReservaVendedor/authErr', authErr)
        return { error: 'No se pudo aprovisionar la cuenta del cliente.' }
      }

      await ensureEmailIdentity(authData.user.id, clienteEmail)
      
      const createdUser = await prisma.user.create({
        data: {
          email: clienteEmail,
          supabaseId: authData.user.id,
          role: 'CLIENTE',
          name: clienteNombre,
        }
      })

      const nuevoCliente = await conEmpresa(companyId, tx => 
        tx.cliente.create({
          data: {
            companyId,
            email: clienteEmail,
            nombre: clienteNombre,
            supabaseId: createdUser.supabaseId,
          }
        })
      )
      targetClienteId = nuevoCliente.id

      // 3. Enviar correo de bienvenida con usuario y contraseña
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3000'
      await sendEmail({
        to: clienteEmail,
        subject: '¡Tu cuenta en MembeGo está lista!',
        companyId,
        html: correoBienvenidaClienteVendedor({
          nombre: clienteNombre,
          email: clienteEmail,
          password,
          urlLogin: `${siteUrl}/login`,
        }),
      })
    }

    // 4. Validar cupo real en BD y Crear Reserva
    const anio = v.datos.fecha.getUTCFullYear()
    const prefijo = excursion.nombre.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, 'E') || 'EXC'
    const totalPasajeros = v.datos.adultos + v.datos.ninos

    const reserva = await conEmpresa(companyId, async (tx) => {
      // Validar cupo real en BD para todas las actividades involucradas
      if (itemsComboAGuardar.length > 0) {
        for (const item of itemsComboAGuardar) {
          const cupoCheck = await verificarYBloquearCupoActividad(tx, {
            companyId,
            actividadId: item.actividadId,
            fecha: item.fecha,
            hora: item.hora,
            pasajeros: totalPasajeros,
          })
          if (!cupoCheck.ok) {
            throw new Error(cupoCheck.error)
          }
        }
      } else {
        const cupoCheck = await verificarYBloquearCupoActividad(tx, {
          companyId,
          actividadId: excursion.id,
          fecha: v.datos.fecha,
          hora: v.datos.hora,
          pasajeros: totalPasajeros,
        })
        if (!cupoCheck.ok) {
          throw new Error(cupoCheck.error)
        }
      }

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
              numero: numeroReserva(prefijo, anio, intento),
              clienteId: targetClienteId,
              vendedorId: vendedor.id,
              excursionId,
              varianteId,
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
              canal: 'VENDEDOR',
              notas: v.datos.notas,
              esResidente: v.datos.esResidente,
              voucherAgencia: v.datos.voucherAgencia,
              hotelRecogida: v.datos.hotelRecogida,
              lobbyRecogida: v.datos.lobbyRecogida,
              horaRecogida: v.datos.horaRecogida,
              habitacion: v.datos.habitacion,
              creadaPorId: user.metadata.dbUserId ?? null,
              checkinToken: generarCodigo(24),
              pasajeros: {
                createMany: {
                  data: [
                    ...Array.from({ length: v.datos.adultos }, () => ({ companyId, tipo: 'ADULTO' })),
                    ...Array.from({ length: v.datos.ninos }, () => ({ companyId, tipo: 'NINO' })),
                  ],
                },
              },
              ...(itemsComboAGuardar.length > 0
                ? {
                    items: {
                      create: itemsComboAGuardar.map((it) => ({
                        companyId,
                        actividadId: it.actividadId,
                        fecha: it.fecha,
                        hora: it.hora,
                        adultos: v.datos.adultos,
                        ninos: v.datos.ninos,
                        estado: 'PENDIENTE',
                      })),
                    },
                  }
                : {}),
            },
            select: { id: true, numero: true },
          })
        } catch (e) {
          const esUnique = e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2002'
          if (!esUnique || i === 4) throw e
          intento += 1
        }
      }
      throw new Error('sin_numero')
    })

    // 5. Atribución
    await conEmpresa(companyId, (tx) =>
      tx.vendedorAtribucion.create({
        data: {
          companyId,
          vendedorId: vendedor.id,
          clienteId: targetClienteId,
          etapa: 'RESERVA',
        },
      })
    ).catch(anotarFallo('excursiones:crearReservaVendedor:atribucion'))

    // 6. Auditoría y sincronización
    const meta = await getRequestMeta()
    await conEmpresa(companyId, (tx) =>
      tx.auditLog.create({
        data: {
          companyId,
          userId: user.metadata.dbUserId,
          accion: 'NOTA_INTERNA',
          entidadTipo: 'ReservaExc',
          entidadId: reserva.id,
          payload: { tipo: 'RESERVA_CREADA_POR_VENDEDOR', vendedorId: vendedor.id },
          ...meta,
        },
      })
    ).catch(anotarFallo('excursiones:crearReservaVendedor:auditLog'))

    await sincronizarEstadoAgotada(companyId, excursionId)
    for (const item of itemsComboAGuardar) {
      await sincronizarEstadoAgotada(companyId, item.actividadId)
    }

    revalidatePath('/vendedor/reservas')

    return { success: `Reserva ${reserva.numero} creada exitosamente.`, reservaId: reserva.id }
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Ocurrió un error inesperado al procesar la reserva.'
    anotarFallo('excursiones:crearReservaVendedor')(e)
    return { error: errorMsg }
  }
}
