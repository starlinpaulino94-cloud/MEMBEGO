'use server'

/**
 * App Car Wash · Fase 2 — acciones de cuentas corporativas, comisiones e
 * incidencias.
 *
 * REGLA DE SEGURIDAD COMÚN: cada acción resuelve la empresa DEL USUARIO y usa
 * ese `companyId` en el WHERE. Nunca se confía en un id que venga del
 * formulario para decidir a qué empresa pertenece algo — un id manipulado
 * podría facturarle a la flota de otro negocio.
 *
 * Cada bloque exige además su propia capacidad, que nace apagada.
 */

import { revalidatePath } from 'next/cache'
import { conEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { ADMIN_ROLES } from '@/types'
import { companyFilter } from '@/modules/admin/queries'
import { tieneCapacidad } from '@/modules/capacidades/resolver'
import type { Capacidad } from '@/modules/capacidades/catalogo'
import { anotarFallo } from '@/lib/prisma-errors'
import { normalizarPlaca } from './cuentas'
import { INCIDENCIA_ESTADOS, INCIDENCIA_TIPOS, GRAVEDADES } from './incidencias'

export interface Fase2State {
  error?: string
  success?: string
}

const RUTA_CUENTAS = '/admin/app/carwash/cuentas'
const RUTA_COMISIONES = '/admin/app/carwash/comisiones'
const RUTA_INCIDENCIAS = '/admin/app/carwash/incidencias'

/** Empresa del usuario + capacidad exigida. Devuelve un error legible si falla. */
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

function dinero(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').trim().replace(/,/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// ── Cuentas corporativas ────────────────────────────────────────────────────

export async function guardarCuenta(_prev: Fase2State, formData: FormData): Promise<Fase2State> {
  try {
    const ctx = await contexto('CUENTAS_CORPORATIVAS')
    if ('error' in ctx) return ctx

    const id = texto(formData.get('id'), 40)
    const nombre = texto(formData.get('nombre'), 80)
    if (!nombre) return { error: 'Escribe el nombre de la empresa.' }

    const datos = {
      nombre,
      rnc: texto(formData.get('rnc'), 20) || null,
      contacto: texto(formData.get('contacto'), 80) || null,
      telefono: texto(formData.get('telefono'), 30) || null,
      email: texto(formData.get('email'), 120) || null,
      limiteCredito: dinero(formData.get('limiteCredito')),
      diasCredito: Math.max(0, Number(formData.get('diasCredito') ?? 30) || 30),
      notas: texto(formData.get('notas'), 500) || null,
    }

    if (id) {
      const upd = await conEmpresa(ctx.companyId, (tx) =>
        tx.cuentaCorporativa.updateMany({
          where: { id, companyId: ctx.companyId },
          data: datos,
        })
      )
      if (upd.count === 0) return { error: 'Cuenta no encontrada.' }
    } else {
      const existe = await conEmpresa(ctx.companyId, (tx) =>
        tx.cuentaCorporativa.findFirst({
          where: { companyId: ctx.companyId, nombre: { equals: nombre, mode: 'insensitive' } },
          select: { id: true },
        })
      )
      if (existe) return { error: `Ya tienes una cuenta llamada "${nombre}".` }
      await conEmpresa(ctx.companyId, (tx) =>
        tx.cuentaCorporativa.create({ data: { companyId: ctx.companyId, ...datos } })
      )
    }

    revalidatePath(RUTA_CUENTAS)
    return { success: id ? 'Cuenta actualizada.' : `Cuenta "${nombre}" creada.` }
  } catch (e) {
    console.error('[carwash f2] guardarCuenta:', e)
    return { error: 'No se pudo guardar. ¿Corriste la migración 20260764?' }
  }
}

export async function alternarCuenta(id: string): Promise<Fase2State> {
  try {
    const ctx = await contexto('CUENTAS_CORPORATIVAS')
    if ('error' in ctx) return ctx
    const c = await conEmpresa(ctx.companyId, (tx) =>
      tx.cuentaCorporativa.findFirst({
        where: { id, companyId: ctx.companyId },
        select: { activa: true },
      })
    )
    if (!c) return { error: 'Cuenta no encontrada.' }
    await conEmpresa(ctx.companyId, (tx) =>
      tx.cuentaCorporativa.update({ where: { id }, data: { activa: !c.activa } })
    )
    revalidatePath(RUTA_CUENTAS)
    return { success: c.activa ? 'Cuenta desactivada.' : 'Cuenta activada.' }
  } catch (e) {
    console.error('[carwash f2] alternarCuenta:', e)
    return { error: 'No se pudo cambiar el estado.' }
  }
}

export async function agregarVehiculoCuenta(
  _prev: Fase2State,
  formData: FormData
): Promise<Fase2State> {
  try {
    const ctx = await contexto('CUENTAS_CORPORATIVAS')
    if ('error' in ctx) return ctx

    const cuentaId = texto(formData.get('cuentaId'), 40)
    const placaCruda = texto(formData.get('placa'), 20)
    if (!cuentaId || !placaCruda) return { error: 'Falta la placa.' }
    const placa = normalizarPlaca(placaCruda)

    // La cuenta tiene que ser de ESTA empresa: sin esto, un id copiado de otro
    // negocio dejaría meter vehículos en su flota.
    const cuenta = await conEmpresa(ctx.companyId, (tx) =>
      tx.cuentaCorporativa.findFirst({
        where: { id: cuentaId, companyId: ctx.companyId },
        select: { id: true },
      })
    )
    if (!cuenta) return { error: 'Cuenta no encontrada.' }

    // Una placa solo puede pertenecer a UNA flota: si no, al entregar el
    // vehículo no habría forma de saber a quién facturarle.
    const enOtra = await conEmpresa(ctx.companyId, (tx) =>
      tx.cuentaVehiculo.findFirst({
        where: { placa, activo: true, cuenta: { companyId: ctx.companyId, id: { not: cuentaId } } },
        select: { cuenta: { select: { nombre: true } } },
      })
    )
    if (enOtra) return { error: `La placa ${placa} ya está en la flota de ${enOtra.cuenta.nombre}.` }

    await conEmpresa(ctx.companyId, (tx) =>
      tx.cuentaVehiculo.upsert({
        where: { cuentaId_placa: { cuentaId, placa } },
        create: { cuentaId, placa, alias: texto(formData.get('alias'), 60) || null },
        update: { activo: true, alias: texto(formData.get('alias'), 60) || null },
      })
    )

    revalidatePath(`${RUTA_CUENTAS}/${cuentaId}`)
    return { success: `Placa ${placa} agregada.` }
  } catch (e) {
    console.error('[carwash f2] agregarVehiculoCuenta:', e)
    return { error: 'No se pudo agregar la placa.' }
  }
}

export async function quitarVehiculoCuenta(id: string): Promise<Fase2State> {
  try {
    const ctx = await contexto('CUENTAS_CORPORATIVAS')
    if ('error' in ctx) return ctx
    const v = await conEmpresa(ctx.companyId, (tx) =>
      tx.cuentaVehiculo.findFirst({
        where: { id, cuenta: { companyId: ctx.companyId } },
        select: { cuentaId: true, placa: true },
      })
    )
    if (!v) return { error: 'Vehículo no encontrado.' }
    // Se desactiva, no se borra: los cargos históricos citan esa placa y
    // borrarla dejaría el estado de cuenta sin explicación.
    await conEmpresa(ctx.companyId, (tx) =>
      tx.cuentaVehiculo.update({ where: { id }, data: { activo: false } })
    )
    revalidatePath(`${RUTA_CUENTAS}/${v.cuentaId}`)
    return { success: `Placa ${v.placa} retirada de la flota.` }
  } catch (e) {
    console.error('[carwash f2] quitarVehiculoCuenta:', e)
    return { error: 'No se pudo retirar la placa.' }
  }
}

/** Cargo manual (un servicio que no pasó por la cola, un ajuste, una nota). */
export async function agregarCargoManual(
  _prev: Fase2State,
  formData: FormData
): Promise<Fase2State> {
  try {
    const ctx = await contexto('CUENTAS_CORPORATIVAS')
    if ('error' in ctx) return ctx

    const cuentaId = texto(formData.get('cuentaId'), 40)
    const concepto = texto(formData.get('concepto'), 160)
    const monto = dinero(formData.get('monto'))
    if (!cuentaId || !concepto) return { error: 'Falta el concepto.' }
    if (monto == null || monto <= 0) return { error: 'Escribe un monto mayor que cero.' }

    const cuenta = await conEmpresa(ctx.companyId, (tx) =>
      tx.cuentaCorporativa.findFirst({
        where: { id: cuentaId, companyId: ctx.companyId },
        select: { id: true },
      })
    )
    if (!cuenta) return { error: 'Cuenta no encontrada.' }

    const placaCruda = texto(formData.get('placa'), 20)
    await conEmpresa(ctx.companyId, (tx) =>
      tx.cargoCuenta.create({
        data: {
          cuentaId,
          concepto,
          monto,
          placa: placaCruda ? normalizarPlaca(placaCruda) : null,
        },
      })
    )

    revalidatePath(`${RUTA_CUENTAS}/${cuentaId}`)
    return { success: 'Cargo agregado.' }
  } catch (e) {
    console.error('[carwash f2] agregarCargoManual:', e)
    return { error: 'No se pudo agregar el cargo.' }
  }
}

/**
 * Cierra el período: marca como FACTURADO todo lo PENDIENTE de una cuenta con
 * una referencia común.
 *
 * `updateMany` filtrando por `estado: 'PENDIENTE'` es lo que hace segura la
 * repetición: si alguien da dos veces al botón, la segunda no encuentra nada
 * pendiente y no reetiqueta cargos que ya iban en otro corte.
 */
export async function cerrarCorte(_prev: Fase2State, formData: FormData): Promise<Fase2State> {
  try {
    const ctx = await contexto('CUENTAS_CORPORATIVAS')
    if ('error' in ctx) return ctx

    const cuentaId = texto(formData.get('cuentaId'), 40)
    const cuenta = await conEmpresa(ctx.companyId, (tx) =>
      tx.cuentaCorporativa.findFirst({
        where: { id: cuentaId, companyId: ctx.companyId },
        select: { id: true },
      })
    )
    if (!cuenta) return { error: 'Cuenta no encontrada.' }

    const corteRef =
      texto(formData.get('corteRef'), 40) ||
      `CORTE-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`

    const upd = await conEmpresa(ctx.companyId, (tx) =>
      tx.cargoCuenta.updateMany({
        where: { cuentaId, estado: 'PENDIENTE' },
        data: { estado: 'FACTURADO', corteRef, facturadoAt: new Date() },
      })
    )
    if (upd.count === 0) return { error: 'No hay cargos pendientes de facturar.' }

    revalidatePath(`${RUTA_CUENTAS}/${cuentaId}`)
    return { success: `${upd.count} cargo(s) facturados como ${corteRef}.` }
  } catch (e) {
    console.error('[carwash f2] cerrarCorte:', e)
    return { error: 'No se pudo cerrar el corte.' }
  }
}

/** Registra el pago de un corte completo. */
export async function marcarCortePagado(
  _prev: Fase2State,
  formData: FormData
): Promise<Fase2State> {
  try {
    const ctx = await contexto('CUENTAS_CORPORATIVAS')
    if ('error' in ctx) return ctx

    const cuentaId = texto(formData.get('cuentaId'), 40)
    const corteRef = texto(formData.get('corteRef'), 40)
    if (!corteRef) return { error: 'Falta la referencia del corte.' }

    const cuenta = await conEmpresa(ctx.companyId, (tx) =>
      tx.cuentaCorporativa.findFirst({
        where: { id: cuentaId, companyId: ctx.companyId },
        select: { id: true },
      })
    )
    if (!cuenta) return { error: 'Cuenta no encontrada.' }

    const upd = await conEmpresa(ctx.companyId, (tx) =>
      tx.cargoCuenta.updateMany({
        where: { cuentaId, corteRef, estado: 'FACTURADO' },
        data: { estado: 'PAGADO', pagadoAt: new Date() },
      })
    )
    if (upd.count === 0) return { error: 'Ese corte no tiene cargos por cobrar.' }

    revalidatePath(`${RUTA_CUENTAS}/${cuentaId}`)
    return { success: `Corte ${corteRef} cobrado (${upd.count} cargos).` }
  } catch (e) {
    console.error('[carwash f2] marcarCortePagado:', e)
    return { error: 'No se pudo registrar el pago.' }
  }
}

// ── Comisiones ──────────────────────────────────────────────────────────────

/** Tarifa de comisión de un servicio. Vacío en ambos = ese servicio no paga. */
export async function guardarTarifaComision(
  _prev: Fase2State,
  formData: FormData
): Promise<Fase2State> {
  try {
    const ctx = await contexto('COMISIONES')
    if ('error' in ctx) return ctx

    const servicioId = texto(formData.get('servicioId'), 40)
    const porcentaje = dinero(formData.get('comisionPorcentaje'))
    const monto = dinero(formData.get('comisionMonto'))
    if (porcentaje != null && porcentaje > 100) {
      return { error: 'El porcentaje no puede pasar de 100.' }
    }

    const upd = await conEmpresa(ctx.companyId, (tx) =>
      tx.servicio.updateMany({
        where: { id: servicioId, companyId: ctx.companyId },
        data: {
          comisionPorcentaje: porcentaje,
          // Si hay porcentaje, el monto fijo se limpia: tener los dos activos en
          // la misma línea haría ambiguo cuál manda.
          comisionMonto: porcentaje != null && porcentaje > 0 ? null : monto,
        },
      })
    )
    if (upd.count === 0) return { error: 'Servicio no encontrado.' }

    revalidatePath(RUTA_COMISIONES)
    revalidatePath('/admin/app/carwash/catalogo')
    return { success: 'Tarifa de comisión guardada.' }
  } catch (e) {
    console.error('[carwash f2] guardarTarifaComision:', e)
    return { error: 'No se pudo guardar la tarifa.' }
  }
}

/**
 * Paga las comisiones pendientes de un lavador con un lote común.
 *
 * Igual que el corte de flota: el filtro `estado: 'PENDIENTE'` hace que
 * repetir la acción no vuelva a pagar lo ya pagado.
 */
export async function pagarComisiones(
  _prev: Fase2State,
  formData: FormData
): Promise<Fase2State> {
  try {
    const ctx = await contexto('COMISIONES')
    if ('error' in ctx) return ctx

    const userId = texto(formData.get('userId'), 40)
    if (!userId) return { error: 'Falta el lavador.' }
    const loteRef =
      texto(formData.get('loteRef'), 40) ||
      `PAGO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`

    const upd = await conEmpresa(ctx.companyId, (tx) =>
      tx.comision.updateMany({
        where: { companyId: ctx.companyId, userId, estado: 'PENDIENTE' },
        data: { estado: 'PAGADA', loteRef, pagadaAt: new Date() },
      })
    )
    if (upd.count === 0) return { error: 'Ese lavador no tiene comisiones pendientes.' }

    revalidatePath(RUTA_COMISIONES)
    return { success: `${upd.count} comisión(es) pagadas como ${loteRef}.` }
  } catch (e) {
    console.error('[carwash f2] pagarComisiones:', e)
    return { error: 'No se pudo registrar el pago.' }
  }
}

/** Asigna quién trabajó el vehículo. Es la base de toda la comisión. */
export async function asignarLavador(colaId: string, userId: string): Promise<Fase2State> {
  try {
    const ctx = await contexto('COMISIONES')
    if ('error' in ctx) return ctx

    const entrada = await conEmpresa(ctx.companyId, (tx) =>
      tx.colaVehiculo.findFirst({
        where: { id: colaId, companyId: ctx.companyId },
        select: { estado: true },
      })
    )
    if (!entrada) return { error: 'Vehículo no encontrado.' }
    // Después de entregar la comisión ya está congelada: cambiar el lavador
    // aquí no la movería, y daría una falsa sensación de corrección.
    if (entrada.estado === 'ENTREGADO') {
      return { error: 'Este vehículo ya se entregó; su comisión ya está calculada.' }
    }

    if (userId) {
      // El empleado tiene que ser de esta empresa.
      const empleado = await conEmpresa(ctx.companyId, (tx) =>
        tx.user.findFirst({
          where: { id: userId, companyId: ctx.companyId },
          select: { id: true },
        })
      )
      if (!empleado) return { error: 'Empleado no encontrado.' }
    }

    await conEmpresa(ctx.companyId, (tx) =>
      tx.colaVehiculo.update({
        where: { id: colaId },
        data: { atendidoPorId: userId || null },
      })
    )
    revalidatePath('/admin/app/carwash/cola')
    return { success: userId ? 'Lavador asignado.' : 'Lavador quitado.' }
  } catch (e) {
    console.error('[carwash f2] asignarLavador:', e)
    return { error: 'No se pudo asignar.' }
  }
}

// ── Incidencias ─────────────────────────────────────────────────────────────

export async function registrarIncidencia(
  _prev: Fase2State,
  formData: FormData
): Promise<Fase2State> {
  try {
    const ctx = await contexto('INCIDENCIAS')
    if ('error' in ctx) return ctx

    const tipo = texto(formData.get('tipo'), 20)
    const descripcion = texto(formData.get('descripcion'), 1000)
    if (!(INCIDENCIA_TIPOS as readonly string[]).includes(tipo)) {
      return { error: 'Elige el tipo de incidencia.' }
    }
    if (!descripcion) return { error: 'Describe qué pasó.' }

    const gravedadCruda = texto(formData.get('gravedad'), 10)
    const gravedad = (GRAVEDADES as readonly string[]).includes(gravedadCruda)
      ? gravedadCruda
      : 'MEDIA'

    // El vehículo señalado se valida contra la empresa; de él se heredan
    // cliente y placa, para no volver a pedirlos.
    const colaId = texto(formData.get('colaId'), 40)
    let datosCola: { colaId: string; clienteId: string | null; vehiculoId: string | null; placa: string | null } | null =
      null
    if (colaId) {
      const cola = await conEmpresa(ctx.companyId, (tx) =>
        tx.colaVehiculo.findFirst({
          where: { id: colaId, companyId: ctx.companyId },
          select: {
            id: true,
            clienteId: true,
            vehiculoId: true,
            placa: true,
            vehiculo: { select: { placa: true } },
          },
        })
      )
      if (!cola) return { error: 'Vehículo no encontrado.' }
      datosCola = {
        colaId: cola.id,
        clienteId: cola.clienteId,
        vehiculoId: cola.vehiculoId,
        placa: cola.placa ?? cola.vehiculo?.placa ?? null,
      }
    }

    const placaManual = texto(formData.get('placa'), 20)

    await conEmpresa(ctx.companyId, (tx) =>
      tx.incidencia.create({
        data: {
          companyId: ctx.companyId,
          tipo,
          gravedad,
          descripcion,
          costo: dinero(formData.get('costo')),
          colaId: datosCola?.colaId ?? null,
          clienteId: datosCola?.clienteId ?? null,
          vehiculoId: datosCola?.vehiculoId ?? null,
          placa: datosCola?.placa ?? (placaManual ? normalizarPlaca(placaManual) : null),
          reportadaPorId: ctx.userId,
        },
      })
    )

    revalidatePath(RUTA_INCIDENCIAS)
    return { success: 'Incidencia registrada.' }
  } catch (e) {
    console.error('[carwash f2] registrarIncidencia:', e)
    return { error: 'No se pudo registrar. ¿Corriste la migración 20260764?' }
  }
}

export async function resolverIncidencia(
  _prev: Fase2State,
  formData: FormData
): Promise<Fase2State> {
  try {
    const ctx = await contexto('INCIDENCIAS')
    if ('error' in ctx) return ctx

    const id = texto(formData.get('id'), 40)
    const estado = texto(formData.get('estado'), 20)
    if (!(INCIDENCIA_ESTADOS as readonly string[]).includes(estado)) {
      return { error: 'Estado no válido.' }
    }

    const upd = await conEmpresa(ctx.companyId, (tx) =>
      tx.incidencia.updateMany({
        where: { id, companyId: ctx.companyId },
        data: {
          estado,
          resolucion: texto(formData.get('resolucion'), 1000) || undefined,
          costo: dinero(formData.get('costo')) ?? undefined,
          resueltaAt: estado === 'RESUELTA' ? new Date() : null,
        },
      })
    )
    if (upd.count === 0) return { error: 'Incidencia no encontrada.' }

    revalidatePath(RUTA_INCIDENCIAS)
    return { success: estado === 'RESUELTA' ? 'Incidencia resuelta.' : 'Incidencia actualizada.' }
  } catch (e) {
    console.error('[carwash f2] resolverIncidencia:', e)
    return { error: 'No se pudo actualizar.' }
  }
}

/**
 * Manda a repetir el trabajo: crea una entrada NUEVA en la cola, copiando el
 * vehículo, y la enlaza a la incidencia.
 *
 * Se crea una entrada nueva en vez de reabrir la vieja porque el rewash ES un
 * paso más por la pista: consume una bahía, minutos y químicos. Reabrir la
 * original borraría ese costo del historial, que es justo lo que hay que medir.
 */
export async function ordenarRewash(incidenciaId: string): Promise<Fase2State> {
  try {
    const ctx = await contexto('INCIDENCIAS')
    if ('error' in ctx) return ctx

    const inc = await conEmpresa(ctx.companyId, (tx) =>
      tx.incidencia.findFirst({
        where: { id: incidenciaId, companyId: ctx.companyId },
        select: {
          id: true,
          rewashColaId: true,
          placa: true,
          clienteId: true,
          vehiculoId: true,
          cola: { select: { sucursalId: true, tipoVehiculoId: true, descripcion: true } },
        },
      })
    )
    if (!inc) return { error: 'Incidencia no encontrada.' }
    if (inc.rewashColaId) return { error: 'Este trabajo ya está en la pista para repetirse.' }

    const nueva = await conEmpresa(ctx.companyId, (tx) =>
      tx.colaVehiculo.create({
        data: {
          companyId: ctx.companyId,
          sucursalId: inc.cola?.sucursalId ?? null,
          clienteId: inc.clienteId,
          vehiculoId: inc.vehiculoId,
          tipoVehiculoId: inc.cola?.tipoVehiculoId ?? null,
          placa: inc.placa,
          descripcion: inc.cola?.descripcion ?? null,
          estado: 'EN_ESPERA',
          notaInterna: `REWASH · repetición por incidencia ${inc.id}`,
          registradaPorId: ctx.userId,
        },
        select: { id: true },
      })
    )

    await conEmpresa(ctx.companyId, (tx) =>
      tx.incidencia
        .update({
          where: { id: inc.id },
          data: { rewashColaId: nueva.id, estado: 'EN_PROCESO' },
        })
        .catch(anotarFallo('carwash:incidencia.rewash', { incidenciaId }))
    )

    revalidatePath(RUTA_INCIDENCIAS)
    revalidatePath('/admin/app/carwash/cola')
    return { success: 'El vehículo volvió a la cola para repetir el trabajo.' }
  } catch (e) {
    console.error('[carwash f2] ordenarRewash:', e)
    return { error: 'No se pudo mandar a repetir.' }
  }
}
