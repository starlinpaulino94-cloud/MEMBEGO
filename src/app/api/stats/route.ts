import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { sinEmpresa } from '@/lib/tenant'
import { MARKETPLACE_TAG } from '@/modules/marketplace/cached'

export const dynamic = 'force-dynamic'

/**
 * GET /api/stats — métricas públicas de prueba social para la landing.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE ARCHIVO ESTÁ ESCRITO ASÍ (auditoría de producción · C-04)
 *
 * La versión anterior hacía cuatro `COUNT(*)` SIN filtro y SIN caché en cada
 * petición, sobre `clientes`, `visits`, `memberships` y `companies`. Un
 * `COUNT(*)` sin filtro en PostgreSQL recorre la tabla entera. Con 100.000
 * clientes y millones de visitas eso son cuatro recorridos completos por cada
 * visita anónima a la portada.
 *
 * El resultado no era un endpoint lento: era una forma de tumbar la plataforma
 * entera —incluido el escáner de la pista, que deja de poder atender carros—
 * con un bucle de `curl`. O sin atacante ninguno: bastaba con que el
 * lanzamiento saliera bien.
 *
 * Dos cambios lo cierran:
 *
 *  1. CACHÉ DE 5 MINUTOS. La base se toca una vez cada cinco minutos, no una
 *     vez por visitante. Mismo patrón y misma etiqueta de invalidación que el
 *     resto del marketplace.
 *
 *  2. CONTEOS APROXIMADOS para las tablas que crecen sin techo. `clientes` y
 *     `visits` solo alimentan un número de escaparate. Nadie necesita que sea
 *     exacto al segundo, y `pg_class.reltuples` —la estimación que el
 *     planificador ya mantiene por su cuenta— responde en tiempo constante sin
 *     leer una sola fila. Pagar un coste que crece con el negocio a cambio de
 *     una exactitud que a nadie le sirve es un mal trato.
 *
 * Las dos cifras que sí son exactas (`empresas`, `membresiasActivas`) lo son
 * porque van por índice sobre tablas pequeñas.
 * ────────────────────────────────────────────────────────────────────────────
 */

interface StatsPublicas {
  empresas: number
  clientes: number
  membresiasActivas: number
  visitas: number
}

/**
 * Estimación de filas que mantiene el planificador de PostgreSQL.
 *
 * `reltuples` se actualiza en cada ANALYZE/autovacuum y vale -1 en una tabla
 * recién creada que nunca se analizó; por eso se acota a 0 por abajo. Para un
 * contador de portada sobra.
 */
async function filasAproximadas(tabla: string): Promise<number> {
  try {
    const filas = await sinEmpresa('stats-reltuples', (tx) =>
      tx.$queryRaw<{ n: number }[]>`
        SELECT GREATEST(reltuples, 0)::bigint::int AS n
        FROM pg_class
        WHERE oid = to_regclass(${`public.${tabla}`})
      `
    )
    return filas[0]?.n ?? 0
  } catch {
    return 0
  }
}

const leerStats = unstable_cache(
  async (): Promise<StatsPublicas> => {
    return sinEmpresa('stats-publicas', async (tx) => {
      const [empresas, membresiasActivas, clientes, visitas] = await Promise.all([
        tx.company.count({ where: { isActive: true, esDemo: false } }).catch(() => 0),
        tx.membership.count({ where: { estado: 'ACTIVA' } }).catch(() => 0),
        filasAproximadas('clientes'),
        filasAproximadas('visitas'),
      ])
      return { empresas, clientes, membresiasActivas, visitas }
    })
  },
  ['api-stats-publicas'],
  { revalidate: 300, tags: [MARKETPLACE_TAG] }
)

export async function GET() {
  try {
    return NextResponse.json(await leerStats())
  } catch {
    // Si la base no está disponible, ceros: la landing no puede romperse por
    // un número decorativo.
    return NextResponse.json({
      empresas: 0,
      clientes: 0,
      membresiasActivas: 0,
      visitas: 0,
    })
  }
}
