/**
 * VERIFICACIÓN DE IDENTIDAD · Fase 3 · las pantallas (app móvil y web) NO deciden el resultado.
 *
 * La app y la web pintan la vista que arma el servidor (`vistaCore.ts` → `identidadPuerta.ts`). Estas pruebas leen el
 * código fuente de las pantallas y fijan lo que no debe cambiar sin que alguien lo vea: que los tipos de la app son los
 * que envía la API, que el retorno de la verificación solo dispara una consulta, que ninguna casilla viene marcada, que
 * ninguna pantalla puede marcar a nadie como verificado y que la ruta del aviso llega a la pantalla.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { redirectSystemPath } from '../apps/client/app/+native-intent'
import { IDENTIDAD_RETURN_URL, isIdentidadReturn, retornoEsDeEsteIntento } from '../apps/client/src/lib/identidad-retorno'
import { resolveNotificationHref } from '../apps/client/src/lib/notificacion-navegacion'
import { isClientDetailRoute } from '../apps/client/src/lib/client-route-presentation'

const raiz = join(__dirname, '..')
const fuente = (ruta: string) => readFileSync(join(raiz, ruta), 'utf8')
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
/** Los nombres de campo de una `interface` (solo el primer nivel). */
function camposDe(src: string, nombre: string): string[] {
  const i = src.indexOf(`interface ${nombre} {`)
  assert.ok(i >= 0, `no se encontró la interface ${nombre}`)
  let nivel = 0
  let cuerpo = ''
  for (const c of src.slice(src.indexOf('{', i))) {
    if (c === '{') nivel++
    if (c === '}') nivel--
    if (nivel >= 1) cuerpo += c
    if (nivel === 0 && cuerpo) break
  }
  const campos: string[] = []
  let profundidad = 0
  for (const linea of cuerpo.split('\n')) {
    const m = linea.match(/^\s*(?:readonly\s+)?(\w+)\??:/)
    if (profundidad === 1 && m) campos.push(m[1])
    for (const c of linea) {
      if (c === '{') profundidad++
      if (c === '}') profundidad--
    }
  }
  return campos.sort()
}

const API_APP = 'apps/client/src/lib/api.ts'
const VISTA_SERVIDOR = 'src/modules/identidad/vistaCore.ts'
const PUERTA_SERVIDOR = 'src/modules/identidad/identidadPuerta.ts'

// ── El retorno ──────────────────────────────────────────────────────────────

test('el retorno de la app es el que manda el servidor y el scheme de app.json', () => {
  const servidor = fuente('src/modules/identidad/sincronizacion.ts').match(/RETORNO_APP_IDENTIDAD = '([^']+)'/)
  assert.ok(servidor, 'el servidor ya no declara RETORNO_APP_IDENTIDAD')
  assert.equal(IDENTIDAD_RETURN_URL, servidor![1], 'servidor y app no coinciden en adónde vuelve la persona')
  assert.equal(JSON.parse(fuente('apps/client/app.json')).expo.scheme, 'membego')
  assert.ok(IDENTIDAD_RETURN_URL.startsWith('membego://'))
})

test('reconoce la vuelta en todas las formas en que el router la entrega, y nada más', () => {
  for (const ok of [IDENTIDAD_RETURN_URL, `${IDENTIDAD_RETURN_URL}?intento=a&nonce=b`, '/identidad/retorno', 'identidad/retorno?intento=a', `${IDENTIDAD_RETURN_URL}#x`]) assert.equal(isIdentidadReturn(ok), true, ok)
  for (const no of ['membego://identidad', 'membego://identidad/retornos', 'membego://pago-cardnet', '/identidad', 'https://membego.com/identidad/retorno', 'membego://identidad/retorno-falso']) assert.equal(isIdentidadReturn(no), false, no)
})

test('el retorno solo cuenta si es de ESTE intento: el mismo id y el mismo nonce, sin claves repetidas', () => {
  const esperado = { intentoId: 'cm123', nonce: 'abc123' }
  const url = (q: string) => `${IDENTIDAD_RETURN_URL}?${q}`
  assert.equal(retornoEsDeEsteIntento(url('intento=cm123&nonce=abc123'), esperado), true)
  for (const mala of ['intento=cm123&nonce=otro', 'intento=otro&nonce=abc123', 'intento=cm123', 'nonce=abc123', 'intento=cm123&intento=otro&nonce=abc123', 'intento=cm123&nonce=abc123&nonce=otro', '']) {
    assert.equal(retornoEsDeEsteIntento(url(mala), esperado), false, mala)
  }
  assert.equal(retornoEsDeEsteIntento('membego://pago-cardnet?intento=cm123&nonce=abc123', esperado), false, 'otro retorno')
  assert.equal(retornoEsDeEsteIntento(url('intento=cm123'), { intentoId: 'cm123', nonce: null }), true, 'sin nonce, no debe traer uno')
  assert.equal(retornoEsDeEsteIntento(url('intento=cm123&nonce=x'), { intentoId: 'cm123', nonce: null }), false)
})

test('el router no intenta navegar a /identidad/retorno: la vuelta se queda en la pantalla (o abre la de identidad en un arranque en frío)', () => {
  assert.equal(redirectSystemPath({ path: `${IDENTIDAD_RETURN_URL}?intento=a`, initial: false }), null)
  assert.equal(redirectSystemPath({ path: '/identidad/retorno?intento=a', initial: false }), null)
  assert.equal(redirectSystemPath({ path: `${IDENTIDAD_RETURN_URL}?intento=a`, initial: true }), '/identidad')
  assert.equal(redirectSystemPath({ path: '/ajustes', initial: false }), '/ajustes', 'las demás rutas no se tocan')
  assert.equal(redirectSystemPath({ path: 'membego://pago-cardnet?s=1', initial: false }), null, 'y la de CardNET sigue igual')
})

test('el aviso de resultado lleva a la pantalla de identidad de la app, y la ruta es de detalle', () => {
  const aviso = fuente('src/modules/identidad/avisosCore.ts').match(/RUTA_DEL_AVISO_DE_IDENTIDAD = '([^']+)'/)
  assert.ok(aviso)
  assert.equal(resolveNotificationHref(aviso![1]), '/identidad')
  assert.equal(resolveNotificationHref('/identidad'), '/identidad')
  assert.equal(isClientDetailRoute('/identidad'), true)
  assert.ok(existsSync(join(raiz, 'apps/client/app/identidad.tsx')))
  assert.ok(existsSync(join(raiz, 'src/app/(cliente)/cliente/identidad/page.tsx')), 'y la web tiene la misma ruta')
})

// ── Los tipos de la app son los de la API ───────────────────────────────────

test('los tipos de la app son los que envía la API (la vista, los permisos y el panel)', () => {
  const app = fuente(API_APP)
  assert.deepEqual(camposDe(app, 'VistaIdentidad'), camposDe(fuente(VISTA_SERVIDOR), 'VistaDeIdentidad'))
  assert.deepEqual(camposDe(app, 'ConsentimientoIdentidad'), camposDe(fuente(VISTA_SERVIDOR), 'ConsentimientoDePanel'))
  assert.deepEqual(camposDe(app, 'PanelIdentidad'), camposDe(fuente(PUERTA_SERVIDOR), 'PanelDeIdentidad'))
  // Y los valores cerrados: tonos y acciones.
  const tonoApp = app.match(/type TonoIdentidad = ([^\n]+)/)![1].match(/'(\w+)'/g)!.sort()
  const tonoServidor = fuente(VISTA_SERVIDOR).match(/type TonoDeVista = ([^\n]+)/)![1].match(/'(\w+)'/g)!.sort()
  assert.deepEqual(tonoApp, tonoServidor)
  const accionApp = app.match(/type AccionIdentidad = ([^\n]+)/)![1].match(/'(\w+)'/g)!.sort()
  const accionServidor = fuente(VISTA_SERVIDOR).match(/type AccionDeVista =[\s\S]*?\n\n/)![0].match(/'(\w+)'/g)!.sort()
  assert.deepEqual(accionApp, accionServidor)
})

test('cada método de la app apunta a una ruta de la API que existe', () => {
  const app = sinComentarios(fuente(API_APP))
  for (const ruta of ['estado', 'sesion', 'consentimientos', 'incidencias', 'borrado']) {
    assert.match(app, new RegExp(`/api/v1/cliente/identidad/${ruta}'`), ruta)
    assert.ok(existsSync(join(raiz, `src/app/api/v1/cliente/identidad/${ruta}/route.ts`)), `falta la ruta ${ruta}`)
  }
})

// ── La app no decide nada ───────────────────────────────────────────────────

test('LA APP NO DECIDE: no marca a nadie como verificado, no habla con la base ni con el proveedor, y abre la verificación en el navegador del sistema', () => {
  const panel = sinComentarios(fuente('apps/client/src/components/identidad/PanelIdentidad.tsx'))
  assert.match(panel, /WebBrowser\.openAuthSessionAsync\(sesion\.url, IDENTIDAD_RETURN_URL/)
  assert.match(panel, /preferEphemeralSession: true/)
  assert.doesNotMatch(panel, /supabase|fetch\(|Prisma|didit/i, 'la app solo habla con la API de Membego')
  // Ninguna escritura de «verificada»: el estado y el botón salen de `panel.vista`.
  assert.doesNotMatch(panel, /estado\s*[:=]\s*'verificada'|setVerificad|esVerificad/, 'la app no calcula si alguien está verificado')
  assert.match(panel, /panel\.vista|const \{ vista \} = panel/)
  // Los textos legales los pone el servidor: la app no tiene su copia.
  for (const frase of ['datos biométricos', 'Unión Europea', 'cédula y una selfie']) assert.doesNotMatch(panel, new RegExp(frase), `la app no debe llevar su copia del texto legal («${frase}»)`)
})

test('cada permiso se manda con la versión del texto que la persona VIO, y ninguna casilla viene marcada', () => {
  const panel = sinComentarios(fuente('apps/client/src/components/identidad/PanelIdentidad.tsx'))
  assert.match(panel, /\[c\.tipo, c\.textoVersion\]/, 'al aceptar se devuelve la versión del texto que se mostró')
  assert.match(panel, /useState<Record<string, boolean>>\(\{\}\)/, 'todas las casillas empiezan sin marcar')
  assert.match(panel, /accessibilityRole="checkbox"/)
  assert.match(panel, /accessibilityState=\{\{ checked: marcada \}\}/)
  assert.match(panel, /disabled=\{faltanObligatorias \|\| abriendo\}/, 'sin las obligatorias el botón no se habilita')
  assert.match(panel, /version: consentimiento\.textoVersion/, 'la divulgación también')
})

test('la app sondea el estado mientras algo está por resolverse y solo entonces', () => {
  const hook = sinComentarios(fuente('apps/client/src/hooks/useIdentidad.ts'))
  assert.match(hook, /refetchInterval:\s*\(query\)\s*=>\s*\(query\.state\.data\?\.vista\.sondear \? SONDEO_IDENTIDAD_MS : false\)/)
  assert.match(hook, /queryKey: IDENTIDAD_QUERY_KEY/)
})

test('accesibilidad y diseño de la app: objetivos de 44 px, avisos en vivo, nada de DOM ni de colores sueltos', () => {
  for (const f of ['apps/client/src/components/identidad/PanelIdentidad.tsx', 'apps/client/src/components/identidad/ResumenIdentidad.tsx', 'apps/client/app/identidad.tsx']) {
    const src = sinComentarios(fuente(f))
    assert.doesNotMatch(src, /<(div|span|p|a|ul|li|button|input|label|section)[\s>]/, `${f}: intrínsecos del DOM`)
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, `${f}: usa los tokens de colors, no hexadecimales`)
  }
  const panel = fuente('apps/client/src/components/identidad/PanelIdentidad.tsx')
  assert.ok((panel.match(/min-h-11/g) ?? []).length >= 5, 'los controles táctiles miden al menos 44 px')
  assert.match(panel, /accessibilityLiveRegion="polite"/)
})

test('la pantalla de la app cubre cargando, sin sesión, error y no disponible', () => {
  const pantalla = sinComentarios(fuente('apps/client/app/identidad.tsx'))
  assert.match(pantalla, /ActivityIndicator/)
  assert.match(pantalla, /Inicia sesión para continuar/)
  assert.match(pantalla, /No pudimos cargar tu verificación/)
  assert.match(pantalla, /Reintentar/)
  assert.match(pantalla, /!panel\?\.visible/)
})

// ── La web ──────────────────────────────────────────────────────────────────

test('LA WEB tampoco decide: la página lee el panel del servidor y el componente solo pinta y llama a las acciones', () => {
  const pagina = sinComentarios(fuente('src/app/(cliente)/cliente/identidad/page.tsx'))
  assert.match(pagina, /requireRole\('CLIENTE'\)/)
  assert.match(pagina, /leerPanelDeIdentidad\(user\.metadata\.dbUserId, \{ reconciliar: true \}\)/, 'la persona sale de la sesión, y al volver se pregunta el estado')
  assert.match(pagina, /searchParams: Promise<\{ identidad\?: string \}>/, 'de la URL solo se lee si vuelve del proveedor: nunca de quién es')
  const comp = sinComentarios(fuente('src/components/cliente/identidad/VerificacionIdentidad.tsx'))
  assert.match(comp, /^'use client'/m)
  assert.doesNotMatch(comp, /prisma|conUsuario|sinEmpresa|supabase/i)
  assert.doesNotMatch(comp, /defaultChecked|checked=\{true\}/, 'ninguna casilla de consentimiento viene marcada')
  assert.match(comp, /useState<Record<string, boolean>>\(\{\}\)/)
  assert.match(comp, /name=\{`version:\$\{c\.tipo\}`\} value=\{c\.textoVersion\}|name=\{`version:\$\{c\.tipo\}`\}\s+value=\{c\.textoVersion\}/, 'se manda la versión del texto que se mostró')
  assert.match(comp, /disabled=\{faltanObligatorias \|\| ocupado\}/)
  for (const frase of ['datos biométricos', 'Unión Europea']) assert.doesNotMatch(comp, new RegExp(frase), `la web no debe llevar su copia del texto legal («${frase}»)`)
  // El auditor de diseño: sin hexadecimales ni paleta cruda en lo nuevo.
  for (const f of ['src/components/cliente/identidad/VerificacionIdentidad.tsx', 'src/components/cliente/identidad/ResumenIdentidad.tsx', 'src/app/(cliente)/cliente/identidad/page.tsx']) {
    const src = sinComentarios(fuente(f))
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, `${f}: hexadecimal`)
    assert.doesNotMatch(src, /\b(?:bg|text|border|ring|from|to|via)-(?:slate|gray|zinc|red|green|amber|blue|yellow|orange|emerald)-\d{2,3}\b/, `${f}: color de la paleta cruda`)
  }
})

test('las acciones web solo traducen: cada una exige a la persona de la SESIÓN y ninguna recibe un userId del formulario', () => {
  const acciones = sinComentarios(fuente('src/modules/identidad/clienteActions.ts'))
  assert.match(acciones, /^'use server'/m)
  const exportadas = [...acciones.matchAll(/export async function (\w+)/g)].map((m) => m[1])
  assert.deepEqual(exportadas.sort(), ['borrarDatosDeIdentidadAction', 'cambiarDivulgacionAction', 'iniciarVerificacionAction', 'reportarProblemaAction'])
  for (const nombre of exportadas) {
    const cuerpo = acciones.slice(acciones.indexOf(`function ${nombre}`)).split(/\nexport async function /)[0]
    assert.match(cuerpo, /await exigirPersona\(\)/, `${nombre} no exige a la persona`)
  }
  assert.doesNotMatch(acciones, /formData\.get\('(userId|usuario|personaId|supabaseId)'\)/)
  // La persona de la sesión: un cliente o (Fase 5) quien trabaja en el portal de un proveedor; cualquier otro rol, fuera.
  assert.match(acciones, /if \(!user \|\| !user\.metadata\.dbUserId\) return null/)
  assert.match(acciones, /const esCliente = user\.metadata\.role === 'CLIENTE'/)
  assert.match(acciones, /if \(!esCliente && !\(await proveedorDeLaSesion\(\)\)\) return null/)
})

test('lo que Configuración muestra del tema es solo un resumen que enlaza a la pantalla, y no rompe Configuración si falla', () => {
  const ajustes = sinComentarios(fuente('src/app/(cliente)/cliente/ajustes/page.tsx'))
  assert.match(ajustes, /leerPanelDeIdentidad\(user\.metadata\.dbUserId\)\.catch\(\(\) => null\)/)
  assert.match(ajustes, /<ResumenIdentidad panel=\{panelDeIdentidad\} \/>/)
  const resumen = sinComentarios(fuente('src/components/cliente/identidad/ResumenIdentidad.tsx'))
  assert.match(resumen, /href="\/cliente\/identidad"/)
  assert.match(resumen, /if \(!panel\?\.visible\) return null/)
  assert.match(sinComentarios(fuente('apps/client/src/components/identidad/ResumenIdentidad.tsx')), /if \(!panel\?\.visible\) return null/)
})
