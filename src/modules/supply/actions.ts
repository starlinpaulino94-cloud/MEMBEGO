'use server'

import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { exigirPlataforma, guardiaProveedor, usuarioDePlataforma } from './permisos'
import {
  auditar,
  comoError,
  dispositivoActual,
  fecha,
  fechaFinDeDia,
  numero,
  refrescarPlataforma,
  texto,
  type EstadoAccion,
} from './actions-util'
import { anularPago } from './finanzas'
import { entregarVenta, fichaDeVentaPorCodigo } from './ventas'
import { derivarDeTipoAcuerdo } from './contrato'
import { ESTRATEGIA_POR_DEFECTO, ESTRATEGIAS_SELECCION, type EstrategiaSeleccion } from './fefo'
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
import { entregar } from './distribucion'
import { claveIdempotencia } from './codigos'
import {
  abrirPedido,
  adjuntarComprobante,
  cambiarEstadoCuenta,
  cancelarPedido,
  confirmarPedido,
  crearCuentaCobro,
  rechazarPedido,
  reembolsarPedido,
} from './cobro'

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

export type { EstadoAccion }

// ── Acuerdos ────────────────────────────────────────────────────────────────

export async function crearAcuerdoAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_CREATE')

    const inicioAt = fecha(fd, 'inicioAt')
    const finAt = fecha(fd, 'finAt')
    const tipoAcuerdo = texto(fd, 'tipoAcuerdo', 30)
    const derivado = tipoAcuerdo ? derivarDeTipoAcuerdo(tipoAcuerdo as never) : null
    if (!inicioAt || !finAt) return { error: 'Hace falta la vigencia del contrato.' }

    const cantidad = numero(fd, 'cantidad')
    const costoUnitario = numero(fd, 'costoUnitario')
    if (cantidad == null || costoUnitario == null) {
      return { error: 'Hace falta la cantidad y el costo unitario.' }
    }

    const { id, codigo } = await crearAcuerdo({
      proveedorId: texto(fd, 'proveedorId', 60),
      tipo: texto(fd, 'tipo', 40) as never,
      modeloComercial: (texto(fd, 'modeloComercial', 40) || derivado?.modeloComercial || 'COMPRA_UNIDAD_COMPLETA') as never,
      modalidadPago: (texto(fd, 'modalidadPago', 40) || derivado?.modalidadPago || 'PREPAGO_PARCIAL') as never,
      tipoAcuerdo: (tipoAcuerdo || null) as never,
      alcance: (texto(fd, 'alcance', 20) || 'ITEM') as never,
      categoriaCodigo: texto(fd, 'categoriaCodigo', 80) || null,
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
      comisionPorcentaje: fd.getAll('comisionPorcentaje').map(String).map((v) => Number(v.trim())).find((n) => Number.isFinite(n) && n > 0) ?? null,
      descuentoPorcentaje: numero(fd, 'descuentoPorcentaje'),
      impuestoPorcentaje: numero(fd, 'impuestoPorcentaje'),
      plazoPagoDias: numero(fd, 'plazoPagoDias'),
      frecuenciaCorte: (texto(fd, 'frecuenciaCorte', 20) || null) as never,
      metodoLiquidacion: texto(fd, 'metodoLiquidacion', 120) || null,
      politicaDevoluciones: texto(fd, 'politicaDevoluciones', 2000) || null,
      slaTexto: texto(fd, 'slaTexto', 2000) || null,
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
    const motivo = texto(fd, 'motivo', 500) || null

    const antes = await sinEmpresa('Membego Supply: estado previo del acuerdo para la bitácora', (tx) =>
      tx.supplyAcuerdo.findUnique({ where: { id: acuerdoId }, select: { estado: true } })
    )
    await moverAcuerdo(acuerdoId, hasta as never, user.metadata.dbUserId ?? null, motivo)
    await auditar('SUPPLY_ACUERDO_ESTADO', 'SupplyAcuerdo', acuerdoId, { antes: antes?.estado ?? null, despues: hasta, motivo })
    if (hasta === 'APROBADO') {
      await auditar('SUPPLY_ACUERDO_VERSION', 'SupplyAcuerdo', acuerdoId, { motivo: 'Condiciones aprobadas.' })
    }
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
      nuevoCostoUnitario: numero(fd, 'nuevoCostoUnitario'),
      nuevaComisionPorcentaje: numero(fd, 'nuevaComisionPorcentaje'),
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

    const antes = await sinEmpresa('Membego Supply: estado previo de la orden para la bitácora', (tx) =>
      tx.supplyOrden.findUnique({ where: { id: ordenId }, select: { estado: true } })
    )
    await moverOrden(ordenId, hasta as never, user.metadata.dbUserId ?? null, texto(fd, 'motivo', 500) || null)
    await auditar('SUPPLY_ORDEN_ESTADO', 'SupplyOrden', ordenId, { antes: antes?.estado ?? null, despues: hasta })

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

    const precioCliente = numero(fd, 'precioCliente')
    const res = await asignar({
      loteId: texto(fd, 'loteId', 60),
      destinoTipo,
      destinoId: texto(fd, 'destinoId', 60) || null,
      etiqueta: texto(fd, 'etiqueta', 200),
      cantidad,
      creadoPorId: user.metadata.dbUserId ?? null,
      precioCliente,
      inicioAt: fecha(fd, 'inicioAt'),
      finAt: fechaFinDeDia(fd, 'finAt'),
      maxPorCliente: numero(fd, 'maxPorCliente'),
      sucursalIds: fd.getAll('sucursalIds').map(String).filter(Boolean),
    })

    const esOferta = destinoTipo === 'OFERTA' || (precioCliente ?? 0) > 0
    await auditar(esOferta ? 'SUPPLY_OFERTA_CREADA' : 'SUPPLY_ASIGNACION_CREADA', 'SupplyAsignacion', res.id, {
      loteId: res.loteId,
      destinoTipo,
      cantidad,
      precioCliente: precioCliente ?? 0,
      disponiblesRestantes: res.disponiblesRestantes,
    })
    revalidatePath('/cliente/beneficios/disponibles')
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
    let loteId = texto(fd, 'loteId', 60)
    let clienteId = texto(fd, 'clienteId', 60)
    const asignacionId = texto(fd, 'asignacionId', 60) || null
    if (!clienteId) {
      // Regalar «a alguien»: correo, nombre exacto o id. Ambiguo = no se regala.
      const { resolverCliente } = await import('./pool')
      const busqueda = texto(fd, 'clienteBusqueda', 160)
      const encontrado = busqueda ? await sinEmpresa('Membego Supply: a quién se regala', (tx) => resolverCliente(tx, busqueda)) : null
      if (!encontrado) return { error: 'No se encontró una sola persona con ese correo, nombre o id.' }
      clienteId = encontrado.id
    }
    const destinoTipo = texto(fd, 'destinoTipo', 40)
    const origen = esDestino(destinoTipo) ? ORIGEN_POR_DESTINO[destinoTipo] : 'MANUAL'

    // Sin lote concreto, se elige por FEFO entre los candidatos del proveedor y
    // producto. Elegir OTRA estrategia es un override administrativo (§10) y
    // queda en la bitácora con la estrategia y el lote que salió.
    const estrategiaPedida = texto(fd, 'estrategia', 20)
    const estrategia: EstrategiaSeleccion = (ESTRATEGIAS_SELECCION as readonly string[]).includes(estrategiaPedida)
      ? (estrategiaPedida as EstrategiaSeleccion)
      : ESTRATEGIA_POR_DEFECTO
    if (!loteId) {
      const { candidatosParaEntregar } = await import('./pool')
      const candidatos = await sinEmpresa('Membego Supply: elegir lote para una emisión manual', (tx) =>
        candidatosParaEntregar(tx, {
          proveedorId: texto(fd, 'proveedorId', 60) || null,
          item: texto(fd, 'item', 200) || null,
          estrategia,
          exigirDisponibles: !asignacionId,
        })
      )
      loteId = candidatos[0]?.id ?? ''
      if (!loteId) return { error: 'No hay ningún lote con unidades para ese producto.' }
      if (estrategia !== ESTRATEGIA_POR_DEFECTO) {
        await auditar('SUPPLY_FEFO_OVERRIDE', 'SupplyLote', loteId, {
          estrategia,
          motivo: texto(fd, 'motivoEstrategia', 500) || null,
          candidatos: candidatos.slice(0, 5).map((c) => ({ id: c.id, codigo: c.codigo, venceAt: c.venceAt.toISOString() })),
        })
      }
    }

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
    const sesion = await abrirSesionQr(voucherId, clienteId, texto(fd, 'sucursalId', 60) || null, await dispositivoActual())

    revalidatePath('/cliente/beneficios')
    return { success: sesion.nonce, id: sesion.id }
  } catch (e) {
    return comoError(e)
  }
}

// ── Cobro a nombre de la plataforma (Fases 22-23) ───────────────────────────
//
// Las tres del cliente piden `clienteId` por formulario y el DOMINIO lo compara
// contra el dueño del pedido. Sin esa comparación, cualquiera con un id de
// pedido podría colgarle un comprobante —o cancelarlo— al pedido de otro.
//
// Las dos de Membego exigen `MEMBEGO_SUPPLY_COBRAR`. Confirmar un pago es una
// decisión financiera: activa un derecho que el proveedor tendrá que cumplir, y
// lo hace sobre la palabra de quien firma.

export async function crearCuentaCobroAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_COBRAR')

    const tipo = texto(fd, 'tipo', 20)
    if (tipo !== 'TRANSFERENCIA' && tipo !== 'PRESENCIAL') {
      return { error: 'Tipo de cuenta no válido.' }
    }

    // Nace apagada salvo que se diga lo contrario: dar de alta una cuenta y
    // publicar precios en la vitrina son dos decisiones, y quien teclea un
    // número de cuenta suele querer revisarlo antes de que el mundo lo vea.
    const activa = String(fd.get('activa') ?? '') === 'on'

    const res = await crearCuentaCobro(
      {
        tipo,
        nombre: texto(fd, 'nombre', 120),
        titular: texto(fd, 'titular', 120) || null,
        numeroCuenta: texto(fd, 'numeroCuenta', 60) || null,
        tipoCuenta: texto(fd, 'tipoCuenta', 40) || null,
        instrucciones: texto(fd, 'instrucciones', 500) || null,
        moneda: texto(fd, 'moneda', 3) || 'DOP',
      },
      activa
    )
    if (!res.ok) return { error: res.mensaje }

    // El número NO va a la bitácora: el registro de auditoría se lee en
    // pantalla y se exporta, y una cuenta bancaria repetida en cada línea es
    // un dato que se esparce sin que nadie lo decida. Queda el id, que lleva
    // a la ficha.
    await auditar('SUPPLY_CUENTA_COBRO_ALTA', 'SupplyCuentaCobro', res.id, {
      nombre: texto(fd, 'nombre', 120),
      activa,
      por: user.metadata.dbUserId ?? null,
    })
    refrescarPlataforma('cobros/cuentas')
    return {
      success: activa
        ? 'Cuenta dada de alta y activa. La vitrina ya puede publicar ofertas de pago.'
        : 'Cuenta dada de alta, apagada. Actívala cuando quieras empezar a cobrar.',
      id: res.id,
    }
  } catch (e) {
    return comoError(e)
  }
}

export async function cambiarEstadoCuentaAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_COBRAR')

    const cuentaId = texto(fd, 'cuentaId', 60)
    const activa = String(fd.get('activa') ?? '') === 'true'
    const res = await cambiarEstadoCuenta(cuentaId, activa)
    if (!res.ok) return { error: res.mensaje }

    await auditar('SUPPLY_CUENTA_COBRO_ESTADO', 'SupplyCuentaCobro', cuentaId, {
      activa,
      por: user.metadata.dbUserId ?? null,
    })
    refrescarPlataforma('cobros/cuentas')
    revalidatePath('/cliente/beneficios/disponibles')

    // Apagar la última cuenta apaga la venta. Se dice aquí y no se impide: si la
    // cuenta se cerró en el banco, seguir publicándola es peor.
    if (res.sinCobro) {
      return {
        success:
          'Cuenta desactivada. Era la última activa, así que Membego deja de cobrar y la vitrina vuelve a publicar solo lo gratuito.',
      }
    }
    return { success: activa ? 'Cuenta activada.' : 'Cuenta desactivada.' }
  } catch (e) {
    return comoError(e)
  }
}

export async function abrirPedidoAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const user = await getUser()
    if (!user) return { error: 'Inicia sesión para comprar.' }

    const clienteId = texto(fd, 'clienteId', 60)
    const asignacionId = texto(fd, 'asignacionId', 60)
    if (!clienteId || !asignacionId) return { error: 'Faltan datos del pedido.' }

    // El precio NO viene del formulario: se lee de la asignación. Si viniera del
    // navegador, cualquiera compraría una pizza por un peso cambiando un campo
    // oculto — y el pedido quedaría perfectamente cuadrado por ese peso.
    const oferta = await sinEmpresa('Membego Supply: precio de la asignación a comprar', (tx) =>
      tx.supplyAsignacion.findUnique({
        where: { id: asignacionId },
        select: { precioCliente: true, loteId: true, activa: true },
      })
    )
    if (!oferta?.activa) return { error: 'Esa oferta ya no está disponible.' }

    const res = await abrirPedido({
      clienteId,
      loteId: oferta.loteId,
      asignacionId,
      precio: Number(oferta.precioCliente),
      claveIdempotencia: claveIdempotencia('pedido', clienteId, asignacionId),
    })
    if (!res.ok) return { error: res.mensaje }

    await auditar('SUPPLY_PEDIDO_ABIERTO', 'SupplyPedido', res.pedidoId, {
      numero: res.numero,
      monto: res.monto,
    })
    revalidatePath('/cliente/beneficios')
    return { success: `Pedido ${res.numero} abierto.`, id: res.pedidoId }
  } catch (e) {
    return comoError(e)
  }
}

export async function adjuntarComprobanteAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await getUser()
    if (!user) return { error: 'Inicia sesión para enviar tu comprobante.' }

    const res = await adjuntarComprobante(
      texto(fd, 'pedidoId', 60),
      texto(fd, 'clienteId', 60),
      texto(fd, 'comprobantePath', 500),
      texto(fd, 'nota', 500) || null,
      texto(fd, 'metodo', 30) || null
    )
    if (!res.ok) return { error: res.mensaje }

    revalidatePath('/cliente/beneficios')
    return { success: 'Recibimos tu comprobante. Te avisamos al verificarlo.' }
  } catch (e) {
    return comoError(e)
  }
}

export async function cancelarPedidoAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await getUser()
    if (!user) return { error: 'Inicia sesión.' }

    const res = await cancelarPedido(texto(fd, 'pedidoId', 60), texto(fd, 'clienteId', 60))
    if (!res.ok) return { error: res.mensaje }

    revalidatePath('/cliente/beneficios')
    return { success: 'Pedido cancelado.' }
  } catch (e) {
    return comoError(e)
  }
}

export async function confirmarPedidoAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    // Lanza si no es plataforma, y `comoError` lo convierte en un mensaje.
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_COBRAR')
    const revisor = user.metadata.dbUserId
    // Sin revisor identificable no se confirma nada: la base exige revisor en
    // todo pedido pagado, y un pago sin firma no se le puede preguntar a nadie.
    if (!revisor) return { error: 'No se pudo identificar quién confirma.' }

    const pedidoId = texto(fd, 'pedidoId', 60)
    const montoVisto = numero(fd, 'montoVisto')
    if (montoVisto === null) {
      return { error: 'Escribe el monto que viste en la cuenta: se compara con el del pedido.' }
    }

    const metodoManual = texto(fd, 'metodoManual', 20)
    const res = await confirmarPedido(pedidoId, revisor, montoVisto, metodoManual === 'EFECTIVO' || metodoManual === 'MANUAL' ? metodoManual : null)
    if (!res.ok) return { error: res.mensaje }

    await auditar('SUPPLY_PEDIDO_COBRADO', 'SupplyPedido', pedidoId, { montoVisto, metodoManual: metodoManual || null })
    refrescarPlataforma('cobros')
    revalidatePath('/cliente/beneficios')
    return { success: 'Pago confirmado. El beneficio ya es utilizable.' }
  } catch (e) {
    return comoError(e)
  }
}

export async function reembolsarPedidoAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_COBRAR')
    const revisor = user.metadata.dbUserId
    if (!revisor) return { error: 'No se pudo identificar quién reembolsa.' }
    const pedidoId = texto(fd, 'pedidoId', 60)
    const motivo = texto(fd, 'motivo', 500)
    const res = await reembolsarPedido(pedidoId, motivo, revisor)
    if (!res.ok) return { error: res.mensaje }
    await auditar('SUPPLY_PEDIDO_REEMBOLSADO', 'SupplyPedido', pedidoId, { antes: 'PAGADO', despues: 'REEMBOLSADO', motivo })
    refrescarPlataforma('finanzas/cobros-clientes')
    revalidatePath('/cliente/beneficios')
    return { success: 'Reembolso registrado. El beneficio volvió al pool y el pedido quedó reembolsado.' }
  } catch (e) {
    return comoError(e)
  }
}

export async function rechazarPedidoAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_COBRAR')
    const revisor = user.metadata.dbUserId
    if (!revisor) return { error: 'No se pudo identificar quién rechaza.' }

    const pedidoId = texto(fd, 'pedidoId', 60)
    const res = await rechazarPedido(pedidoId, revisor, texto(fd, 'motivo', 500))
    if (!res.ok) return { error: res.mensaje }

    await auditar('SUPPLY_PEDIDO_RECHAZADO', 'SupplyPedido', pedidoId, {})
    refrescarPlataforma('cobros')
    revalidatePath('/cliente/beneficios')
    return { success: 'Pedido rechazado y unidad devuelta al pool.' }
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
      ventaId: texto(fd, 'ventaId', 60) || null,
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

    // Venta sin precompra: el mismo botón «Confirmar entrega», otro dominio.
    // No mueve ninguna cubeta: nace la cuenta por pagar por el neto (§14).
    const ventaId = texto(fd, 'ventaId', 60)
    if (ventaId) {
      const entrega = await entregarVenta({
        ventaId,
        proveedorId: companyId,
        sucursalId: texto(fd, 'sucursalId', 60) || null,
        empleadoId: user.metadata.dbUserId ?? null,
      })
      if (!entrega.ok) {
        const detalle = entrega.detalle ? ` Se entregó el ${entrega.detalle.fecha.toLocaleDateString('es-DO')}.` : ''
        return { error: entrega.mensaje + detalle }
      }
      await auditar('SUPPLY_VENTA_ENTREGADA', 'SupplyVentaDirecta', ventaId, {
        cuentaPorPagarId: entrega.cuentaPorPagarId,
        montoProveedor: entrega.montoProveedor,
        reutilizada: entrega.reutilizada,
      }, companyId)
      revalidatePath('/admin/supply')
      refrescarPlataforma('ventas')
      return { success: entrega.reutilizada ? 'Ya estaba registrada.' : 'Entrega confirmada. Membego le debe al proveedor el neto de la venta.', id: ventaId }
    }

    const voucherId = texto(fd, 'voucherId', 60)
    const res = await redimir({
      voucherId,
      proveedorId: companyId,
      sucursalId: texto(fd, 'sucursalId', 60) || null,
      empleadoId: user.metadata.dbUserId ?? null,
      sesionQrId: texto(fd, 'sesionQrId', 60) || null,
      dispositivo: await dispositivoActual(),
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

    const antes = await sinEmpresa('Membego Supply: estado previo de la incidencia para la bitácora', (tx) =>
      tx.supplyIncidencia.findUnique({ where: { id: incidenciaId }, select: { estado: true } })
    )
    await moverIncidencia(incidenciaId, estado as never, resolucion || null, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_INCIDENCIA_RESUELTA', 'SupplyIncidencia', incidenciaId, { antes: antes?.estado ?? null, despues: estado, resolucion })
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
      cuentaPorPagarId: texto(fd, 'cuentaPorPagarId', 60) || null,
      comprobantePath: texto(fd, 'comprobantePath', 500) || null,
      registradoPorId: user.metadata.dbUserId ?? null,
      claveIdempotencia: texto(fd, 'claveIdempotencia', 190) || null,
    })

    await auditar('SUPPLY_PAGO_REGISTRADO', 'SupplyPago', id, { acuerdoId, tipo, monto, reutilizado, cuentaPorPagarId: texto(fd, 'cuentaPorPagarId', 60) || null })
    refrescarPlataforma('finanzas/pagos')
    refrescarPlataforma('finanzas/cuentas-por-pagar')
    return { success: reutilizado ? 'El pago ya estaba registrado.' : 'Pago registrado como pendiente.', id }
  } catch (e) {
    return comoError(e)
  }
}

export async function anularPagoAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_APPROVE')
    const pagoId = texto(fd, 'pagoId', 60)
    const motivo = texto(fd, 'motivo', 500)
    await anularPago(pagoId, motivo, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_PAGO_ANULADO', 'SupplyPago', pagoId, { antes: 'PENDIENTE', despues: 'ANULADO', motivo })
    refrescarPlataforma('finanzas/pagos')
    return { success: 'Pago anulado.' }
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
    await auditar('SUPPLY_PAGO_CONFIRMADO', 'SupplyPago', pagoId, { antes: 'PENDIENTE', despues: 'CONFIRMADO' })
    refrescarPlataforma('finanzas/pagos')
    refrescarPlataforma('finanzas/depositos')
    refrescarPlataforma('finanzas/cuentas-por-pagar')
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
  /** Venta sin precompra: el mismo escáner, otro objeto (§14). */
  venta?: {
    ventaId: string
    numero: string
    cliente: string
    producto: string
    variante: string | null
    cantidad: number
    proveedor: string
    montoBruto: number
    avisoCobro: string
  }
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
/**
 * El comercio marca que ya preparó un pedido reservado (Fase 40).
 *
 * Guardada con `guardiaProveedor`, igual que el escáner: exige la sección
 * `supply` Y que la empresa tenga encendida la capacidad de proveedora. El
 * `companyId` viaja en el formulario y se comprueba; el id de la reserva se
 * vuelve a acotar por empresa dentro de `marcarLista`, que es donde de verdad
 * importa.
 */
export async function marcarPedidoListoAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const companyId = texto(fd, 'companyId', 60)
    const user = await guardiaProveedor(companyId)
    if (!user) return { error: 'No tienes permiso para gestionar los pedidos de Membego aquí.' }

    const reservaId = texto(fd, 'reservaId', 60)
    if (!reservaId) return { error: 'Falta la reserva.' }

    const { marcarLista } = await import('./reservas')
    const res = await marcarLista(reservaId, companyId)
    if (!res.ok) return { error: res.mensaje }

    revalidatePath('/admin/supply')
    return { success: 'Listo. Se le avisó al cliente.' }
  } catch (e) {
    return comoError(e)
  }
}

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

    if (!voucherId) {
      // ¿Es el código de recogida de una venta sin precompra?
      const venta = await sinEmpresa('Membego Supply: el comercio busca una venta por su código', (tx) =>
        fichaDeVentaPorCodigo(tx, leido)
      )
      if (venta) {
        return {
          venta: {
            ventaId: venta.ventaId,
            numero: venta.numero,
            cliente: venta.cliente,
            producto: venta.producto,
            variante: venta.variante,
            cantidad: venta.cantidad,
            proveedor: venta.proveedor,
            montoBruto: venta.montoBruto,
            avisoCobro:
              venta.estado === 'PAGADA'
                ? 'El cliente ya le pagó a Membego. No se le cobra nada: Membego te liquida el neto.'
                : `Esta venta está ${venta.estado.toLowerCase()}: no se puede entregar.`,
          },
        }
      }
      return { error: 'Este código no es de Membego Supply.' }
    }

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

// ── Reclamar una oferta de Membego (Fases 21, 56, 57) ───────────────────────

/**
 * El cliente reclama un beneficio publicado por Membego.
 *
 * TODA la comprobación ocurre antes de mover una unidad y dentro de la misma
 * transacción que la mueve: elegibilidad, cupo de la campaña y saldo del lote.
 * El prompt lo pide con estas palabras — «no permitir claim y verificar
 * después»— y la razón es concreta: una campaña de 200 con el límite «una por
 * persona» comprobado a posteriori reparte 260 vouchers y deja a Membego
 * eligiendo a quién decepcionar.
 */
export async function reclamarOfertaAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await getUser()
    if (!user) return { error: 'Inicia sesión para obtener tu beneficio.' }

    const clienteId = texto(fd, 'clienteId', 60)
    const asignacionId = texto(fd, 'asignacionId', 60)
    if (!clienteId || !asignacionId) return { error: 'Falta información de la oferta.' }

    const res = await entregar({
      clienteId,
      destino: 'CAMPANA',
      asignacionId,
      precioCliente: 0,
      referencia: 'marketplace',
    })
    if (!res.ok) return { error: res.mensaje }

    await auditar('SUPPLY_DERECHO_EMITIDO', 'SupplyDerecho', res.derechoId, {
      asignacionId,
      clienteId,
      canal: 'MARKETPLACE',
      reutilizado: res.reutilizado,
    })

    revalidatePath('/cliente/beneficios')
    revalidatePath('/cliente/explorar')
    return {
      success: res.reutilizado
        ? 'Ya tenías este beneficio: está en «Beneficios Membego».'
        : '¡Listo! Tu beneficio está en «Beneficios Membego».',
      id: res.derechoId,
    }
  } catch (e) {
    return comoError(e)
  }
}
