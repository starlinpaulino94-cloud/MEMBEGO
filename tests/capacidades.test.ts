/**
 * Plataforma modular · pruebas del RESOLUTOR DE CAPACIDADES.
 * Ejecutar: npm test
 *
 * Es el sistema que decide qué módulos ve cada empresa. Dos propiedades son
 * críticas y se prueban aquí:
 *   1. FAIL-OPEN: ante configuración ausente o corrupta, la empresa conserva
 *      su paquete base. Nunca se apaga sola.
 *   2. Los módulos NUEVOS nacen apagados y solo se encienden con un override
 *      explícito.
 *
 * Contexto real: en producción faltó la migración de la columna `capacidades`
 * y el resolutor respondió con el paquete base sin romper nada — exactamente
 * el comportamiento que estas pruebas protegen.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPACIDADES,
  CAPACIDADES_BASE,
  CATEGORIAS,
  CAPACIDAD_LABELS,
  CAPACIDAD_DE_SECCION,
  SECCIONES_POR_CAPACIDAD,
  CATEGORIAS_CON_VEHICULO,
  MODULOS_CLIENTE,
  MODULO_CLIENTE_AUTO,
  MODULO_CLIENTE_LABELS,
  RUTAS_POR_MODULO_CLIENTE,
  capacidadesEfectivas,
  categoriaDeType,
  categoriaExplicitaDeType,
  resolverConfig,
  rutasOcultasCliente,
} from '../src/modules/capacidades/catalogo'

// ── Catálogo íntegro ─────────────────────────────────────────────────────────

test('toda capacidad tiene etiqueta legible (ninguna huérfana)', () => {
  for (const cap of CAPACIDADES) {
    assert.ok(CAPACIDAD_LABELS[cap], `falta CAPACIDAD_LABELS[${cap}]`)
  }
})

test('toda categoría tiene paquete base definido', () => {
  for (const cat of CATEGORIAS) {
    assert.ok(Array.isArray(CAPACIDADES_BASE[cat]), `falta CAPACIDADES_BASE[${cat}]`)
  }
})

test('los paquetes base solo contienen capacidades del catálogo', () => {
  for (const cat of CATEGORIAS) {
    for (const cap of CAPACIDADES_BASE[cat]) {
      assert.ok(
        (CAPACIDADES as readonly string[]).includes(cap),
        `${cat} declara una capacidad inexistente: ${cap}`
      )
    }
  }
})

test('el índice sección → capacidad es coherente con su origen', () => {
  for (const [cap, secciones] of Object.entries(SECCIONES_POR_CAPACIDAD)) {
    for (const sec of secciones ?? []) {
      assert.equal(CAPACIDAD_DE_SECCION[sec], cap, `sección ${sec} mal indexada`)
    }
  }
})

// ── Categoría derivada del tipo de empresa ───────────────────────────────────

test('categoriaDeType reconoce los tipos conocidos', () => {
  assert.equal(categoriaDeType('carwash'), 'CAR_WASH')
  assert.equal(categoriaDeType('barberia'), 'BARBERIA')
  assert.equal(categoriaDeType('salon'), 'BARBERIA')
  assert.equal(categoriaDeType('restaurante'), 'RESTAURANTE')
  assert.equal(categoriaDeType('gym'), 'GYM')
})

test('un tipo desconocido, vacío o nulo cae en CAR_WASH (la categoría operativa)', () => {
  assert.equal(categoriaDeType('lo-que-sea'), 'CAR_WASH')
  assert.equal(categoriaDeType(''), 'CAR_WASH')
  assert.equal(categoriaDeType(null), 'CAR_WASH')
  assert.equal(categoriaDeType(undefined), 'CAR_WASH')
})

// ── FAIL-OPEN: lo más importante ─────────────────────────────────────────────

test('sin configuración, la empresa conserva el paquete base de su categoría', () => {
  const { categoria, activas } = capacidadesEfectivas('carwash', null)
  assert.equal(categoria, 'CAR_WASH')
  for (const cap of CAPACIDADES_BASE.CAR_WASH) {
    assert.ok(activas.has(cap), `el paquete base perdió ${cap}`)
  }
})

test('una configuración corrupta no apaga nada (se ignora, no se cae)', () => {
  for (const basura of [undefined, 'texto', 42, [], { overrides: 'no-es-objeto' }]) {
    const { activas } = capacidadesEfectivas('carwash', basura)
    for (const cap of CAPACIDADES_BASE.CAR_WASH) {
      assert.ok(activas.has(cap), `la basura ${JSON.stringify(basura)} apagó ${cap}`)
    }
  }
})

test('resolverConfig descarta categorías y overrides inválidos', () => {
  const cfg = resolverConfig({
    categoria: 'PANADERIA', // no existe
    overrides: { NO_EXISTE: true, CITAS: 'sí', SEGUIMIENTO: false },
  })
  const overrides = (cfg.overrides ?? {}) as Record<string, unknown>
  assert.equal(cfg.categoria, undefined)
  assert.equal(overrides.NO_EXISTE, undefined, 'una capacidad inventada debe descartarse')
  assert.equal(overrides.CITAS, undefined, 'un valor no booleano debe ignorarse')
  assert.equal(cfg.overrides?.SEGUIMIENTO, false, 'un booleano válido sí se respeta')
})

// ── Módulos nuevos: apagados por defecto ─────────────────────────────────────

test('los módulos operativos nuevos NO vienen encendidos de fábrica', () => {
  const { activas } = capacidadesEfectivas('carwash', null)
  for (const cap of ['COLA_VEHICULOS', 'INVENTARIO', 'EVIDENCIA_FOTOS', 'NAVEGACION_V2'] as const) {
    assert.equal(activas.has(cap), false, `${cap} no debería nacer encendida`)
  }
})

test('un override explícito enciende un módulo nuevo', () => {
  const { activas } = capacidadesEfectivas('carwash', {
    overrides: { COLA_VEHICULOS: true },
  })
  assert.ok(activas.has('COLA_VEHICULOS'))
  // Y no toca lo demás.
  assert.equal(activas.has('INVENTARIO'), false)
})

test('un override puede apagar algo del paquete base', () => {
  const { activas } = capacidadesEfectivas('carwash', {
    overrides: { CITAS: false },
  })
  assert.equal(activas.has('CITAS'), false)
  assert.ok(activas.has('SEGUIMIENTO'), 'apagar CITAS no debe arrastrar a las demás')
})

// ── Categoría forzada por configuración ──────────────────────────────────────

test('la categoría guardada manda sobre la derivada del tipo', () => {
  const { categoria, activas } = capacidadesEfectivas('carwash', { categoria: 'BARBERIA' })
  assert.equal(categoria, 'BARBERIA')
  // Barbería no incluye la regla de cita antes del QR en su paquete base.
  assert.equal(activas.has('CITA_ANTES_DEL_QR'), false)
  assert.ok(activas.has('CITAS'))
})

test('encender y apagar la misma capacidad es idempotente', () => {
  const a = capacidadesEfectivas('carwash', { overrides: { INVENTARIO: true } })
  const b = capacidadesEfectivas('carwash', { overrides: { INVENTARIO: true } })
  assert.deepEqual([...a.activas].sort(), [...b.activas].sort())
})

// ── Categoría EXPLÍCITA: la que decide requisitos ────────────────────────────
//
// El default a CAR_WASH de `categoriaDeType` es correcto para ENCENDER módulos
// (fail-open) y desastroso para EXIGIR: hacía que el cliente de un restaurante
// tuviera que registrar un vehículo para ver los planes, porque el tipo de esa
// empresa ("otro", el valor que ofrece el propio formulario de registro) no
// estaba en el mapa y caía en car wash. De ahí las dos funciones.

test('categoriaExplicitaDeType reconoce los tipos conocidos y sus variantes', () => {
  assert.equal(categoriaExplicitaDeType('carwash'), 'CAR_WASH')
  assert.equal(categoriaExplicitaDeType('Car Wash'), 'CAR_WASH')
  assert.equal(categoriaExplicitaDeType(' restaurante '), 'RESTAURANTE')
  assert.equal(categoriaExplicitaDeType('restaurant'), 'RESTAURANTE')
  assert.equal(categoriaExplicitaDeType('salón'), 'BARBERIA')
  assert.equal(categoriaExplicitaDeType('gimnasio'), 'GYM')
})

test('un tipo que nadie afirmó NO es una categoría explícita', () => {
  for (const type of ['otro', '', '   ', 'lo-que-sea', null, undefined]) {
    assert.equal(categoriaExplicitaDeType(type), null, `"${type}" no debería afirmar nada`)
    // …y sin embargo sigue teniendo módulos: las dos preguntas son distintas.
    assert.equal(categoriaDeType(type), 'CAR_WASH')
  }
})

test('capacidadesEfectivas separa la categoría efectiva de la explícita', () => {
  const desconocida = capacidadesEfectivas('otro', null)
  assert.equal(desconocida.categoria, 'CAR_WASH', 'los módulos siguen encendidos')
  assert.equal(desconocida.categoriaExplicita, null, 'pero no se le exige nada al cliente')

  // Elegirla a mano en el panel SÍ es afirmarla.
  const elegida = capacidadesEfectivas('otro', { categoria: 'RESTAURANTE' })
  assert.equal(elegida.categoriaExplicita, 'RESTAURANTE')
})

test('solo las categorías con vehículo pueden pedir uno', () => {
  assert.deepEqual([...CATEGORIAS_CON_VEHICULO], ['CAR_WASH'])
  for (const cat of CATEGORIAS) {
    if (cat === 'CAR_WASH') continue
    assert.equal(
      CATEGORIAS_CON_VEHICULO.includes(cat),
      false,
      `${cat} no debería pedir vehículo`
    )
  }
})

// ── Módulos del cliente: automático + forzado ────────────────────────────────

test('todo módulo del cliente tiene etiqueta, criterio y rutas', () => {
  for (const modulo of MODULOS_CLIENTE) {
    assert.ok(MODULO_CLIENTE_LABELS[modulo], `falta etiqueta de ${modulo}`)
    assert.ok(MODULO_CLIENTE_AUTO[modulo], `falta el criterio automático de ${modulo}`)
    assert.ok(RUTAS_POR_MODULO_CLIENTE[modulo]?.length, `${modulo} no controla ninguna ruta`)
  }
})

test('ninguna ruta del cliente la controlan dos módulos a la vez', () => {
  const vistas = new Set<string>()
  for (const modulo of MODULOS_CLIENTE) {
    for (const ruta of RUTAS_POR_MODULO_CLIENTE[modulo]) {
      assert.equal(vistas.has(ruta), false, `${ruta} está en dos módulos`)
      vistas.add(ruta)
    }
  }
})

test('un módulo vacío se esconde y uno con contenido se ve', () => {
  const ocultas = rutasOcultasCliente({ MEMBRESIAS: false, OFERTAS: true })
  assert.ok(ocultas.includes('/cliente/planes'))
  assert.ok(ocultas.includes('/mis-membresias'))
  assert.equal(ocultas.includes('/cliente/promociones'), false)
})

test('lo que no se pudo averiguar se muestra (un fallo no deja al cliente sin menú)', () => {
  assert.deepEqual(rutasOcultasCliente({}), [], 'sin datos no se oculta nada')
  assert.deepEqual(rutasOcultasCliente({ CITAS: undefined }), [])
})

test('el forzado manda sobre el criterio automático, en los dos sentidos', () => {
  // MOSTRAR rescata un módulo vacío (lanzamiento programado para mañana).
  const conMostrar = rutasOcultasCliente({ MEMBRESIAS: false }, { MEMBRESIAS: 'MOSTRAR' })
  assert.deepEqual(conMostrar, [])

  // OCULTAR esconde uno lleno (existe, pero no se quiere ofrecer todavía).
  const conOcultar = rutasOcultasCliente({ RULETA: true }, { RULETA: 'OCULTAR' })
  assert.deepEqual(conOcultar, ['/cliente/ruleta'])

  // AUTO explícito se comporta igual que la ausencia de decisión.
  assert.deepEqual(
    rutasOcultasCliente({ RULETA: false }, { RULETA: 'AUTO' }),
    rutasOcultasCliente({ RULETA: false })
  )
})

test('resolverConfig descarta módulos y visibilidades inventadas', () => {
  const cfg = resolverConfig({
    modulosCliente: { NO_EXISTE: 'OCULTAR', RULETA: 'A_VECES', CITAS: 'OCULTAR' },
  })
  const mods = (cfg.modulosCliente ?? {}) as Record<string, unknown>
  assert.equal(mods.NO_EXISTE, undefined, 'un módulo inventado debe descartarse')
  assert.equal(mods.RULETA, undefined, 'una visibilidad inventada debe descartarse')
  assert.equal(cfg.modulosCliente?.CITAS, 'OCULTAR', 'lo válido sí se respeta')
})
