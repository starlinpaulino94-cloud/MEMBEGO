import type { SupplyAsientoTipo, SupplyPagoTipo } from '@prisma/client'

/**
 * MEMBEGO SUPPLY · ARITMÉTICA DEL DINERO CON EL PROVEEDOR.
 *
 * PURO, como `ledger.ts` lo es para las unidades: aquí viven las reglas que
 * deciden un signo, un saldo o un reparto, y que se prueban sin base de datos.
 * `finanzas.ts`, `depositos.ts`, `cuentas.ts`, `ventas.ts` y
 * `liquidaciones.ts` escriben; esto decide.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL SIGNO (ADR-0008)
 *
 * `monto` positivo = a favor del proveedor (Membego le debe más).
 * `monto` negativo = a favor de Membego.
 *
 * La auditoría del 29-09-2026 (hallazgo H1) encontró que `REEMBOLSO` iba en
 * negativo: un reembolso es dinero que el proveedor DEVUELVE a Membego, así
 * que reduce lo que el proveedor retiene de Membego y el saldo sube hacia
 * cero. Con un depósito de 100k (−100k) reembolsado entero, el saldo tiene
 * que quedar en 0, no en −200k.
 */

export function redondear2(n: number): number {
  return Number(n.toFixed(2))
}

/** Tipo de asiento que le corresponde a cada tipo de pago. */
export const ASIENTO_DE_PAGO: Record<SupplyPagoTipo, SupplyAsientoTipo> = {
  ANTICIPO: 'DEPOSITO',
  DEPOSITO: 'DEPOSITO',
  LIQUIDACION_REDENCIONES: 'PAGO',
  LIQUIDACION_FINAL: 'PAGO',
  REEMBOLSO: 'REEMBOLSO',
  AJUSTE: 'AJUSTE',
  CREDITO: 'CREDITO',
}

/**
 * Signo del asiento de un pago confirmado.
 *
 *  · Membego PAGA (depósito, anticipo, liquidación): sale dinero → negativo.
 *  · El proveedor DEVUELVE (reembolso): vuelve dinero → positivo.
 *  · CREDITO a favor del proveedor: positivo.
 *  · AJUSTE: quien lo registra dice el signo con el monto; aquí va con el
 *    signo de «pago» por defecto y el dominio lo puede invertir.
 */
export function signoDeAsiento(tipo: SupplyAsientoTipo): 1 | -1 {
  return tipo === 'CREDITO' || tipo === 'REEMBOLSO' || tipo === 'CUENTA_POR_PAGAR' ? 1 : -1
}

// ── Depósitos ───────────────────────────────────────────────────────────────

export interface EstadoDeposito {
  montoOriginal: number
  montoAplicado: number
  montoDevuelto: number
}

/** Lo que todavía se puede aplicar o devolver. */
export function saldoDisponibleDeposito(d: EstadoDeposito): number {
  return redondear2(d.montoOriginal - d.montoAplicado - d.montoDevuelto)
}

export type ResultadoAplicacion =
  | { ok: true; saldoAntes: number; saldoDespues: number; montoAplicado: number }
  | { ok: false; error: string }

/**
 * ¿Se puede aplicar `monto` del depósito a una obligación de `pendiente`?
 *
 * Nunca más de lo disponible y nunca más de lo que la obligación debe: aplicar
 * 30k a una factura de 20k dejaría 10k «pagados» sin obligación que los
 * explique. Devuelve el saldo antes y después para el movimiento.
 */
export function aplicarDeposito(d: EstadoDeposito, monto: number, pendiente: number): ResultadoAplicacion {
  if (!Number.isFinite(monto) || monto <= 0) {
    return { ok: false, error: 'El monto a aplicar tiene que ser positivo.' }
  }
  const disponible = saldoDisponibleDeposito(d)
  if (monto > disponible + 0.005) {
    return { ok: false, error: `El depósito solo tiene ${redondear2(disponible)} disponibles y se piden ${redondear2(monto)}.` }
  }
  if (monto > pendiente + 0.005) {
    return { ok: false, error: `La obligación solo debe ${redondear2(pendiente)} y se intentan aplicar ${redondear2(monto)}.` }
  }
  return { ok: true, saldoAntes: disponible, saldoDespues: redondear2(disponible - monto), montoAplicado: redondear2(monto) }
}

/** Estado que le toca al depósito según su saldo. */
export function estadoDeDeposito(d: EstadoDeposito): 'ABIERTO' | 'PARCIALMENTE_APLICADO' | 'AGOTADO' {
  const disponible = saldoDisponibleDeposito(d)
  if (disponible <= 0.005) return 'AGOTADO'
  if (d.montoAplicado > 0 || d.montoDevuelto > 0) return 'PARCIALMENTE_APLICADO'
  return 'ABIERTO'
}

// ── Cuentas por pagar / por cobrar ──────────────────────────────────────────

export interface EstadoCuenta {
  montoNeto: number
  montoSaldado: number
}

export function pendienteDeCuenta(c: EstadoCuenta): number {
  return redondear2(Math.max(0, c.montoNeto - c.montoSaldado))
}

export type ResultadoSaldar =
  | { ok: true; montoSaldado: number; estado: 'PARCIALMENTE_SALDADA' | 'SALDADA' }
  | { ok: false; error: string }

/**
 * Salda `monto` de una cuenta. Nunca por encima de lo pendiente: un pago que
 * excede la obligación es un error de captura o un reembolso pendiente, y
 * cualquiera de los dos se registra aparte, no se traga aquí.
 */
export function saldarCuenta(c: EstadoCuenta, monto: number): ResultadoSaldar {
  if (!Number.isFinite(monto) || monto <= 0) {
    return { ok: false, error: 'El monto a saldar tiene que ser positivo.' }
  }
  const pendiente = pendienteDeCuenta(c)
  if (monto > pendiente + 0.005) {
    return { ok: false, error: `La cuenta solo debe ${pendiente} y se intentan saldar ${redondear2(monto)}.` }
  }
  const saldado = redondear2(c.montoSaldado + monto)
  const estado = Math.abs(saldado - c.montoNeto) < 0.005 ? 'SALDADA' : 'PARCIALMENTE_SALDADA'
  return { ok: true, montoSaldado: estado === 'SALDADA' ? redondear2(c.montoNeto) : saldado, estado }
}

/** Neto de una cuenta por pagar: bruto − comisión − descuentos + impuestos. */
export function netoCuentaPorPagar(d: {
  montoBruto: number
  comision?: number
  descuentos?: number
  impuestos?: number
}): number {
  return redondear2(d.montoBruto - (d.comision ?? 0) - (d.descuentos ?? 0) + (d.impuestos ?? 0))
}

// ── Venta sin precompra (§14) ───────────────────────────────────────────────

export interface RepartoVenta {
  montoBruto: number
  comisionPorcentaje: number
  comisionMonto: number
  montoProveedor: number
}

/**
 * El reparto del encargo: RD$1.000 vendidos, 10% para Membego → RD$900 al
 * proveedor. La comisión se redondea a centavos y el resto es del proveedor,
 * para que las dos partes SUMEN el bruto exacto (lo exige el CHECK de la base).
 */
export function repartirVenta(precioUnitario: number, cantidad: number, comisionPorcentaje: number): RepartoVenta {
  if (!Number.isFinite(precioUnitario) || precioUnitario < 0) throw new Error('El precio no puede ser negativo.')
  if (!Number.isInteger(cantidad) || cantidad <= 0) throw new Error('La cantidad tiene que ser un entero positivo.')
  if (!Number.isFinite(comisionPorcentaje) || comisionPorcentaje < 0 || comisionPorcentaje > 100) {
    throw new Error('La comisión tiene que estar entre 0 y 100 por ciento.')
  }
  const montoBruto = redondear2(precioUnitario * cantidad)
  const comisionMonto = redondear2((montoBruto * comisionPorcentaje) / 100)
  return {
    montoBruto,
    comisionPorcentaje,
    comisionMonto,
    montoProveedor: redondear2(montoBruto - comisionMonto),
  }
}

// ── Liquidación (§17) ───────────────────────────────────────────────────────

export interface LineaNeteo {
  tipo: 'CUENTA_POR_PAGAR' | 'CUENTA_POR_COBRAR' | 'REDENCION' | 'DEPOSITO_APLICADO' | 'AJUSTE'
  /** Positivo a favor del proveedor, negativo a favor de Membego. */
  monto: number
  /** Solo en CUENTA_POR_PAGAR de origen VENTA_DIRECTA: bruto y comisión. */
  bruto?: number
  comision?: number
}

export interface SnapshotLiquidacion {
  ventasBrutas: number
  comisionMembego: number
  montoProveedor: number
  redencionesMonto: number
  reembolsos: number
  ajustes: number
  depositoAplicado: number
  netoLiquidar: number
}

/**
 * Suma las líneas de un corte. Es la aritmética que se congela en el snapshot:
 * cambiar el acuerdo después no la altera porque las líneas ya llevan sus
 * montos. `netoLiquidar` puede ser negativo (el proveedor debe a Membego).
 */
export function netearLiquidacion(lineas: readonly LineaNeteo[]): SnapshotLiquidacion {
  const s: SnapshotLiquidacion = {
    ventasBrutas: 0,
    comisionMembego: 0,
    montoProveedor: 0,
    redencionesMonto: 0,
    reembolsos: 0,
    ajustes: 0,
    depositoAplicado: 0,
    netoLiquidar: 0,
  }
  for (const l of lineas) {
    switch (l.tipo) {
      case 'CUENTA_POR_PAGAR':
        s.montoProveedor += l.monto
        s.ventasBrutas += l.bruto ?? 0
        s.comisionMembego += l.comision ?? 0
        break
      case 'REDENCION':
        s.redencionesMonto += l.monto
        break
      case 'CUENTA_POR_COBRAR':
        s.reembolsos += -l.monto
        break
      case 'DEPOSITO_APLICADO':
        s.depositoAplicado += -l.monto
        break
      case 'AJUSTE':
        s.ajustes += l.monto
        break
    }
    s.netoLiquidar += l.monto
  }
  for (const k of Object.keys(s) as (keyof SnapshotLiquidacion)[]) s[k] = redondear2(s[k])
  return s
}

/**
 * Cuánto del depósito conviene aplicar al corte: lo que cubra el neto
 * positivo, nunca más de lo disponible. Si el neto ya es ≤ 0, nada.
 */
export function depositoAplicableAlCorte(netoAntesDeDeposito: number, disponible: number): number {
  if (netoAntesDeDeposito <= 0 || disponible <= 0) return 0
  return redondear2(Math.min(netoAntesDeDeposito, disponible))
}

// ── Unit economics a comisión (§25) ─────────────────────────────────────────

export interface EconomiaComision {
  ventas: number
  ingresoBruto: number
  recibioProveedor: number
  retuvoMembego: number
  margenPorcentaje: number
}

export function economiaComision(ventas: readonly { montoBruto: number; comisionMonto: number; montoProveedor: number }[]): EconomiaComision {
  const ingresoBruto = redondear2(ventas.reduce((t, v) => t + v.montoBruto, 0))
  const retuvoMembego = redondear2(ventas.reduce((t, v) => t + v.comisionMonto, 0))
  const recibioProveedor = redondear2(ventas.reduce((t, v) => t + v.montoProveedor, 0))
  return {
    ventas: ventas.length,
    ingresoBruto,
    recibioProveedor,
    retuvoMembego,
    margenPorcentaje: ingresoBruto === 0 ? 0 : Number(((retuvoMembego / ingresoBruto) * 100).toFixed(1)),
  }
}
