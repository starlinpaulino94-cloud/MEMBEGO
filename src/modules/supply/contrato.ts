import type {
  SupplyModalidadPago,
  SupplyModeloComercial,
  SupplyPoliticaSobrante,
  SupplyTipo,
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
}

/**
 * Comprobaciones que NO se pueden delegar a la base.
 *
 * La de SUBSIDIO es la importante: un subsidio sin aporte declarado es un
 * contrato que nadie sabe liquidar, y un aporte mayor que el precio público
 * significa que Membego paga más de lo que vale — casi siempre un dedo de más
 * al teclear, y si no lo es, hay que decirlo a mano en una enmienda.
 */
export function validarAcuerdo(d: DatosAcuerdo): string | null {
  if (!d.itemNombre.trim()) return 'Hace falta decir qué se está comprando.'
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
