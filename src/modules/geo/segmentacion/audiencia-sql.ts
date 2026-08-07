import 'server-only'
import { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { resolverRadios, type Nodo } from './arbol'
import { predicadoDeNodo, predicadoConsentimiento } from './sql'

/**
 * Construye el WHERE de "audiencia de una empresa" a partir del AST de un
 * segmento. Compartido por el AudienceEstimator (conteos) y el fan-out de
 * campañas (entrega por lotes): los dos SIEMPRE aplican el consentimiento de
 * marketing geo y excluyen clientes de mostrador.
 */

/** Fragmento SQL con su lista de parámetros (primer argumento = SQL crudo). */
export function fragmentoSql(sql: string, params: unknown[]): Prisma.Sql {
  return Prisma.sql([sql], params as [])
}

async function resolverConSucursales(tx: Tx, companyId: string, nodo: Nodo): Promise<Nodo> {
  const sucursales = await tx.sucursal.findMany({
    where: { companyId, ubicacionVerificada: true, latitud: { not: null }, longitud: { not: null } },
    select: { id: true, latitud: true, longitud: true },
  })
  return resolverRadios(
    nodo,
    new Map(sucursales.map((s) => [s.id, { latitud: s.latitud!, longitud: s.longitud! }]))
  )
}

/** WHERE con consentimiento activo (audiencia elegible). */
export async function dondeAudiencia(
  tx: Tx,
  companyId: string,
  nodo: Nodo
): Promise<Prisma.Sql> {
  const consent = predicadoConsentimiento()
  const base = Prisma.sql`c.companyId = ${companyId} AND c.esLocal = false`
  const resuelto = await resolverConSucursales(tx, companyId, nodo)
  const pred = predicadoDeNodo(resuelto)
  const conPred =
    pred.sql.length > 0
      ? Prisma.sql`${base} AND (${fragmentoSql(pred.sql, pred.params)})`
      : base
  return Prisma.sql`${conPred} AND (${fragmentoSql(consent.sql, [])})`
}

/** WHERE con consentimiento negado (clientes que coinciden pero no consienten). */
export async function dondeAudienciaSinConsent(
  tx: Tx,
  companyId: string,
  nodo: Nodo
): Promise<Prisma.Sql> {
  const consent = predicadoConsentimiento()
  const base = Prisma.sql`c.companyId = ${companyId} AND c.esLocal = false`
  const resuelto = await resolverConSucursales(tx, companyId, nodo)
  const pred = predicadoDeNodo(resuelto)
  const conPred =
    pred.sql.length > 0
      ? Prisma.sql`${base} AND (${fragmentoSql(pred.sql, pred.params)})`
      : base
  return Prisma.sql`${conPred} AND NOT (${fragmentoSql(consent.sql, [])})`
}
