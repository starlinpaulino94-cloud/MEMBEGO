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
const COMPONENTE = 'src/components/membresia/RenovacionAutomatica.tsx'
const PAGINA = 'src/app/(cliente)/membresia/[membresiaId]/page.tsx'
const SERVICIO = 'src/modules/pagos/renovacionCliente.ts'

const activar = () => trozo(fuente(ACCIONES), 'export async function activarRenovacionAction', 'export async function desactivarRenovacionAction')
const desactivar = () => trozo(fuente(ACCIONES), 'export async function desactivarRenovacionAction')

// ── La puerta ───────────────────────────────────────────────────────────────

test('activar exige sesión de cliente, límite de peticiones y la aceptación EXPLÍCITA, antes de tocar nada', () => {
  const src = activar()
  const sesion = src.indexOf('clienteActual()')
  const limite = src.indexOf('formSubmitLimiter(')
  const acepto = src.indexOf("formData.get('acepto') !== 'on'")
  const servicio = src.indexOf('activarRenovacion(')
  assert.ok(sesion > 0 && limite > sesion && acepto > limite && servicio > acepto, 'el orden de las comprobaciones cambió')
})

test('activar solo si la empresa puede cobrar con tarjeta; desactivar NUNCA depende de eso', () => {
  assert.match(activar(), /puedeCobrarToken\(m\.cliente\.companyId\)/)
  const des = desactivar()
  assert.doesNotMatch(des, /puedeCobrarToken|tieneCapacidad/, 'dejar de cobrar no puede depender de un interruptor de la empresa')
  assert.match(des, /desactivarRenovacion\(/)
})

test('lo que se registra como aceptado es la versión del texto que la pantalla muestra, con IP y agente de la petición', () => {
  const src = activar()
  assert.match(src, /textoVersion:\s*TEXTO_VERSION_RENOVACION/)
  assert.match(src, /getRequestMeta\(\)/)
  assert.match(src, /ip:\s*meta\.ipAddress/)
  assert.match(src, /userAgent:\s*meta\.userAgent/)
})

test('las dos acciones buscan la membresía POR PERSONA (como la pantalla), no por la ficha activa', () => {
  const src = fuente(ACCIONES)
  assert.match(src, /membresiaDeLaPersona\(ctx\.user, membershipId\)/)
  const busca = trozo(src, 'async function membresiaDeLaPersona', 'export async function activarRenovacionAction')
  assert.match(busca, /cliente\.supabaseId === user\.supabaseId \|\| m\.cliente\.id === user\.metadata\.clienteId/)
  for (const accion of [activar(), desactivar()]) {
    assert.match(accion, /if \(!m\) return NO_AUTORIZADO/)
  }
})

test('cada resultado del servicio tiene su mensaje: no queda ninguno sin decir qué pasó', () => {
  const servicio = fuente(SERVICIO)
  const tipo = trozo(servicio, 'export type ActivarRenovacion', 'export async function activarRenovacion')
  const resultados = [...tipo.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).filter((r) => r !== 'ok')
  assert.ok(resultados.length >= 8)
  const mensajes = trozo(activar(), 'const MENSAJES', 'if (r !== ')
  for (const r of resultados) assert.match(mensajes, new RegExp(`\\b${r}:`), `sin mensaje para «${r}»`)
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

test('el panel solo sale donde el cobro podría ocurrir, y nunca tumba la página', () => {
  const src = fuente(PAGINA)
  // Las condiciones, hasta donde empiezan las consultas.
  const cond = trozo(src, 'const renovacion =', 'await Promise.all')
  for (const c of [
    'isActive &&',
    '!isChangePending &&',
    '!membership.canceladaAlVencimiento &&',
    'membership.fechaVencimiento != null &&',
    'Number(membership.plan.precio) > 0',
  ]) {
    assert.ok(cond.includes(c), `el panel ya no exige ${c}`)
  }
  assert.match(src, /\.catch\(\(\) => null\)/)
  // Se ofrece activar si la empresa puede; si ya está activa se muestra siempre, para poder desactivarla.
  assert.match(src, /puedeActivar \|\| estado\.activa \? \{ puedeActivar, estado, tarjetas \} : null/)
})

test('el panel va antes de la cancelación y le pasa a la pantalla solo lo que necesita', () => {
  const src = fuente(PAGINA)
  const panel = src.indexOf('<RenovacionAutomatica')
  assert.ok(panel > 0 && panel < src.indexOf('<CancelarMembresiaBoton'))
  assert.match(src, /tarjetasParaRenovar\(empresaDeLaMembresia, membership\.clienteId\)/)
  assert.match(src, /periodoTexto=\{periodoDelPlan\(membership\.plan\.vigenciaDias\)\}/)
  assert.match(src, /heredada=\{renovacion\.estado\.origen === 'HEREDADO'\}/)
})
