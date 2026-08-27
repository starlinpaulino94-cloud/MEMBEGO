'use server'

/**
 * EXCURSIONES · Reservas — acciones.
 *
 * Tres decisiones que gobiernan este archivo:
 *
 * 1. EL PRECIO LO PONE EL SERVIDOR. El formulario dice a quién, cuándo y
 *    cuántos; los precios se leen del catálogo aquí y se CONGELAN en la
 *    reserva. Si mañana sube la excursión, esta reserva sigue valiendo lo que
 *    valía (§57).
 * 2. EL VENDEDOR SE CONGELA AL RESERVAR. Se resuelve con la política de la
 *    empresa sobre los hechos de atribución y se guarda en la reserva. Cambiar
 *    la política después no reescribe reservas viejas (§12).
 * 3. NADA SE BORRA. Un pago se anula con un movimiento nuevo; una reserva se
 *    cancela, no desaparece (§99).
 */

import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import { generarCodigo } from '@/lib/codes'
import {
  resolverVendedorAtribuido,
  politicaValida,
  VENTANA_ATRIBUCION_DIAS,
} from '@/modules/excursiones/atribucion/nucleo'
import { procesarVentaYComisionInterna } from '../ventas/actions'
import { prisma } from '@/lib/prisma'
import { ensureEmailIdentity } from '@/lib/supabase/identity'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { randomBytes } from 'crypto'
import {
  ESTADOS_RESERVA,
  ESTADOS_CERRADOS,
  calcularTotales,
  calcularSaldo,
  estadoPorPagos,
  numeroReserva,
  validarReserva,
  validarPago,
  validarDisponibilidad,
  validarDisponibilidadCombo,
  validarDisponibilidadComboMultiFecha,
  calcularPrecioEfectivo,
  normalizarHora,
  type EstadoReserva,
} from './nucleo'
import { verificarYBloquearCupoActividad } from './queries'
import { sincronizarEstadoAgotada } from '../catalogo/actions'

export interface ReservaActionState {
  error?: string
  success?: string
  creada?: { reservaId: string; numero: string; total: string }
}

async function auditar(
  companyId: string,
  userId: string | null,
  entidadId: string,
  payload: Record<string, unknown>
) {
  const meta = await getRequestMeta()
  await conEmpresa(companyId, (tx) =>
    tx.auditLog.create({
      data: {
        companyId,
        userId,
        accion: 'NOTA_INTERNA',
        entidadTipo: 'ReservaExc',
        entidadId,
        payload: payload as Prisma.InputJsonObject,
        ...meta,
      },
    })
  ).catch(anotarFallo('excursiones:reservas:auditLog'))
}

/**
 * A quién le toca esta reserva: se leen los hechos de atribución del cliente
 * y se aplica la política de la empresa. Sin hechos vivos no hay vendedor —
 * es una venta directa, y eso es un resultado legítimo, no un error (§98).
 */
async function vendedorParaCliente(companyId: string, clienteId: string): Promise<string | null> {
  try {
    const config = await conEmpresa(companyId, (tx) =>
      tx.excursionesConfig.findUnique({
        where: { companyId },
        select: { politicaAtribucion: true, ventanaAtribucionDias: true },
      })
    )
    const hechos = await conEmpresa(companyId, (tx) =>
      tx.vendedorAtribucion.findMany({
        where: { companyId, clienteId },
        select: { vendedorId: true, etapa: true, createdAt: true },
      })
    )
    return resolverVendedorAtribuido(hechos, {
      politica: politicaValida(config?.politicaAtribucion),
      ventanaDias: config?.ventanaAtribucionDias ?? VENTANA_ATRIBUCION_DIAS,
    })
  } catch (e) {
    console.error('[excursiones] vendedorParaCliente:', e)
    return null
  }
}

/** ADMIN · Crear la reserva con sus pasajeros y su número correlativo. */
export async function crearReserva(
  _prev: ReservaActionState,
  formData: FormData
): Promise<ReservaActionState> {
  try {
    const user = await requireSection('excursiones', 'reserva_crear')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }

    const clienteIdInput = String(formData.get('clienteId') ?? '').trim()
    const clienteNombre = String(formData.get('clienteNombre') ?? '').trim()
    const clienteEmail = String(formData.get('clienteEmail') ?? '').trim().toLowerCase()
    const clienteTelefono = String(formData.get('clienteTelefono') ?? '').trim()
    const excursionId = String(formData.get('excursionId') ?? '').trim()
    const varianteId = String(formData.get('varianteId') ?? '').trim()
    const vendedorIdInput = String(formData.get('vendedorId') ?? '').trim()

    if (!excursionId || !varianteId) {
      return { error: 'Selecciona la excursión y una opción de tarifa.' }
    }

    const v = validarReserva({
      fecha: String(formData.get('fecha') ?? ''),
      hora: String(formData.get('hora') ?? ''),
      adultos: String(formData.get('adultos') ?? '1'),
      ninos: String(formData.get('ninos') ?? '0'),
      descuento: String(formData.get('descuento') ?? '0'),
      notas: String(formData.get('notas') ?? ''),
      canal: String(formData.get('canal') ?? 'ADMIN'),
      voucherAgencia: String(formData.get('voucherAgencia') ?? ''),
      hotelRecogida: String(formData.get('hotelRecogida') ?? ''),
      lobbyRecogida: String(formData.get('lobbyRecogida') ?? ''),
      horaRecogida: String(formData.get('horaRecogida') ?? ''),
      habitacion: String(formData.get('habitacion') ?? ''),
    })
    if (!v.ok) return { error: v.error }

    // =========================================================================
    // RESOLUCIÓN / APROVISIONAMIENTO DEL CLIENTE
    // =========================================================================
    let targetClienteId: string

    if (clienteIdInput) {
      // 1. Cliente existente seleccionado en la empresa
      const clienteExistente = await conEmpresa(companyId, (tx) =>
        tx.cliente.findFirst({
          where: { id: clienteIdInput, companyId },
          select: { id: true, nombre: true, email: true },
        })
      )
      if (!clienteExistente) {
        return { error: 'El cliente seleccionado no existe en tu empresa.' }
      }
      targetClienteId = clienteExistente.id
    } else if (clienteEmail) {
      if (!clienteNombre) {
        return { error: 'El nombre del cliente es obligatorio cuando se ingresa un correo.' }
      }

      // 2. Verificar si el usuario ya existe globalmente en la plataforma
      const userRow = await prisma.user.findUnique({
        where: { email: clienteEmail },
      })

      if (userRow) {
        // El usuario ya existe en MembeGo. Verificar si ya es cliente de esta empresa
        const clienteDeEstaEmpresa = await conEmpresa(companyId, (tx) =>
          tx.cliente.findFirst({
            where: {
              companyId,
              OR: [
                { supabaseId: userRow.supabaseId },
                { email: clienteEmail },
              ],
            },
            select: { id: true },
          })
        )

        if (clienteDeEstaEmpresa) {
          targetClienteId = clienteDeEstaEmpresa.id
        } else {
          // El cliente existe pero NO es cliente de este negocio: crear su perfil en esta empresa
          const nuevoClienteEmpresa = await conEmpresa(companyId, (tx) =>
            tx.cliente.create({
              data: {
                companyId,
                email: clienteEmail,
                nombre: clienteNombre || userRow.name || 'Cliente',
                telefono: clienteTelefono || null,
                supabaseId: userRow.supabaseId,
              },
              select: { id: true },
            })
          )
          targetClienteId = nuevoClienteEmpresa.id
        }
      } else {
        // El usuario NO existe en toda la plataforma: auto-aprovisionar cuenta
        const supabaseAdmin = createAdminClient()
        const password = randomBytes(12).toString('base64')
        const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
          email: clienteEmail,
          password,
          email_confirm: true,
          user_metadata: { role: 'CLIENTE', source: 'admin_reservation_provisioning', name: clienteNombre },
        })

        if (authErr || !authData.user) {
          console.error('[excursiones] crearReserva/authErr', authErr)
          return { error: `No se pudo aprovisionar la cuenta del cliente: ${authErr?.message ?? 'error desconocido'}` }
        }

        await ensureEmailIdentity(authData.user.id, clienteEmail)

        const createdUser = await prisma.user.create({
          data: {
            email: clienteEmail,
            supabaseId: authData.user.id,
            role: 'CLIENTE',
            name: clienteNombre,
          },
        })

        const nuevoCliente = await conEmpresa(companyId, (tx) =>
          tx.cliente.create({
            data: {
              companyId,
              email: clienteEmail,
              nombre: clienteNombre,
              telefono: clienteTelefono || null,
              supabaseId: createdUser.supabaseId,
            },
            select: { id: true },
          })
        )
        targetClienteId = nuevoCliente.id

        // Enviar correo de bienvenida con credenciales
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3000'
        await sendEmail({
          to: clienteEmail,
          subject: '¡Tu cuenta en MembeGo está lista!',
          companyId,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>¡Hola ${clienteNombre}!</h2>
              <p>Se ha creado tu cuenta para que puedas gestionar tus reservas y acceder a tu pase digital.</p>
              <div style="background-color: #f4f4f5; padding: 16px; border-radius: 8px; margin: 24px 0;">
                <p style="margin: 0 0 8px 0;"><strong>Usuario:</strong> ${clienteEmail}</p>
                <p style="margin: 0;"><strong>Contraseña:</strong> ${password}</p>
              </div>
              <p>
                <a href="${siteUrl}/login" style="display: inline-block; background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                  Iniciar Sesión
                </a>
              </p>
              <p style="color: #666; font-size: 14px; margin-top: 24px;">
                Te recomendamos cambiar tu contraseña una vez hayas iniciado sesión por primera vez.
              </p>
            </div>
          `,
        }).catch((e) => console.error('[excursiones] Error enviando email de bienvenida en crearReserva:', e))
      }
    } else {
      return { error: 'Selecciona un cliente existente o ingresa el nombre y correo del nuevo cliente.' }
    }

    // =========================================================================
    // CONSULTA Y VALIDACIÓN DE CATÁLOGO & PRECIOS
    // =========================================================================
    const excursion = await conEmpresa(companyId, (tx) =>
      tx.excursion.findFirst({
        where: { id: excursionId, companyId },
        select: {
          id: true,
          nombre: true,
          moneda: true,
          tipoItem: true,
          capacidad: true,
          horaSalida: true,
          impuestoPct: true,
          estado: true,
          horarios: {
            where: { activo: true },
            select: { id: true, diasSemana: true, horaSalida: true, cupo: true },
          },
          variantes: {
            where: { id: varianteId, activa: true },
            select: { id: true, nombre: true, precioAdulto: true, precioNino: true, preciosDinamicos: true },
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
        },
      })
    )
    if (!excursion) return { error: 'Esa excursión no existe en tu empresa.' }
    if (excursion.estado === 'ARCHIVADA') {
      return { error: 'Esa excursión está archivada: no se puede reservar.' }
    }
    const variante = excursion.variantes[0]
    if (!variante) return { error: 'Esa excursión no tiene variantes activas con precio.' }

    // Calcular precio efectivo con reglas dinámicas
    const reglasDin = variante.preciosDinamicos ? (variante.preciosDinamicos as any[]) : null
    const baseAdulto = Number(variante.precioAdulto)
    const baseNino = variante.precioNino != null ? Number(variante.precioNino) : null
    const { precioAdulto, precioNino } = calcularPrecioEfectivo(
      v.datos.fecha,
      v.datos.hora,
      baseAdulto,
      baseNino,
      reglasDin
    )

    const totales = calcularTotales({
      adultos: v.datos.adultos,
      ninos: v.datos.ninos,
      precioAdulto,
      precioNino,
      descuento: v.datos.descuento,
      impuestoPct: excursion.impuestoPct != null ? Number(excursion.impuestoPct) : null,
    })

    // =========================================================================
    // COMBOS / PAQUETES: PARSING & VALIDACIÓN DE ITINERARIO
    // =========================================================================
    const comboItinerarioRaw = String(formData.get('comboItinerarioJson') ?? '')
    let comboItinerarioParsed: { actividadId: string; fecha: string; hora: string | null }[] = []
    if (comboItinerarioRaw) {
      try {
        const parsed = JSON.parse(comboItinerarioRaw)
        if (Array.isArray(parsed)) {
          comboItinerarioParsed = parsed
        }
      } catch {
        /* ignore */
      }
    }

    let itemsComboAGuardar: { actividadId: string; fecha: Date; hora: string | null }[] = []
    const totalPasajeros = v.datos.adultos + v.datos.ninos

    if (excursion.tipoItem === 'COMBO' && excursion.comboItems.length > 0) {
      if (comboItinerarioParsed.length > 0) {
        itemsComboAGuardar = comboItinerarioParsed.map((it) => {
          const [y, m, d] = String(it.fecha).split('-').map(Number)
          return {
            actividadId: it.actividadId,
            fecha: new Date(Date.UTC(y, m - 1, d)),
            hora: it.hora ? normalizarHora(it.hora) : null,
          }
        })

        const dispComboMulti = validarDisponibilidadComboMultiFecha(
          totalPasajeros,
          {
            nombre: excursion.nombre,
            capacidad: excursion.capacidad,
            actividades: excursion.comboItems.map((ci) => ({
              id: ci.actividad.id,
              nombre: ci.actividad.nombre,
              tipoItem: ci.actividad.tipoItem,
              capacidad: ci.actividad.capacidad,
              horaSalida: ci.actividad.horaSalida,
              duracionMin: ci.actividad.duracionMin || 120,
              horarios: ci.actividad.horarios.map((h) => ({
                id: h.id,
                diasSemana: Array.isArray(h.diasSemana) ? (h.diasSemana as number[]) : [],
                horaSalida: h.horaSalida,
                cupo: h.cupo,
              })),
              permitirSolapamiento: ci.permitirSolapamiento,
            })),
          },
          itemsComboAGuardar
        )
        if (!dispComboMulti.ok) return { error: dispComboMulti.error }
      } else {
        // Mismo día por defecto
        itemsComboAGuardar = excursion.comboItems.map((ci) => ({
          actividadId: ci.actividad.id,
          fecha: v.datos.fecha,
          hora: ci.actividad.tipoItem === 'PASE_DIA' ? null : ci.actividad.horaSalida || v.datos.hora,
        }))

        const dispCombo = validarDisponibilidadCombo(
          v.datos.fecha,
          v.datos.hora,
          totalPasajeros,
          {
            nombre: excursion.nombre,
            capacidad: excursion.capacidad,
            actividades: excursion.comboItems.map((ci) => ({
              id: ci.actividad.id,
              nombre: ci.actividad.nombre,
              tipoItem: ci.actividad.tipoItem,
              capacidad: ci.actividad.capacidad,
              horaSalida: ci.actividad.tipoItem === 'PASE_DIA' ? null : ci.actividad.horaSalida || v.datos.hora,
              duracionMin: ci.actividad.duracionMin || 120,
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
        totalPasajeros,
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

    // =========================================================================
    // VENDEDOR ATRIBUIDO O MANUAL
    // =========================================================================
    let vendedorId: string | null = null
    if (vendedorIdInput) {
      const vActivo = await conEmpresa(companyId, (tx) =>
        tx.vendedor.findFirst({
          where: { id: vendedorIdInput, companyId, estado: 'ACTIVO' },
          select: { id: true },
        })
      )
      vendedorId = vActivo ? vActivo.id : null
    } else {
      vendedorId = await vendedorParaCliente(companyId, targetClienteId)
    }

    const anio = v.datos.fecha.getUTCFullYear()

    // =========================================================================
    // CREACIÓN TRANSACCIONAL DE RESERVA & VERIFICACIÓN DE CUPO EN BD
    // =========================================================================
    const creada = await conEmpresa(companyId, async (tx) => {
      // Validar cupo real en BD
      if (itemsComboAGuardar.length > 0) {
        for (const it of itemsComboAGuardar) {
          const cupoCheck = await verificarYBloquearCupoActividad(tx, {
            companyId,
            actividadId: it.actividadId,
            fecha: it.fecha,
            hora: it.hora,
            pasajeros: totalPasajeros,
          })
          if (!cupoCheck.ok) throw new Error(cupoCheck.error)
        }
      } else {
        const cupoCheck = await verificarYBloquearCupoActividad(tx, {
          companyId,
          actividadId: excursion.id,
          fecha: v.datos.fecha,
          hora: v.datos.hora,
          pasajeros: totalPasajeros,
        })
        if (!cupoCheck.ok) throw new Error(cupoCheck.error)
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
              numero: numeroReserva('EXC', anio, intento),
              clienteId: targetClienteId,
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
              canal: v.datos.canal,
              notas: v.datos.notas,
              voucherAgencia: v.datos.voucherAgencia || null,
              hotelRecogida: v.datos.hotelRecogida || null,
              lobbyRecogida: v.datos.lobbyRecogida || null,
              horaRecogida: v.datos.horaRecogida || null,
              habitacion: v.datos.habitacion || null,
              creadaPorId: user.metadata.dbUserId ?? null,
              checkinToken: generarCodigo(24),
              pasajeros: {
                create: [
                  ...Array.from({ length: v.datos.adultos }, () => ({ companyId, tipo: 'ADULTO' })),
                  ...Array.from({ length: v.datos.ninos }, () => ({ companyId, tipo: 'NINO' })),
                ],
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
            select: { id: true, numero: true, total: true },
          })
        } catch (e) {
          const esUnique = e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2002'
          if (!esUnique || i === 4) throw e
          intento += 1
        }
      }
      throw new Error('sin_numero')
    })

    // Registrar atribución si aplica
    if (vendedorId) {
      await conEmpresa(companyId, (tx) =>
        tx.vendedorAtribucion.create({
          data: { companyId, vendedorId, clienteId: targetClienteId, etapa: 'RESERVA' },
        })
      ).catch(anotarFallo('excursiones:reservas:atribucion'))
    }

    await auditar(companyId, user.metadata.dbUserId ?? null, creada.id, {
      tipo: 'RESERVA_CREADA',
      numero: creada.numero,
      total: String(creada.total),
      excursion: excursion.nombre,
      vendedorId,
      clienteId: targetClienteId,
    })

    await sincronizarEstadoAgotada(companyId, excursionId)
    for (const it of itemsComboAGuardar) {
      await sincronizarEstadoAgotada(companyId, it.actividadId)
    }

    revalidatePath('/admin/excursiones/reservas')
    return {
      success: `Reserva ${creada.numero} creada exitosamente.`,
      creada: { reservaId: creada.id, numero: creada.numero, total: String(creada.total) },
    }
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'No se pudo crear la reserva. Intenta de nuevo.'
    console.error('[excursiones] crearReserva:', e)
    return { error: errorMsg }
  }
}

/** Recalcula el estado desde los pagos vivos. Devuelve el estado resultante. */
async function refrescarEstadoPorPagos(
  companyId: string,
  reservaId: string
): Promise<EstadoReserva | null> {
  const reserva = await conEmpresa(companyId, (tx) =>
    tx.reservaExc.findFirst({
      where: { id: reservaId, companyId },
      select: {
        estado: true,
        total: true,
        pagos: { select: { monto: true, estado: true } },
      },
    })
  )
  if (!reserva) return null
  const total = Number(reserva.total)
  const { pagado } = calcularSaldo(
    total,
    reserva.pagos.map((p) => ({ monto: Number(p.monto), estado: p.estado }))
  )
  const nuevo = estadoPorPagos(reserva.estado as EstadoReserva, total, pagado)
  if (nuevo !== reserva.estado) {
    await conEmpresa(companyId, (tx) =>
      tx.reservaExc.updateMany({ where: { id: reservaId, companyId }, data: { estado: nuevo } })
    )
  }
  return nuevo
}

/** ADMIN · Registrar un abono o el pago completo. */
export async function registrarPago(
  _prev: ReservaActionState,
  formData: FormData
): Promise<ReservaActionState> {
  try {
    const user = await requireSection('excursiones', 'reserva_pago')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const reservaId = String(formData.get('reservaId') ?? '')

    const reserva = await conEmpresa(companyId, (tx) =>
      tx.reservaExc.findFirst({
        where: { id: reservaId, companyId },
        select: {
          id: true,
          estado: true,
          total: true,
          moneda: true,
          pagos: { select: { monto: true, estado: true } },
        },
      })
    )
    if (!reserva) return { error: 'Reserva no encontrada.' }
    if (ESTADOS_CERRADOS.includes(reserva.estado as EstadoReserva)) {
      return { error: 'Esta reserva está cerrada: no admite pagos.' }
    }

    // El saldo se calcula AQUÍ, con los pagos vivos de la base. Lo que la
    // pantalla creyera que faltaba no decide nada.
    const { saldo } = calcularSaldo(
      Number(reserva.total),
      reserva.pagos.map((p) => ({ monto: Number(p.monto), estado: p.estado }))
    )
    const v = validarPago(
      {
        monto: String(formData.get('monto') ?? ''),
        metodo: String(formData.get('metodo') ?? ''),
        referencia: String(formData.get('referencia') ?? ''),
        notas: String(formData.get('notas') ?? ''),
      },
      saldo
    )
    if (!v.ok) return { error: v.error }

    await conEmpresa(companyId, (tx) =>
      tx.reservaPago.create({
        data: {
          companyId,
          reservaId: reserva.id,
          monto: v.datos.monto,
          moneda: reserva.moneda,
          metodo: v.datos.metodo,
          referencia: v.datos.referencia,
          notas: v.datos.notas,
          confirmadoPorId: user.metadata.dbUserId ?? null,
        },
      })
    )
    const estado = await refrescarEstadoPorPagos(companyId, reserva.id)

    // Si la reserva quedó saldada por completo, auto-confirmar la venta y generar la comisión del vendedor
    if (estado === 'PAGADA') {
      await procesarVentaYComisionInterna(
        companyId,
        reserva.id,
        user.metadata.dbUserId ?? null
      ).catch(anotarFallo('excursiones:reservas:autoVentaComision'))
    }

    await auditar(companyId, user.metadata.dbUserId ?? null, reserva.id, {
      tipo: 'RESERVA_PAGO',
      monto: v.datos.monto,
      metodo: v.datos.metodo,
      estado,
    })
    revalidatePath(`/admin/excursiones/reservas/${reserva.id}`)
    revalidatePath('/admin/excursiones/reservas')
    revalidatePath('/vendedor/comisiones')
    return { success: 'Pago registrado.' }
  } catch (e) {
    console.error('[excursiones] registrarPago:', e)
    return { error: 'No se pudo registrar el pago.' }
  }
}

/**
 * ADMIN · Anular un pago mal registrado. El movimiento se marca ANULADO y se
 * queda a la vista: la trazabilidad del dinero no admite borrar (§99).
 */
export async function anularPago(
  _prev: ReservaActionState,
  formData: FormData
): Promise<ReservaActionState> {
  try {
    const user = await requireSection('excursiones', 'reserva_anular_pago')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const pagoId = String(formData.get('pagoId') ?? '')
    const motivo = String(formData.get('motivo') ?? '').trim().slice(0, 300)
    if (!motivo) return { error: 'Escribe por qué se anula el pago.' }

    const pago = await conEmpresa(companyId, (tx) =>
      tx.reservaPago.findFirst({
        where: { id: pagoId, companyId },
        select: { id: true, reservaId: true, monto: true, estado: true, notas: true },
      })
    )
    if (!pago) return { error: 'Pago no encontrado.' }
    if (pago.estado === 'ANULADO') return { error: 'Ese pago ya estaba anulado.' }

    await conEmpresa(companyId, (tx) =>
      tx.reservaPago.updateMany({
        where: { id: pago.id, companyId },
        data: {
          estado: 'ANULADO',
          notas: [pago.notas, `Anulado: ${motivo}`].filter(Boolean).join('\n'),
        },
      })
    )
    const estado = await refrescarEstadoPorPagos(companyId, pago.reservaId)

    await auditar(companyId, user.metadata.dbUserId ?? null, pago.reservaId, {
      tipo: 'RESERVA_PAGO_ANULADO',
      pagoId: pago.id,
      monto: String(pago.monto),
      motivo,
      estado,
    })
    revalidatePath(`/admin/excursiones/reservas/${pago.reservaId}`)
    return { success: 'Pago anulado.' }
  } catch (e) {
    console.error('[excursiones] anularPago:', e)
    return { error: 'No se pudo anular el pago.' }
  }
}

/**
 * ADMIN · Mover la reserva a mano: confirmar, completar, cancelar o marcar que
 * no se presentó. Cancelar exige motivo — es el estado que después explica un
 * reembolso o una comisión que no se paga.
 */
export async function cambiarEstadoReserva(
  _prev: ReservaActionState,
  formData: FormData
): Promise<ReservaActionState> {
  try {
    const estado = String(formData.get('estado') ?? '') as EstadoReserva
    if (!(ESTADOS_RESERVA as readonly string[]).includes(estado)) {
      return { error: 'Estado no reconocido.' }
    }
    const esCancelacion = estado === 'CANCELADA'
    const user = await requireSection(
      'excursiones',
      esCancelacion ? 'reserva_cancelar' : 'reserva_editar'
    )
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }
    const reservaId = String(formData.get('reservaId') ?? '')
    const motivo = String(formData.get('motivo') ?? '').trim().slice(0, 300)
    if (esCancelacion && !motivo) return { error: 'Escribe el motivo de la cancelación.' }

    const reserva = await conEmpresa(companyId, (tx) =>
      tx.reservaExc.findFirst({
        where: { id: reservaId, companyId },
        select: { id: true, estado: true, notas: true },
      })
    )
    if (!reserva) return { error: 'Reserva no encontrada.' }
    if (ESTADOS_CERRADOS.includes(reserva.estado as EstadoReserva) && reserva.estado !== estado) {
      return {
        error: 'Esta reserva ya está cerrada. Su histórico no se reescribe; registra una nueva.',
      }
    }

    await conEmpresa(companyId, (tx) =>
      tx.reservaExc.updateMany({
        where: { id: reserva.id, companyId },
        data: {
          estado,
          ...(motivo
            ? { notas: `${reserva.notas ? `${reserva.notas}\n` : ''}[${estado}] ${motivo}` }
            : {}),
        },
      })
    )

    await auditar(companyId, user.metadata.dbUserId ?? null, reserva.id, {
      tipo: 'RESERVA_ESTADO',
      desde: reserva.estado,
      hacia: estado,
      ...(motivo ? { motivo } : {}),
    })
    revalidatePath(`/admin/excursiones/reservas/${reserva.id}`)
    revalidatePath('/admin/excursiones/reservas')
    return { success: `Reserva ${estado.toLowerCase().replace('_', ' ')}.` }
  } catch (e) {
    console.error('[excursiones] cambiarEstadoReserva:', e)
    return { error: 'No se pudo cambiar el estado.' }
  }
}
