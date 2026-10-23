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
const MODELOS = /\b(identidadVerificacion|identidadIntento|identidadConsentimiento|identidadInterruptor|identidadIncidencia|identidadRegla)\b\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/

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
    'src/app/(admin)/admin/supply/identidad/page.tsx', // la pantalla de quien trabaja en el portal del proveedor: solo SU verificación
    'src/app/(cliente)/cliente/ajustes/page.tsx', // el resumen de Configuración (solo lectura)
    'src/app/(cliente)/cliente/identidad/page.tsx', // la pantalla de la persona (solo lectura)
    'src/app/(superadmin)/superadmin/identidad/[userId]/page.tsx', // el caso (solo SUPERADMIN)
    'src/app/(superadmin)/superadmin/identidad/page.tsx', // el panel del equipo (solo SUPERADMIN)
    'src/app/api/cron/identidad/route.ts',
    'src/app/api/v1/auth/cuenta/route.ts', // elimina la cuenta: purga antes lo del proveedor
    'src/app/api/v1/cliente/identidad/borrado/route.ts',
    'src/app/api/v1/cliente/identidad/consentimientos/route.ts',
    'src/app/api/v1/cliente/identidad/estado/route.ts',
    'src/app/api/v1/cliente/identidad/incidencias/route.ts',
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
  for (const m of ['20261078_identidad_acciones_enum', '20261079_identidad_verificacion', '20261080_identidad_acciones_proveedor', '20261081_identidad_proveedor', '20261082_identidad_avisos_incidencias_enums', '20261083_identidad_incidencias', '20261084_identidad_admin_enums', '20261085_identidad_incidencias_respuesta', '20261086_identidad_reglas_enums', '20261087_identidad_reglas']) assert.ok(sumas.includes(m), `${m} sin sellar (npm run migraciones:sellar)`)
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

test('LAS RUTAS DEL CLIENTE: la persona sale de la sesión (nunca de la petición), solo para clientes y con límite de uso', () => {
  const rutas = ['estado', 'sesion', 'consentimientos', 'incidencias', 'borrado'].map((n) => 'src/app/api/v1/cliente/identidad/' + n + '/route.ts')
  for (const f of rutas) {
    const r = quitarComentarios(leer(f))
    assert.match(r, /getApiClientUser\(request\)/, f)
    assert.match(r, /metadata\.role !== 'CLIENTE'/, f)
    assert.match(r, /user\.metadata\.dbUserId/, f)
    assert.doesNotMatch(r, /datos\.userId|d\.userId|cuerpo\.userId|body\.(userId|usuario|personaId)|searchParams\.get\('(userId|usuario)'\)/, f + ': no se acepta de quién es desde la petición')
    assert.doesNotMatch(r, /console\./, f)
    // Cada ruta habla con la puerta compartida (y ahí está el límite de uso) o lleva su propio límite.
    assert.match(r, /Limiter\(|identidadPuerta/, f)
  }
  // Los límites viven en la puerta: crear sesión cuesta dinero (estrecho), el resto va con el límite de formularios.
  const puerta = quitarComentarios(leer('src/modules/identidad/identidadPuerta.ts'))
  const cuerpo = (nombre: string) => puerta.slice(puerta.indexOf('export async function ' + nombre)).split(/\nexport async function /)[0]
  assert.match(cuerpo('iniciarVerificacionDePersona'), /identidadSesionLimiter\(/)
  for (const n of ['cambiarConsentimientoDePersona', 'reportarProblemaDePersona', 'pedirBorradoDePersona']) assert.match(cuerpo(n), /formSubmitLimiter\(/, n)
  assert.match(quitarComentarios(leer('src/app/api/v1/cliente/identidad/estado/route.ts')), /paymentSessionLimiter\(/)
  // La puerta no marca a nadie como verificado ni escribe estado.
  assert.doesNotMatch(puerta, /aplicarDecision|registrarAprobada|estado:\s*'verificada'/)
})

test('LAS INCIDENCIAS: se escriben solo desde el servicio, sin el texto de la persona en bitácora ni correo, y con la cola acotada', () => {
  const servicio = quitarComentarios(leer(SERVICIO))
  assert.match(servicio, /MAX_INCIDENCIAS_ABIERTAS/)
  assert.match(servicio, /findFirst\(\{ where: \{ id: input\.intentoId, userId \}/, 'el intento tiene que ser de la persona')
  const puerta = quitarComentarios(leer('src/modules/identidad/identidadPuerta.ts'))
  const reporte = puerta.slice(puerta.indexOf('export async function reportarProblemaDePersona')).split(/\nexport async function /)[0]
  assert.doesNotMatch(reporte, /entrada\.mensaje/, 'el correo a soporte no lleva el texto de la persona')
  const correo = reporte.slice(reporte.indexOf('encolarEmail({'), reporte.indexOf('} catch'))
  assert.ok(correo.length > 50, 'no se encontró el correo a soporte')
  assert.doesNotMatch(correo, /quien\.|entrada\.mensaje/, 'ni su correo, ni su id, ni su texto en el aviso a soporte')
  const migracion = leer('prisma/migrations/20261083_identidad_incidencias/migration.sql')
  assert.match(migracion, /identidad_incidencias_tipo_chk[\s\S]{0,200}no_puedo_completar/)
  assert.match(migracion, /identidad_incidencias_mensaje_chk[\s\S]{0,120}BETWEEN 1 AND 600/)
  assert.match(migracion, /ALTER TABLE "identidad_incidencias" ENABLE ROW LEVEL SECURITY/)
  assert.match(leer('prisma/migrations_manual/2026-10-rls-identidad.sql'), /CREATE POLICY membego_dueno ON "identidad_incidencias"/)
})

test('LOS AVISOS: la deduplicación va en la base (clave única por intento y resultado) y los valores del enum van solos en su migración', () => {
  const avisos = quitarComentarios(leer('src/modules/identidad/avisos.ts'))
  assert.match(avisos, /skipDuplicates: true/, 'el reclamo no aborta la transacción si el aviso ya existe')
  assert.match(avisos, /claveDeAviso\(intentoId, resultado\)/)
  assert.match(avisos, /catch\(anotarFallo/, 'un aviso que falla no tumba la resolución')
  const sinc = quitarComentarios(leer('src/modules/identidad/sincronizacion.ts'))
  assert.match(sinc, /if \(aplicada\.aplicado === 'aplicar'\) await avisarResultadoDeIdentidad\(intentoId\)/, 'se avisa solo cuando el resultado se aplica de verdad')
  const enums = leer('prisma/migrations/20261082_identidad_avisos_incidencias_enums/migration.sql')
  for (const v of ['IDENTIDAD_VERIFICADA', 'IDENTIDAD_RECHAZADA', 'IDENTIDAD_EN_REVISION', 'IDENTIDAD_INCIDENCIA_REPORTADA']) assert.match(enums, new RegExp(v))
  assert.doesNotMatch(quitarComentarios(enums).replace(/--.*$/gm, '').replace(/DO \$\$ BEGIN\s*ALTER TYPE[^;]+;\s*END \$\$;/g, ''), /\S/, 'la migración del enum va SOLA')
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

// ── Fase 4 · el equipo ──────────────────────────────────────────────────────

test('EL PANEL DEL EQUIPO es solo de SUPERADMIN en TODAS sus capas: las páginas, las acciones y el servicio', () => {
  for (const f of ['src/app/(superadmin)/superadmin/identidad/page.tsx', 'src/app/(superadmin)/superadmin/identidad/[userId]/page.tsx']) {
    const src = quitarComentarios(leer(f))
    assert.match(src, /requireRole\('SUPERADMIN'\)/, f)
    assert.doesNotMatch(src, /\bprisma\b|conEmpresa|conUsuario|sinEmpresa/, f + ': las páginas no tocan la base: todo pasa por el servicio del equipo')
    assert.doesNotMatch(src, /<img|<Image|referenciaProveedor|hashDedupe/, f + ': nunca una imagen ni la referencia del proveedor')
  }
  const acciones = quitarComentarios(leer('src/modules/superadmin/identidadActions.ts'))
  assert.match(acciones, /^'use server'/m)
  const exportadas = [...acciones.matchAll(/export async function (\w+)/g)].map((m) => m[1])
  assert.deepEqual(exportadas.sort(), ['atenderIncidenciaAction', 'cambiarInterruptorAction', 'cambiarReglaAction', 'pedirRevalidacionAction', 'resolverRevisionAction', 'revocarVerificacionAction', 'suprimirIdentidadAction'])
  for (const nombre of exportadas) {
    const cuerpo = acciones.slice(acciones.indexOf('function ' + nombre)).split(/\nexport async function /)[0]
    assert.match(cuerpo, /await requireSuperadmin\(\)/, nombre + ' no exige ser SUPERADMIN')
    assert.match(cuerpo, /if \(!sesion\) return \{ error: 'No autorizado\.' \}/, nombre)
  }
  assert.match(acciones, /user\.metadata\.role !== 'SUPERADMIN'/)
  // Todas las funciones del servicio del equipo empiezan por la comprobación del rol.
  const staff = quitarComentarios(leer('src/modules/identidad/staff.ts'))
  for (const nombre of ['resumenDeLaPlataforma', 'colaDeRevision', 'colaDeIncidencias', 'buscarPersonas', 'verCasoDeIdentidad', 'reglasDeLaPlataforma', 'cambiarReglaComoStaff']) {
    const cuerpo = staff.slice(staff.indexOf('export async function ' + nombre)).split(/\nexport async function /)[0]
    assert.match(cuerpo.slice(0, 700), /exigirGestionDeIdentidad\(actor\)/, nombre + ' debe empezar comprobando el rol')
  }
  assert.match(quitarComentarios(leer(SERVICIO)), /export const ROLES_GESTION_IDENTIDAD: readonly string\[\] = \['SUPERADMIN'\]/)
})

test('EL EQUIPO NO PUEDE ACREDITAR A NADIE: no hay acción de aprobar, y lo que resuelve un caso solo rechaza o pide repetir', () => {
  const acciones = quitarComentarios(leer('src/modules/superadmin/identidadActions.ts'))
  assert.doesNotMatch(acciones, /aprobar|aplicarDecision|registrarAprobada|estado:\s*'verificada'/i)
  const servicio = quitarComentarios(leer(SERVICIO))
  const resolver = servicio.slice(servicio.indexOf('export async function resolverRevisionDeIdentidad')).split(/\nexport (async )?function |\nexport type /)[0]
  assert.match(resolver, /decision !== 'rechazar' && decision !== 'pedir_repeticion'/, 'una decisión inventada no se interpreta como la segunda salida')
  assert.doesNotMatch(resolver, /'aprobada'|'verificada'/)
  assert.match(resolver, /where: \{ id: intentoId, estado: 'en_revision' \}/, 'solo se toca lo que sigue en revisión')
  // La pantalla lo dice con todas las letras.
  assert.match(leer('src/app/(superadmin)/superadmin/identidad/[userId]/page.tsx'), /Para aprobar un caso en revisión, hazlo en la consola del proveedor/)
})

test('EL SERVICIO DEL EQUIPO nunca saca la referencia del proveedor, el hash ni un documento; y cada consulta usa un motivo de lista cerrada', () => {
  const staff = quitarComentarios(leer('src/modules/identidad/staff.ts'))
  assert.doesNotMatch(staff, /hashDedupe|abrirReferencia|leerReferenciaDeSesion|sesionesDeLaPersona/, 'staff.ts no toca la referencia ni el hash')
  // La referencia sellada solo aparece como FILTRO («¿queda algo por borrar en el proveedor?»), nunca elegida ni leída.
  const usosDeLaReferencia = staff.match(/referenciaProveedorSellada[^\n]*/g) ?? []
  assert.ok(usosDeLaReferencia.every((u) => /^referenciaProveedorSellada: \{ not: null \},?$/.test(u.trim())), 'la referencia del proveedor solo puede usarse como filtro')
  assert.match(staff, /if \(!esMotivoDeConsulta\(motivo\)\) throw new ErrorDeIdentidad\('motivo_requerido'/)
  assert.match(staff, /consultarIdentidadComoStaff\(actor, userId, motivo, contexto\)/, 'la consulta pasa por la función que deja asiento')
  // La lectura del caso deja asiento ANTES de completar nada: la llamada auditada va primero.
  assert.ok(staff.indexOf('consultarIdentidadComoStaff(actor') < staff.indexOf("tx.identidadConsentimiento.findMany({ where: { userId }"))
  // El panel no ofrece ningún enlace de descarga ni tiene rutas que devuelvan archivos.
  for (const f of archivos('src/app/(superadmin)/superadmin/identidad')) assert.doesNotMatch(quitarComentarios(leer(f)), /download|\.pdf|\.zip|createReadStream|Content-Disposition/i, f)
  assert.deepEqual(archivos('src/app/(superadmin)/superadmin/identidad').filter((f) => f.endsWith('route.ts')), [], 'el panel no tiene rutas de datos')
})

test('LAS EMPRESAS NO TOCAN LA IDENTIDAD DE NADIE: sin importar el módulo ni leer sus tablas; solo la insignia «verificada» de la ficha, con la capacidad', () => {
  const zonasDeEmpresa = [...archivos('src/app/(admin)'), ...archivos('src/modules/admin'), ...archivos('src/components/admin'), ...archivos('src/app/(vendedor)')]
  const infractores = zonasDeEmpresa.filter((f) => /@\/modules\/identidad\/|\bidentidad(Verificacion|Intento|Consentimiento|Incidencia|EventoExterno|Interruptor)\b/.test(quitarComentarios(leer(f))))
  // Única excepción (Fase 2): borrar a un empleado se frena mientras haya un borrado de identidad sin completar. La función solo
  // devuelve un TEXTO de aviso (o null): ningún dato de identidad llega a la empresa.
  // Y la pantalla de la persona que trabaja en el portal del proveedor (Fase 5): es SU verificación, la de la sesión, no la de la empresa.
  assert.deepEqual(infractores, ['src/app/(admin)/admin/supply/identidad/page.tsx', 'src/modules/admin/actions.ts'], 'una empresa no importa el módulo de identidad ni lee sus tablas')
  const origen = quitarComentarios(leer('src/modules/admin/actions.ts'))
  assert.deepEqual([...origen.matchAll(/from '@\/modules\/identidad\/([\w-]+)'/g)].map((m) => m[1]), ['supresion'])
  assert.match(origen, /import \{ bloqueoPorIdentidadPendiente \} from '@\/modules\/identidad\/supresion'/)
  // Lo único que lee de la persona: la proyección de la ficha, solo en la ficha de un cliente, y detrás de la capacidad.
  const lectores = archivos('src').filter((f) => /\bcliente\.identidad(Estado|Nivel|VerificadaEn)\b/.test(quitarComentarios(leer(f))))
  assert.deepEqual(lectores, ['src/app/(admin)/admin/clientes/[id]/page.tsx'])
  const ficha = quitarComentarios(leer(lectores[0]))
  assert.match(ficha, /cliente\.identidadEstado === 'verificada' && \(await tieneCapacidad\(cliente\.companyId, 'VERIFICACION_IDENTIDAD'\)\)/)
  const insignia = quitarComentarios(leer('src/components/admin/IdentidadVerificadaBadge.tsx'))
  assert.doesNotMatch(insignia, /rechaz|revis|duplic|nivel|c[eé]dula|selfie/i, 'la insignia no dice nada más que «verificada»')
})

// ── Fase 5 · reglas por función ─────────────────────────────────────────────

const PAGOS = 'src/modules/supply-v2/finance/payments.ts'

test('LAS REGLAS SOLO LAS CONSULTA LA PUERTA DONDE SALE EL DINERO: ni compras, ni promociones, ni membresías, ni renovaciones, ni accesos', () => {
  // Quién fuera del módulo de identidad lo importa. Una compra, una renovación o un escáner aquí sería abrirles la puerta de la identidad.
  const fuera = archivos('src').filter((f) => !f.startsWith('src/modules/identidad/') && /@\/modules\/identidad\//.test(quitarComentarios(leer(f))))
  assert.deepEqual(fuera.sort(), [
    'src/app/(admin)/admin/supply/identidad/page.tsx',
    'src/app/(cliente)/cliente/ajustes/page.tsx',
    'src/app/(cliente)/cliente/identidad/page.tsx',
    'src/app/(superadmin)/superadmin/identidad/[userId]/page.tsx',
    'src/app/(superadmin)/superadmin/identidad/page.tsx',
    'src/app/api/cron/identidad/route.ts',
    'src/app/api/v1/auth/cuenta/route.ts',
    'src/app/api/v1/cliente/identidad/borrado/route.ts',
    'src/app/api/v1/cliente/identidad/consentimientos/route.ts',
    'src/app/api/v1/cliente/identidad/estado/route.ts',
    'src/app/api/v1/cliente/identidad/incidencias/route.ts',
    'src/app/api/v1/cliente/identidad/sesion/route.ts',
    'src/app/api/webhooks/identidad/[proveedor]/route.ts',
    'src/components/cliente/identidad/ResumenIdentidad.tsx',
    'src/components/cliente/identidad/VerificacionIdentidad.tsx',
    'src/modules/admin/actions.ts',
    'src/modules/superadmin/eliminarActions.ts',
    'src/modules/superadmin/identidadActions.ts',
    PAGOS,
  ])
  // Las reglas (el núcleo y el evaluador) las toca un solo sitio fuera del módulo: la confirmación del pago a un proveedor.
  const conReglas = archivos('src').filter((f) => !f.startsWith('src/modules/identidad/') && /identidad\/reglas(Core)?['"]/.test(quitarComentarios(leer(f))))
  assert.deepEqual(conReglas, [PAGOS])
  // Dentro del módulo, quién consulta la decisión: solo el evaluador y el servicio del equipo (que cambia reglas).
  const dentro = archivos('src/modules/identidad').filter((f) => /\bdecidirRequisito\b|\bevaluarRequisitoDePagoAProveedor\b/.test(quitarComentarios(leer(f))))
  assert.deepEqual(dentro.sort(), ['src/modules/identidad/reglas.ts', 'src/modules/identidad/reglasCore.ts'])
})

test('LA PUERTA DEL PAGO está donde sale el dinero: dentro de la confirmación, antes de moverlo, una sola vez', () => {
  const pagos = quitarComentarios(leer(PAGOS))
  assert.equal((pagos.match(/evaluarRequisitoDePagoAProveedor\(/g) ?? []).length, 1, 'un solo sitio pregunta')
  const confirmar = pagos.slice(pagos.indexOf('export async function confirmarPagoProveedorEnTx')).split(/\nexport async function /)[0]
  const llamada = confirmar.indexOf('exigirIdentidadDelRepresentante(')
  assert.ok(llamada > 0, 'la confirmación la llama')
  assert.ok(llamada > confirmar.indexOf("exigirTransicion(TRANSICIONES_PAGO_PROVEEDOR, p.status, 'CONFIRMED'"), 'después de comprobar que el pago se puede confirmar')
  assert.ok(llamada < confirmar.indexOf("data: { status: 'CONFIRMED'"), 'ANTES de marcarlo confirmado y de aplicarlo: si se frena, no sale nada')
  assert.ok(llamada < confirmar.indexOf('aplicarEnTx('), 'antes de aplicar el dinero')
  // La confirmación repetida (idempotente) no vuelve a preguntar: ya salió.
  assert.ok(confirmar.indexOf("p.status === 'CONFIRMED'") < llamada)
  // El representante es quien aceptó el contrato (dato del servidor), nunca algo que llegue de fuera.
  assert.match(confirmar, /representanteId: p\.supplier\.termsAcceptedById/)
  assert.match(pagos, /fallo\('IDENTIDAD_DEL_REPRESENTANTE', decision\.mensaje\)/)
})

test('LA BASE Y EL CÓDIGO COINCIDEN EN QUÉ OPERACIONES PUEDEN TENER REGLA, y ninguna es una compra', () => {
  const migracion = leer('prisma/migrations/20261087_identidad_reglas/migration.sql')
  const enBase = [...(migracion.match(/CHECK \("operacion" IN \(([^)]*)\)\)/)?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])
  const nucleo = quitarComentarios(leer('src/modules/identidad/reglasCore.ts'))
  const enCodigo = [...(nucleo.slice(nucleo.indexOf('export const OPERACIONES_CON_REGLA'), nucleo.indexOf('export type OperacionDeIdentidad')).matchAll(/clave: '([A-Z_]+)'/g))].map((m) => m[1])
  assert.deepEqual(enBase.sort(), enCodigo.sort(), 'el CHECK de la base y el catálogo del código dicen lo mismo')
  const nunca = [...(nucleo.slice(nucleo.indexOf('export const OPERACIONES_SIN_REGLA')).matchAll(/clave: '([A-Z_]+)'/g))].map((m) => m[1])
  assert.ok(nunca.length >= 7)
  assert.deepEqual(enBase.filter((o) => nunca.includes(o)), [], 'una compra, una renovación o un acceso no pueden tener regla')
  // Nace apagada y vacía: la migración no inserta ninguna regla.
  assert.doesNotMatch(migracion, /INSERT INTO "identidad_reglas"/)
  assert.match(migracion, /"activa"\s+BOOLEAN\s+NOT NULL DEFAULT false/)
})

test('QUIEN VERIFICA DESDE EL PORTAL DEL PROVEEDOR: el sitio de vuelta sale del ROL, la pantalla es la de la sesión y la ruta coincide con el aviso', () => {
  const acciones = quitarComentarios(leer('src/modules/identidad/clienteActions.ts'))
  assert.match(acciones, /origenWeb: esCliente \? 'cliente' : 'proveedor'/, 'el origen se deduce del rol')
  assert.doesNotMatch(acciones, /formData\.get\('origen/, 'nunca de lo que mande el formulario')
  assert.match(acciones, /if \(!esCliente && !\(await proveedorDeLaSesion\(\)\)\) return null/, 'solo un cliente o alguien del portal de un proveedor')
  const pagina = quitarComentarios(leer('src/app/(admin)/admin/supply/identidad/page.tsx'))
  assert.match(pagina, /proveedorDeLaSesion\(\)/)
  assert.match(pagina, /leerPanelDeIdentidad\(proveedor\.id,/, 'el panel es el de la persona de la sesión')
  assert.doesNotMatch(pagina, /\bprisma\.|from '@\/lib\/prisma'|conEmpresa|sinEmpresa|await params|\.userId\b/, 'sin base ni identificadores de otra persona')
  // La misma ruta en el catálogo del portal y en el aviso.
  const catalogo = quitarComentarios(leer('src/modules/supply-v2/core/catalogo.ts'))
  assert.match(catalogo, /RUTA_PORTAL_IDENTIDAD = `\$\{RUTA_PORTAL_PROVEEDOR\}\/identidad`/)
  assert.match(quitarComentarios(leer('src/modules/identidad/avisosCore.ts')), /RUTA_DEL_AVISO_PARA_PROVEEDOR = '\/admin\/supply\/identidad'/)
  // Y solo hay rutas de retorno de una lista cerrada.
  assert.match(quitarComentarios(leer('src/modules/identidad/sincronizacion.ts')), /export const RUTAS_WEB_DE_RETORNO = \{\s*cliente: RUTA_WEB_RETORNO_IDENTIDAD,\s*proveedor: RUTA_DEL_AVISO_PARA_PROVEEDOR,\s*\} as const/)
})

test('EL EVALUADOR DE REGLAS no traga errores: si no puede leer la regla o a la persona, el pago no sale (no sé no es sí)', () => {
  const reglas = quitarComentarios(leer('src/modules/identidad/reglas.ts'))
  assert.doesNotMatch(reglas, /catch\s*[({]/, 'ningún try/catch que convierta un fallo en «puede pasar»')
  assert.doesNotMatch(reglas, /console\./)
  // Con la regla apagada no se lee nada de la persona (se evalúa antes de tocarla).
  assert.ok(reglas.indexOf('if (!regla?.activa)') < reglas.indexOf('estadoDeIdentidadDe('))
})

test('LA POLÍTICA Y LA PANTALLA DEL PORTAL DICEN LA EXCEPCIÓN: solo antes de pagarle a un proveedor, siendo decisión de la persona, y nunca para comprar', () => {
  const privacidad = leer('src/app/(public)/privacy/page.tsx').replace(/\s+/g, ' ')
  assert.match(privacidad, /Hay un solo caso en el que MembeGo puede pedírtelo: si aceptaste el contrato de un proveedor de Membego Supply/)
  assert.match(privacidad, /Sigue siendo tu decisión \(si no lo haces, ese pago queda a la espera\) y nunca se pide para comprar, reservar, renovar ni entrar con tu QR/)
  const pantalla = leer('src/app/(admin)/admin/supply/identidad/page.tsx').replace(/\s+/g, ' ')
  assert.match(pantalla, /Es tu decisión: si no la haces, ese pago queda a la espera, y nada más cambia en tu portal/)
})
