import { Prisma } from '@prisma/client'
import type { Tx } from '@/lib/tenant'
import { UMBRALES, VENTANA_DIAS, evaluarCliente, evaluarEmpresa, ordenarSenales, type MetricasDeCliente, type MetricasDeEmpresa, type Senal } from './domain'

/**
 * SEÑALES DE RIESGO · lecturas (Fase 9). SOLO LECTURA, sin tablas nuevas: se calcula en el momento sobre los
 * pedidos, los cupones y la cuenta Membego de cada empresa. Corre en `sinEmpresa` (superadmin) y deja fuera las
 * empresas de práctica. Solo mira el marketplace: los pedidos del POS y de Supply no son «cancelaciones» de nadie.
 *
 * Para no traer toda la plataforma al servidor, cada consulta filtra en la base a quienes ya superan el mínimo de
 * alguna señal; después `domain.ts` decide qué señal es y de qué gravedad.
 */

const SIN_DEMO = (col: string): Prisma.Sql => Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "companies" cdemo WHERE cdemo."id" = ${Prisma.raw(col)} AND cdemo."esDemo" = true)`

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))

export async function metricasDeEmpresasEnTx(tx: Tx, ahora: Date): Promise<MetricasDeEmpresa[]> {
  const desde = new Date(ahora.getTime() - VENTANA_DIAS * 86_400_000)
  const limiteSinAtender = new Date(ahora.getTime() - UMBRALES.horasSinAtender * 3_600_000)
  const ajusteGrande = UMBRALES.ajusteGrande

  const pedidos = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT o."companyId" AS "companyId",
           count(*) FILTER (WHERE o."createdAt" >= ${desde})::int AS pedidos,
           count(*) FILTER (WHERE o."createdAt" >= ${desde} AND o."status" = 'CANCELLED')::int AS cancelados,
           count(*) FILTER (WHERE o."createdAt" >= ${desde} AND o."status" = 'COMPLETED')::int AS completados,
           count(*) FILTER (WHERE o."createdAt" >= ${desde} AND o."status" = 'REFUNDED')::int AS reembolsados,
           count(*) FILTER (WHERE o."status" = 'AWAITING_MERCHANT' AND o."createdAt" < ${limiteSinAtender})::int AS "sinAtender",
           count(*) FILTER (WHERE o."createdAt" >= ${desde} AND o."status" <> 'CANCELLED' AND o."subtotal" > 0 AND abs(o."adjustment") > o."subtotal" * ${ajusteGrande}::numeric)::int AS "conAjusteGrande"
      FROM "membego_orders" o
     WHERE o."origin" = 'MARKETPLACE' ${SIN_DEMO('o."companyId"')}
       AND (o."createdAt" >= ${desde} OR o."status" = 'AWAITING_MERCHANT')
     GROUP BY o."companyId"`

  const cuentas = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT b."companyId" AS "companyId", b."creditLimit" AS limite, b."status" AS estado,
           (SELECT e."balance" FROM "merchant_ledger_entries" e WHERE e."companyId" = b."companyId" ORDER BY e."seq" DESC LIMIT 1) AS saldo
      FROM "merchant_billing_configs" b
     WHERE true ${SIN_DEMO('b."companyId"')}`

  const ids = new Set<string>([...pedidos.map((p) => String(p.companyId)), ...cuentas.map((c) => String(c.companyId))])
  if (ids.size === 0) return []
  const empresas = await tx.$queryRaw<{ id: string; name: string }[]>`SELECT "id", "name" FROM "companies" WHERE "id" IN (${Prisma.join([...ids])})`
  const nombre = new Map(empresas.map((e) => [e.id, e.name]))
  const ped = new Map(pedidos.map((p) => [String(p.companyId), p]))
  const cta = new Map(cuentas.map((c) => [String(c.companyId), c]))

  return [...ids].map((id): MetricasDeEmpresa => {
    const p = ped.get(id)
    const c = cta.get(id)
    return {
      companyId: id,
      empresa: nombre.get(id) ?? id,
      pedidos: num(p?.pedidos),
      cancelados: num(p?.cancelados),
      completados: num(p?.completados),
      reembolsados: num(p?.reembolsados),
      sinAtender: num(p?.sinAtender),
      conAjusteGrande: num(p?.conAjusteGrande),
      saldo: c ? num(c.saldo) : null,
      limiteDeCredito: c ? num(c.limite) : null,
      estadoDeCuenta: c ? (c.estado as MetricasDeEmpresa['estadoDeCuenta']) : null,
    }
  })
}

export async function metricasDeClientesEnTx(tx: Tx, ahora: Date): Promise<MetricasDeCliente[]> {
  const desde = new Date(ahora.getTime() - VENTANA_DIAS * 86_400_000)
  const hace24h = new Date(ahora.getTime() - 24 * 3_600_000)
  const U = UMBRALES.cliente

  const pedidos = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT cl."supabaseId" AS clave, max(cl."nombre") AS nombre, max(cl."email") AS correo,
           count(DISTINCT o."companyId")::int AS empresas,
           count(*)::int AS pedidos,
           count(*) FILTER (WHERE o."status" = 'CANCELLED')::int AS cancelados,
           count(*) FILTER (WHERE o."createdAt" >= ${hace24h})::int AS "pedidosEnUnDia"
      FROM "membego_orders" o
      JOIN "clientes" cl ON cl."id" = o."customerId" AND cl."companyId" = o."companyId"
     WHERE o."origin" = 'MARKETPLACE' AND o."createdAt" >= ${desde} ${SIN_DEMO('o."companyId"')}
     GROUP BY cl."supabaseId"
    HAVING count(*) FILTER (WHERE o."status" = 'CANCELLED') >= ${U.cancelados.media}
        OR count(*) FILTER (WHERE o."createdAt" >= ${hace24h}) >= ${U.rafaga.media}`

  const cupones = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT cl."supabaseId" AS clave, max(cl."nombre") AS nombre, max(cl."email") AS correo, count(*)::int AS vencidos
      FROM "deal_claims" dc
      JOIN "clientes" cl ON cl."id" = dc."customerId" AND cl."companyId" = dc."companyId"
     WHERE dc."status" = 'EXPIRED' AND dc."closedAt" >= ${desde} ${SIN_DEMO('dc."companyId"')}
     GROUP BY cl."supabaseId"
    HAVING count(*) >= ${U.cuponesVencidos.media}`

  const porClave = new Map<string, MetricasDeCliente>()
  for (const p of pedidos) {
    porClave.set(String(p.clave), { clave: String(p.clave), nombre: String(p.nombre), correo: String(p.correo), empresas: num(p.empresas), pedidos: num(p.pedidos), cancelados: num(p.cancelados), cuponesVencidos: 0, pedidosEnUnDia: num(p.pedidosEnUnDia) })
  }
  for (const c of cupones) {
    const clave = String(c.clave)
    const m = porClave.get(clave) ?? { clave, nombre: String(c.nombre), correo: String(c.correo), empresas: 0, pedidos: 0, cancelados: 0, cuponesVencidos: 0, pedidosEnUnDia: 0 }
    m.cuponesVencidos = num(c.vencidos)
    porClave.set(clave, m)
  }
  return [...porClave.values()]
}

export interface PanoramaDeRiesgo {
  generadoEn: Date
  ventanaDias: number
  senales: Senal[]
  /** Cuántas empresas y cuántos clientes se revisaron (no solo los que dieron señal). */
  revisadas: { empresas: number }
}

/** Todas las señales de la plataforma, ordenadas. */
export async function riesgoDeLaPlataformaEnTx(tx: Tx, ahora = new Date()): Promise<PanoramaDeRiesgo> {
  const empresas = await metricasDeEmpresasEnTx(tx, ahora)
  const clientes = await metricasDeClientesEnTx(tx, ahora)
  const senales = ordenarSenales([...empresas.flatMap(evaluarEmpresa), ...clientes.flatMap(evaluarCliente)])
  return { generadoEn: ahora, ventanaDias: VENTANA_DIAS, senales, revisadas: { empresas: empresas.length } }
}
