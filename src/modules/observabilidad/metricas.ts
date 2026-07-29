import { prisma } from '@/lib/prisma'
import { SIN_DEMO } from '@/modules/demo'

/**
 * MÉTRICAS DE NEGOCIO Y DE SISTEMA (auditoría de producción · A-09, Fase 6).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE CALCULAN DESDE LA BASE Y NO CON CONTADORES EN MEMORIA
 *
 * La forma habitual de instrumentar una aplicación es incrementar contadores en
 * memoria y exponerlos. En Vercel eso no vale para nada: cada petición puede
 * caer en una instancia distinta y las instancias mueren solas. Un contador
 * dice "3 canjes" porque esa instancia concreta vio 3, mientras otras veinte
 * vieron los otros 400. Sumarlos es imposible y el número engaña, que es peor
 * que no tenerlo.
 *
 * La base de datos, en cambio, es el único sitio que lo ve todo. Estas
 * consultas cuestan más que un contador y a cambio dan un número que es cierto.
 *
 * Lo que la base NO puede responder es la latencia (no se guarda cuánto tardó
 * cada petición). Eso vive en los eventos estructurados de `eventos.ts` y en
 * Sentry. Las dos mitades juntas son la observabilidad; ninguna sola basta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS EMPRESAS DEMO NO CUENTAN
 *
 * Todas las consultas llevan `SIN_DEMO`. Una empresa de práctica genera visitas
 * y cobros de mentira mientras se entrena al personal; si contaran, cada sesión
 * de entrenamiento parecería un buen día de ventas y las métricas dejarían de
 * servir para decidir nada.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface MetricaNegocio {
  /** Últimas 24 horas. */
  visitas24h: number
  /** Visitas de las 24 horas ANTERIORES, para comparar. */
  visitasPrevias24h: number
  transacciones24h: number
  clientesNuevos24h: number
  pagosAprobados24h: number
  pagosRechazados24h: number
  /** Cobros iniciados que nunca se resolvieron. Cada uno es un cliente colgado. */
  pagosSinResolver: number
  empresasActivas: number
  notificaciones24h: number
}

export interface MetricaSistema {
  /** Latencia de una consulta trivial contra la base, en ms. */
  latenciaBdMs: number | null
  /** ¿Contesta la base? */
  bdViva: boolean
  /** Conexiones abiertas contra Postgres, si se puede leer. */
  conexiones: number | null
  /** Límite configurado del servidor. Con `conexiones` da la saturación. */
  conexionesMax: number | null
  /** Índices en estado inválido (una creación CONCURRENTLY que se cortó). */
  indicesInvalidos: number | null
}

export interface Metricas {
  negocio: MetricaNegocio
  sistema: MetricaSistema
  /** Momento del cálculo. */
  medidoEn: string
  /** Qué no se pudo medir y por qué. Vacío = todo salió. */
  fallos: string[]
}

function haceHoras(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000)
}

/**
 * Lee todas las métricas.
 *
 * Cada bloque va en su propio `try`: que no se pueda leer `pg_stat_activity`
 * —cosa perfectamente posible según los permisos de Supabase— no puede dejar
 * sin métricas de negocio a quien mira el panel. Lo que falla se anota en
 * `fallos` en vez de desaparecer sin más; una métrica ausente que se muestra
 * como cero es una mentira.
 */
export async function leerMetricas(): Promise<Metricas> {
  const fallos: string[] = []
  const hace24 = haceHoras(24)
  const hace48 = haceHoras(48)

  const negocio: MetricaNegocio = {
    visitas24h: 0,
    visitasPrevias24h: 0,
    transacciones24h: 0,
    clientesNuevos24h: 0,
    pagosAprobados24h: 0,
    pagosRechazados24h: 0,
    pagosSinResolver: 0,
    empresasActivas: 0,
    notificaciones24h: 0,
  }

  try {
    const [
      visitas24h,
      visitasPrevias24h,
      transacciones24h,
      clientesNuevos24h,
      pagosAprobados24h,
      pagosRechazados24h,
      pagosSinResolver,
      empresasActivas,
      notificaciones24h,
    ] = await Promise.all([
      // `visits` no tiene companyId propio: se llega por la membresía.
      prisma.visit.count({
        where: { fechaVisita: { gte: hace24 }, membership: { company: SIN_DEMO } },
      }),
      prisma.visit.count({
        where: {
          fechaVisita: { gte: hace48, lt: hace24 },
          membership: { company: SIN_DEMO },
        },
      }),
      prisma.transaction.count({
        where: { createdAt: { gte: hace24 }, company: SIN_DEMO },
      }),
      prisma.cliente.count({
        where: { createdAt: { gte: hace24 }, company: SIN_DEMO },
      }),
      prisma.pagoIntento.count({
        where: { createdAt: { gte: hace24 }, estado: 'APROBADO', company: SIN_DEMO },
      }),
      prisma.pagoIntento.count({
        where: { createdAt: { gte: hace24 }, estado: 'RECHAZADO', company: SIN_DEMO },
      }),
      // Más de una hora en 'REDIRIGIDO' sin activar: el cliente se fue a pagar
      // y nunca volvió, o el aviso se perdió. Cada fila es dinero en el aire.
      // Ver docs/runbooks/pagos-cardnet.md.
      prisma.pagoIntento.count({
        where: {
          createdAt: { gte: hace24, lt: haceHoras(1) },
          estado: { in: ['CREADO', 'REDIRIGIDO'] },
          activadoAt: null,
          company: SIN_DEMO,
        },
      }),
      prisma.company.count({ where: { ...SIN_DEMO, isActive: true } }),
      // Las notificaciones cuelgan del usuario, no de la empresa, y un usuario
      // puede no tener empresa (un cliente del marketplace). El OR conserva a
      // esos y descarta solo a los de empresas de práctica.
      prisma.notificacion.count({
        where: {
          createdAt: { gte: hace24 },
          user: { OR: [{ companyId: null }, { company: SIN_DEMO }] },
        },
      }),
    ])

    Object.assign(negocio, {
      visitas24h,
      visitasPrevias24h,
      transacciones24h,
      clientesNuevos24h,
      pagosAprobados24h,
      pagosRechazados24h,
      pagosSinResolver,
      empresasActivas,
      notificaciones24h,
    })
  } catch (e) {
    console.error('[metricas] negocio:', e)
    fallos.push('negocio')
  }

  const sistema: MetricaSistema = {
    latenciaBdMs: null,
    bdViva: false,
    conexiones: null,
    conexionesMax: null,
    indicesInvalidos: null,
  }

  try {
    const t0 = Date.now()
    await prisma.$queryRaw`SELECT 1`
    sistema.latenciaBdMs = Date.now() - t0
    sistema.bdViva = true
  } catch (e) {
    console.error('[metricas] latencia:', e)
    fallos.push('latencia')
  }

  try {
    // Saturación del pool: el incidente P2024 visto ANTES de que ocurra, que es
    // la diferencia entre este runbook y una tarde perdida.
    // Ver docs/runbooks/pool-agotado.md.
    const filas = await prisma.$queryRaw<{ abiertas: bigint; tope: string }[]>`
      SELECT (SELECT count(*) FROM pg_stat_activity) AS abiertas,
             current_setting('max_connections') AS tope
    `
    if (filas[0]) {
      sistema.conexiones = Number(filas[0].abiertas)
      sistema.conexionesMax = Number(filas[0].tope)
    }
  } catch {
    // Sin permiso sobre pg_stat_activity en algunos planes. No es un error:
    // es una métrica que este entorno no da.
    fallos.push('conexiones')
  }

  try {
    const filas = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_index WHERE NOT indisvalid
    `
    sistema.indicesInvalidos = Number(filas[0]?.n ?? 0)
  } catch {
    fallos.push('indices')
  }

  return { negocio, sistema, medidoEn: new Date().toISOString(), fallos }
}

/** Variación porcentual de visitas frente al día anterior. `null` sin base. */
export function variacionVisitas(m: MetricaNegocio): number | null {
  if (m.visitasPrevias24h <= 0) return null
  return ((m.visitas24h - m.visitasPrevias24h) / m.visitasPrevias24h) * 100
}

/** Fracción del pool consumida, entre 0 y 1. `null` si no se pudo medir. */
export function saturacionConexiones(s: MetricaSistema): number | null {
  if (s.conexiones === null || !s.conexionesMax) return null
  return s.conexiones / s.conexionesMax
}

/**
 * Traduce las métricas a la respuesta corta que puede vigilar un monitor
 * externo: `ok`, `degradado` o `critico`.
 *
 * Función pura y separada de la lectura para poder probar los umbrales sin base
 * de datos — que es justo lo que nadie prueba y luego alerta mal.
 */
export function estadoGeneral(m: Metricas): 'ok' | 'degradado' | 'critico' {
  if (!m.sistema.bdViva) return 'critico'

  const sat = saturacionConexiones(m.sistema)
  if (sat !== null && sat >= 0.9) return 'critico'

  if (m.sistema.latenciaBdMs !== null && m.sistema.latenciaBdMs > 1000) return 'critico'
  if (m.sistema.latenciaBdMs !== null && m.sistema.latenciaBdMs > 300) return 'degradado'
  if (sat !== null && sat >= 0.75) return 'degradado'
  if ((m.sistema.indicesInvalidos ?? 0) > 0) return 'degradado'

  return 'ok'
}
