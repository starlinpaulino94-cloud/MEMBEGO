/**
 * LA PANTALLA PARA ACTIVAR LA RENOVACIÓN AUTOMÁTICA · lo que no se puede romper sin que se note.
 *
 * Son pruebas del código fuente: la puerta (las acciones), la pantalla (el componente) y su lugar en la membresía. El
 * comportamiento contra la base está en `tests/postgres/renovacion-activar.db.test.ts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  TEXTO_VERSION_RENOVACION,
  TEXTOS_PUBLICADOS,
  partirTexto,
  renderizarTexto,
} from '../src/modules/pagos/consentimientosCore'
import { renovacionVisible } from '../src/modules/pagos/renovacionFormato'

const raiz = join(__dirname, '..')
const fuente = (ruta: string) =>
  readFileSync(join(raiz, ruta), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
const trozo = (src: string, desde: string, hasta?: string) => {
  const i = src.indexOf(desde)
  assert.ok(i >= 0, `no se encontró «${desde}»`)
  const j = hasta ? src.indexOf(hasta, i + desde.length) : src.length
  assert.ok(j >= 0, `no se encontró «${hasta}»`)
  return src.slice(i, j)
}

const ACCIONES = 'src/modules/pagos/renovacionActions.ts'
const PUERTA = 'src/modules/pagos/renovacionPuerta.ts'
const RUTA_API = 'src/app/api/v1/cliente/membresias/[membershipId]/renovacion/route.ts'
const COMPONENTE = 'src/components/membresia/RenovacionAutomatica.tsx'
const PAGINA = 'src/app/(cliente)/membresia/[membresiaId]/page.tsx'
const SERVICIO = 'src/modules/pagos/renovacionCliente.ts'

const activar = () => trozo(fuente(PUERTA), 'export async function activarRenovacionDelCliente', 'export async function desactivarRenovacionDelCliente')
const desactivar = () => trozo(fuente(PUERTA), 'export async function desactivarRenovacionDelCliente', 'export interface PanelDeRenovacion')

// ── La puerta ───────────────────────────────────────────────────────────────

test('activar exige límite de peticiones, la aceptación EXPLÍCITA y la versión vista, antes de tocar nada', () => {
  const src = activar()
  const limite = src.indexOf('formSubmitLimiter(')
  const acepto = src.indexOf('!input.acepto')
  const version = src.indexOf('input.textoVersionVista !== TEXTO_VERSION_RENOVACION')
  const persona = src.indexOf('membresiaDeLaPersona(')
  const servicio = src.indexOf('activarRenovacion(')
  assert.ok(limite > 0 && acepto > limite && version > acepto && persona > version && servicio > persona, 'el orden de las comprobaciones cambió')
})

test('activar solo si la empresa puede cobrar con tarjeta; desactivar NUNCA depende de eso', () => {
  assert.match(activar(), /puedeCobrarToken\(m\.cliente\.companyId\)/)
  const des = desactivar()
  assert.doesNotMatch(des, /puedeCobrarToken|tieneCapacidad/, 'dejar de cobrar no puede depender de un interruptor de la empresa')
  assert.match(des, /desactivarRenovacion\(/)
})

test('lo que se registra como aceptado es la versión vigente del texto, con la IP y el agente de la petición', () => {
  const src = activar()
  assert.match(src, /textoVersion:\s*TEXTO_VERSION_RENOVACION/)
  assert.match(src, /ip:\s*input\.ip/)
  assert.match(src, /userAgent:\s*input\.userAgent/)
})

test('las dos operaciones buscan la membresía POR PERSONA (como la pantalla), no por la ficha activa', () => {
  const src = fuente(PUERTA)
  const busca = trozo(src, 'async function membresiaDeLaPersona', 'const MENSAJES')
  assert.match(busca, /cliente\.supabaseId === quien\.supabaseId \|\| m\.cliente\.id === quien\.clienteId/)
  for (const operacion of [activar(), desactivar()]) {
    assert.match(operacion, /membresiaDeLaPersona\(quien,/)
    assert.match(operacion, /if \(!m\) return NO_AUTORIZADO/)
  }
})

test('cada resultado del servicio tiene su mensaje: no queda ninguno sin decir qué pasó', () => {
  const servicio = fuente(SERVICIO)
  const tipo = trozo(servicio, 'export type ActivarRenovacion', 'export async function activarRenovacion')
  const resultados = [...tipo.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).filter((r) => r !== 'ok')
  assert.ok(resultados.length >= 8)
  const mensajes = trozo(fuente(PUERTA), 'const MENSAJES', 'export async function activarRenovacionDelCliente')
  for (const r of resultados) assert.match(mensajes, new RegExp(`\\b${r}:`), `sin mensaje para «${r}»`)
})

test('la web y la app móvil entran por LA MISMA puerta: ninguna repite las comprobaciones', () => {
  for (const [nombre, ruta] of [['las acciones web', ACCIONES], ['la API móvil', RUTA_API]] as const) {
    // De la API solo los métodos que ESCRIBEN: el GET lee la membresía para armar la pantalla.
    const src = ruta === RUTA_API ? trozo(fuente(ruta), 'export async function POST') : fuente(ruta)
    assert.match(src, /activarRenovacionDelCliente\(/, `${nombre} no usa la puerta para activar`)
    assert.match(src, /desactivarRenovacionDelCliente\(/, `${nombre} no usa la puerta para desactivar`)
    assert.doesNotMatch(src, /puedeCobrarToken|formSubmitLimiter|renovacionCliente'|\.membership\./, `${nombre} repite una comprobación de la puerta`)
  }
  // La web lee la casilla y la versión del formulario; la app, del cuerpo.
  assert.match(fuente(ACCIONES), /formData\.get\('acepto'\) === 'on'/)
  assert.match(fuente(ACCIONES), /formData\.get\('textoVersion'\)/)
  assert.match(fuente(RUTA_API), /acepto: campos\.acepto === true/)
  assert.match(fuente(RUTA_API), /textoVersionVista: typeof campos\.textoVersion === 'string'/)
})

test('el servicio comprueba lo mismo que el cobro exigirá, y deja el consentimiento junto con el encendido', () => {
  const src = trozo(fuente(SERVICIO), 'export async function activarRenovacion(', 'export async function desactivarRenovacion')
  for (const comprobacion of [
    "estado !== 'ACTIVA'",
    'canceladaAlVencimiento',
    'planIdSolicitado',
    'plan.precio',
    'tarjetaCardnetVencida(',
    'paymentProfileId',
  ]) {
    assert.ok(src.includes(comprobacion), `ya no comprueba ${comprobacion}`)
  }
  // El consentimiento y el encendido, en la MISMA transacción.
  assert.ok(src.indexOf('autoRenovar: true') > 0 && src.indexOf('otorgarConsentimiento(') > src.indexOf('autoRenovar: true'))
})

// ── La pantalla ─────────────────────────────────────────────────────────────

test('el texto del consentimiento sale de la fuente que el servidor registra, NO se escribe en la pantalla', () => {
  const src = fuente(COMPONENTE)
  assert.match(src, /renderizarTexto\(TEXTO_VERSION_RENOVACION,/)
  assert.match(src, /partirTexto\(/)
  // Ninguna frase del texto aceptado aparece literal en el componente.
  for (const frase of ['Autorizo a', 'sin confirmar cada cobro', 'Política de pagos.']) {
    assert.ok(!src.includes(frase), `«${frase}» está escrita a mano en la pantalla`)
  }
})

test('la casilla es corta y las condiciones completas están a un clic, en la Política de pagos', () => {
  const src = fuente(COMPONENTE)
  assert.match(src, /href=\{RUTA_POLITICA_RENOVACION\}/)
  assert.match(src, /Condiciones de la renovación automática/)
  // El enlace acompaña tanto al formulario de activar como al estado «activa».
  assert.equal([...src.matchAll(/<EnlaceCondiciones \/>/g)].length, 2)
})

test('el texto que se muestra es el registrado, con empresa, monto y periodo, y SE VE COMPLETO', () => {
  const t = renderizarTexto(TEXTO_VERSION_RENOVACION, { empresa: 'Lavado Express', monto: 'RD$1,600', periodo: 'cada 30 días' })
  assert.match(t, /Autorizo a Lavado Express a cobrar a esta tarjeta el precio vigente del plan \(hoy RD\$1,600\) cada 30 días/)
  assert.doesNotMatch(t, /\{(empresa|monto|periodo)\}/)
  const { titulo, detalle } = partirTexto(t)
  assert.equal(`${titulo} ${detalle}`, t, 'título + detalle es el texto completo, sin recortar nada')
  assert.ok(TEXTOS_PUBLICADOS[TEXTO_VERSION_RENOVACION])
})

test('la casilla va SIN marcar, el botón no se habilita hasta marcarla, y el formulario dice que se aceptó', () => {
  const src = fuente(COMPONENTE)
  assert.match(src, /useState\(false\)/)
  assert.match(src, /const \[acepto, setAcepto\] = useState\(false\)/)
  assert.match(src, /name="acepto"/)
  assert.match(src, /disabled=\{!acepto \|\| !tarjetaId \|\| pendiente\}/)
  assert.doesNotMatch(src, /defaultChecked|checked=\{true\}/)
})

test('desactivar pide confirmación y dice que la tarjeta sigue guardada y la membresía vigente', () => {
  const src = fuente(COMPONENTE)
  const des = trozo(src, 'accion={desactivarRenovacionAction}', 'Desactivar renovación automática')
  assert.match(des, /confirmacion=\{\{/)
  assert.match(src, /tu tarjeta\s+seguirá guardada/)
  assert.match(des, /Tu membresía sigue activa hasta/)
})

test('una tarjeta vencida no se ofrece, y sin tarjetas no hay un botón que no pueda hacer nada', () => {
  const src = fuente(COMPONENTE)
  assert.match(src, /tarjetas\.filter\(\(t\) => !t\.vencida\)/)
  assert.match(src, /vigentes\.length > 0 \?/)
  // Los tres textos sin botón.
  assert.match(src, /no está disponible en este negocio por ahora/)
  assert.match(src, /están vencidas/)
  assert.match(src, /Guardar esta tarjeta para futuras compras/)
})

test('una renovación HEREDADA se puede confirmar, solo con una tarjeta vigente y si la empresa puede cobrar', () => {
  const src = fuente(COMPONENTE)
  assert.match(src, /heredada && puedeActivar && vigentes\.some\(\(t\) => t\.id === tarjetaActual\.id\)/)
  assert.match(src, /textoBoton="Confirmar renovación automática"/)
})

test('la pantalla no maneja con qué se cobra: solo reconoce la tarjeta por marca y últimos 4', () => {
  const src = fuente(COMPONENTE)
  assert.doesNotMatch(src, /\btoken\b|tokenCifrado|paymentProfileId|customerId/)
  const tipo = fuente('src/modules/pagos/renovacionFormato.ts')
  assert.doesNotMatch(tipo, /token|paymentProfileId|customerId/i)
})

// ── Su lugar en la membresía ────────────────────────────────────────────────

test('el panel solo sale donde el cobro podría ocurrir (regla compartida), y nunca tumba la página', () => {
  const src = fuente(PAGINA)
  const cond = trozo(src, 'const renovacion = renovacionVisible({', 'cargarPanelDeRenovacion(')
  for (const campo of ['estado: membership.estado', 'fechaVencimiento: membership.fechaVencimiento', 'planIdSolicitado:', 'canceladaAlVencimiento:', 'precioPlan:']) {
    assert.ok(cond.includes(campo), `la página ya no pasa ${campo} a la regla`)
  }
  // El panel se carga con la función compartida, que degrada a null si algo falla.
  const puerta = fuente(PUERTA)
  assert.match(trozo(puerta, 'export async function cargarPanelDeRenovacion'), /\} catch \{\s*return null/)
  // Se ofrece activar si la empresa puede; si ya está activa se muestra siempre, para poder desactivarla.
  assert.match(puerta, /puedeActivar \|\| estado\.activa \? \{ puedeActivar, estado, tarjetas \} : null/)
})

test('el panel va antes de la cancelación y le pasa a la pantalla solo lo que necesita', () => {
  const src = fuente(PAGINA)
  const panel = src.indexOf('<RenovacionAutomatica')
  assert.ok(panel > 0 && panel < src.indexOf('<CancelarMembresiaBoton'))
  assert.match(src, /clienteId: membership\.clienteId/)
  assert.match(src, /periodoTexto=\{periodoDelPlan\(membership\.plan\.vigenciaDias\)\}/)
  assert.match(src, /heredada=\{renovacion\.estado\.origen === 'HEREDADO'\}/)
})

// ── La regla compartida de visibilidad ──────────────────────────────────────

test('renovacionVisible: solo una membresía activa, con vencimiento futuro, sin cancelación ni cambio de plan, con precio', () => {
  const AHORA = new Date('2026-10-21T12:00:00Z')
  const base = {
    estado: 'ACTIVA',
    fechaVencimiento: new Date('2026-11-10T12:00:00Z'),
    planIdSolicitado: null,
    canceladaAlVencimiento: null,
    precioPlan: 500,
  }
  assert.equal(renovacionVisible(base, AHORA), true)
  for (const [nombre, cambio] of [
    ['cancelada', { estado: 'CANCELADA' }],
    ['vencida', { estado: 'VENCIDA' }],
    ['pendiente de pago', { estado: 'PENDIENTE_PAGO' }],
    ['sin fecha de vencimiento', { fechaVencimiento: null }],
    ['ya venció (aunque diga ACTIVA)', { fechaVencimiento: new Date('2026-10-20T12:00:00Z') }],
    ['con cambio de plan por pagar', { planIdSolicitado: 'plan-2' }],
    ['con la cancelación programada', { canceladaAlVencimiento: new Date('2026-10-01T12:00:00Z') }],
    ['plan gratis', { precioPlan: 0 }],
  ] as const) {
    assert.equal(renovacionVisible({ ...base, ...cambio }, AHORA), false, nombre)
  }
})

// ── La app móvil ────────────────────────────────────────────────────────────

const PANEL_MOVIL = 'apps/client/src/components/membresia/RenovacionAutomaticaPanel.tsx'
const API_MOVIL = 'apps/client/src/lib/api.ts'
const PANTALLA_MOVIL = 'apps/client/app/membresia/[membresiaId].tsx'
const TARJETAS_MOVIL = 'apps/client/app/tarjetas.tsx'

test('móvil: el texto del consentimiento lo escribe el SERVIDOR; la app no tiene su copia que pueda separarse', () => {
  const src = fuente(PANEL_MOVIL)
  assert.match(src, /consentimiento\.titulo/)
  assert.match(src, /consentimiento\.detalle/)
  for (const frase of ['Autorizo a', 'sin confirmar cada cobro', 'Política de pagos', 'Renovar mi membresía automáticamente']) {
    assert.ok(!src.includes(frase), `«${frase}» está escrita a mano en la app: el texto aceptado debe venir del servidor`)
  }
})

test('móvil: al aceptar devuelve la versión del texto que vio, y solo acepta con la casilla marcada', () => {
  const src = fuente(PANEL_MOVIL)
  assert.match(src, /textoVersion: consentimiento\.textoVersion/)
  assert.match(src, /useState\(false\)/)
  assert.match(src, /const \[acepto, setAcepto\] = useState\(false\)/)
  assert.match(src, /disabled=\{!acepto \|\| !tarjetaId \|\| activar\.isPending\}/)
  assert.match(src, /accessibilityRole="checkbox"/)
  const api = trozo(fuente(API_MOVIL), 'activarRenovacionAutomatica: (', 'desactivarRenovacionAutomatica:')
  assert.match(api, /acepto: true/)
  assert.match(api, /textoVersion: input\.textoVersion/)
})

test('móvil: la app no decide la elegibilidad: no oculta ni ofrece nada por su cuenta, y desactivar pide confirmación', () => {
  const src = fuente(PANEL_MOVIL)
  // Lo que se ofrece sale de `puedeActivar`, `tarjetas` y `activa`, que decide el servidor.
  assert.match(src, /if \(!datos \|\| !datos\.disponible\) return null/)
  assert.match(src, /datos\.puedeActivar/)
  assert.match(src, /tarjetas\.filter\(\(t\) => !t\.vencida\)/)
  assert.doesNotMatch(src, /\.precio|vigenciaDias|canceladaAlVencimiento|\.estado\b/, 'la app deriva elegibilidad que decide el servidor')
  const des = trozo(src, 'const confirmarDesactivar', 'return (')
  assert.match(des, /Alert\.alert\(/)
  assert.match(des, /Tu membresía sigue activa hasta/)
})

test('móvil: las condiciones completas están a un toque, en la Política de pagos que da el servidor', () => {
  const src = fuente(PANEL_MOVIL)
  assert.match(src, /Linking\.openURL\(url\)/)
  assert.match(src, /consentimiento\.urlCondiciones/)
  assert.equal([...src.matchAll(/<EnlaceCondiciones /g)].length, 2, 'el enlace acompaña al estado activo y al formulario')
})

test('móvil: los tipos de la app son los que envía la API (mismas claves, sin inventar ninguna)', () => {
  const ruta = trozo(fuente(PUERTA), 'export type RenovacionParaLaApp')
  const tipo = trozo(fuente(API_MOVIL), 'export type RenovacionAutomatica =', 'function getApiBaseUrl')
  for (const clave of ['disponible', 'activa', 'heredada', 'tarjetaActual', 'puedeActivar', 'tarjetas', 'proximoCobro', 'montoTexto', 'consentimiento', 'textoVersion', 'titulo', 'detalle', 'urlCondiciones']) {
    assert.ok(tipo.includes(`${clave}`), `el tipo de la app no tiene «${clave}»`)
    assert.ok(ruta.includes(`${clave}`), `la API ya no envía «${clave}»`)
  }
})

test('móvil: las tres llamadas van a la API de la membresía y quitar una tarjeta refresca las renovaciones', () => {
  const api = fuente(API_MOVIL)
  for (const metodo of ['getRenovacionAutomatica', 'activarRenovacionAutomatica', 'desactivarRenovacionAutomatica']) {
    assert.match(api, new RegExp(`${metodo}: `), metodo)
  }
  assert.equal([...api.matchAll(/\/api\/v1\/cliente\/membresias\/\$\{encodeURIComponent\(membershipId\)\}\/renovacion/g)].length, 3)
  assert.match(api, /method: 'DELETE'/)
  assert.match(fuente(TARJETAS_MOVIL), /queryKey: \['cliente', 'membresia-renovacion'\]/)
})

test('móvil: el panel va en el detalle de la membresía, solo si está activa, y no estorba si no carga', () => {
  assert.match(fuente(PANTALLA_MOVIL), /\{isActive \? <RenovacionAutomaticaPanel membershipId=\{membresia\.id\} \/> : null\}/)
  const query = trozo(fuente(PANEL_MOVIL), 'const query = useQuery', 'return <Panel')
  assert.match(query, /if \(!datos \|\| !datos\.disponible\) return null/)
})
