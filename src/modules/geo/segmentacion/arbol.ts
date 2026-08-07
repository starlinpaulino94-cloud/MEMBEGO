/**
 * ÁRBOL DE CONDICIONES DE UN SEGMENTO (docs/GEOLOCALIZACION.md §10.3).
 *
 * Transforma el DTO del constructor en un AST normalizado y válido, con el
 * mismo patrón que el Rule Engine (AND/OR/NOT anidables). Validación
 * ESTRUCTURAL y DE OPERADORES — los valores contra catálogos reales (ciudad,
 * sector, tipo de vehículo) se validan en el servicio, que tiene acceso a la
 * base de datos (docs/GEOLOCALIZACION.md §10.1: "no hay valores inventados").
 *
 * PURO (sin `server-only`): se prueba sin base de datos.
 */

import {
  CAMPOS_POR_NOMBRE,
  VALORES_MEMBRESIA,
  esOperadorValido,
  esValorRadio,
  operadorPermitido,
  RADIO_MAX_KM,
  RADIO_MIN_KM,
  type OperadorCampo,
  type ValorRadio,
} from './campos'

export type OperadorGrupo = 'AND' | 'OR' | 'NOT'

export interface CondicionDto {
  campo: string
  operador: string
  valor: unknown
}

export interface GrupoDto {
  operador: string
  condiciones: CondicionDto[]
  grupos: GrupoDto[]
}

/** Raíz de un segmento: un grupo booleano con su operador de combinación. */
export interface SegmentoRaiz {
  operador: string
  condiciones: CondicionDto[]
  grupos: GrupoDto[]
}

/** Condición ya validada: operador tipado y valor con forma correcta. */
export interface CondicionValida {
  campo: string
  operador: OperadorCampo
  valor: unknown
}

export type Nodo =
  | { tipo: 'condicion'; cond: CondicionValida }
  | { tipo: 'grupo'; operador: OperadorGrupo; hijos: Nodo[] }

export const PROFUNDIDAD_MAXIMA = 4

export function esRaizVacia(raiz: SegmentoRaiz): boolean {
  return raiz.condiciones.length === 0 && raiz.grupos.length === 0
}

function esOperadorGrupo(v: unknown): v is OperadorGrupo {
  return v === 'AND' || v === 'OR' || v === 'NOT'
}

/**
 * Normaliza y valida una raíz. Lanza `Error` con el mensaje en español del
 * primer problema encontrado (fail-closed). Devuelve el nodo raíz del AST.
 */
export function normalizarRaiz(raiz: SegmentoRaiz): Nodo {
  if (!raiz || typeof raiz !== 'object') {
    throw new Error('El segmento debe tener un árbol de condiciones.')
  }
  if (!esOperadorGrupo(raiz.operador)) {
    throw new Error('Operador de combinación inválido.')
  }
  const condiciones = Array.isArray(raiz.condiciones) ? raiz.condiciones : []
  const grupos = Array.isArray(raiz.grupos) ? raiz.grupos : []
  const hijos: Nodo[] = []
  for (const c of condiciones) hijos.push({ tipo: 'condicion', cond: normalizarCondicion(c) })
  for (const g of grupos) hijos.push(normalizarGrupo(g, 0))
  return { tipo: 'grupo', operador: raiz.operador, hijos }
}

function normalizarGrupo(g: GrupoDto, profundidad: number): Nodo {
  if (profundidad >= PROFUNDIDAD_MAXIMA) {
    throw new Error(`La profundidad máxima de grupos es ${PROFUNDIDAD_MAXIMA}.`)
  }
  if (!g || typeof g !== 'object') {
    throw new Error('Grupo inválido: debe tener operador, condiciones y grupos.')
  }
  if (!esOperadorGrupo(g.operador)) {
    throw new Error('Operador de grupo inválido (use Y, O o NO).')
  }
  const condiciones = Array.isArray(g.condiciones) ? g.condiciones : []
  const grupos = Array.isArray(g.grupos) ? g.grupos : []
  if (condiciones.length === 0 && grupos.length === 0) {
    throw new Error('Un grupo no puede estar vacío.')
  }
  const hijos: Nodo[] = []
  for (const c of condiciones) hijos.push({ tipo: 'condicion', cond: normalizarCondicion(c) })
  for (const sg of grupos) hijos.push(normalizarGrupo(sg, profundidad + 1))
  return { tipo: 'grupo', operador: g.operador, hijos }
}

export function normalizarCondicion(c: CondicionDto): CondicionValida {
  if (!c || typeof c !== 'object') {
    throw new Error('Condición inválida: se esperaba un objeto con campo, operador y valor.')
  }
  const campo = c.campo
  const def = CAMPOS_POR_NOMBRE.get(campo)
  if (!def) {
    throw new Error(`Campo de segmentación desconocido: "${campo}".`)
  }
  if (!esOperadorValido(c.operador)) {
    throw new Error(`Operador inválido para "${def.etiqueta}".`)
  }
  if (!operadorPermitido(campo, c.operador)) {
    throw new Error(`El operador no está disponible para "${def.etiqueta}".`)
  }
  const valor = validarValor(def, c.operador, c.valor)
  return { campo, operador: c.operador, valor }
}

function validarValor(
  def: { campo: string; tipo: string; catalogo?: { tipo: string } },
  operador: OperadorCampo,
  valor: unknown
): unknown {
  const requiereLista = operador === 'in' || operador === 'not_in'

  switch (def.tipo) {
    case 'radio': {
      if (!esValorRadio(valor)) {
        throw new Error(`Para "${def.campo}" el valor debe tener sucursalId y km.`)
      }
      if (!Number.isFinite(valor.km) || valor.km < RADIO_MIN_KM || valor.km > RADIO_MAX_KM) {
        throw new Error(`El radio debe estar entre ${RADIO_MIN_KM} y ${RADIO_MAX_KM} km.`)
      }
      return valor
    }
    case 'id': {
      if (requiereLista) {
        const lista = comoLista(valor, def.campo)
        if (lista.length === 0) throw new Error(`Elige al menos una opción para "${def.campo}".`)
        return lista
      }
      if (typeof valor !== 'string' || valor.length === 0) {
        throw new Error(`Para "${def.campo}" hace falta elegir un valor.`)
      }
      return valor
    }
    case 'texto': {
      if (def.campo === 'cliente.membresia.estado') {
        if (requiereLista) {
          const lista = comoLista(valor, def.campo)
          if (lista.length === 0) throw new Error('Elige al menos un estado de membresía.')
          for (const v of lista) {
            if (!(VALORES_MEMBRESIA as readonly string[]).includes(v)) {
              throw new Error(`Estado de membresía inválido: ${v}.`)
            }
          }
          return lista
        }
        if (!(VALORES_MEMBRESIA as readonly string[]).includes(valor as string)) {
          throw new Error('Estado de membresía inválido.')
        }
        return valor
      }
      return valor
    }
    case 'numero': {
      const n = Number(valor)
      if (!Number.isFinite(n) || n < 0) {
        throw new Error('El valor debe ser un número mayor o igual a 0.')
      }
      return n
    }
    case 'fecha': {
      if (typeof valor !== 'string' || Number.isNaN(Date.parse(valor))) {
        throw new Error('Fecha inválida.')
      }
      return new Date(valor).toISOString()
    }
    case 'mes': {
      const n = Number(valor)
      if (!Number.isInteger(n) || n < 1 || n > 12) {
        throw new Error('El mes debe ser un número del 1 al 12.')
      }
      return n
    }
    case 'bool': {
      if (typeof valor !== 'boolean') {
        throw new Error('El valor debe ser sí o no.')
      }
      return valor
    }
    default:
      throw new Error(`Tipo de campo no soportado: ${def.tipo}.`)
  }
}

function comoLista(valor: unknown, campo: string): string[] {
  if (!Array.isArray(valor)) {
    throw new Error(`Para "${campo}" el valor debe ser una lista.`)
  }
  return valor.filter((v): v is string => typeof v === 'string')
}

/**
 * Resuelve las condiciones de radio contra las coordenadas de las sucursales.
 * Devuelve un árbol CLONADO donde cada radio queda como
 * `{ latitud, longitud, km }` (listo para el SQL), o lanza si alguna sucursal
 * no tiene coordenadas verificadas. PURA: recibe el mapa resuelto.
 */
export function resolverRadios(
  nodo: Nodo,
  sucursales: Map<string, { latitud: number; longitud: number }>
): Nodo {
  switch (nodo.tipo) {
    case 'condicion': {
      if (nodo.cond.campo !== 'cliente.distanciaSucursalKm') return nodo
      const radio = nodo.cond.valor as ValorRadio
      const suc = sucursales.get(radio.sucursalId)
      if (!suc) {
        throw new Error('La sucursal del radio no existe en esta empresa.')
      }
      return {
        tipo: 'condicion',
        cond: {
          ...nodo.cond,
          valor: { latitud: suc.latitud, longitud: suc.longitud, km: radio.km },
        },
      }
    }
    case 'grupo':
      return {
        tipo: 'grupo',
        operador: nodo.operador,
        hijos: nodo.hijos.map((h) => resolverRadios(h, sucursales)),
      }
  }
}

/** Número total de condiciones atómicas (para la UI). */
export function contarCondiciones(nodo: Nodo | null): number {
  if (!nodo) return 0
  if (nodo.tipo === 'condicion') return 1
  return nodo.hijos.reduce((acc, h) => acc + contarCondiciones(h), 0)
}

/** Serializa el AST a la forma del editor (raíz → condiciones + grupos). */
export function nodoARaiz(nodo: Nodo): SegmentoRaiz {
  if (nodo.tipo !== 'grupo') {
    // Raíz con condición suelta (datos legados): se envuelve en un AND.
    return { operador: 'AND', condiciones: [nodo.cond], grupos: [] }
  }
  const condiciones: CondicionDto[] = []
  const grupos: GrupoDto[] = []
  for (const hijo of nodo.hijos) {
    if (hijo.tipo === 'condicion') condiciones.push(hijo.cond)
    else grupos.push(nodoAGrupo(hijo))
  }
  return { operador: nodo.operador, condiciones, grupos }
}

function nodoAGrupo(nodo: Nodo): GrupoDto {
  if (nodo.tipo !== 'grupo') {
    return { operador: 'AND', condiciones: [nodo.cond], grupos: [] }
  }
  const condiciones: CondicionDto[] = []
  const grupos: GrupoDto[] = []
  for (const hijo of nodo.hijos) {
    if (hijo.tipo === 'condicion') condiciones.push(hijo.cond)
    else grupos.push(nodoAGrupo(hijo))
  }
  return { operador: nodo.operador, condiciones, grupos }
}
