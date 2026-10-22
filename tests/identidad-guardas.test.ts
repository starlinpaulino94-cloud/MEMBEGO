/**
 * GUARDAS DE CÓDIGO de la verificación de identidad (Fase 1). No ejecutan nada:
 * leen el repositorio y fallan si alguien abre un camino que el diseño cierra a
 * propósito. Cada una explica qué defecto impide.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join(__dirname, '..')
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8')
const quitarComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function archivos(dir: string, ext = /\.(ts|tsx|mts)$/): string[] {
  const salida: string[] = []
  for (const nombre of readdirSync(join(RAIZ, dir))) {
    const ruta = join(dir, nombre)
    if (statSync(join(RAIZ, ruta)).isDirectory()) salida.push(...archivos(ruta, ext))
    else if (ext.test(nombre)) salida.push(ruta.replace(/\\/g, '/'))
  }
  return salida
}

const SERVICIO = 'src/modules/identidad/identidad.ts'
const MODELOS = /\b(identidadVerificacion|identidadIntento|identidadConsentimiento|identidadInterruptor)\b\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/

test('NADIE ESCRIBE EL ESTADO DE IDENTIDAD FUERA DEL SERVICIO: el resto del código solo lo lee', () => {
  const infractores = archivos('src').filter((f) => f !== SERVICIO && MODELOS.test(quitarComentarios(leer(f))))
  assert.deepEqual(infractores, [], 'las tablas de identidad se escriben solo desde modules/identidad/identidad.ts')
})

test('NINGUNA RUTA DE API NI ACCIÓN DE CLIENTE MARCA «VERIFICADA»: el resultado lo pone solo el worker, tras consultar al proveedor', () => {
  const origen = quitarComentarios(leer(SERVICIO))
  assert.equal((origen.match(/estado:\s*'verificada'\s+as\b/g) ?? []).length, 1, 'un solo sitio escribe estado verificada (registrarAprobada)')
  // aplicarDecision es el único escritor del estado del intento; revocar/revalidar/expirar son del equipo o del sistema.
  const llamadores = archivos('src').filter((f) => f !== SERVICIO && /\baplicarDecision\b/.test(quitarComentarios(leer(f))))
  assert.deepEqual(llamadores, ['src/modules/identidad/sincronizacion.ts'], 'solo el worker (que consulta al proveedor antes) llama a aplicarDecision')
  // Ninguna ruta toca el estado: solo hablan con el worker, el cron y los servicios de lectura.
  const rutas = archivos('src/app').filter((f) => /@\/modules\/identidad\//.test(quitarComentarios(leer(f))))
  assert.deepEqual(rutas.sort(), [
    'src/app/api/cron/identidad/route.ts',
    'src/app/api/v1/auth/cuenta/route.ts', // elimina la cuenta: purga antes lo del proveedor
    'src/app/api/v1/cliente/identidad/estado/route.ts',
    'src/app/api/v1/cliente/identidad/sesion/route.ts',
    'src/app/api/webhooks/identidad/[proveedor]/route.ts',
  ])
  for (const r of rutas) assert.doesNotMatch(quitarComentarios(leer(r)), /\baplicarDecision\b|\bregistrarAprobada\b/, r)
})

test('el servicio solo toca la base con conUsuario / sinEmpresa (nunca el cliente `prisma` suelto)', () => {
  const origen = quitarComentarios(leer(SERVICIO))
  assert.doesNotMatch(origen, /\bprisma\.(identidad|user|cliente|auditLog)/, 'sin `prisma.` directo')
  assert.doesNotMatch(origen, /import\s*\{[^}]*\bprisma\b[^}]*\}\s*from\s*['"]@\/lib\/prisma['"]/)
  assert.match(origen, /conUsuario/)
  assert.match(origen, /sinEmpresa\('identidad:/, 'cada sinEmpresa lleva su justificación')
})

test('EL ESQUEMA NO TIENE DÓNDE GUARDAR IMÁGENES, BIOMETRÍA NI DATOS DEL DOCUMENTO', () => {
  const esquema = leer('prisma/schema/identidad-verificacion.prisma')
  const campos = [...esquema.matchAll(/^\s{2}([a-zA-Z]\w*)\s+\S+/gm)].map((m) => m[1])
  assert.ok(campos.length > 20)
  const prohibidos = /(imagen|image|foto|photo|selfie|biometr|rostro|face|template|plantilla|cedula|cédula|documento|numeroDoc|passport|pasaporte|nombre|apellido|birth|nacimiento|direccion|address|telefono|phone|email|sexo|gender|nacionalidad)/i
  assert.deepEqual(campos.filter((c) => prohibidos.test(c) && c !== 'consentimientoBiometriaId' && c !== 'ipAddress'), [])
  // La referencia del proveedor solo existe sellada, y el hash es lo único que se guarda del documento.
  assert.ok(campos.includes('referenciaProveedorSellada'))
  assert.ok(!campos.includes('referenciaProveedor'))
  assert.ok(campos.includes('hashDedupe'))
})

test('el cliente (ficha de empresa) solo recibe estado, nivel y fecha: nunca un rechazo ni nada del documento', () => {
  const clientes = leer('prisma/schema/clientes.prisma')
  const bloque = clientes.match(/model Cliente \{[\s\S]*?\n\}/)?.[0] ?? ''
  const identidad = [...bloque.matchAll(/^\s{2}(identidad\w+)\s/gm)].map((m) => m[1])
  assert.deepEqual(identidad.sort(), ['identidadEstado', 'identidadNivel', 'identidadVerificadaEn'])
  const migracion = leer('prisma/migrations/20261079_identidad_verificacion/migration.sql')
  assert.match(migracion, /clientes_identidad_estado_chk[\s\S]{0,200}'verificada'/)
})

test('el cron de identidad exige CRON_SECRET (autorizarCron) y está programado en vercel.json', () => {
  const ruta = quitarComentarios(leer('src/app/api/cron/identidad/route.ts'))
  assert.match(ruta, /autorizarCron\(req\)/)
  assert.ok(ruta.indexOf('autorizarCron') < ruta.indexOf('ejecutarMantenimientoDeIdentidad()'), 'autoriza ANTES de hacer nada')
  const vercel = JSON.parse(leer('vercel.json')) as { crons: { path: string; schedule: string }[] }
  const cron = vercel.crons.find((c) => c.path === '/api/cron/identidad')
  assert.ok(cron, 'falta el cron en vercel.json')
  assert.match(cron.schedule, /^\S+ \S+ \* \* \*$/, 'diario: el plan solo admite crons diarios')
})

test('la migración deja la base como segunda barrera: CHECKs, un solo intento abierto, un consentimiento vigente, RLS y el interruptor APAGADO', () => {
  const m = leer('prisma/migrations/20261079_identidad_verificacion/migration.sql')
  for (const c of [
    'identidad_verificaciones_estado_chk', 'identidad_verificaciones_nivel_chk', 'identidad_verificaciones_verificada_completa_chk',
    'identidad_intentos_estado_chk', 'identidad_intentos_tipo_rechazo_chk', 'identidad_intentos_canal_chk', 'identidad_intentos_origen_chk',
    'identidad_consentimientos_tipo_chk', 'identidad_consentimientos_canal_chk',
  ]) assert.ok(m.includes(c), c)
  assert.match(m, /CREATE UNIQUE INDEX IF NOT EXISTS "identidad_intentos_uno_abierto_uk"[\s\S]{0,400}WHERE/)
  assert.match(m, /CREATE UNIQUE INDEX IF NOT EXISTS "identidad_consentimientos_vigente_uk"[\s\S]{0,300}"revocadoAt" IS NULL/)
  assert.match(m, /CREATE UNIQUE INDEX IF NOT EXISTS "identidad_verificaciones_hashDedupe_key"/)
  for (const t of ['identidad_verificaciones', 'identidad_intentos', 'identidad_consentimientos', 'identidad_interruptores']) {
    assert.match(m, new RegExp(`ALTER TABLE "${t}"\\s+ENABLE ROW LEVEL SECURITY`), `RLS en ${t}`)
  }
  const sembrado = m.match(/INSERT INTO "identidad_interruptores"[\s\S]*?;/)?.[0] ?? ''
  assert.match(sembrado, /'VERIFICACION_IDENTIDAD'\s*,\s*false/, 'el interruptor nace APAGADO')
  // Borrar a la persona borra su rastro (el interruptor solo referencia a quien lo cambió).
  assert.match(m, /identidad_verificaciones_userId_fkey[\s\S]{0,200}ON DELETE CASCADE/)
  assert.match(m, /identidad_consentimientos_userId_fkey[\s\S]{0,200}ON DELETE CASCADE/)
})

test('la política RLS de las tablas de la persona es de DUEÑO: ninguna empresa las lee', () => {
  const sql = leer('prisma/migrations_manual/2026-10-rls-identidad.sql')
  for (const t of ['identidad_verificaciones', 'identidad_intentos', 'identidad_consentimientos']) {
    assert.match(sql, new RegExp(`CREATE POLICY membego_dueno ON "${t}"[\\s\\S]{0,500}app\\.user_id`), t)
  }
  assert.doesNotMatch(sql, /membego_inquilino[\s\S]{0,40}identidad_/, 'ninguna política por empresa sobre identidad')
  assert.doesNotMatch(quitarComentarios(sql), /app\.company_id/)
})

test('el interruptor y la capacidad nacen apagados en el código: la verificación no se activa sola', () => {
  const catalogo = leer('src/modules/capacidades/catalogo.ts')
  assert.match(catalogo, /VERIFICACION_IDENTIDAD/)
  const schema = leer('prisma/schema/identidad-verificacion.prisma')
  assert.match(schema.match(/model IdentidadInterruptor[\s\S]*?\n\}/)?.[0] ?? '', /enabled\s+Boolean\s+@default\(false\)/)
  const env = quitarComentarios(leer('src/lib/env.ts'))
  assert.match(env, /IDENTIDAD_CLAVES_MAESTRAS/)
  assert.match(env, /IDENTIDAD_PEPPER_DEDUPE/)
})

test('las migraciones de identidad están selladas en SUMAS.txt y son las últimas', () => {
  const sumas = leer('prisma/migrations/SUMAS.txt')
  for (const m of ['20261078_identidad_acciones_enum', '20261079_identidad_verificacion', '20261080_identidad_acciones_proveedor', '20261081_identidad_proveedor']) assert.ok(sumas.includes(m), `${m} sin sellar (npm run migraciones:sellar)`)
})

// ── Fase 2 · el proveedor ───────────────────────────────────────────────────

test('la bandeja de avisos solo se escribe desde eventos.ts, y guarda de un aviso solo lo imprescindible', () => {
  const infractores = archivos('src').filter(
    (f) => f !== 'src/modules/identidad/eventos.ts' && /\bidentidadEventoExterno\b\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/.test(quitarComentarios(leer(f)))
  )
  assert.deepEqual(infractores, [])
  const esquema = leer('prisma/schema/identidad-verificacion.prisma')
  const bandeja = esquema.match(/model IdentidadEventoExterno[\s\S]*?\n\}/)?.[0] ?? ''
  const campos = [...bandeja.matchAll(/^\s{2}([a-zA-Z]\w*)\s+\S+/gm)].map((m) => m[1])
  // Ni el cuerpo ni el id de la sesión ni nada del documento.
  assert.deepEqual(campos.sort(), ['detalle', 'estado', 'estadoExterno', 'eventoExternoId', 'id', 'intentoId', 'intentosDeProceso', 'payloadHash', 'procesadoAt', 'proveedor', 'recibidoAt', 'tipo'])
})

test('EL WEBHOOK: lee el cuerpo CRUDO, verifica la firma antes de tocar la base y está fuera del proxy de sesión', () => {
  const ruta = quitarComentarios(leer('src/app/api/webhooks/identidad/[proveedor]/route.ts'))
  assert.match(ruta, /request\.text\(\)/, 'cuerpo crudo: la firma se calcula sobre los bytes que llegaron')
  assert.doesNotMatch(ruta, /request\.json\(\)/)
  assert.match(ruta, /recibirAvisoDeProveedor/)
  assert.match(ruta, /after\(/, 'el procesamiento va después de responder')
  assert.doesNotMatch(ruta, /prisma|sinEmpresa|conUsuario/, 'la ruta no toca la base: todo pasa por el manejador')

  const eventos = quitarComentarios(leer('src/modules/identidad/eventos.ts'))
  const manejador = eventos.slice(eventos.indexOf('export async function recibirAvisoDeProveedor'), eventos.indexOf('async function nombraOtraSesion'))
  const firma = manejador.indexOf('verificarFirmaDeDidit')
  assert.ok(firma > 0)
  for (const despues of ['registrarEvento(', 'leerAviso(', 'JSON.parse(']) assert.ok(manejador.indexOf(despues) > firma, despues + ' va DESPUÉS de verificar la firma')

  // /api/webhooks sigue excluido del proxy de sesión.
  assert.match(leer('src/proxy.ts'), /api\/webhooks/)
})

test('EL CLIENTE DEL PROVEEDOR: sin redirecciones, con tiempo máximo y la clave solo en su cabecera; nada de lo suyo llega a un log', () => {
  const didit = quitarComentarios(leer('src/modules/identidad/proveedor/didit.ts'))
  assert.match(didit, /redirect:\s*'manual'/)
  assert.match(didit, /AbortSignal\.timeout/)
  assert.match(didit, /'x-api-key':\s*config\.apiKey/)
  // Nadie más lee la clave del proveedor.
  const lectoresDeLaClave = archivos('src').filter((f) => /process\.env\.DIDIT_API_KEY/.test(quitarComentarios(leer(f))))
  assert.deepEqual(lectoresDeLaClave, ['src/lib/env.ts'])
  for (const f of archivos('src/modules/identidad')) {
    assert.doesNotMatch(quitarComentarios(leer(f)), /\bconsole\.(log|info|warn|error|debug)\b/, f + ': los fallos se anotan con códigos (anotarFallo), no se imprimen')
  }
  // Ninguna variable del proveedor se expone al navegador ni a la app.
  assert.doesNotMatch(leer('.env.example'), /NEXT_PUBLIC_DIDIT|EXPO_PUBLIC_DIDIT/)
})

test('LAS RUTAS DEL CLIENTE: la persona sale de la sesión (nunca del cuerpo), con límite de uso y solo para clientes', () => {
  for (const f of ['src/app/api/v1/cliente/identidad/sesion/route.ts', 'src/app/api/v1/cliente/identidad/estado/route.ts']) {
    const r = quitarComentarios(leer(f))
    assert.match(r, /getApiClientUser\(request\)/, f)
    assert.match(r, /metadata\.role !== 'CLIENTE'/, f)
    assert.match(r, /Limiter\(/, f)
    assert.match(r, /user\.metadata\.dbUserId/, f)
    assert.doesNotMatch(r, /body\.(userId|usuario|personaId)|searchParams\.get\('(userId|usuario)'\)/, f + ': no se acepta de quién es desde la petición')
  }
  // La dirección con token no se registra en ninguna parte de la ruta.
  assert.doesNotMatch(quitarComentarios(leer('src/app/api/v1/cliente/identidad/sesion/route.ts')), /console\./)
})

test('ELIMINAR UNA CUENTA borra antes los datos del proveedor, en TODOS los caminos que eliminan a una persona', () => {
  const caminos: [string, RegExp][] = [
    ['src/app/api/v1/auth/cuenta/route.ts', /purgarClienteRow\(ficha\.id\)/],
    ['src/modules/superadmin/eliminarActions.ts', /purgarClienteRow\(cliente\.id\)/],
    ['src/modules/admin/actions.ts', /auth\.admin\.deleteUser\(\s*empleado\.supabaseId/],
  ]
  for (const [archivo, borrado] of caminos) {
    const src = quitarComentarios(leer(archivo))
    const guardia = src.search(/bloqueoPorIdentidadPendiente\w*\(/)
    const primerBorrado = src.search(borrado)
    assert.ok(guardia > 0, archivo + ': falta la purga del proveedor')
    assert.ok(primerBorrado > guardia, archivo + ': la purga del proveedor va ANTES de borrar nada')
  }
  const superadmin = quitarComentarios(leer('src/modules/superadmin/eliminarActions.ts'))
  assert.equal((superadmin.match(/bloqueoPorIdentidadPendiente\(/g) ?? []).length, 1, 'eliminarUsuarioGlobal')
  assert.equal((superadmin.match(/bloqueoPorIdentidadPendientePorSupabaseId\(/g) ?? []).length, 1, 'eliminarClienteGlobal')
  // Los demás borrados de usuario son retrocesos de altas que fallaron (la persona nunca llegó a verificarse).
  const otros = archivos('src').filter((f) => /\buser\.delete\(/.test(quitarComentarios(leer(f))))
  assert.deepEqual(otros.sort(), [
    'src/app/api/v1/auth/cuenta/route.ts',
    'src/modules/admin/actions.ts',
    'src/modules/admin/invitacionActions.ts',
    'src/modules/excursiones/vendedores/actions.ts',
    'src/modules/superadmin/eliminarActions.ts',
  ], 'apareció un camino nuevo que elimina usuarios: ¿borra antes los datos de identidad del proveedor?')
})

test('la migración de la bandeja deja el aviso único por proveedor + evento + tipo, el CHECK de estado y RLS', () => {
  const m = leer('prisma/migrations/20261081_identidad_proveedor/migration.sql')
  assert.match(m, /CREATE UNIQUE INDEX IF NOT EXISTS "identidad_eventos_externos_proveedor_eventoExternoId_tipo_key"[\s\S]{0,120}"proveedor", "eventoExternoId", "tipo"/)
  assert.match(m, /identidad_eventos_externos_estado_chk[\s\S]{0,200}'recibido', 'procesado', 'ignorado', 'fallido'/)
  assert.match(m, /ALTER TABLE "identidad_eventos_externos" ENABLE ROW LEVEL SECURITY/)
  for (const col of ['purgadoAt', 'purgaIntentos', 'ultimaConsultaAt']) assert.match(m, new RegExp('ADD COLUMN IF NOT EXISTS "' + col + '"'))
  assert.match(leer('prisma/migrations_manual/2026-10-rls-identidad.sql'), /CREATE POLICY membego_plataforma ON "identidad_eventos_externos"[\s\S]{0,200}app\.omnisciente/)
  const enumM = leer('prisma/migrations/20261080_identidad_acciones_proveedor/migration.sql')
  assert.doesNotMatch(quitarComentarios(enumM).replace(/--.*$/gm, '').replace(/ALTER TYPE[^;]+;/g, ''), /\S/, 'la migración del enum va SOLA: un valor nuevo no se puede usar en la misma transacción')
})

test('las variables del proveedor están documentadas en .env.example y se exigen para encender', () => {
  const ejemplo = leer('.env.example')
  for (const v of ['DIDIT_API_KEY', 'DIDIT_WORKFLOW_ID', 'DIDIT_WEBHOOK_SECRET', 'DIDIT_WEBHOOK_SECRET_ANTERIOR', 'DIDIT_API_BASE']) assert.match(ejemplo, new RegExp('^' + v + '=', 'm'), v)
  const env = quitarComentarios(leer('src/lib/env.ts'))
  const faltantes = env.slice(env.indexOf('export function faltantesIdentidad'))
  for (const v of ['DIDIT_API_KEY', 'DIDIT_WORKFLOW_ID', 'DIDIT_WEBHOOK_SECRET']) assert.match(faltantes, new RegExp(v), 'faltantesIdentidad debe exigir ' + v)
})
