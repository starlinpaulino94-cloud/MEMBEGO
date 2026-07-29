import { PrismaClient } from '@prisma/client'
import { registrarEvento } from '@/modules/observabilidad/eventos'

/**
 * UMBRAL DE CONSULTA LENTA (auditoría · A-09, Fase 6).
 *
 * 500 ms. No es un número redondo elegido al azar: por debajo de eso una
 * consulta puede ser lenta por la latencia de red a Supabase y por la conexión
 * fría, cosas que no se arreglan tocando el código. Por encima, casi siempre
 * hay un índice que falta o un listado sin paginar.
 *
 * El objetivo no es registrar consultas lentas para leerlas una a una, sino
 * poder CONTARLAS: "hoy hubo 400 consultas por encima de medio segundo y ayer
 * 12" es una frase que ahora se puede decir, y antes no.
 */
const MS_CONSULTA_LENTA = 500

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function crearCliente() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

  /**
   * Medición de consultas.
   *
   * Se registra el modelo y la operación —`visit.findMany`— y NUNCA los
   * argumentos. Los argumentos de una consulta llevan correos, teléfonos y
   * tokens: son exactamente los datos que no pueden acabar en un log
   * (`src/modules/observabilidad/eventos.ts`). Con el modelo y la operación ya
   * se sabe qué consulta mirar; el detalle se reproduce en local.
   *
   * `P2024` se registra aparte porque no es "una consulta que falló": es la
   * señal de que el pool de conexiones se agotó, el incidente que hoy solo se
   * detecta cuando los usuarios se quejan (docs/runbooks/pool-agotado.md).
   */
  return base.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        const t0 = Date.now()
        try {
          const r = await query(args)
          const ms = Date.now() - t0
          if (ms >= MS_CONSULTA_LENTA) {
            registrarEvento({
              dominio: 'datos',
              accion: 'consulta_lenta',
              ok: true,
              ms,
              extra: { modelo: (model ?? 'raw').toLowerCase(), op: operation.toLowerCase() },
            })
          }
          return r
        } catch (e) {
          const codigo =
            typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : 'sin_codigo'
          registrarEvento({
            dominio: 'datos',
            accion: codigo === 'P2024' ? 'pool_agotado' : 'consulta_fallida',
            ok: false,
            ms: Date.now() - t0,
            motivo: codigo,
            extra: { modelo: (model ?? 'raw').toLowerCase(), op: operation.toLowerCase() },
          })
          throw e
        }
      },
    },
  })
}

/**
 * POR QUÉ HAY UN `as unknown as PrismaClient` AQUÍ.
 *
 * `$extends` devuelve un tipo distinto de `PrismaClient` (le falta `$on` y los
 * métodos de modelo se declaran con otra firma genérica). Ese tipo se propaga:
 * las diez fábricas de `src/lib/<dominio>/index.ts`, `Db = PrismaClient |
 * Prisma.TransactionClient` en dos servicios y `Tx` en growth dejan de
 * compilar — 40 errores en archivos que no tienen nada que ver con medir
 * consultas.
 *
 * La alternativa era cambiar la firma de esos doce archivos para que hablaran
 * del cliente extendido. Sería más "correcto" de tipos y bastante peor de
 * mantener: el tipo extendido es ilegible, aparece en los mensajes de error de
 * cualquiera que toque esos servicios, y ata todo el dominio a un detalle de
 * instrumentación.
 *
 * La diferencia real entre los dos tipos es `$on`, que este proyecto no usa en
 * ningún sitio (comprobado) y que además no serviría de nada con el `log`
 * configurado por nivel y no por evento. Todo lo demás —modelos,
 * `$transaction`, `$queryRaw`— existe igual en el objeto extendido.
 *
 * Es decir: la mentira del tipo se limita a un método inexistente que nadie
 * llama, y se paga una vez, aquí, con este comentario al lado.
 */
export const prisma: PrismaClient =
  globalForPrisma.prisma ?? (crearCliente() as unknown as PrismaClient)

// Reutilizar el cliente también en producción: si el bundler evalúa este
// módulo más de una vez (chunks/workers), cada evaluación abriría un pool
// de conexiones propio contra el pooler de Supabase.
globalForPrisma.prisma = prisma

// Guardia de configuración (una vez por proceso): en serverless (Vercel),
// conectar al puerto DIRECTO de Postgres agota las conexiones de Supabase
// bajo carga → cada click espera el pool (hasta 10 s) y termina en P2024.
// El síntoma es "toda la app lenta y con errores de carga". La conexión de la
// app DEBE ir por el transaction pooler (puerto 6543, pgbouncer=true).
if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) {
  try {
    const u = new URL(process.env.DATABASE_URL)
    const usaPooler = u.port === '6543' || u.searchParams.has('pgbouncer')

    // Auditoría de producción · Fase 4. El puerto correcto no basta:
    // `connection_limit` decide cuántas conexiones abre CADA instancia
    // serverless contra el pooler.
    //
    // La aritmética que importa: Supabase Pro da del orden de 200 conexiones
    // al pooler. Vercel puede tener cientos de instancias vivas a la vez bajo
    // carga. Con el valor por defecto de Prisma (num_cpus * 2 + 1, típicamente
    // 5 o 9) bastan ~25 instancias para agotarlo, y a partir de ahí cada clic
    // espera hasta diez segundos y muere en P2024.
    //
    // En serverless el número correcto es 1: la instancia atiende una petición
    // a la vez, así que un pool mayor no da paralelismo — solo reserva
    // conexiones que otra instancia necesita.
    const limite = u.searchParams.get('connection_limit')
    if (usaPooler && limite !== '1') {
      console.warn(
        '[prisma] DATABASE_URL sin `connection_limit=1`' +
          (limite ? ` (está en ${limite})` : ' (sin definir, Prisma usará ~5-9)') +
          '. En serverless cada instancia abriría ese número de conexiones contra el ' +
          'pooler de Supabase; con suficientes instancias se agotan y toda la app ' +
          'empieza a devolver P2024. Añade `&connection_limit=1` a la cadena.'
      )
    }

    if (!usaPooler) {
      console.warn(
        '[prisma] DATABASE_URL apunta al puerto directo de Postgres ' +
          `(${u.port || '5432'}). En Vercel esto agota las conexiones y frena toda la app. ` +
          'Usa la cadena del Transaction Pooler de Supabase (puerto 6543, ?pgbouncer=true&connection_limit=1) ' +
          'y deja la directa solo en DIRECT_URL (migraciones).'
      )
    }
  } catch {
    /* URL inválida: Prisma dará su propio error al conectar */
  }
}
