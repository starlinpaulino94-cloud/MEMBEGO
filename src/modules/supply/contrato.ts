import type {
  SupplyFrecuenciaCorte,
  SupplyModalidadPago,
  SupplyModeloComercial,
  SupplyPoliticaSobrante,
  SupplyTipo,
  SupplyTipoAcuerdo,
  SupplyAlcanceAcuerdo,
} from '@prisma/client'

/**
 * MEMBEGO SUPPLY · la FORMA y las REGLAS de un contrato con un proveedor.
 *
 * Separado de `procurement.ts` (que es `server-only`) porque estas reglas son
 * aritmética y condiciones, no acceso a datos: se prueban sin base, se pueden
 * usar para validar un formulario antes de enviarlo, y no arrastran Prisma a
 * quien solo quiere saber si un subsidio está bien formado.
 */

export interface DatosAcuerdo {
  proveedorId: string
  tipo: SupplyTipo
  modeloComercial: SupplyModeloComercial
  modalidadPago: SupplyModalidadPago
  politicaSobrante: SupplyPoliticaSobrante
  itemNombre: string
  itemDescripcion?: string | null
  varianteEtiqueta?: string | null
  servicioId?: string | null
  promocionId?: string | null
  cantidad: number
  costoUnitario: number
  precioReferencia?: number | null
  aporteMembego?: number | null
  moneda?: string
  anticipoPorcentaje?: number | null
  condicionesPago?: string | null
  inicioAt: Date
  finAt: Date
  sucursalIds?: string[]
  capacidadDiaria?: number | null
  capacidadHoraria?: number | null
  diasBloqueados?: string[]
  horarioTexto?: string | null
  reglasRedencion?: string | null
  reglasSustitucion?: string | null
  reglasCumplimiento?: string | null
  politicaCancelacion?: string | null
  notas?: string | null
  creadoPorId?: string | null
  // Condiciones comerciales y de liquidación (§4).
  comisionPorcentaje?: number | null
  descuentoPorcentaje?: number | null
  impuestoPorcentaje?: number | null
  plazoPagoDias?: number | null
  frecuenciaCorte?: SupplyFrecuenciaCorte | null
  metodoLiquidacion?: string | null
  politicaDevoluciones?: string | null
  slaTexto?: string | null
  // Wizard (encargo 2026-09 bis): tipo y alcance.
  tipoAcuerdo?: SupplyTipoAcuerdo | null
  alcance?: SupplyAlcanceAcuerdo | null
  categoriaCodigo?: string | null
}

function porcentajeValido(n: number | null | undefined): boolean {
  return n == null || (Number.isFinite(n) && n >= 0 && n <= 100)
}

/**
 * Comprobaciones que NO se pueden delegar a la base.
 *
 * La de SUBSIDIO es la importante: un subsidio sin aporte declarado es un
 * contrato que nadie sabe liquidar, y un aporte mayor que el precio público
 * significa que Membego paga más de lo que vale — casi siempre un dedo de más
 * al teclear, y si no lo es, hay que decirlo a mano en una enmienda.
 */
/**
 * Lo que cada tipo del wizard implica en el dominio. El tipo es la etiqueta
 * con la que se elige; modelo comercial y modalidad de pago son lo que las
 * reglas de abajo y el resto del módulo siguen mirando.
 */
export function derivarDeTipoAcuerdo(tipo: SupplyTipoAcuerdo): {
  modeloComercial: DatosAcuerdo['modeloComercial']
  modalidadPago: DatosAcuerdo['modalidadPago']
} {
  switch (tipo) {
    case 'COMPRA_PREPAGO':
      return { modeloComercial: 'COMPRA_UNIDAD_COMPLETA', modalidadPago: 'PREPAGO_TOTAL' }
    case 'DEPOSITO_ABIERTO':
    case 'PAGO_POSTERIOR':
      return { modeloComercial: 'COMPRA_UNIDAD_COMPLETA', modalidadPago: 'PAGO_POR_REDENCION' }
    case 'VENTA_COMISION':
      return { modeloComercial: 'COMISION', modalidadPago: 'PAGO_POR_REDENCION' }
    case 'HIBRIDO':
      return { modeloComercial: 'SUBSIDIO', modalidadPago: 'SUBSIDIO' }
  }
}

export function validarAcuerdo(d: DatosAcuerdo): string | null {
  if (!d.itemNombre.trim()) return 'Hace falta decir qué se está comprando.'
  if (d.tipoAcuerdo) {
    const esperado = derivarDeTipoAcuerdo(d.tipoAcuerdo)
    if (esperado.modeloComercial !== d.modeloComercial) {
      return `Un acuerdo de tipo ${d.tipoAcuerdo} va con el modelo comercial ${esperado.modeloComercial}.`
    }
  }
  if (d.alcance && d.alcance !== 'ITEM') {
    // «15% sobre todo el menú»: sin descuento ni comisión no hay acuerdo que aplicar.
    if ((d.descuentoPorcentaje ?? 0) <= 0 && (d.comisionPorcentaje ?? 0) <= 0) {
      return 'Un acuerdo por categoría o catálogo necesita un descuento o una comisión que aplicar.'
    }
    if (d.alcance === 'CATEGORIA' && !d.categoriaCodigo?.trim()) {
      return 'Un acuerdo por categoría tiene que decir cuál.'
    }
    if (d.modeloComercial !== 'COMISION') {
      return 'Hoy el alcance por categoría o catálogo se ofrece con el modelo de venta a comisión: Membego no precompra unidades de todo un menú.'
    }
  }
  if (!Number.isInteger(d.cantidad) || d.cantidad <= 0) {
    return 'La cantidad contratada tiene que ser un entero positivo.'
  }
  if (d.costoUnitario < 0) return 'El costo unitario no puede ser negativo.'
  if (d.finAt <= d.inicioAt) return 'La vigencia termina antes de empezar.'

  if (d.modeloComercial === 'SUBSIDIO') {
    const aporte = d.aporteMembego ?? 0
    if (aporte <= 0) {
      return 'Una oferta subsidiada tiene que declarar cuánto aporta Membego por unidad.'
    }
    if (d.precioReferencia != null && aporte > d.precioReferencia) {
      return 'El aporte de Membego no puede superar el precio público de la unidad.'
    }
  }

  if (d.modeloComercial === 'COMISION') {
    // Membego no compra: no hay costo unitario. Lo que hay es una comisión,
    // y sin ella no se sabe cuánto se le debe al proveedor por cada venta.
    if (d.costoUnitario !== 0) {
      return 'En una venta sin precompra Membego no paga la unidad: el costo unitario tiene que ser 0.'
    }
    if (d.comisionPorcentaje == null || d.comisionPorcentaje <= 0 || d.comisionPorcentaje > 100) {
      return 'Una venta sin precompra tiene que declarar la comisión de Membego (entre 0 y 100 por ciento).'
    }
    if (d.precioReferencia == null || d.precioReferencia <= 0) {
      return 'Una venta sin precompra necesita el precio al que se vende la unidad (precio público).'
    }
    if (d.modalidadPago !== 'PAGO_POR_REDENCION') {
      return 'En una venta sin precompra el proveedor cobra al entregar: la modalidad tiene que ser «se paga al redimirse».'
    }
  }

  if (!porcentajeValido(d.comisionPorcentaje) || !porcentajeValido(d.descuentoPorcentaje) || !porcentajeValido(d.impuestoPorcentaje)) {
    return 'Los porcentajes tienen que estar entre 0 y 100.'
  }
  if (d.plazoPagoDias != null && (!Number.isInteger(d.plazoPagoDias) || d.plazoPagoDias < 0)) {
    return 'El plazo de pago se expresa en días enteros, cero o más.'
  }

  if (d.modalidadPago === 'PREPAGO_PARCIAL') {
    const pct = d.anticipoPorcentaje ?? 0
    if (pct <= 0 || pct >= 100) {
      return 'Un anticipo parcial tiene que estar entre 1 y 99 por ciento.'
    }
  }

  if (d.tipo === 'CAPACIDAD_AGENDADA' && !d.capacidadDiaria) {
    return 'La capacidad agendada exige un cupo diario: sin él no se puede reservar.'
  }
  return null
}
