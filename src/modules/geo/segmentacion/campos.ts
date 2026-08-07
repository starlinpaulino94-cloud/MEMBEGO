/**
 * CATÁLOGO DE CAMPOS DEL CONTEXTO DE SEGMENTACIÓN (docs/GEOLOCALIZACION.md §10.2).
 *
 * No es una lista ad-hoc: es la fuente de verdad de qué puede preguntar el
 * constructor de segmentos y de cómo se valida cada condición. Cada campo
 * declara sus operadores válidos y el tipo de su valor, y —cuando el valor
 * sale de un catálogo real (ciudad, sector, tipo de vehículo)— el tipo de
 * catálogo contra el que hay que validarlo. No hay valores inventados: lo que
 * el admin no puede escribir por catálogo, no existe aquí.
 *
 * Este archivo es PURO (sin `server-only`): lo usa también la validación y el
 * builder SQL, que se prueban sin base de datos.
 */

export type OperadorCampo =
  | 'eq' // es / no es
  | 'neq'
  | 'in' // es uno de / no es ninguno de
  | 'not_in'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'es_true'
  | 'es_falso'

export type TipoValor = 'id' | 'texto' | 'numero' | 'fecha' | 'mes' | 'bool' | 'radio'

/** Catálogo real contra el que se valida el valor (nunca valores inventados). */
export interface ValorCatalogo {
  tipo: 'city' | 'sector' | 'tipoVehiculo'
  /** Los tipos de vehículo son por empresa; ciudad/sector son globales. */
  empresaEspecifica: boolean
}

export interface CampoDefinicion {
  /** Dot-path del contexto de segmentación (ej. "cliente.cityId"). */
  campo: string
  etiqueta: string
  descripcion: string
  tipo: TipoValor
  operadores: OperadorCampo[]
  catalogo?: ValorCatalogo
}

export const CAMPOS_SEGMENTACION: CampoDefinicion[] = [
  {
    campo: 'cliente.cityId',
    etiqueta: 'Ciudad',
    descripcion: 'Ciudad de la ubicación primaria del cliente.',
    tipo: 'id',
    operadores: ['eq', 'neq', 'in', 'not_in'],
    catalogo: { tipo: 'city', empresaEspecifica: false },
  },
  {
    campo: 'cliente.sectorId',
    etiqueta: 'Sector',
    descripcion: 'Sector de la ubicación primaria del cliente.',
    tipo: 'id',
    operadores: ['eq', 'neq', 'in', 'not_in'],
    catalogo: { tipo: 'sector', empresaEspecifica: false },
  },
  {
    campo: 'cliente.distanciaSucursalKm',
    etiqueta: 'Radio alrededor de una sucursal',
    descripcion:
      'Clientes cuya ubicación primaria (confirmada) queda dentro del radio de la sucursal.',
    tipo: 'radio',
    operadores: ['lte'],
  },
  {
    campo: 'cliente.esLocal',
    etiqueta: 'Cliente de mostrador',
    descripcion: 'Vino a lavar sin cuenta en la plataforma (exclúyelos de campañas).',
    tipo: 'bool',
    operadores: ['es_true', 'es_falso'],
  },
  {
    campo: 'cliente.createdAt',
    etiqueta: 'Fecha de registro',
    descripcion: 'Cuándo se registró como cliente de esta empresa.',
    tipo: 'fecha',
    operadores: ['gte', 'lt'],
  },
  {
    campo: 'cliente.ultimaVisitaDias',
    etiqueta: 'Días desde la última visita',
    descripcion: '"Al menos N" = inactivos; "a lo sumo N" = activos recientes.',
    tipo: 'numero',
    operadores: ['lte', 'gte'],
  },
  {
    campo: 'cliente.membresia.estado',
    etiqueta: 'Membresía',
    descripcion: 'Estado de su membresía (ACTIVA, VENCIDA, … o SIN_ACTIVA).',
    tipo: 'texto',
    operadores: ['eq', 'neq', 'in', 'not_in'],
  },
  {
    campo: 'cliente.vehiculo.tipoVehiculoId',
    etiqueta: 'Tipo de vehículo',
    descripcion: 'Categoría de vehículo registrada por el cliente.',
    tipo: 'id',
    operadores: ['eq', 'neq', 'in', 'not_in'],
    catalogo: { tipo: 'tipoVehiculo', empresaEspecifica: true },
  },
  {
    campo: 'cliente.cumpleMes',
    etiqueta: 'Mes de cumpleaños',
    descripcion: 'Mes de nacimiento (1–12), para campañas de cumpleaños.',
    tipo: 'mes',
    operadores: ['eq', 'neq'],
  },
]

export const CAMPOS_POR_NOMBRE: ReadonlyMap<string, CampoDefinicion> = new Map(
  CAMPOS_SEGMENTACION.map((c) => [c.campo, c])
)

export function campoDef(campo: string): CampoDefinicion | undefined {
  return CAMPOS_POR_NOMBRE.get(campo)
}

export function operadorPermitido(campo: string, operador: OperadorCampo): boolean {
  return campoDef(campo)?.operadores.includes(operador) ?? false
}

export function esOperadorValido(operador: string): operador is OperadorCampo {
  return [
    'eq',
    'neq',
    'in',
    'not_in',
    'lt',
    'lte',
    'gt',
    'gte',
    'es_true',
    'es_falso',
  ].includes(operador)
}

/** Estados de membresía segmentables + SIN_ACTIVA (no tiene ninguna activa). */
export const VALORES_MEMBRESIA = [
  'ACTIVA',
  'VENCIDA',
  'CANCELADA',
  'PENDIENTE',
  'SIN_ACTIVA',
] as const

export type ValorMembresia = (typeof VALORES_MEMBRESIA)[number]

export const ETIQUETA_MEMBRESIA: Record<ValorMembresia, string> = {
  ACTIVA: 'Activa',
  VENCIDA: 'Vencida',
  CANCELADA: 'Cancelada',
  PENDIENTE: 'Pendiente',
  SIN_ACTIVA: 'Sin membresía activa',
}

/** Forma de un valor de radio (necesita la sucursal + km). */
export interface ValorRadio {
  sucursalId: string
  km: number
}

export const RADIO_MIN_KM = 1
export const RADIO_MAX_KM = 200

export function esValorRadio(v: unknown): v is ValorRadio {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.sucursalId === 'string' && typeof r.km === 'number'
}

/** Etiqueta en lenguaje natural de cada operador (constructor visual). */
export function etiquetaOperador(op: OperadorCampo): string {
  switch (op) {
    case 'eq':
      return 'es'
    case 'neq':
      return 'no es'
    case 'in':
      return 'es uno de'
    case 'not_in':
      return 'no es ninguno de'
    case 'lt':
      return 'menor que'
    case 'lte':
      return 'dentro de'
    case 'gt':
      return 'mayor que'
    case 'gte':
      return 'al menos'
    case 'es_true':
      return 'es sí'
    case 'es_falso':
      return 'es no'
  }
}
