'use server'

import { revalidatePath } from 'next/cache'
import type { AuditAccion, Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import { getUser } from '@/lib/auth'
import { exigirPlataforma, guardiaProveedor, usuarioDePlataforma } from './permisos'
import {
  crearAcuerdo,
  crearOrden,
  generarLotes,
  moverAcuerdo,
  moverOrden,
  registrarEnmienda,
} from './procurement'
import { asignar, liberar } from './asignaciones'
import { cancelarDerecho, emitirDerecho, reemitirVoucher } from './derechos'
import { fichaDeVoucher, redimir, reversarRedencion } from './redencion'
import { abrirIncidencia, moverIncidencia } from './incidencias'
import { confirmarPago, registrarPago } from './finanzas'
import { recalcularCubetas } from './movimientos'
import { abrirSesionQr, resolverNonce } from './qr'
import { cancelarReserva, reservar } from './reservas'
import { esDestino, ORIGEN_POR_DESTINO } from './catalogo'
import { claveIdempotencia } from './codigos'

/**
 * MEMBEGO SUPPLY · server actions.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TODA ACCIÓN PASA POR TRES COSAS, SIEMPRE EN ESTE ORDEN
 *
 *   1. GUARDIA. Quién puede hacerlo. Las que comprometen capital exigen rol de
 *      plataforma; las del comercio exigen sección `supply` Y la capacidad
 *      MEMBEGO_SUPPLIER de ESA empresa.
 *   2. REGLA DE DOMINIO. La lógica vive en los módulos, no aquí. Este archivo
 *      no sabe qué es FEFO ni cómo cuadra un ledger.
 *   3. BITÁCORA. Con actor, entidad y lo que cambió.
 *
 * Las actions se despachan POR ID sobre cualquier ruta permitida, así que el
 * gate del middleware no las protege: la guardia de cada una es la barrera
 * real, y por eso ninguna se salta el paso 1.
 *
 * Devuelven `{ error }` o `{ success }` en vez de lanzar: un `throw` en una
 * server action llega al cliente como «algo salió mal» y el usuario no sabe si
 * su compra de RD$300.000 se registró o no.
 */

export interface EstadoAccion {
  error?: string
  success?: string
  /** Id de lo recién creado, para que la pantalla pueda navegar. */
  id?: string
}

// ── Bitácora ────────────────────────────────────────────────────────────────

async function auditar(
  accion: AuditAccion,
  entidadTipo: string,
  entidadId: string,
  payload: Prisma.InputJsonValue,
  companyId?: string | null
): Promise<void> {
  const user = await getUser()
  const meta = await getRequestMeta()
  await sinEmpresa('Membego Supply: bitácora de una acción de plataforma', (tx) =>
    tx.auditLog.create({
      data: {
        companyId: companyId ?? null,
        userId: user?.metadata.dbUserId ?? null,
        accion,
        entidadTipo,
        entidadId,
        payload,
        ...meta,
      },
    })
  ).catch(anotarFallo('supply:auditLog.create'))
}

function refrescarPlataforma(sufijo = ''): void {
  revalidatePath('/superadmin/supply')
  if (sufijo) revalidatePath(`/superadmin/supply/${sufijo}`)
}

/** Convierte cualquier fallo en un mensaje que se puede enseñar. */
function comoError(e: unknown): EstadoAccion {
  return { error: e instanceof Error ? e.message : 'No se pudo completar la operación.' }
}

function texto(fd: FormData, clave: string, max = 500): string {
  return String(fd.get(clave) ?? '').trim().slice(0, max)
}

function numero(fd: FormData, clave: string): number | null {
  const v = String(fd.get(clave) ?? '').trim()
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function fecha(fd: FormData, clave: string): Date | null {
  const v = String(fd.get(clave) ?? '').trim()
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

// ── Acuerdos ────────────────────────────────────────────────────────────────

export async function crearAcuerdoAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_CREATE')

    const inicioAt = fecha(fd, 'inicioAt')
    const finAt = fecha(fd, 'finAt')
    if (!inicioAt || !finAt) return { error: 'Hace falta la vigencia del contrato.' }

    const cantidad = numero(fd, 'cantidad')
    const costoUnitario = numero(fd, 'costoUnitario')
    if (cantidad == null || costoUnitario == null) {
      return { error: 'Hace falta la cantidad y el costo unitario.' }
    }

    const { id, codigo } = await crearAcuerdo({
      proveedorId: texto(fd, 'proveedorId', 60),
      tipo: texto(fd, 'tipo', 40) as never,
      modeloComercial: (texto(fd, 'modeloComercial', 40) || 'COMPRA_UNIDAD_COMPLETA') as never,
      modalidadPago: (texto(fd, 'modalidadPago', 40) || 'PREPAGO_PARCIAL') as never,
      politicaSobrante: (texto(fd, 'politicaSobrante', 40) || 'EXPIRAR') as never,
      itemNombre: texto(fd, 'itemNombre', 200),
      itemDescripcion: texto(fd, 'itemDescripcion', 1000) || null,
      varianteEtiqueta: texto(fd, 'varianteEtiqueta', 120) || null,
      servicioId: texto(fd, 'servicioId', 60) || null,
      promocionId: texto(fd, 'promocionId', 60) || null,
      cantidad,
      costoUnitario,
      precioReferencia: numero(fd, 'precioReferencia'),
      aporteMembego: numero(fd, 'aporteMembego'),
      anticipoPorcentaje: numero(fd, 'anticipoPorcentaje'),
      condicionesPago: texto(fd, 'condicionesPago', 1000) || null,
      inicioAt,
      finAt,
      sucursalIds: fd.getAll('sucursalIds').map(String).filter(Boolean),
      capacidadDiaria: numero(fd, 'capacidadDiaria'),
      capacidadHoraria: numero(fd, 'capacidadHoraria'),
      diasBloqueados: texto(fd, 'diasBloqueados', 2000)
        .split(/[\s,]+/)
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
      horarioTexto: texto(fd, 'horarioTexto', 120) || null,
      reglasRedencion: texto(fd, 'reglasRedencion', 2000) || null,
      reglasSustitucion: texto(fd, 'reglasSustitucion', 2000) || null,
      reglasCumplimiento: texto(fd, 'reglasCumplimiento', 2000) || null,
      politicaCancelacion: texto(fd, 'politicaCancelacion', 2000) || null,
      notas: texto(fd, 'notas', 2000) || null,
      creadoPorId: user.metadata.dbUserId ?? null,
    })

    await auditar('SUPPLY_ACUERDO_CREADO', 'SupplyAcuerdo', id, {
      codigo,
      item: texto(fd, 'itemNombre', 200),
      cantidad,
      costoUnitario,
    })
    refrescarPlataforma('acuerdos')
    return { success: `Acuerdo ${codigo} creado en borrador.`, id }
  } catch (e) {
    return comoError(e)
  }
}

export async function moverAcuerdoAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_APPROVE')
    const acuerdoId = texto(fd, 'acuerdoId', 60)
    const hasta = texto(fd, 'estado', 40)

    await moverAcuerdo(acuerdoId, hasta as never, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_ACUERDO_ESTADO', 'SupplyAcuerdo', acuerdoId, { despues: hasta })
    refrescarPlataforma('acuerdos')
    return { success: `Acuerdo ${hasta.toLowerCase()}.` }
  } catch (e) {
    return comoError(e)
  }
}

export async function enmendarAcuerdoAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_APPROVE')
    const acuerdoId = texto(fd, 'acuerdoId', 60)
    const campo = texto(fd, 'campo', 40)
    const motivo = texto(fd, 'motivo', 1000)

    const { id } = await registrarEnmienda({
      acuerdoId,
      campo: campo as never,
      antes: JSON.parse(texto(fd, 'antes', 4000) || '{}') as Prisma.InputJsonValue,
      despues: JSON.parse(texto(fd, 'despues', 4000) || '{}') as Prisma.InputJsonValue,
      motivo,
      loteId: texto(fd, 'loteId', 60) || null,
      unidadesExtra: numero(fd, 'unidadesExtra'),
      nuevoFinAt: fecha(fd, 'nuevoFinAt'),
      solicitadoPorId: user.metadata.dbUserId ?? null,
      aprobadoPorId: user.metadata.dbUserId ?? null,
    })

    await auditar('SUPPLY_ENMIENDA_REGISTRADA', 'SupplyAcuerdo', acuerdoId, { campo, motivo, enmienda: id })
    refrescarPlataforma('acuerdos')
    return { success: 'Enmienda registrada.', id }
  } catch (e) {
    return comoError(e)
  }
}

// ── Órdenes de compra ───────────────────────────────────────────────────────

export async function crearOrdenAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_CREATE')
    const acuerdoId = texto(fd, 'acuerdoId', 60)

    // Una línea por defecto tomada del acuerdo: el caso normal es comprar lo
    // contratado. Las líneas múltiples se arman con `lineaItem[]`.
    const nombres = fd.getAll('lineaItem').map(String).filter(Boolean)
    const cantidades = fd.getAll('lineaCantidad').map((v) => Number(v))
    const costos = fd.getAll('lineaCosto').map((v) => Number(v))

    const lineas = nombres.map((itemNombre, i) => ({
      itemNombre,
      cantidad: cantidades[i] ?? 0,
      costoUnitario: costos[i] ?? 0,
      varianteEtiqueta: null,
    }))
    if (lineas.length === 0) return { error: 'La orden necesita al menos una línea.' }

    const { id, numero: numeroOc } = await crearOrden({
      acuerdoId,
      lineas,
      impuestos: numero(fd, 'impuestos') ?? 0,
      condicionesPago: texto(fd, 'condicionesPago', 1000) || null,
      notas: texto(fd, 'notas', 2000) || null,
      creadoPorId: user.metadata.dbUserId ?? null,
    })

    await auditar('SUPPLY_ORDEN_CREADA', 'SupplyOrden', id, {
      numero: numeroOc,
      acuerdoId,
      lineas: lineas.length,
      unidades: lineas.reduce((t, l) => t + l.cantidad, 0),
    })
    refrescarPlataforma('ordenes')
    return { success: `Orden ${numeroOc} creada en borrador.`, id }
  } catch (e) {
    return comoError(e)
  }
}

export async function moverOrdenAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_APPROVE')
    const ordenId = texto(fd, 'ordenId', 60)
    const hasta = texto(fd, 'estado', 40)

    await moverOrden(ordenId, hasta as never, user.metadata.dbUserId ?? null, texto(fd, 'motivo', 500) || null)
    await auditar('SUPPLY_ORDEN_ESTADO', 'SupplyOrden', ordenId, { despues: hasta })

    // ACTIVA es el momento en que el supply existe de verdad: se generan los
    // lotes y se asienta la compra en el ledger, en la misma petición.
    if (hasta === 'ACTIVA') {
      const lotes = await generarLotes(ordenId, user.metadata.dbUserId ?? null)
      for (const l of lotes) {
        await auditar('SUPPLY_LOTE_ACTIVADO', 'SupplyLote', l.id, {
          codigo: l.codigo,
          compradas: l.compradas,
        })
      }
      refrescarPlataforma('lotes')
      return {
        success: `Orden activada. ${lotes.length} lote(s) en el pool con ${lotes.reduce((t, l) => t + l.compradas, 0)} unidades.`,
      }
    }

    refrescarPlataforma('ordenes')
    return { success: `Orden ${hasta.toLowerCase()}.` }
  } catch (e) {
    return comoError(e)
  }
}

// ── Asignaciones ────────────────────────────────────────────────────────────

export async function asignarAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_ALLOCATE')
    const destinoTipo = texto(fd, 'destinoTipo', 40)
    if (!esDestino(destinoTipo)) return { error: 'Destino de asignación no válido.' }

    const cantidad = numero(fd, 'cantidad')
    if (cantidad == null) return { error: 'Hace falta la cantidad a asignar.' }

    const res = await asignar({
      loteId: texto(fd, 'loteId', 60),
      destinoTipo,
      destinoId: texto(fd, 'destinoId', 60) || null,
      etiqueta: texto(fd, 'etiqueta', 200),
      cantidad,
      creadoPorId: user.metadata.dbUserId ?? null,
    })

    await auditar('SUPPLY_ASIGNACION_CREADA', 'SupplyAsignacion', res.id, {
      loteId: res.loteId,
      destinoTipo,
      cantidad,
      disponiblesRestantes: res.disponiblesRestantes,
    })
    refrescarPlataforma('lotes')
    return { success: `${cantidad} unidades apartadas. Quedan ${res.disponiblesRestantes} sin asignar.`, id: res.id }
  } catch (e) {
    return comoError(e)
  }
}

export async function liberarAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_ALLOCATE')
    const asignacionId = texto(fd, 'asignacionId', 60)

    const res = await liberar(
      asignacionId,
      numero(fd, 'cantidad') ?? undefined,
      user.metadata.dbUserId ?? null,
      texto(fd, 'motivo', 500) || undefined
    )
    await auditar('SUPPLY_ASIGNACION_LIBERADA', 'SupplyAsignacion', asignacionId, res)
    refrescarPlataforma('lotes')
    return { success: `${res.liberadas} unidades devueltas al pool.` }
  } catch (e) {
    return comoError(e)
  }
}

// ── Emisión manual (Fase 21: regalos, soporte, influencers) ─────────────────

export async function emitirDerechoAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_ALLOCATE')
    const loteId = texto(fd, 'loteId', 60)
    const clienteId = texto(fd, 'clienteId', 60)
    const asignacionId = texto(fd, 'asignacionId', 60) || null
    const destinoTipo = texto(fd, 'destinoTipo', 40)
    const origen = esDestino(destinoTipo) ? ORIGEN_POR_DESTINO[destinoTipo] : 'MANUAL'

    const res = await emitirDerecho({
      loteId,
      clienteId,
      asignacionId,
      origen,
      precioCliente: numero(fd, 'precioCliente') ?? 0,
      actorId: user.metadata.dbUserId ?? null,
      // Determinista: el mismo lote, la misma persona y la misma campaña no
      // pueden emitir dos veces por un doble clic.
      claveIdempotencia: claveIdempotencia('manual', loteId, clienteId, asignacionId ?? 'sin-campana'),
    })
    if (!res.ok) return { error: res.veredicto.mensaje }

    await auditar('SUPPLY_DERECHO_EMITIDO', 'SupplyDerecho', res.derecho.derechoId, {
      loteId,
      clienteId,
      origen,
      reutilizado: res.derecho.reutilizado,
    })
    refrescarPlataforma('derechos')
    return {
      success: res.derecho.reutilizado
        ? 'Esta persona ya tenía este beneficio: no se emitió otro.'
        : 'Beneficio emitido.',
      id: res.derecho.derechoId,
    }
  } catch (e) {
    return comoError(e)
  }
}

export async function cancelarDerechoAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_ALLOCATE')
    const derechoId = texto(fd, 'derechoId', 60)
    const motivo = texto(fd, 'motivo', 500)
    const devolver = fd.get('devolverAlPool') === 'on'

    await cancelarDerecho(derechoId, motivo, devolver, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_DERECHO_CANCELADO', 'SupplyDerecho', derechoId, { motivo, devolverAlPool: devolver })
    refrescarPlataforma('derechos')
    return { success: devolver ? 'Beneficio cancelado y unidad devuelta al pool.' : 'Beneficio cancelado.' }
  } catch (e) {
    return comoError(e)
  }
}

export async function reemitirVoucherAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_ALLOCATE')
    const derechoId = texto(fd, 'derechoId', 60)
    const motivo = texto(fd, 'motivo', 500)

    const v = await reemitirVoucher(derechoId, motivo, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_VOUCHER_EMITIDO', 'SupplyVoucher', v.id, { derechoId, motivo, reemision: true })
    refrescarPlataforma('derechos')
    return { success: 'Voucher reemitido. El anterior quedó revocado.', id: v.id }
  } catch (e) {
    return comoError(e)
  }
}

// ── Cliente ─────────────────────────────────────────────────────────────────

export async function abrirQrAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const user = await getUser()
    if (!user) return { error: 'Inicia sesión para usar tu beneficio.' }

    const voucherId = texto(fd, 'voucherId', 60)
    const clienteId = texto(fd, 'clienteId', 60)
    const sesion = await abrirSesionQr(voucherId, clienteId, texto(fd, 'sucursalId', 60) || null)

    revalidatePath('/cliente/beneficios')
    return { success: sesion.nonce, id: sesion.id }
  } catch (e) {
    return comoError(e)
  }
}

export async function reservarAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const user = await getUser()
    if (!user) return { error: 'Inicia sesión para reservar.' }

    const res = await reservar({
      derechoId: texto(fd, 'derechoId', 60),
      clienteId: texto(fd, 'clienteId', 60),
      sucursalId: texto(fd, 'sucursalId', 60),
      dia: texto(fd, 'dia', 10),
      hora: numero(fd, 'hora'),
    })
    if (!res.ok) return { error: res.mensaje }

    revalidatePath('/cliente/beneficios')
    return { success: 'Reserva confirmada.', id: res.reservaId }
  } catch (e) {
    return comoError(e)
  }
}

export async function cancelarReservaAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await getUser()
    if (!user) return { error: 'Inicia sesión.' }
    await cancelarReserva(texto(fd, 'derechoId', 60), texto(fd, 'clienteId', 60))
    revalidatePath('/cliente/beneficios')
    return { success: 'Reserva cancelada.' }
  } catch (e) {
    return comoError(e)
  }
}

export async function reportarIncidenciaAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await getUser()
    if (!user) return { error: 'Inicia sesión para reportar.' }

    const { id } = await abrirIncidencia({
      tipo: texto(fd, 'tipo', 40) as never,
      detalle: texto(fd, 'detalle', 2000),
      derechoId: texto(fd, 'derechoId', 60) || null,
      voucherId: texto(fd, 'voucherId', 60) || null,
      redencionId: texto(fd, 'redencionId', 60) || null,
      clienteId: texto(fd, 'clienteId', 60) || null,
      sucursalId: texto(fd, 'sucursalId', 60) || null,
      reportadoPorId: user.metadata.dbUserId ?? null,
    })

    await auditar('SUPPLY_INCIDENCIA_ABIERTA', 'SupplyIncidencia', id, { tipo: texto(fd, 'tipo', 40) })
    revalidatePath('/cliente/beneficios')
    refrescarPlataforma('incidencias')
    return { success: 'Incidencia registrada. Membego la va a revisar.', id }
  } catch (e) {
    return comoError(e)
  }
}

// ── Comercio: escáner y entrega ─────────────────────────────────────────────

export async function redimirAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const companyId = texto(fd, 'companyId', 60)
    const user = await guardiaProveedor(companyId, 'redimir')
    if (!user) {
      return { error: 'No tienes permiso para entregar beneficios de Membego en esta empresa.' }
    }

    const voucherId = texto(fd, 'voucherId', 60)
    const res = await redimir({
      voucherId,
      proveedorId: companyId,
      sucursalId: texto(fd, 'sucursalId', 60) || null,
      empleadoId: user.metadata.dbUserId ?? null,
      sesionQrId: texto(fd, 'sesionQrId', 60) || null,
      extrasMonto: numero(fd, 'extrasMonto') ?? 0,
      extrasNota: texto(fd, 'extrasNota', 500) || null,
      aporteClienteComercio: numero(fd, 'aporteCliente') ?? 0,
      // Dos toques del botón "Confirmar entrega" no entregan dos pizzas.
      claveIdempotencia: claveIdempotencia('redencion', voucherId),
    })

    if (!res.ok) {
      const detalle = res.detalle
        ? ` Se utilizó el ${res.detalle.fecha.toLocaleDateString('es-DO')}${res.detalle.sucursal ? ` en ${res.detalle.sucursal}` : ''}.`
        : ''
      return { error: res.mensaje + detalle }
    }

    await auditar(
      'SUPPLY_REDENCION_REGISTRADA',
      'SupplyRedencion',
      res.redencion.redencionId,
      { voucherId, loteId: res.redencion.loteId, reutilizada: res.redencion.reutilizada },
      companyId
    )
    revalidatePath('/admin/supply')
    refrescarPlataforma('redenciones')
    return {
      success: res.redencion.reutilizada ? 'Ya estaba registrada.' : 'Entrega confirmada.',
      id: res.redencion.redencionId,
    }
  } catch (e) {
    return comoError(e)
  }
}

export async function reversarRedencionAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    // La reversa la autoriza la PLATAFORMA, no el comercio: deshacer una
    // entrega devuelve el beneficio al cliente y, con pago por redención,
    // cancela una cuenta por pagar. No puede depender de quien la registró.
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_APPROVE')
    const redencionId = texto(fd, 'redencionId', 60)
    const motivo = texto(fd, 'motivo', 500)

    await reversarRedencion(redencionId, motivo, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_REDENCION_REVERSADA', 'SupplyRedencion', redencionId, { motivo })
    refrescarPlataforma('redenciones')
    return { success: 'Entrega reversada. El cliente recupera su beneficio.' }
  } catch (e) {
    return comoError(e)
  }
}

// ── Incidencias y disputas ──────────────────────────────────────────────────

export async function resolverIncidenciaAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_APPROVE')
    const incidenciaId = texto(fd, 'incidenciaId', 60)
    const estado = texto(fd, 'estado', 40)
    const resolucion = texto(fd, 'resolucion', 2000)

    await moverIncidencia(incidenciaId, estado as never, resolucion || null, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_INCIDENCIA_RESUELTA', 'SupplyIncidencia', incidenciaId, { estado, resolucion })
    refrescarPlataforma('incidencias')
    return { success: 'Incidencia actualizada.' }
  } catch (e) {
    return comoError(e)
  }
}

// ── Dinero ──────────────────────────────────────────────────────────────────

export async function registrarPagoAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_APPROVE')
    const monto = numero(fd, 'monto')
    if (monto == null) return { error: 'Hace falta el monto.' }

    const acuerdoId = texto(fd, 'acuerdoId', 60)
    const tipo = texto(fd, 'tipo', 40)
    const { id, reutilizado } = await registrarPago({
      acuerdoId,
      ordenId: texto(fd, 'ordenId', 60) || null,
      tipo: tipo as never,
      monto,
      metodo: texto(fd, 'metodo', 100) || null,
      referencia: texto(fd, 'referencia', 200) || null,
      notas: texto(fd, 'notas', 1000) || null,
      periodoDesde: fecha(fd, 'periodoDesde'),
      periodoHasta: fecha(fd, 'periodoHasta'),
      registradoPorId: user.metadata.dbUserId ?? null,
      claveIdempotencia: texto(fd, 'claveIdempotencia', 190) || null,
    })

    await auditar('SUPPLY_PAGO_REGISTRADO', 'SupplyPago', id, { acuerdoId, tipo, monto, reutilizado })
    refrescarPlataforma('liquidaciones')
    return { success: reutilizado ? 'El pago ya estaba registrado.' : 'Pago registrado como pendiente.', id }
  } catch (e) {
    return comoError(e)
  }
}

export async function confirmarPagoAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_APPROVE')
    const pagoId = texto(fd, 'pagoId', 60)

    await confirmarPago(pagoId, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_PAGO_CONFIRMADO', 'SupplyPago', pagoId, {})
    refrescarPlataforma('liquidaciones')
    return { success: 'Pago confirmado y asentado.' }
  } catch (e) {
    return comoError(e)
  }
}

// ── Conciliación ────────────────────────────────────────────────────────────

export async function recalcularLoteAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_APPROVE')
    const loteId = texto(fd, 'loteId', 60)

    // Siempre del ledger al contador, nunca al revés: el contador es caché.
    const saldo = await sinEmpresa('Membego Supply: recálculo de un lote desde su ledger', (tx) =>
      recalcularCubetas(tx, loteId)
    )
    await auditar('SUPPLY_LOTE_RECALCULADO', 'SupplyLote', loteId, {
      ...saldo,
      actor: user.metadata.dbUserId,
    })
    refrescarPlataforma('conciliacion')
    return { success: 'Contadores recalculados desde el ledger.' }
  } catch (e) {
    return comoError(e)
  }
}

/** ¿Hay sesión de plataforma? Lo usan las pantallas para esconder acciones. */
export async function puedeAdministrarSupply(): Promise<boolean> {
  return (await usuarioDePlataforma()) !== null
}

// ── Escáner del proveedor (Fase 14) ─────────────────────────────────────────

export interface EstadoEscaneo {
  error?: string
  /** Ficha del voucher cuando el código es válido: lo que el empleado confirma. */
  ficha?: {
    voucherId: string
    sesionQrId: string | null
    codigo: string
    cliente: string
    producto: string
    variante: string | null
    proveedor: string
    loteCodigo: string
    campana: string | null
    venceAt: string
    avisoCobro: string
  }
}

/**
 * Resuelve un código escaneado SIN consumirlo.
 *
 * Dos pasos y no uno: primero se enseña quién es y qué le toca, y solo cuando
 * el empleado pulsa «Confirmar entrega» se redime. Consumir al escanear dejaría
 * el voucher inservible si el empleado se arrepiente o la pantalla se cae antes
 * de confirmar — y el cliente sin su pizza y sin su beneficio.
 *
 * Acepta el nonce de un QR dinámico o el código del voucher directamente (por
 * si el cliente enseña el código desde su historial o lo dicta por teléfono).
 */
export async function escanearSupplyAction(
  _prev: EstadoEscaneo,
  fd: FormData
): Promise<EstadoEscaneo> {
  try {
    const companyId = texto(fd, 'companyId', 60)
    const user = await guardiaProveedor(companyId)
    if (!user) return { error: 'No tienes permiso para escanear beneficios de Membego aquí.' }

    const leido = texto(fd, 'codigo', 200)
    if (!leido) return { error: 'No se leyó ningún código.' }

    const porNonce = await resolverNonce(leido)
    let voucherId: string | null = null
    let sesionQrId: string | null = null

    if (porNonce.ok) {
      voucherId = porNonce.voucherId
      sesionQrId = porNonce.sesionId
    } else if (porNonce.motivo !== 'DESCONOCIDO') {
      // EXPIRADO o YA_USADO son respuestas informativas: el código ES de
      // Membego y decir «no es de Membego» mandaría al cliente a discutir con
      // el empleado en vez de a regenerar su QR.
      return { error: porNonce.mensaje }
    } else {
      const directo = await sinEmpresa(
        'Membego Supply: el comercio busca un voucher por su código',
        (tx) => tx.supplyVoucher.findUnique({ where: { codigo: leido }, select: { id: true } })
      )
      voucherId = directo?.id ?? null
    }

    if (!voucherId) return { error: 'Este código no es de Membego Supply.' }

    const ficha = await sinEmpresa('Membego Supply: ficha del voucher escaneado', (tx) =>
      fichaDeVoucher(tx, voucherId)
    )
    if (!ficha) return { error: 'Voucher no encontrado.' }

    return {
      ficha: {
        voucherId: ficha.voucherId,
        sesionQrId,
        codigo: ficha.codigo.slice(0, 8),
        cliente: ficha.cliente,
        producto: ficha.producto,
        variante: ficha.variante,
        proveedor: ficha.proveedor,
        loteCodigo: ficha.loteCodigo,
        campana: ficha.campana,
        venceAt: ficha.venceAt.toISOString(),
        avisoCobro: ficha.avisoCobro,
      },
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'No se pudo leer el código.' }
  }
}
