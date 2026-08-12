import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sufijoPeriodo, textoVigencia } from '../src/modules/planes/periodo'

/**
 * EL CATÁLOGO: lo que los clientes compran.
 *
 * Dos exigencias, y las dos son sobre dinero, no sobre diseño:
 *
 *  1. El precio tiene que decir CADA CUÁNTO se paga. Estaba escrito «/mes» a
 *     mano en las dos pantallas de planes, siempre, mientras `vigenciaDias` era
 *     un campo del plan que el formulario pide. Un plan anual salía como
 *     «RD$1,600/mes».
 *
 *  2. Cambiar un precio tiene que dejar rastro. Ninguna de las cuatro acciones
 *     del módulo escribía en la bitácora.
 */

const SUPER = readFileSync(join('src', 'app', '(superadmin)', 'superadmin', 'planes', 'page.tsx'), 'utf8')
const ADMIN = readFileSync(join('src', 'app', '(admin)', 'admin', 'planes', 'page.tsx'), 'utf8')
const ACTIONS = readFileSync(join('src', 'modules', 'admin', 'planActions.ts'), 'utf8')
const BOTON = readFileSync(join('src', 'components', 'admin', 'DeletePlanButton.tsx'), 'utf8')

/**
 * PARA LAS GUARDIAS DE «ESTO NO PUEDE APARECER», el código sin comentarios.
 *
 * Estos archivos EXPLICAN qué escribían mal antes —«/mes» a mano, «RD$»
 * clavado, «membresía(s)»— y esa explicación es justo lo que hace que el
 * arreglo sobreviva a quien lo lea dentro de un año. Sin esto, cada guardia
 * saltaría por el comentario que la justifica, y la salida obvia sería borrar
 * la explicación: perder lo único que impide que el defecto vuelva.
 */
const sinComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '')

// ─────────────────────────── M46 · el periodo ───────────────────────────

test('un mes se dice «/mes», lo tenga de 28 o de 31 días', () => {
  // Un mes son 28, 29, 30 o 31 según cuál. Exigir el número exacto para que la
  // pantalla lo entienda sería hacerle aprender la regla interna a quien
  // configura el plan.
  for (const d of [28, 29, 30, 31]) assert.equal(sufijoPeriodo(d), '/mes')
})

test('lo que NO es un mes deja de decir que lo es', () => {
  assert.equal(sufijoPeriodo(365), '/año')
  assert.equal(sufijoPeriodo(7), '/semana')
  assert.equal(sufijoPeriodo(90), '/trimestre')
  assert.equal(sufijoPeriodo(1), '/día')
  // Lo que no encaja en ningún tramo se dice tal cual: feo, pero exacto.
  assert.equal(sufijoPeriodo(45), '/45 días')
})

test('un valor imposible no inventa un periodo', () => {
  // Vale más no decir nada que decir «/0 días» junto a un precio.
  assert.equal(sufijoPeriodo(0), '')
  assert.equal(sufijoPeriodo(-3), '')
  assert.equal(sufijoPeriodo(Number.NaN), '')
})

test('la vigencia se dice entera, y en singular cuando toca', () => {
  assert.equal(textoVigencia(30), 'Vigencia 30 días')
  assert.equal(textoVigencia(1), 'Vigencia 1 día')
  assert.equal(textoVigencia(0), 'Sin vigencia definida')
})

/**
 * Y NINGUNA DE LAS DOS PANTALLAS VUELVE A ESCRIBIRLO A MANO.
 *
 * Arreglar solo la del superadmin habría dejado al dueño del negocio leyendo el
 * precio falso mientras el superadmin lo lee bien — peor que el error original,
 * porque además se contradicen.
 */
test('ninguna pantalla de planes escribe «/mes» a mano', () => {
  for (const [nombre, src] of [['superadmin', SUPER], ['empresa', ADMIN]] as const) {
    assert.ok(
      !/>\s*\/mes\s*</.test(sinComentarios(src)),
      `la pantalla de planes de ${nombre} volvió a clavar «/mes»; usa sufijoPeriodo(vigenciaDias)`
    )
    assert.match(src, /sufijoPeriodo\(plan\.vigenciaDias\)/)
  }
})

test('las dos pantallas enseñan la vigencia real', () => {
  // Es lo que hacía el error indetectable: el sufijo decía «/mes» y no había
  // ningún otro sitio donde comprobar que la vigencia era de 365 días.
  for (const src of [SUPER, ADMIN]) assert.match(src, /textoVigencia\(plan\.vigenciaDias\)/)
})

// ─────────────────────────── M52 · la moneda ───────────────────────────

test('el panel de plataforma no clava la moneda dominicana', () => {
  // Es la ÚNICA pantalla que cruza empresas, así que es justo donde un «RD$»
  // escrito a mano etiqueta mal el dinero de otra divisa.
  const codigo = sinComentarios(SUPER)
  assert.ok(!/RD\$/.test(codigo), 'usa `formatMoney(precio, prefs)` con las prefs de la empresa')
  assert.ok(
    !/new Intl\.NumberFormat/.test(codigo),
    'formatear a mano vuelve a clavar idioma y moneda en el archivo'
  )
  assert.match(SUPER, /formatMoney\(Number\(plan\.precio\), prefs\)/)
})

test('las prefs viajan con la empresa, sin una consulta por empresa', () => {
  // `getRegionalPrefs` abre su propia transacción: llamarlo dentro del bucle
  // sería una por empresa para leer tres columnas que ya estaban a mano.
  assert.match(SUPER, /moneda: true, idioma: true, zonaHoraria: true/)
  assert.ok(
    !/getRegionalPrefs/.test(sinComentarios(SUPER)),
    'no pidas las prefs empresa por empresa: vienen en la consulta de empresas'
  )
})

// ─────────────────────── M48 · la bitácora del catálogo ───────────────────────

test('las cuatro operaciones sobre un plan quedan registradas', () => {
  for (const accion of [
    'PLAN_CREADO',
    'PLAN_ACTUALIZADO',
    'PLAN_PAUSADO',
    'PLAN_REANUDADO',
    'PLAN_ELIMINADO',
  ]) {
    assert.ok(ACTIONS.includes(`'${accion}'`), `falta registrar ${accion}`)
  }
})

/**
 * Y LO QUE SE REGISTRA AL EDITAR ES EL PRECIO ANTERIOR.
 *
 * Guardar solo el precio nuevo respondería «cuánto cuesta ahora», que ya se ve
 * en la pantalla. La pregunta que se hace cuando un cliente reclama es la otra:
 * cuánto costaba antes.
 */
test('al editar se guarda el precio anterior y el nuevo', () => {
  assert.match(ACTIONS, /const precioAntes = Number\(plan\.precio\)/)
  assert.match(ACTIONS, /antes: precioAntes, despues: parsed\.precio/)
  // Y el estado anterior se lee ANTES del update; después del `update` el
  // precio viejo ya no existe en ninguna parte.
  const lectura = ACTIONS.indexOf('activo: true, nombre: true, precio: true')
  const escritura = ACTIONS.indexOf("'PLAN_ACTUALIZADO', planId")
  assert.ok(lectura > 0, 'planDeMiEmpresa tiene que traer el precio anterior')
  assert.ok(escritura > lectura, 'la línea de bitácora va después de leer el estado anterior')
})

/**
 * AUDITAR NO PUEDE IMPEDIR VENDER.
 *
 * Los valores nuevos del enum viven en una migración, y aquí las migraciones se
 * aplican a mano. Si la línea de bitácora fuera parte de la misma transacción
 * que el cambio, este código en producción ANTES que su migración dejaría el
 * catálogo de solo lectura: PostgreSQL rechaza el valor desconocido y arrastra
 * consigo el cambio del plan.
 */
test('un fallo de auditoría no tumba el cambio del plan', () => {
  const bloque = ACTIONS.slice(ACTIONS.indexOf('async function auditarPlan'))
  assert.match(bloque, /try \{/, 'auditarPlan tiene que capturar sus errores')
  assert.match(bloque, /catch \(e\) \{/)
  assert.ok(
    !/throw/.test(bloque.slice(0, bloque.indexOf('\n}\n'))),
    'auditarPlan no puede propagar el error'
  )
})

// ──────────────────── M55 · por qué no se puede eliminar ────────────────────

test('un plan SOLICITADO también impide borrar', () => {
  // La clave foránea `planIdSolicitado` rechaza el borrado igual que una
  // membresía vendida. Sin contarla, el botón se ofrecía habilitado y al
  // pulsarlo salía «Ocurrió un error. Intenta de nuevo.» — lo peor que se puede
  // decir, porque reintentar no iba a funcionar nunca.
  assert.match(ACTIONS, /planIdSolicitado: planId/)
  assert.match(ACTIONS, /vendidas > 0 \|\| solicitadas > 0/)
  for (const src of [SUPER, ADMIN]) {
    assert.match(src, /membershipsSolicitadas: true/)
    assert.match(src, /solicitudes=\{plan\._count\.membershipsSolicitadas\}/)
  }
})

test('nadie vuelve a escribir «membresía(s)»', () => {
  for (const [nombre, src] of [
    ['la acción', ACTIONS],
    ['el botón', BOTON],
  ] as const) {
    assert.ok(
      !sinComentarios(src).includes('membresía(s)'),
      `${nombre} usa \`plural()\`, no paréntesis`
    )
  }
  assert.match(BOTON, /from '@\/lib\/plural'/)
})

test('el error dice qué hacer en su lugar', () => {
  // Un «no se puede» sin salida deja a quien lo lee sin siguiente paso. Pausar
  // es lo que casi siempre se quería.
  assert.match(ACTIONS, /Páusalo para dejar de ofrecerlo/)
})

// ─────────────────── M56 · las empresas sin planes, aparte ───────────────────

test('las empresas sin planes no ocupan una sección cada una', () => {
  assert.ok(
    !SUPER.includes('Sin planes configurados.'),
    'ya no hay una sección por empresa vacía; van resumidas al final'
  )
  assert.match(SUPER, /const sinPlanes = byCompany\.filter\(\(c\) => c\.planes\.length === 0\)/)
  assert.match(SUPER, /const conPlanes = byCompany\.filter\(\(c\) => c\.planes\.length > 0\)/)
})

test('pero se siguen diciendo: una empresa activa sin planes no puede vender', () => {
  // Plegarlas no es esconderlas. El dato importa; lo que sobraba era el sitio
  // que ocupaba.
  assert.match(SUPER, /sinPlanes\.map\(\(c\) => c\.name\)\.join\(', '\)/)
  assert.match(SUPER, /empresa sin planes', 'empresas sin planes/)
})
