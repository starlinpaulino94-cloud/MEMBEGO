/**
 * BUILDER SQL DEL PREDICADO DE UN SEGMENTO (docs/GEOLOCALIZACION.md §10.3).
 *
 * Traduce el AST normalizado a un fragmento SQL booleano sobre `clientes c`,
 * con parámetros (nunca interpola valores: `$1, $2, …`). El llamador lo une a
 * su consulta (`WHERE c.companyId = $1 AND …`).
 *
 * PURO (sin `server-only`): se prueba sin base de datos. El resultado es
 * determinista y depende solo del árbol.
 */

import type { Nodo } from './arbol'
import type { OperadorCampo } from './campos'

export interface SqlPredicado {
  sql: string
  params: unknown[]
}

/**
 * Fragmento `EXISTS` sobre la ubicación primaria del cliente, con el filtro
 * adicional que se le quiera añadir (ej. `AND cl.cityId = $2`).
 */
function ubicacionPrimaria(extra: string): string {
  return `EXISTS (
  SELECT 1 FROM customer_locations cl
  JOIN users u ON u.id = cl.userId
  WHERE u.supabaseId = c.supabaseId AND cl.isPrimary ${extra}
)`
}

interface Ctx {
  params: unknown[]
}

function param(ctx: Ctx, v: unknown): string {
  ctx.params.push(v)
  return `$${ctx.params.length}`
}

function condicionSql(campo: string, operador: OperadorCampo, valor: unknown, ctx: Ctx): string {
  switch (campo) {
    case 'cliente.cityId':
    case 'cliente.sectorId': {
      const col = campo === 'cliente.cityId' ? 'cl.cityId' : 'cl.sectorId'
      const base =
        operador === 'eq' || operador === 'in'
          ? ubiquicacionConLista(ctx, col, operador === 'in', valor)
          : null
      if (base !== null) return base
      // neq / not_in → negación de la positiva.
      return `NOT (${condicionSql(campo, operador === 'neq' ? 'eq' : 'in', valor, ctx)})`
    }
    case 'cliente.distanciaSucursalKm': {
      const r = valor as { latitud: number; longitud: number; km: number }
      const lat = param(ctx, r.latitud)
      const lng = param(ctx, r.longitud)
      const km = param(ctx, r.km)
      return `EXISTS (
  SELECT 1 FROM customer_locations cl
  JOIN users u ON u.id = cl.userId
  WHERE u.supabaseId = c.supabaseId AND cl.isPrimary
    AND cl.verificationStatus = 'CONFIRMED'
    AND cl.latitud IS NOT NULL AND cl.longitud IS NOT NULL
    AND (
      6371000 * acos(greatest(-1.0, least(1.0,
        sin(radians(cl.latitud)) * sin(radians(${lat})) +
        cos(radians(cl.latitud)) * cos(radians(${lat})) *
        cos(radians(${lng}) - radians(cl.longitud))
      )))
    ) <= ${km} * 1000
)`
    }
    case 'cliente.esLocal': {
      const v = param(ctx, valor)
      return `c.esLocal = ${v}`
    }
    case 'cliente.createdAt': {
      const v = param(ctx, valor)
      return operador === 'gte' ? `c.createdAt >= ${v}` : `c.createdAt < ${v}`
    }
    case 'cliente.ultimaVisitaDias': {
      const dias = param(ctx, valor)
      const existe = `EXISTS (
  SELECT 1 FROM visits v JOIN memberships m ON m.id = v.membershipId
  WHERE m.clienteId = c.id AND v.fechaVisita >= now() - (${dias} || ' days')::interval
)`
      // lte = "visitó en los últimos N días" (activos); gte = inactivos.
      return operador === 'lte' ? existe : `NOT (${existe})`
    }
    case 'cliente.membresia.estado':
      return membresiaSql(operador, valor, ctx)
    case 'cliente.vehiculo.tipoVehiculoId': {
      const lista = (Array.isArray(valor) ? valor : [valor]) as string[]
      const v = param(ctx, lista)
      const positivo = `EXISTS (
  SELECT 1 FROM vehiculos vv WHERE vv.clienteId = c.id AND vv.tipoVehiculoId = ANY(${v})
)`
      return operador === 'eq' || operador === 'in' ? positivo : `NOT (${positivo})`
    }
    case 'cliente.cumpleMes': {
      const v = param(ctx, valor)
      const eq = `EXTRACT(MONTH FROM c.fechaNacimiento) = ${v}`
      return operador === 'eq' ? eq : `NOT (${eq})`
    }
    default:
      throw new Error(`Campo de segmentación no soportado por el motor SQL: ${campo}`)
  }
}

/** `eq`/`in` para ciudad/sector: EXISTS sobre la columna con un id o lista. */
function ubiquicacionConLista(
  ctx: Ctx,
  col: string,
  esLista: boolean,
  valor: unknown
): string | null {
  if (esLista) {
    const v = param(ctx, valor)
    return ubicacionPrimaria(`AND ${col} = ANY(${v})`)
  }
  if (typeof valor === 'string') {
    const v = param(ctx, valor)
    return ubicacionPrimaria(`AND ${col} = ${v}`)
  }
  return null
}

function membresiaSql(operador: OperadorCampo, valor: unknown, ctx: Ctx): string {
  const valores = (Array.isArray(valor) ? valor : [valor]) as string[]
  const estados = valores.filter((e) => e !== 'SIN_ACTIVA')
  const sinActiva = valores.includes('SIN_ACTIVA')

  const parteEstados =
    estados.length > 0
      ? `EXISTS (SELECT 1 FROM memberships m WHERE m.clienteId = c.id AND m.estado = ANY(${param(
          ctx,
          estados
        )}))`
      : null
  const parteSinActiva = `NOT EXISTS (
  SELECT 1 FROM memberships m WHERE m.clienteId = c.id AND m.estado = 'ACTIVA'
)`

  if (operador === 'in' || operador === 'eq') {
    return [parteEstados, sinActiva ? parteSinActiva : null].filter(Boolean).join(' OR ')
  }
  const negadas: string[] = []
  if (parteEstados) negadas.push(`NOT (${parteEstados})`)
  if (sinActiva) {
    negadas.push(
      `EXISTS (SELECT 1 FROM memberships m WHERE m.clienteId = c.id AND m.estado = 'ACTIVA')`
    )
  }
  return negadas.join(' AND ') || '(TRUE)'
}

/** SQL del predicado de consentimiento de marketing geo (siempre exigido). */
export function predicadoConsentimiento(): SqlPredicado {
  return {
    sql: `EXISTS (
  SELECT 1 FROM users u
  JOIN geo_consents gc ON gc.userId = u.id
  WHERE u.supabaseId = c.supabaseId
    AND gc.tipo = 'MARKETING_GEO' AND gc.estado = 'ACTIVE'
)`,
    params: [],
  }
}

function nodoSql(nodo: Nodo, ctx: Ctx): string {
  switch (nodo.tipo) {
    case 'condicion':
      return condicionSql(nodo.cond.campo, nodo.cond.operador, nodo.cond.valor, ctx)
    case 'grupo': {
      const hijos = nodo.hijos.map((h) => nodoSql(h, ctx))
      if (nodo.operador === 'NOT') {
        return `NOT (${hijos.join(' AND ')})`
      }
      return `(${hijos.join(` ${nodo.operador} `)})`
    }
  }
}

/**
 * Predicado booleano del árbol (vacío si el segmento no tiene condiciones).
 * El `sql` es una expresión usable en `WHERE`; puede estar vacío (sin filtro).
 */
export function predicadoDeNodo(nodo: Nodo): SqlPredicado {
  if (nodo.tipo === 'grupo' && nodo.hijos.length === 0) {
    return { sql: '', params: [] }
  }
  const ctx: Ctx = { params: [] }
  const sql = nodoSql(nodo, ctx)
  return { sql, params: ctx.params }
}
