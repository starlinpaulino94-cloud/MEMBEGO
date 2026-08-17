import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CATEGORIAS, CATEGORIA_LABELS } from '../src/modules/capacidades/catalogo'
import {
  ESTADOS_HABILITACION,
  ESTADOS_SISTEMA,
  decidirAcceso,
  mensajeDenegado,
  type EstadoHabilitacion,
  type SistemaParaAcceso,
} from '../src/modules/plataforma/acceso'

/**
 * ACCESO A UN SISTEMA VERTICAL (Fase 1b).
 *
 * Antes, «¿puede esta empresa entrar a este sistema?» era una comparación de
 * dos cadenas copiada en cuatro archivos:
 *
 *     sistema.activo && sistema.categoria === categoriaDeLaEmpresa
 *
 * Estas pruebas fijan la regla que la sustituye, y sobre todo el ORDEN de sus
 * comprobaciones — que es donde se esconden los fallos que parecen respuestas
 * correctas.
 */

const CAR_WASH: SistemaParaAcceso = {
  estado: 'ACTIVE',
  autoHabilitar: true,
  tiposNegocio: ['CAR_WASH'],
}

/** El vertical nuevo: opt-in, como nacen todos a partir de ahora. */
const RESTAURANTE: SistemaParaAcceso = {
  estado: 'ACTIVE',
  autoHabilitar: false,
  tiposNegocio: ['RESTAURANTE'],
}

// ── Estado del sistema ──────────────────────────────────────────────────────

test('solo un sistema ACTIVE abre la puerta', () => {
  for (const estado of ESTADOS_SISTEMA) {
    const d = decidirAcceso({ ...CAR_WASH, estado }, 'CAR_WASH', 'ENABLED')
    assert.equal(
      d.permitido,
      estado === 'ACTIVE',
      `estado "${estado}" no debería comportarse como ${d.permitido ? 'abierto' : 'cerrado'}`
    )
  }
})

test('el estado del sistema se mira ANTES que la habilitación', () => {
  // Si fuera al revés, suspender un sistema por incidente no cerraría nada
  // para las empresas que ya lo tienen contratado — que son justo todas.
  const d = decidirAcceso({ ...CAR_WASH, estado: 'SUSPENDED' }, 'CAR_WASH', 'ENABLED')
  assert.deepEqual(d, { permitido: false, motivo: 'SISTEMA_NO_ACTIVO' })
})

// ── Compatibilidad de vertical (N:M) ────────────────────────────────────────

test('una empresa de otro vertical no entra ni habilitada', () => {
  const d = decidirAcceso(CAR_WASH, 'RESTAURANTE', 'ENABLED')
  assert.deepEqual(d, { permitido: false, motivo: 'VERTICAL_INCOMPATIBLE' })
})

test('un sistema puede atender varios verticales', () => {
  // Es la razón de ser de la tabla N:M: `categoria` era una sola cadena y un
  // POS que sirve a restaurante y a barbería no se podía representar.
  const pos: SistemaParaAcceso = {
    estado: 'ACTIVE',
    autoHabilitar: false,
    tiposNegocio: ['RESTAURANTE', 'BARBERIA'],
  }
  assert.equal(decidirAcceso(pos, 'RESTAURANTE', 'ENABLED').permitido, true)
  assert.equal(decidirAcceso(pos, 'BARBERIA', 'ENABLED').permitido, true)
  assert.equal(decidirAcceso(pos, 'GYM', 'ENABLED').permitido, false)
})

test('un sistema sin ningún vertical declarado no lo usa nadie', () => {
  // Fallo cerrado: una lista vacía es una configuración incompleta, no un
  // comodín. El panel lo marca en rojo por el mismo motivo.
  const huerfano: SistemaParaAcceso = { estado: 'ACTIVE', autoHabilitar: true, tiposNegocio: [] }
  assert.deepEqual(decidirAcceso(huerfano, 'CAR_WASH', 'ENABLED'), {
    permitido: false,
    motivo: 'VERTICAL_INCOMPATIBLE',
  })
})

// ── Concesión ───────────────────────────────────────────────────────────────

test('el vertical incumbente sigue abierto sin fila: nadie pierde acceso', () => {
  // La promesa de la migración. Car Wash funcionaba por categoría, así que
  // queda con autoHabilitar; una empresa sin fila entra igual que ayer.
  assert.equal(decidirAcceso(CAR_WASH, 'CAR_WASH', null).permitido, true)
})

test('un vertical nuevo NO se concede solo por ser compatible', () => {
  // El problema que los entitlements existen para resolver: registrar el
  // sistema de Restaurante no puede dárselo de golpe a todos los restaurantes.
  assert.deepEqual(decidirAcceso(RESTAURANTE, 'RESTAURANTE', null), {
    permitido: false,
    motivo: 'SIN_HABILITACION',
  })
  assert.equal(decidirAcceso(RESTAURANTE, 'RESTAURANTE', 'ENABLED').permitido, true)
})

test('AVAILABLE no concede: es "disponible para encender", no "encendido"', () => {
  assert.equal(decidirAcceso(RESTAURANTE, 'RESTAURANTE', 'AVAILABLE').permitido, false)
  // Y sobre un sistema automático se comporta igual que no tener fila.
  assert.equal(decidirAcceso(CAR_WASH, 'CAR_WASH', 'AVAILABLE').permitido, true)
  assert.equal(decidirAcceso(CAR_WASH, 'CAR_WASH', null).permitido, true)
})

/**
 * LA PRUEBA QUE IMPORTA.
 *
 * Una revocación explícita tiene que ganar a la política general. Si el orden
 * se invirtiera, apagarle el sistema a una empresa concreta no haría nada
 * mientras el vertical siguiera siendo automático: el panel diría
 * «deshabilitado» y la puerta seguiría abierta. Un fallo que se lee como un
 * acierto en pantalla y solo aparece en los logs del satélite.
 */
test('una revocación explícita gana a autoHabilitar', () => {
  for (const revocado of ['DISABLED', 'SUSPENDED'] as const) {
    assert.deepEqual(
      decidirAcceso(CAR_WASH, 'CAR_WASH', revocado),
      { permitido: false, motivo: 'HABILITACION_REVOCADA' },
      `"${revocado}" debe cerrar la puerta aunque el sistema sea automático`
    )
  }
})

test('cada estado de habilitación tiene un comportamiento decidido', () => {
  // Nadie puede añadir un quinto estado y dejar que caiga en el `else`.
  const esperado: Record<EstadoHabilitacion, boolean> = {
    AVAILABLE: false,
    ENABLED: true,
    DISABLED: false,
    SUSPENDED: false,
  }
  for (const estado of ESTADOS_HABILITACION) {
    assert.equal(
      decidirAcceso(RESTAURANTE, 'RESTAURANTE', estado).permitido,
      esperado[estado],
      `"${estado}" sobre un sistema opt-in`
    )
  }
})

// ── Lo que se le dice al usuario ────────────────────────────────────────────

test('el mensaje al usuario no describe la configuración de la plataforma', () => {
  const motivos = [
    'SISTEMA_NO_ACTIVO',
    'VERTICAL_INCOMPATIBLE',
    'SIN_HABILITACION',
    'HABILITACION_REVOCADA',
  ] as const
  for (const m of motivos) {
    const texto = mensajeDenegado(m)
    assert.ok(texto.length > 0, `"${m}" no tiene mensaje`)
    // Ni estados internos ni nombres de columna en pantalla: el detalle va al
    // log del servidor, donde lo lee quien puede arreglarlo.
    assert.doesNotMatch(texto, /DRAFT|RETIRED|autoHabilitar|entitlement|ENABLED/)
  }
})

// ── Guardias ────────────────────────────────────────────────────────────────

/**
 * `categoria` y `activo` siguen existiendo en la tabla porque la migración es
 * expansiva. Pero solo pueden leerlas los dos caminos de respaldo que sirven
 * durante la ventana entre el despliegue del código y el de la migración.
 *
 * Si esta prueba falla, alguien volvió a decidir con la columna vieja — y esa
 * decisión ignora las habilitaciones, así que concede de más sin avisar.
 */
test('nadie decide ya con `categoria` ni con `activo` del sistema', () => {
  const RESPALDOS = [
    join('src', 'modules', 'plataforma', 'registro.ts'),
    join('src', 'modules', 'integraciones', 'panel.ts'),
  ]

  function archivos(dir: string, acc: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === '.next') continue
      const p = join(dir, e)
      if (statSync(p).isDirectory()) archivos(p, acc)
      else if (p.endsWith('.ts') || p.endsWith('.tsx')) acc.push(p)
    }
    return acc
  }

  const infractores: string[] = []
  for (const archivo of archivos('src')) {
    if (RESPALDOS.includes(archivo)) continue
    const src = readFileSync(archivo, 'utf8')
    if (!src.includes('sistemaConectado')) continue
    if (/\bactivo\s*:/.test(src)) infractores.push(`${archivo}: filtra por 'activo'`)
    if (/\bcategoria\s*:\s*(true|categoria)\b/.test(src)) {
      infractores.push(`${archivo}: lee 'categoria' del sistema`)
    }
  }

  assert.deepEqual(
    infractores,
    [],
    'La decisión de acceso se toma en modules/plataforma/acceso.ts. Consultar el ' +
      'catálogo por columnas de legado ignora las habilitaciones:\n' +
      infractores.join('\n')
  )
})

/**
 * La semilla de `tipos_negocio` vive en el SQL de la migración y el catálogo
 * sigue viviendo en el `as const`. Son dos sitios, y esta prueba es lo único
 * que impide que se separen: una categoría añadida al `as const` sin sembrar
 * deja a sus empresas sin ningún sistema compatible.
 */
test('la semilla de la migración cubre todas las categorías del catálogo', () => {
  // La semilla puede vivir en la migración fundacional (las cuatro originales)
  // o en la migración que ESTRENA una categoría (EXCURSIONES, 20260817): lo
  // que la prueba exige es que exista en alguna, no en cuál.
  const sql = [
    join('prisma', 'migrations', '20260803_plataforma_registro', 'migration.sql'),
    join('prisma', 'migrations', '20260817_excursiones_fundacion', 'migration.sql'),
  ]
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n')
  for (const codigo of CATEGORIAS) {
    assert.ok(sql.includes(`'${codigo}'`), `la migración no siembra el tipo de negocio "${codigo}"`)
    assert.ok(
      sql.includes(`'${CATEGORIA_LABELS[codigo]}'`),
      `la migración siembra "${codigo}" con un nombre distinto al del catálogo`
    )
  }
})

/**
 * `activo` pasa a ser un espejo de `estado`. Dos columnas que dicen lo mismo se
 * separan siempre — normalmente por un UPDATE a mano un viernes — y a partir de
 * ahí una dice que el sistema está encendido y la otra que no.
 *
 * El CHECK lo hace imposible en la base, no solo desaconsejable en el código.
 */
test('la migración instala el CHECK que impide la deriva de `activo`', () => {
  const sql = readFileSync(
    join('prisma', 'migrations', '20260803_plataforma_registro', 'migration.sql'),
    'utf8'
  )
  assert.match(sql, /CHECK\s*\(\("estado"\s*=\s*'ACTIVE'\)\s*=\s*"activo"\)/)
  for (const estado of ESTADOS_SISTEMA) {
    assert.ok(sql.includes(`'${estado}'`), `el CHECK de estados no admite "${estado}"`)
  }
  for (const estado of ESTADOS_HABILITACION) {
    assert.ok(sql.includes(`'${estado}'`), `el CHECK de habilitaciones no admite "${estado}"`)
  }
})
