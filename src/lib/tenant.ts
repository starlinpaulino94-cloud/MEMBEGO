import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

/**
 * CONTEXTO DE EMPRESA PARA RLS  (auditoría de producción · A-01, Capa 2)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ES ESTO
 *
 * PostgreSQL no sabe quién es el usuario de MembeGo. Ve una conexión y nada
 * más. Para que las políticas de `prisma/migrations_manual/
 * 2026-07-rls-capa2-aislamiento.sql` puedan filtrar por empresa, alguien tiene
 * que decírselo en cada transacción. Eso es lo que hace `conEmpresa`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE PUEDE EMPEZAR A USAR HOY, CON RLS TODAVÍA APAGADO
 *
 * Y es a propósito. Hoy la aplicación se conecta como `postgres`, que se salta
 * RLS: poner la variable no cambia absolutamente nada, ni para bien ni para
 * mal. El día que `DATABASE_URL` pase a `membego_app`, el código que ya use
 * `conEmpresa` queda protegido sin tocarlo, y el que no lo use dejará de ver
 * datos —ruidosamente, en la primera prueba— en vez de fallar en silencio.
 *
 * Es decir: se migra módulo a módulo, con la red puesta, en vez de un cambio
 * de golpe que no se puede probar contra producción. El orden recomendado
 * está en docs/RLS.md § 4.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ `SET LOCAL` Y NO `SET`
 *
 * `SET LOCAL` muere con la transacción. `SET` a secas se queda pegado a la
 * CONEXIÓN, y con un pooler delante —MembeGo usa el de Supabase— la conexión
 * se reutiliza: la siguiente petición heredaría la empresa de la anterior y
 * un cliente vería los datos de otro. Es el fallo clásico de RLS con pooling,
 * y por eso aquí no hay una versión sin transacción.
 */

/** Cliente de Prisma dentro de una transacción. */
export type Tx = Prisma.TransactionClient

/**
 * OPCIONES DE TODAS LAS TRANSACCIONES DE CONTEXTO (incidente 12-08-2026).
 *
 * Los valores por defecto de Prisma —2 s de espera para ARRANCAR la
 * transacción, 5 s para terminarla— tumbaron el panel entero en producción
 * con `P2028: Unable to start a transaction in the given time`.
 *
 * La aritmética del fallo: cada pantalla del panel pasa por aquí, cada
 * transacción retiene una conexión mientras dura, y en Vercel con Fluid
 * varias peticiones CONCURRENTES comparten la instancia — y por tanto el
 * pool de esa instancia. Con `connection_limit` bajo, las transacciones
 * hacen cola por la conexión; a la que la de delante tarda más de 2 s, la
 * de detrás muere sin llegar a empezar. Bajo tráfico real (campaña de
 * Instagram) eso fue «No se pudo cargar esta sección» en todos los módulos
 * a la vez.
 *
 * `maxWait` alto convierte ese error en espera: la página tarda, pero
 * carga. `timeout` acota el daño de una transacción colgada sin cortar los
 * dashboards legítimamente lentos. Si estos números vuelven a quedarse
 * cortos, el ajuste que falta es `connection_limit` en DATABASE_URL
 * (ver la guardia en src/lib/prisma.ts).
 */
const OPCIONES_TX = { maxWait: 20_000, timeout: 45_000 } as const

/**
 * `cuid()` o `cuid2`, que es lo que genera el esquema. Se comprueba antes de
 * meterlo en la sesión: `set_config` recibe el valor como parámetro y no hay
 * riesgo de inyección, pero un id con basura dentro significa que algo va mal
 * más arriba, y es mejor enterarse aquí que servir una página vacía.
 */
const RE_ID = /^[a-z0-9_-]{1,64}$/i

/**
 * Ejecuta `fn` con el contexto puesto en una empresa.
 *
 * Con RLS encendido, dentro de `fn` **solo existen las filas de esa empresa**:
 * un `findMany` sin `where` devuelve lo suyo y nada más.
 *
 * El `where: { companyId }` de las consultas NO se quita. RLS es la segunda
 * barrera, no la primera: si un día alguien despliega sin las políticas, el
 * filtro de la aplicación sigue ahí. Dos cierres independientes.
 *
 * @throws si `companyId` está vacío o tiene una forma imposible.
 */
export async function conEmpresa<T>(
  companyId: string,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  if (!companyId || !RE_ID.test(companyId)) {
    throw new Error(`conEmpresa: companyId inválido (${JSON.stringify(companyId)})`)
  }

  return prisma.$transaction(async (tx) => {
    // `set_config(..., true)` es `SET LOCAL` en forma de función. La diferencia
    // que importa: acepta el valor como PARÁMETRO. `SET LOCAL app.company_id
    // = '...'` no admite parámetros y habría que interpolar la cadena a mano.
    await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`
    return fn(tx)
  }, OPCIONES_TX)
}

/**
 * Ejecuta `fn` viendo TODAS las empresas.
 *
 * Para lo que cruza inquilinos por diseño: el marketplace público, el panel
 * del superadmin, el cron que recorre empresa por empresa, los trabajos de la
 * cola.
 *
 * Cada uso es una renuncia deliberada al aislamiento, así que se lee en la
 * revisión de código como lo que es. Si aparece dentro de una pantalla de
 * empresa, está mal.
 *
 * @param motivo por qué este código necesita ver todo. No se usa en tiempo de
 *   ejecución: existe para que quien lea la llamada no tenga que adivinarlo.
 */
export async function sinEmpresa<T>(motivo: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  void motivo
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.omnisciente', 'on', true)`
    return fn(tx)
  }, OPCIONES_TX)
}

/**
 * Ejecuta `fn` en UNA empresa, o en todas si no hay ninguna.
 *
 * Existe por una forma concreta del panel: `companyFilter(user)` devuelve
 * `undefined` cuando quien mira es el superadmin, porque su panel de empresa
 * cruza inquilinos a propósito. Sin este envoltorio, cada pantalla del panel
 * repetiría el mismo `companyId ? conEmpresa(...) : sinEmpresa(...)` —
 * cincuenta y siete veces, y la primera que se copiara mal sería un hueco.
 *
 * El `motivo` es el de `sinEmpresa`: solo se usa cuando NO hay empresa, que es
 * justo el caso que hay que poder justificar leyendo la llamada.
 */
export function conEmpresaOTodas<T>(
  companyId: string | null | undefined,
  motivo: string,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return companyId ? conEmpresa(companyId, fn) : sinEmpresa(motivo, fn)
}

/**
 * Ejecuta `fn` con la variable `app.user_id` puesta. Es el análogo de
 * `conEmpresa` para los datos DE LA PERSONA (RLS · GEO ·
 * `prisma/migrations_manual/2026-08-rls-geo.sql`): `customer_locations`,
 * `geo_consents` y `location_search_events` solo los ve su dueño.
 *
 * Hoy la aplicación se conecta como `postgres` (se salta RLS), así que esto no
 * cambia nada todavía; el día que `DATABASE_URL` pase a `membego_app`, el
 * código que use `conUsuario` queda protegido y el que no, dejará de ver datos
 * —ruidosamente— en vez de filtrarlos. Mismo patrón que `conEmpresa`.
 */
export async function conUsuario<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!userId || !RE_ID.test(userId)) {
    throw new Error(`conUsuario: userId inválido (${JSON.stringify(userId)})`)
  }
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`
    return fn(tx)
  }, OPCIONES_TX)
}
