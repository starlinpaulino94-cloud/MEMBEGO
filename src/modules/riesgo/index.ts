import 'server-only'

import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { type FiltroRiesgo } from '@/modules/riesgo/filtro'

export { RIESGO_POR_DEFECTO, leerFiltroRiesgo, type FiltroRiesgo } from '@/modules/riesgo/filtro'

/**
 * CLIENTES EN RIESGO — el cruce que nadie podía hacer.
 *
 * El panel sabía por separado que 2 membresías vencen esta semana y que 17
 * clientes llevan un mes sin venir. Lo que no sabía decir es quiénes son los
 * que están en las DOS listas y encima tienen usos pagados sin consumir: ese es
 * el cliente que se va a ir, y el que más caro sale perder.
 *
 * ORDENADO POR DINERO EN JUEGO, no por nombre ni por fecha. Con una lista de
 * cincuenta personas y una tarde para llamar, el orden alfabético reparte el
 * esfuerzo al azar. Lo que decide a quién se llama primero es cuánto cuesta
 * perderlo.
 *
 * El cálculo va en SQL a propósito: el valor en juego es una expresión
 * compuesta (importe pagado ÷ usos incluidos × usos restantes) y ordenar por
 * ella en memoria obligaría a traer toda la lista para paginar. Así el orden y
 * la paginación son exactos aunque la lista tenga miles.
 */

export interface ClienteEnRiesgo {
  clienteId: string
  membershipId: string
  nombre: string
  email: string
  telefono: string | null
  plan: string
  esIlimitado: boolean
  fechaVencimiento: Date | null
  usosRestantes: number
  importe: number
  ultimaVisita: Date | null
  /** Usos restantes × valor de cada uso. En planes ilimitados, el importe. */
  valorEnJuego: number
}

export interface ResultadoRiesgo {
  items: ClienteEnRiesgo[]
  total: number
  /** Suma del valor en juego de TODA la lista, no solo de la página visible. */
  valorTotal: number
}

/**
 * Condiciones del cruce, como fragmento de SQL reutilizable por la consulta de
 * datos, la del total y la de la exportación. Escribirlas tres veces sería
 * garantizar que un día dejen de coincidir.
 */
function condiciones(companyId: string, filtro: FiltroRiesgo, ahora: Date): Prisma.Sql {
  const partes: Prisma.Sql[] = [
    Prisma.sql`m."companyId" = ${companyId}`,
    // Vigente: activa Y sin vencer. Misma regla que el resto del panel.
    Prisma.sql`m."estado" = 'ACTIVA'`,
    Prisma.sql`(m."fechaVencimiento" IS NULL OR m."fechaVencimiento" >= ${ahora})`,
  ]

  if (filtro.sinVisitas > 0) {
    const limite = new Date(ahora.getTime() - filtro.sinVisitas * 86_400_000)
    // `IS NULL` incluye a quien NUNCA vino: pagó y no ha aparecido, que es el
    // caso más urgente de todos y el que una condición de fecha sola perdería.
    partes.push(Prisma.sql`(uv."ultima" IS NULL OR uv."ultima" < ${limite})`)
  }

  if (filtro.vence > 0) {
    const limite = new Date(ahora.getTime() + filtro.vence * 86_400_000)
    partes.push(Prisma.sql`m."fechaVencimiento" IS NOT NULL AND m."fechaVencimiento" <= ${limite}`)
  }

  if (filtro.soloConUsos) {
    partes.push(Prisma.sql`(p."esIlimitado" OR m."lavadosRestantes" > 0)`)
  }

  return Prisma.join(partes, ' AND ')
}

/**
 * Valor en juego. Un plan ilimitado no tiene contador de usos: lo que se pierde
 * es la renovación entera. Un plan por usos vale lo que queda dentro, al precio
 * al que se compró — no al de la lista, que puede haber cambiado desde
 * entonces.
 */
const VALOR_EN_JUEGO = Prisma.sql`
  (CASE
     WHEN p."esIlimitado" THEN COALESCE(m."montoPagado", p."precio")
     WHEN p."lavadosIncluidos" > 0
       THEN m."lavadosRestantes" * (COALESCE(m."montoPagado", p."precio") / p."lavadosIncluidos")
     ELSE 0
   END)::float8`

const DESDE = Prisma.sql`
  FROM "memberships" m
  JOIN "clientes" c ON c."id" = m."clienteId"
  JOIN "plans" p ON p."id" = m."planId"
  LEFT JOIN LATERAL (
    SELECT MAX(v."fechaVisita") AS "ultima"
    FROM "visits" v
    WHERE v."clienteId" = c."id"
  ) uv ON TRUE`

export async function clientesEnRiesgo(
  companyId: string,
  filtro: FiltroRiesgo,
  paginacion: { saltar: number; tomar: number },
  ahora: Date = new Date()
): Promise<ResultadoRiesgo> {
  const donde = condiciones(companyId, filtro, ahora)

  return conEmpresa(companyId, async (tx) => {
    const [items, resumen] = await Promise.all([
      tx.$queryRaw<ClienteEnRiesgo[]>(Prisma.sql`
        SELECT
          c."id"                 AS "clienteId",
          m."id"                 AS "membershipId",
          c."nombre",
          c."email",
          c."telefono",
          p."nombre"             AS "plan",
          p."esIlimitado",
          m."fechaVencimiento",
          m."lavadosRestantes"   AS "usosRestantes",
          COALESCE(m."montoPagado", p."precio")::float8 AS "importe",
          uv."ultima"            AS "ultimaVisita",
          ${VALOR_EN_JUEGO}      AS "valorEnJuego"
        ${DESDE}
        WHERE ${donde}
        ORDER BY "valorEnJuego" DESC, m."fechaVencimiento" ASC NULLS LAST, c."nombre" ASC
        LIMIT ${paginacion.tomar} OFFSET ${paginacion.saltar}
      `),
      tx.$queryRaw<{ total: bigint; valor: number }[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS "total", COALESCE(SUM(${VALOR_EN_JUEGO}), 0)::float8 AS "valor"
        ${DESDE}
        WHERE ${donde}
      `),
    ])

    return {
      items,
      total: Number(resumen[0]?.total ?? 0),
      valorTotal: Number(resumen[0]?.valor ?? 0),
    }
  })
}
