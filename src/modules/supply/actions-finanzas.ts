'use server'

import type {
  SupplyCuentaEstado,
  SupplyDiscrepanciaEstado,
  SupplyFacturaTipo,
  SupplyLiquidacionEstado,
} from '@prisma/client'
import { exigirPlataforma } from './permisos'
import {
  auditar,
  comoError,
  documentos,
  fecha,
  fechaFinDeDia,
  numero,
  refrescarPlataforma,
  texto,
  type EstadoAccion,
} from './actions-util'
import {
  convertirProveedorEnEmpresa,
  guardarPerfilProveedor,
  habilitarProveedorExistente,
  registrarProveedorExterno,
} from './proveedores'
import { aplicarDeposito, cerrarDeposito, devolverDeposito, registrarDeposito } from './depositos'
import { moverFactura, registrarFactura } from './facturas'
import { crearCuentaPorCobrarEnTx, crearCuentaPorPagarEnTx, moverCuenta } from './cuentas'
import {
  calcularLiquidacion,
  moverLiquidacion,
  pagarLiquidacion,
  recalcularLiquidacion,
} from './liquidaciones'
import {
  abrirConciliacion,
  agregarNotaDiscrepancia,
  cerrarConciliacion,
  moverDiscrepancia,
} from './conciliacion-proveedor'
import { sinEmpresa } from '@/lib/tenant'

/**
 * MEMBEGO SUPPLY · server actions de la capa financiera y de proveedores.
 *
 * Mismo contrato que `actions.ts`: guardia → regla de dominio → bitácora.
 * Todas son de plataforma; los permisos concretos siguen el catálogo de
 * `permisos.ts` (Supplier.Manage, Settlement.Manage, Reconciliation.Manage,
 * Supply.Adjust) aunque hoy todos resuelvan al rol SUPERADMIN.
 */

export type { EstadoAccion }

function refrescarFinanzas(...sufijos: string[]): void {
  refrescarPlataforma('finanzas')
  for (const s of sufijos) refrescarPlataforma(`finanzas/${s}`)
}

// ── Proveedores ─────────────────────────────────────────────────────────────

function perfilDeFormulario(fd: FormData) {
  return {
    rnc: texto(fd, 'rnc', 40) || null,
    razonSocial: texto(fd, 'razonSocial', 200) || null,
    contactoNombre: texto(fd, 'contactoNombre', 120) || null,
    contactoEmail: texto(fd, 'contactoEmail', 160) || null,
    contactoTelefono: texto(fd, 'contactoTelefono', 40) || null,
    banco: texto(fd, 'banco', 120) || null,
    cuentaBancaria: texto(fd, 'cuentaBancaria', 60) || null,
    tipoCuenta: texto(fd, 'tipoCuenta', 40) || null,
    plazoPagoDias: numero(fd, 'plazoPagoDias'),
    notas: texto(fd, 'notas', 2000) || null,
    whatsapp: texto(fd, 'whatsapp', 40) || null,
    direccion: texto(fd, 'direccion', 300) || null,
    pais: texto(fd, 'pais', 80) || null,
    moneda: texto(fd, 'moneda', 3) || null,
    condicionesPago: texto(fd, 'condicionesPago', 1000) || null,
    documentos: documentos(fd),
  }
}

export async function registrarProveedorExternoAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLIER_MANAGE')
    const nombre = texto(fd, 'nombre', 160)
    if (!nombre) return { error: 'El proveedor necesita un nombre.' }
    const res = await registrarProveedorExterno(
      {
        nombre,
        tipo: texto(fd, 'tipo', 60) || null,
        email: texto(fd, 'email', 160) || null,
        telefono: texto(fd, 'telefono', 40) || null,
        ciudad: texto(fd, 'ciudad', 80) || null,
        ...perfilDeFormulario(fd),
        contactoTelefono: texto(fd, 'contactoTelefono', 40) || texto(fd, 'telefono', 40) || null,
        contactoEmail: texto(fd, 'contactoEmail', 160) || texto(fd, 'email', 160) || null,
      },
      user.metadata.dbUserId ?? null
    )
    await auditar(
      'SUPPLY_PROVEEDOR_REGISTRADO',
      'SupplyProveedor',
      res.perfilId,
      { companyId: res.companyId, nombre, origen: 'EXTERNA', reutilizado: res.reutilizado },
      res.companyId
    )
    refrescarPlataforma('proveedores')
    return {
      success: res.reutilizado ? 'Ese proveedor ya existía: se reutilizó.' : `Proveedor «${nombre}» registrado.`,
      id: res.companyId,
    }
  } catch (e) {
    return comoError(e)
  }
}

export async function habilitarProveedorExistenteAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLIER_MANAGE')
    const companyId = texto(fd, 'companyId', 60)
    if (!companyId) return { error: 'Elige la empresa.' }
    const res = await habilitarProveedorExistente(companyId, perfilDeFormulario(fd), user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_PROVEEDOR_HABILITADO', 'SupplyProveedor', res.perfilId, { companyId, yaEra: res.yaEra }, companyId)
    refrescarPlataforma('proveedores')
    refrescarPlataforma('acuerdos')
    return {
      success: res.yaEra ? 'Esa empresa ya era proveedora: se actualizó su perfil.' : 'Empresa habilitada como proveedora de Membego.',
      id: companyId,
    }
  } catch (e) {
    return comoError(e)
  }
}

export async function guardarPerfilProveedorAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLIER_MANAGE')
    const companyId = texto(fd, 'companyId', 60)
    if (!companyId) return { error: 'Falta la empresa.' }
    const activo = fd.get('activo') == null ? undefined : fd.get('activo') === 'on' || fd.get('activo') === 'true'
    const res = await guardarPerfilProveedor(
      companyId,
      { ...perfilDeFormulario(fd), activo },
      user.metadata.dbUserId ?? null
    )
    await auditar('SUPPLY_PROVEEDOR_ACTUALIZADO', 'SupplyProveedor', res.perfilId, { companyId, activo: activo ?? null }, companyId)
    refrescarPlataforma('proveedores')
    refrescarPlataforma(`proveedores/${companyId}`)
    return { success: 'Perfil del proveedor guardado.', id: res.perfilId }
  } catch (e) {
    return comoError(e)
  }
}

export async function convertirProveedorAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    await exigirPlataforma('MEMBEGO_SUPPLIER_MANAGE')
    const companyId = texto(fd, 'companyId', 60)
    if (!companyId) return { error: 'Falta la empresa.' }
    await convertirProveedorEnEmpresa(companyId)
    await auditar('SUPPLY_PROVEEDOR_ACTUALIZADO', 'Company', companyId, { antes: 'EXTERNA', despues: 'REGISTRADA' }, companyId)
    refrescarPlataforma('proveedores')
    refrescarPlataforma(`proveedores/${companyId}`)
    return { success: 'El proveedor ahora es una empresa registrada en Membego. Su historial sigue intacto.' }
  } catch (e) {
    return comoError(e)
  }
}

// ── Depósitos ───────────────────────────────────────────────────────────────

export async function registrarDepositoAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_APPROVE')
    const monto = numero(fd, 'monto')
    if (monto == null) return { error: 'Hace falta el monto.' }
    const proveedorId = texto(fd, 'proveedorId', 60)
    const acuerdoId = texto(fd, 'acuerdoId', 60)
    const res = await registrarDeposito({
      proveedorId,
      acuerdoId: acuerdoId || null,
      monto,
      moneda: texto(fd, 'moneda', 3) || undefined,
      referencia: texto(fd, 'referencia', 200) || null,
      metodo: texto(fd, 'metodo', 100) || null,
      notas: texto(fd, 'notas', 2000) || null,
      cierraAt: fechaFinDeDia(fd, 'cierraAt'),
      documentos: documentos(fd),
      registradoPorId: user.metadata.dbUserId ?? null,
      claveIdempotencia: texto(fd, 'claveIdempotencia', 190) || null,
    })
    await auditar('SUPPLY_DEPOSITO_REGISTRADO', 'SupplyDeposito', res.id, {
      codigo: res.codigo,
      proveedorId,
      acuerdoId,
      monto,
      pagoId: res.pagoId,
      reutilizado: res.reutilizado,
    }, proveedorId)
    refrescarFinanzas('depositos', 'pagos')
    return {
      success: res.reutilizado
        ? 'Ese depósito ya estaba registrado.'
        : `Depósito ${res.codigo} registrado. Se abre cuando tesorería confirme el pago.`,
      id: res.id,
    }
  } catch (e) {
    return comoError(e)
  }
}

export async function aplicarDepositoAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_APPROVE')
    const depositoId = texto(fd, 'depositoId', 60)
    const cuentaPorPagarId = texto(fd, 'cuentaPorPagarId', 60)
    const monto = numero(fd, 'monto')
    if (!depositoId || !cuentaPorPagarId || monto == null) return { error: 'Faltan datos de la aplicación.' }
    const res = await aplicarDeposito(depositoId, cuentaPorPagarId, monto, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_DEPOSITO_APLICADO', 'SupplyDeposito', depositoId, {
      cuentaPorPagarId,
      monto: res.montoAplicado,
      saldoAntes: res.saldoAntes,
      saldoDespues: res.saldoDespues,
    })
    refrescarFinanzas('depositos', `depositos/${depositoId}`, 'cuentas-por-pagar')
    return { success: `Aplicado. Saldo del depósito: ${res.saldoDespues.toFixed(2)}.` }
  } catch (e) {
    return comoError(e)
  }
}

export async function devolverDepositoAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_APPROVE')
    const depositoId = texto(fd, 'depositoId', 60)
    const monto = numero(fd, 'monto')
    if (!depositoId || monto == null) return { error: 'Faltan datos de la devolución.' }
    const res = await devolverDeposito(depositoId, monto, texto(fd, 'referencia', 200) || null, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_DEPOSITO_DEVUELTO', 'SupplyDeposito', depositoId, { monto, saldoDespues: res.saldoDespues })
    refrescarFinanzas('depositos', `depositos/${depositoId}`, 'pagos')
    return { success: `Devolución registrada. Saldo del depósito: ${res.saldoDespues.toFixed(2)}.` }
  } catch (e) {
    return comoError(e)
  }
}

export async function cerrarDepositoAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_APPROVE')
    const depositoId = texto(fd, 'depositoId', 60)
    const motivo = texto(fd, 'motivo', 500)
    if (!depositoId) return { error: 'Falta el depósito.' }
    await cerrarDeposito(depositoId, motivo, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_DEPOSITO_CERRADO', 'SupplyDeposito', depositoId, { motivo, despues: 'CERRADO' })
    refrescarFinanzas('depositos', `depositos/${depositoId}`)
    return { success: 'Depósito cerrado.' }
  } catch (e) {
    return comoError(e)
  }
}

// ── Facturas de proveedor ───────────────────────────────────────────────────

const TIPOS_FACTURA: readonly SupplyFacturaTipo[] = ['FACTURA', 'NOTA_CREDITO', 'NOTA_DEBITO']

export async function registrarFacturaAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_APPROVE')
    const proveedorId = texto(fd, 'proveedorId', 60)
    const numeroFactura = texto(fd, 'numero', 60)
    const subtotal = numero(fd, 'subtotal')
    const fechaEmision = fecha(fd, 'fechaEmision')
    const tipo = texto(fd, 'tipo', 20) as SupplyFacturaTipo
    if (!proveedorId || !numeroFactura || subtotal == null || !fechaEmision) {
      return { error: 'Faltan proveedor, número, subtotal o fecha de emisión.' }
    }
    if (!TIPOS_FACTURA.includes(tipo)) return { error: 'Tipo de documento no válido.' }
    const res = await registrarFactura({
      proveedorId,
      acuerdoId: texto(fd, 'acuerdoId', 60) || null,
      ordenId: texto(fd, 'ordenId', 60) || null,
      tipo,
      numero: numeroFactura,
      fechaEmision,
      fechaVencimiento: fechaFinDeDia(fd, 'fechaVencimiento'),
      subtotal,
      impuestos: numero(fd, 'impuestos') ?? 0,
      moneda: texto(fd, 'moneda', 3) || undefined,
      documentoPath: texto(fd, 'documentoPath', 500) || null,
      notas: texto(fd, 'notas', 2000) || null,
      registradoPorId: user.metadata.dbUserId ?? null,
      claveIdempotencia: texto(fd, 'claveIdempotencia', 190) || null,
    })
    await auditar('SUPPLY_FACTURA_REGISTRADA', 'SupplyFacturaProveedor', res.id, {
      codigo: res.codigo,
      proveedorId,
      numero: numeroFactura,
      tipo,
      total: res.total,
      reutilizada: res.reutilizada,
    }, proveedorId)
    refrescarFinanzas('facturas', 'cuentas-por-pagar', 'cuentas-por-cobrar')
    return {
      success: res.reutilizada ? 'Esa factura ya estaba registrada.' : `${res.codigo} registrada por ${res.total.toFixed(2)}.`,
      id: res.id,
    }
  } catch (e) {
    return comoError(e)
  }
}

export async function moverFacturaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_APPROVE')
    const facturaId = texto(fd, 'facturaId', 60)
    const hasta = texto(fd, 'hasta', 20)
    const motivo = texto(fd, 'motivo', 500)
    if (!facturaId || !['DISPUTADA', 'ANULADA', 'REGISTRADA'].includes(hasta)) return { error: 'Transición no válida.' }
    const antes = await sinEmpresa('Membego Supply: estado actual de una factura', (tx) =>
      tx.supplyFacturaProveedor.findUnique({ where: { id: facturaId }, select: { estado: true } })
    )
    await moverFactura(facturaId, hasta as 'DISPUTADA' | 'ANULADA' | 'REGISTRADA', motivo, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_FACTURA_ESTADO', 'SupplyFacturaProveedor', facturaId, { antes: antes?.estado ?? null, despues: hasta, motivo })
    refrescarFinanzas('facturas', 'cuentas-por-pagar')
    return { success: `Factura → ${hasta}.` }
  } catch (e) {
    return comoError(e)
  }
}

// ── Cuentas por pagar / por cobrar ──────────────────────────────────────────

export async function moverCuentaAction(_prev: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_ADJUST')
    const lado = texto(fd, 'lado', 3) === 'CXC' ? 'CXC' : 'CXP'
    const cuentaId = texto(fd, 'cuentaId', 60)
    const hasta = texto(fd, 'hasta', 30) as SupplyCuentaEstado
    const motivo = texto(fd, 'motivo', 500)
    if (!cuentaId || !hasta) return { error: 'Faltan datos.' }
    const antes = await sinEmpresa('Membego Supply: estado actual de una cuenta', (tx) =>
      lado === 'CXP'
        ? tx.supplyCuentaPorPagar.findUnique({ where: { id: cuentaId }, select: { estado: true } })
        : tx.supplyCuentaPorCobrar.findUnique({ where: { id: cuentaId }, select: { estado: true } })
    )
    await moverCuenta(lado, cuentaId, hasta, motivo, user.metadata.dbUserId ?? null)
    await auditar(
      lado === 'CXP' ? 'SUPPLY_CXP_ESTADO' : 'SUPPLY_CXC_ESTADO',
      lado === 'CXP' ? 'SupplyCuentaPorPagar' : 'SupplyCuentaPorCobrar',
      cuentaId,
      { antes: antes?.estado ?? null, despues: hasta, motivo }
    )
    refrescarFinanzas(lado === 'CXP' ? 'cuentas-por-pagar' : 'cuentas-por-cobrar')
    return { success: `Cuenta → ${hasta}.` }
  } catch (e) {
    return comoError(e)
  }
}

/** Cuenta manual (ajuste, penalización, subsidio…) que no nace de un documento. */
export async function crearCuentaManualAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SUPPLY_ADJUST')
    const lado = texto(fd, 'lado', 3) === 'CXC' ? 'CXC' : 'CXP'
    const proveedorId = texto(fd, 'proveedorId', 60)
    const descripcion = texto(fd, 'descripcion', 300)
    const monto = numero(fd, 'monto')
    if (!proveedorId || !descripcion || monto == null || monto <= 0) {
      return { error: 'Faltan proveedor, descripción o un monto positivo.' }
    }
    const comun = {
      proveedorId,
      acuerdoId: texto(fd, 'acuerdoId', 60) || null,
      descripcion,
      vencimientoAt: fechaFinDeDia(fd, 'vencimientoAt'),
      notas: texto(fd, 'notas', 2000) || null,
      creadoPorId: user.metadata.dbUserId ?? null,
      claveIdempotencia: texto(fd, 'claveIdempotencia', 190) || null,
    }
    const res = await sinEmpresa('Membego Supply: cuenta manual', (tx) =>
      lado === 'CXP'
        ? crearCuentaPorPagarEnTx(tx, { ...comun, origen: texto(fd, 'origen', 30) === 'AJUSTE' ? 'AJUSTE' : 'MANUAL', montoBruto: monto })
        : crearCuentaPorCobrarEnTx(tx, { ...comun, origen: (texto(fd, 'origen', 30) || 'AJUSTE') as never, monto })
    )
    await auditar(
      lado === 'CXP' ? 'SUPPLY_CXP_CREADA' : 'SUPPLY_CXC_CREADA',
      lado === 'CXP' ? 'SupplyCuentaPorPagar' : 'SupplyCuentaPorCobrar',
      res.id,
      { codigo: res.codigo, proveedorId, monto: res.montoNeto, descripcion, manual: true },
      proveedorId
    )
    refrescarFinanzas(lado === 'CXP' ? 'cuentas-por-pagar' : 'cuentas-por-cobrar')
    return { success: `${res.codigo} creada por ${res.montoNeto.toFixed(2)}.`, id: res.id }
  } catch (e) {
    return comoError(e)
  }
}

// ── Liquidaciones ───────────────────────────────────────────────────────────

export async function calcularLiquidacionAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SETTLEMENT_MANAGE')
    const proveedorId = texto(fd, 'proveedorId', 60)
    const desde = fecha(fd, 'desde')
    const hasta = fechaFinDeDia(fd, 'hasta')
    if (!proveedorId || !desde || !hasta) return { error: 'Faltan proveedor o período.' }
    const res = await calcularLiquidacion({
      proveedorId,
      acuerdoId: texto(fd, 'acuerdoId', 60) || null,
      desde,
      hasta,
      aplicarDeposito: fd.get('aplicarDeposito') === 'on' || fd.get('aplicarDeposito') === 'true',
      notas: texto(fd, 'notas', 2000) || null,
      calculadaPorId: user.metadata.dbUserId ?? null,
      claveIdempotencia: texto(fd, 'claveIdempotencia', 190) || null,
    })
    await auditar('SUPPLY_LIQUIDACION_CALCULADA', 'SupplyLiquidacion', res.id, {
      codigo: res.codigo,
      proveedorId,
      desde: desde.toISOString(),
      hasta: hasta.toISOString(),
      netoLiquidar: res.netoLiquidar,
      lineas: res.lineas,
    }, proveedorId)
    refrescarFinanzas('liquidaciones', `liquidaciones/${res.id}`)
    return { success: `${res.codigo} calculada: neto ${res.netoLiquidar.toFixed(2)} en ${res.lineas} líneas.`, id: res.id }
  } catch (e) {
    return comoError(e)
  }
}

export async function recalcularLiquidacionAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SETTLEMENT_MANAGE')
    const liquidacionId = texto(fd, 'liquidacionId', 60)
    if (!liquidacionId) return { error: 'Falta la liquidación.' }
    const res = await recalcularLiquidacion(
      liquidacionId,
      user.metadata.dbUserId ?? null,
      fd.get('aplicarDeposito') === 'on' || fd.get('aplicarDeposito') === 'true'
    )
    await auditar('SUPPLY_LIQUIDACION_CALCULADA', 'SupplyLiquidacion', liquidacionId, { recalculo: true, netoLiquidar: res.netoLiquidar, lineas: res.lineas })
    refrescarFinanzas('liquidaciones', `liquidaciones/${liquidacionId}`)
    return { success: `Recalculada: neto ${res.netoLiquidar.toFixed(2)}.` }
  } catch (e) {
    return comoError(e)
  }
}

const TRANSICIONES_LIQ_MANUALES: readonly SupplyLiquidacionEstado[] = ['EN_REVISION', 'APROBADA', 'DISPUTADA', 'CANCELADA', 'CONCILIADA']

export async function moverLiquidacionAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SETTLEMENT_MANAGE')
    const liquidacionId = texto(fd, 'liquidacionId', 60)
    const hasta = texto(fd, 'hasta', 20) as SupplyLiquidacionEstado
    const motivo = texto(fd, 'motivo', 500)
    if (!liquidacionId || !TRANSICIONES_LIQ_MANUALES.includes(hasta)) return { error: 'Transición no válida.' }
    const antes = await sinEmpresa('Membego Supply: estado actual de una liquidación', (tx) =>
      tx.supplyLiquidacion.findUnique({ where: { id: liquidacionId }, select: { estado: true } })
    )
    await moverLiquidacion(liquidacionId, hasta as never, user.metadata.dbUserId ?? null, motivo || null)
    await auditar('SUPPLY_LIQUIDACION_ESTADO', 'SupplyLiquidacion', liquidacionId, { antes: antes?.estado ?? null, despues: hasta, motivo })
    refrescarFinanzas('liquidaciones', `liquidaciones/${liquidacionId}`)
    return { success: `Liquidación → ${hasta}.` }
  } catch (e) {
    return comoError(e)
  }
}

export async function pagarLiquidacionAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_SETTLEMENT_MANAGE')
    const liquidacionId = texto(fd, 'liquidacionId', 60)
    if (!liquidacionId) return { error: 'Falta la liquidación.' }
    const res = await pagarLiquidacion(liquidacionId, {
      metodo: texto(fd, 'metodo', 100) || null,
      referencia: texto(fd, 'referencia', 200) || null,
      actorId: user.metadata.dbUserId ?? null,
    })
    await auditar('SUPPLY_LIQUIDACION_ESTADO', 'SupplyLiquidacion', liquidacionId, {
      antes: 'APROBADA',
      despues: 'PAGADA',
      pagoId: res.pagoId ?? null,
      netoLiquidar: res.netoLiquidar,
      depositoAplicado: res.depositoAplicado,
    })
    refrescarFinanzas('liquidaciones', `liquidaciones/${liquidacionId}`, 'pagos', 'depositos', 'cuentas-por-pagar', 'cuentas-por-cobrar')
    return { success: `Liquidación pagada: neto ${res.netoLiquidar.toFixed(2)}, ${res.depositoAplicado.toFixed(2)} tomados de depósitos.` }
  } catch (e) {
    return comoError(e)
  }
}

// ── Conciliación con el proveedor ───────────────────────────────────────────

export async function abrirConciliacionAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_RECONCILIATION_MANAGE')
    const proveedorId = texto(fd, 'proveedorId', 60)
    const desde = fecha(fd, 'desde')
    const hasta = fechaFinDeDia(fd, 'hasta')
    const proveedorRedenciones = numero(fd, 'proveedorRedenciones')
    const proveedorMonto = numero(fd, 'proveedorMonto')
    if (!proveedorId || !desde || !hasta || proveedorRedenciones == null || proveedorMonto == null) {
      return { error: 'Faltan proveedor, período o las cifras declaradas por el proveedor.' }
    }
    const res = await abrirConciliacion({
      proveedorId,
      acuerdoId: texto(fd, 'acuerdoId', 60) || null,
      liquidacionId: texto(fd, 'liquidacionId', 60) || null,
      desde,
      hasta,
      proveedorRedenciones,
      proveedorMonto,
      proveedorVentas: numero(fd, 'proveedorVentas') ?? undefined,
      proveedorVentasMonto: numero(fd, 'proveedorVentasMonto') ?? undefined,
      notas: texto(fd, 'notas', 2000) || null,
      documentos: documentos(fd),
      creadoPorId: user.metadata.dbUserId ?? null,
    })
    await auditar('SUPPLY_CONCILIACION_ABIERTA', 'SupplyConciliacion', res.id, {
      codigo: res.codigo,
      proveedorId,
      desde: desde.toISOString(),
      hasta: hasta.toISOString(),
      discrepancias: res.discrepancias,
    }, proveedorId)
    refrescarPlataforma('conciliacion')
    refrescarPlataforma(`conciliacion/${res.id}`)
    return {
      success:
        res.discrepancias === 0
          ? `${res.codigo} abierta: las cifras cuadran.`
          : `${res.codigo} abierta con ${res.discrepancias} discrepancia(s) por investigar.`,
      id: res.id,
    }
  } catch (e) {
    return comoError(e)
  }
}

export async function moverDiscrepanciaAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_RECONCILIATION_MANAGE')
    const discrepanciaId = texto(fd, 'discrepanciaId', 60)
    const conciliacionId = texto(fd, 'conciliacionId', 60)
    const hasta = texto(fd, 'hasta', 30) as SupplyDiscrepanciaEstado
    if (!discrepanciaId || !hasta) return { error: 'Faltan datos.' }
    const ajusteMonto = numero(fd, 'ajusteMonto')
    const ajuste =
      hasta === 'AJUSTADA' && ajusteMonto != null
        ? {
            lado: texto(fd, 'ajusteLado', 3) === 'CXC' ? ('CXC' as const) : ('CXP' as const),
            monto: ajusteMonto,
            descripcion: texto(fd, 'ajusteDescripcion', 300) || null,
          }
        : null
    const antes = await sinEmpresa('Membego Supply: estado actual de una discrepancia', (tx) =>
      tx.supplyDiscrepancia.findUnique({ where: { id: discrepanciaId }, select: { estado: true } })
    )
    await moverDiscrepancia(discrepanciaId, hasta, {
      resolucion: texto(fd, 'resolucion', 2000) || null,
      ajuste,
      actorId: user.metadata.dbUserId ?? null,
    })
    await auditar('SUPPLY_DISCREPANCIA_ESTADO', 'SupplyDiscrepancia', discrepanciaId, {
      antes: antes?.estado ?? null,
      despues: hasta,
      ajuste: ajuste ? { lado: ajuste.lado, monto: ajuste.monto } : null,
    })
    refrescarPlataforma('conciliacion')
    if (conciliacionId) refrescarPlataforma(`conciliacion/${conciliacionId}`)
    refrescarFinanzas('cuentas-por-pagar', 'cuentas-por-cobrar')
    return { success: `Discrepancia → ${hasta}.` }
  } catch (e) {
    return comoError(e)
  }
}

export async function agregarNotaDiscrepanciaAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_RECONCILIATION_MANAGE')
    const discrepanciaId = texto(fd, 'discrepanciaId', 60)
    const conciliacionId = texto(fd, 'conciliacionId', 60)
    if (!discrepanciaId) return { error: 'Falta la discrepancia.' }
    const res = await agregarNotaDiscrepancia(
      discrepanciaId,
      texto(fd, 'texto', 2000),
      texto(fd, 'documentoPath', 500) || null,
      user.metadata.dbUserId ?? null
    )
    if (conciliacionId) refrescarPlataforma(`conciliacion/${conciliacionId}`)
    return { success: 'Nota agregada.', id: res.id }
  } catch (e) {
    return comoError(e)
  }
}

export async function cerrarConciliacionAction(
  _prev: EstadoAccion,
  fd: FormData
): Promise<EstadoAccion> {
  try {
    const user = await exigirPlataforma('MEMBEGO_RECONCILIATION_MANAGE')
    const conciliacionId = texto(fd, 'conciliacionId', 60)
    if (!conciliacionId) return { error: 'Falta la conciliación.' }
    await cerrarConciliacion(conciliacionId, user.metadata.dbUserId ?? null)
    await auditar('SUPPLY_CONCILIACION_ESTADO', 'SupplyConciliacion', conciliacionId, { despues: 'CERRADA' })
    refrescarPlataforma('conciliacion')
    refrescarPlataforma(`conciliacion/${conciliacionId}`)
    refrescarFinanzas('liquidaciones')
    return { success: 'Conciliación cerrada.' }
  } catch (e) {
    return comoError(e)
  }
}
