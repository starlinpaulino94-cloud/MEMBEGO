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
// CONSTRUCCIÓN PEREZOSA (y por qué no es opcional): construir el cliente al
// importar el módulo significa que cualquier componente cliente que — por
// error — importe un módulo de servidor arrastra esta línea al navegador y
// TODA la página muere con "PrismaClient is unable to run in this browser
// environment" (así se cayó /admin/notificaciones). Con el Proxy, importar
// este módulo es gratis en cualquier entorno; el cliente real solo se
// construye en la primera CONSULTA, que únicamente ocurre en el servidor.
// Se reutiliza vía globalThis también en producción: si el bundler evalúa
// este módulo más de una vez (chunks/workers), cada evaluación abriría un
// pool de conexiones propio contra el pooler de Supabase.
function obtenerCliente(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = crearCliente() as unknown as PrismaClient
  }
  return globalForPrisma.prisma
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_objetivo, prop) {
    const real = obtenerCliente()
    const valor = Reflect.get(real, prop)
    return typeof valor === 'function'
      ? (valor as (...args: unknown[]) => unknown).bind(real)
      : valor
  },
  has(_objetivo, prop) {
    return Reflect.has(obtenerCliente(), prop)
  },
})

// Guardia de configuración (una vez por proceso): en serverless (Vercel),
// conectar al puerto DIRECTO de Postgres agota las conexiones de Supabase
// bajo carga → cada click espera el pool (hasta 10 s) y termina en P2024.
// El síntoma es "toda la app lenta y con errores de carga". La conexión de la
// app DEBE ir por el transaction pooler (puerto 6543, pgbouncer=true).
if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) {
  try {
    const u = new URL(process.env.DATABASE_URL)
    const usaPooler = u.port === '6543' || u.searchParams.has('pgbouncer')

    // Auditoría de producción · Fase 4, REVISADA en el incidente del
    // 12-08-2026. El puerto correcto no basta: `connection_limit` decide
    // cuántas conexiones abre CADA instancia serverless contra el pooler.
    //
    // La aritmética tiene DOS lados y los dos han fallado ya en producción:
    //
    //   · Demasiado alto: Supabase da del orden de 200 conexiones al pooler y
    //     Vercel puede tener decenas de instancias vivas; con el valor por
    //     defecto de Prisma (num_cpus * 2 + 1) bastan ~25 instancias para
    //     agotarlo → P2024 en toda la app.
    //
    //   · Demasiado bajo: con Fluid, VARIAS peticiones concurrentes comparten
    //     la instancia — y su pool. Con `connection_limit=1` (la
    //     recomendación original, escrita cuando cada instancia atendía una
    //     petición), todas las transacciones de `conEmpresa`/`sinEmpresa` de
    //     esa instancia hacen cola por UNA conexión y mueren en P2028 en
    //     cuanto la de delante tarda más que `maxWait`. Así se cayó el panel
    //     entero el 12-08-2026.
    //
    // El rango sano con Fluid es pequeño pero mayor que uno: 3–5.
    const limite = Number(u.searchParams.get('connection_limit') ?? NaN)
    if (usaPooler && !(limite >= 1 && limite <= 5)) {
      console.warn(
        '[prisma] DATABASE_URL con `connection_limit` ' +
          (Number.isNaN(limite) ? 'sin definir (Prisma usará ~5-9)' : `en ${limite}`) +
          '. Con Fluid, el rango sano es 3-5: menos serializa las transacciones ' +
          'de la instancia (P2028); mucho más agota el pooler de Supabase entre ' +
          'todas las instancias (P2024). Añade `&connection_limit=3` a la cadena.'
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
