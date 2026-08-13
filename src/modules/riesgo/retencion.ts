import 'server-only'

import { Prisma } from '@prisma/client'
import { conEmpresa } from '@/lib/tenant'
import { armarCsvBloques } from '@/lib/csv'

/**
 * RETENCIÓN Y CONSUMO — las tres preguntas que nadie podía responder.
 *
 * 1. ¿Cuánta gente se está enfriando? (distribución por días sin venir)
 * 2. ¿Cuántos renuevan cuando les vence? (la tasa que decide si el negocio
 *    crece o solo repone)
 * 3. ¿Cuánto servicio pagado se debe? (`lavadosRestantes` existía en cada
 *    membresía, se pintaba en una columna, y ahí terminaba su vida)
 *
 * La tercera es la que más sorprende al verla: **no es una métrica de
 * marketing, es un pasivo**. Son usos cobrados que el negocio todavía tiene que
 * prestar, y que si vencen sin consumirse se convierten en un cliente molesto,
 * no en un ingreso extra.
 */

export interface TramoInactividad {
  clave: string
  label: string
  clientes: number
}

export interface ConsumoPlan {
  plan: string
  membresias: number
  usosIncluidos: number
  usosRestantes: number
  /** Porcentaje consumido, 0-100. */
  consumido: number
}

export interface Retencion {
  /** Clientes con membresía vigente, por hace cuánto que no vienen. */
  inactividad: TramoInactividad[]
  /** Clientes con membresía vigente considerados en el reparto. */
  totalVigentes: number
  /** Membresías vencidas en la ventana analizada. */
  vencidas: number
  /** De ésas, cuántas volvieron: el cliente tiene otra vigente hoy. */
  renovadas: number
  /** Usos pagados que siguen sin consumirse (solo planes por usos). */
  usosPendientes: number
  /** Lo que valen esos usos, al precio al que se compraron. */
  valorPendiente: number
  /** Consumo por plan, para ver cuáles se usan y cuáles se olvidan. */
  porPlan: ConsumoPlan[]
  /** Días de la ventana usada para la renovación. */
  ventanaDias: number
}

const VACIO: Retencion = {
  inactividad: [],
  totalVigentes: 0,
  vencidas: 0,
  renovadas: 0,
  usosPendientes: 0,
  valorPendiente: 0,
  porPlan: [],
  ventanaDias: 90,
}

/** Los tramos, en orden. Se nombran para que la tabla no tenga que inventarlos. */
const TRAMOS: { clave: string; label: string; desde: number; hasta: number | null }[] = [
  { clave: '0-7', label: 'Esta semana', desde: 0, hasta: 7 },
  { clave: '8-15', label: 'Hace 8-15 días', desde: 8, hasta: 15 },
  { clave: '16-30', label: 'Hace 16-30 días', desde: 16, hasta: 30 },
  { clave: '31-60', label: 'Hace 31-60 días', desde: 31, hasta: 60 },
  { clave: '60+', label: 'Hace más de 60 días', desde: 61, hasta: null },
  { clave: 'nunca', label: 'Nunca ha venido', desde: -1, hasta: -1 },
]

export async function getRetencion(
  companyId: string,
  ventanaDias = 90,
  ahora: Date = new Date()
): Promise<Retencion> {
  const desdeVentana = new Date(ahora.getTime() - ventanaDias * 86_400_000)

  try {
    return await conEmpresa(companyId, async (tx) => {
      const [inactividadRaw, renovacionRaw, pasivoRaw, porPlanRaw] = await Promise.all([
        // 1 · Reparto por días desde la última visita. Se agrupa en SQL: traer
        // un cliente por fila para contarlos en memoria es trabajo que crece
        // con el negocio y no aporta nada.
        tx.$queryRaw<{ tramo: string; clientes: bigint }[]>(Prisma.sql`
          SELECT
            CASE
              WHEN uv."ultima" IS NULL THEN 'nunca'
              WHEN uv."ultima" >= ${ahora}::timestamp - INTERVAL '7 days'  THEN '0-7'
              WHEN uv."ultima" >= ${ahora}::timestamp - INTERVAL '15 days' THEN '8-15'
              WHEN uv."ultima" >= ${ahora}::timestamp - INTERVAL '30 days' THEN '16-30'
              WHEN uv."ultima" >= ${ahora}::timestamp - INTERVAL '60 days' THEN '31-60'
              ELSE '60+'
            END AS "tramo",
            COUNT(*)::bigint AS "clientes"
          FROM "clientes" c
          JOIN "memberships" m ON m."clienteId" = c."id"
           AND m."estado" = 'ACTIVA'
           AND (m."fechaVencimiento" IS NULL OR m."fechaVencimiento" >= ${ahora})
          LEFT JOIN LATERAL (
            SELECT MAX(v."fechaVisita") AS "ultima" FROM "visits" v WHERE v."clienteId" = c."id"
          ) uv ON TRUE
          WHERE c."companyId" = ${companyId}
          GROUP BY 1
        `),

        // 2 · Renovación. «Renovó» = el cliente tiene HOY una membresía vigente.
        // No se mira si es la misma fila: reabrir la suya o comprar otra son la
        // misma decisión desde el punto de vista del negocio — volvió.
        tx.$queryRaw<{ vencidas: bigint; renovadas: bigint }[]>(Prisma.sql`
          SELECT
            COUNT(*)::bigint AS "vencidas",
            COUNT(*) FILTER (WHERE viva."existe")::bigint AS "renovadas"
          FROM "memberships" m
          LEFT JOIN LATERAL (
            SELECT TRUE AS "existe"
            FROM "memberships" m2
            WHERE m2."clienteId" = m."clienteId"
              AND m2."estado" = 'ACTIVA'
              AND (m2."fechaVencimiento" IS NULL OR m2."fechaVencimiento" >= ${ahora})
            LIMIT 1
          ) viva ON TRUE
          WHERE m."companyId" = ${companyId}
            AND m."fechaVencimiento" IS NOT NULL
            AND m."fechaVencimiento" <  ${ahora}
            AND m."fechaVencimiento" >= ${desdeVentana}
        `),

        // 3 · El pasivo: usos cobrados y no prestados, y lo que valen.
        tx.$queryRaw<{ usos: bigint; valor: number }[]>(Prisma.sql`
          SELECT
            COALESCE(SUM(m."lavadosRestantes"), 0)::bigint AS "usos",
            COALESCE(SUM(
              CASE WHEN p."lavadosIncluidos" > 0
                THEN m."lavadosRestantes" * (COALESCE(m."montoPagado", p."precio") / p."lavadosIncluidos")
                ELSE 0 END
            ), 0)::float8 AS "valor"
          FROM "memberships" m
          JOIN "plans" p ON p."id" = m."planId"
          WHERE m."companyId" = ${companyId}
            AND m."estado" = 'ACTIVA'
            AND (m."fechaVencimiento" IS NULL OR m."fechaVencimiento" >= ${ahora})
            AND p."esIlimitado" = FALSE
        `),

        // 4 · Consumo por plan: cuáles se usan y cuáles se compran y se olvidan.
        tx.$queryRaw<
          { plan: string; membresias: bigint; incluidos: bigint; restantes: bigint }[]
        >(Prisma.sql`
          SELECT
            p."nombre" AS "plan",
            COUNT(*)::bigint AS "membresias",
            COALESCE(SUM(p."lavadosIncluidos"), 0)::bigint AS "incluidos",
            COALESCE(SUM(m."lavadosRestantes"), 0)::bigint AS "restantes"
          FROM "memberships" m
          JOIN "plans" p ON p."id" = m."planId"
          WHERE m."companyId" = ${companyId}
            AND m."estado" = 'ACTIVA'
            AND (m."fechaVencimiento" IS NULL OR m."fechaVencimiento" >= ${ahora})
            AND p."esIlimitado" = FALSE
          GROUP BY p."nombre"
          ORDER BY COUNT(*) DESC
        `),
      ])

      const porTramo = new Map(inactividadRaw.map((r) => [r.tramo, Number(r.clientes)]))
      const inactividad = TRAMOS.map((t) => ({
        clave: t.clave,
        label: t.label,
        clientes: porTramo.get(t.clave) ?? 0,
      }))

      return {
        inactividad,
        totalVigentes: inactividad.reduce((s, t) => s + t.clientes, 0),
        vencidas: Number(renovacionRaw[0]?.vencidas ?? 0),
        renovadas: Number(renovacionRaw[0]?.renovadas ?? 0),
        usosPendientes: Number(pasivoRaw[0]?.usos ?? 0),
        valorPendiente: Number(pasivoRaw[0]?.valor ?? 0),
        porPlan: porPlanRaw.map((r) => {
          const incluidos = Number(r.incluidos)
          const restantes = Number(r.restantes)
          return {
            plan: r.plan,
            membresias: Number(r.membresias),
            usosIncluidos: incluidos,
            usosRestantes: restantes,
            consumido: incluidos > 0 ? Math.round(((incluidos - restantes) / incluidos) * 100) : 0,
          }
        }),
        ventanaDias,
      }
    })
  } catch (e) {
    console.error('[retencion]', e)
    return { ...VACIO, ventanaDias }
  }
}

/**
 * El reporte de retención en CSV.
 *
 * Era el único reporte del panel sin ninguna forma de sacarlo: los tres bloques
 * —enfriamiento, renovación y consumo pendiente— solo existían en pantalla, y
 * el pasivo de servicio (lo que se cobró y todavía no se ha prestado) es
 * justamente el número que alguien quiere cruzar con su contabilidad.
 *
 * `dinero` llega desde fuera para que el archivo salga en la moneda de la
 * empresa sin que este módulo tenga que conocer las preferencias regionales.
 */
export function retencionToCsv(r: Retencion, valorPendienteFormateado: string): string {
  return armarCsvBloques([
    {
      titulo: 'Hace cuanto que no vienen',
      encabezados: ['Tramo', 'Clientes'],
      filas: r.inactividad.map((t) => [t.label, t.clientes]),
    },
    {
      titulo: 'Renovacion y pasivo',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Clientes con membresia vigente', r.totalVigentes],
        [`Membresias vencidas (ultimos ${r.ventanaDias} dias)`, r.vencidas],
        ['De esas, renovadas', r.renovadas],
        [
          'Tasa de renovacion %',
          // Sin vencimientos no hay tasa. Un 0 % ahí diría «nadie renueva»
          // cuando lo cierto es que nadie tuvo ocasión.
          r.vencidas > 0 ? Math.round((r.renovadas / r.vencidas) * 100) : '',
        ],
        ['Usos pagados sin consumir', r.usosPendientes],
        ['Valor de esos usos', valorPendienteFormateado],
      ],
    },
    {
      titulo: 'Consumo por plan',
      encabezados: [
        'Plan',
        'Membresias',
        'Usos incluidos',
        'Usos restantes',
        'Consumido %',
      ],
      filas: r.porPlan.map((p) => [
        p.plan,
        p.membresias,
        p.usosIncluidos,
        p.usosRestantes,
        p.consumido,
      ]),
    },
  ])
}
