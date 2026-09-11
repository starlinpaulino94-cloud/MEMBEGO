import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { membresiaEstadoUi } from '../src/lib/estados'

const raiz = join(__dirname, '..')

/**
 * Estos módulos son `server-only`, así que no se pueden importar aquí. Se
 * comprueba su FUENTE, que es lo que ya hacen las otras guardias del proyecto.
 *
 * Con los comentarios fuera: cada una de estas afirmaciones habla de una
 * cadena que TAMBIÉN aparece explicada en un comentario del propio archivo, y
 * una prueba que se da por satisfecha leyendo la explicación de lo que vigila
 * no vigila nada.
 */
function fuente(ruta: string): string {
  return readFileSync(join(raiz, ruta), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

// ── El cobro automático ─────────────────────────────────────────────────────

test('la renovación con tarjeta mira una VENTANA, no todo el pasado', () => {
  /**
   * El fallo que lo motivó: la selección pedía `fechaVencimiento <= ahora + 1
   * día` sin suelo. Eso no es «vence mañana», es «vence mañana o venció alguna
   * vez», así que a una membresía caducada hacía meses —que seguía diciendo
   * ACTIVA porque el job diario no había pasado— se le cobraba la tarjeta.
   */
  const src = fuente('src/modules/pagos/cardnetTokenGuardado.ts')
  const where = src.slice(src.indexOf('membresiasARenovar'))
  assert.match(
    where,
    /fechaVencimiento:\s*\{[^}]*gte:/,
    'falta el suelo: sin `gte` se cobran membresías vencidas hace meses'
  )
  assert.match(where, /fechaVencimiento:\s*\{[^}]*lte:/, 'falta el techo de la ventana')
})

test('el suelo de gracia es corto: días, no meses', () => {
  // Cubre que el cron falle un día. No que alguien reviva una membresía que el
  // cliente dio por terminada en marzo.
  const src = fuente('src/modules/pagos/cardnetTokenGuardado.ts')
  const m = src.match(/GRACIA_VENCIDA_MS\s*=\s*(\d+)\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/)
  assert.ok(m, 'GRACIA_VENCIDA_MS debería expresarse en días')
  const dias = Number(m![1])
  assert.ok(dias >= 1 && dias <= 7, `la gracia son ${dias} días; fuera de 1..7 hay que decidirlo a propósito`)
})

// ── Cancelar corta el cobro ─────────────────────────────────────────────────

for (const ruta of ['src/modules/admin/actions.ts', 'src/modules/admin/planActions.ts']) {
  test(`cancelar apaga la renovación automática en ${ruta.split('/').pop()}`, () => {
    // Sin esto, basta con que la membresía vuelva a ACTIVA para que el cron la
    // recoja y cobre sin que nadie lo pidiera. Cancelar es «deja de cobrarme».
    const src = fuente(ruta)
    const i = src.indexOf("estado: 'CANCELADA'")
    assert.ok(i > 0, 'no se encontró la cancelación')
    const linea = src.slice(i, i + 120)
    assert.match(linea, /autoRenovar:\s*false/, 'cancelar debe apagar `autoRenovar`')
  })
}

// ── Lo que ve cada uno ──────────────────────────────────────────────────────

test('al cliente no se le dice «Cancelada»', () => {
  // Es lenguaje de administración: le plantea una pregunta que la pantalla no
  // le responde. Lo que necesita es saber que se acabó y que puede volver.
  const ui = membresiaEstadoUi('CANCELADA')
  assert.equal(ui.labelCliente, 'Finalizada')
  assert.doesNotMatch(ui.labelCliente, /cancel/i)
})

test('al equipo sí, porque vencer y cancelar no son lo mismo', () => {
  assert.equal(membresiaEstadoUi('CANCELADA').label, 'Cancelada')
  assert.equal(membresiaEstadoUi('VENCIDA').label, 'Vencida')
})

test('la pantalla del cliente usa la etiqueta del cliente', () => {
  // Usaba `.label` —la de admin—, que anulaba el motivo de que existan las dos.
  const src = fuente('src/app/(cliente)/membresia/[membresiaId]/page.tsx')
  assert.match(src, /membresiaEstadoUi\([^)]*\)\.labelCliente/)
  assert.doesNotMatch(
    src,
    /membresiaEstadoUi\([^)]*\)\.label\b/,
    'quedó un uso de la etiqueta de administración en una pantalla de cliente'
  )
})

// ── Los otros administradores se enteran ────────────────────────────────────

test('el historial del cliente trae quién canceló y cuándo', () => {
  // La membresía guarda su estado, no su historia: mirándola solo se sabe que
  // está CANCELADA, nunca quién lo hizo. El dato ya estaba en la bitácora.
  const src = fuente('src/modules/cliente/historial.ts')
  assert.match(src, /MEMBRESIA_CANCELADA/, 'no se leen las cancelaciones de la bitácora')
  assert.match(src, /user:\s*\{\s*select:\s*\{\s*name:\s*true/, 'no se trae el autor')
})
