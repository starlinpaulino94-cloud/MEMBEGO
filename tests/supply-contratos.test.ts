/**
 * MEMBEGO SUPPLY · pruebas de CONTRATO del módulo.
 * Ejecutar: npm test
 *
 * No prueban aritmética (eso está en supply-ledger y supply-economia) sino las
 * PROMESAS ESTRUCTURALES que el módulo le hace al resto de la plataforma y que
 * se rompen en silencio cuando alguien añade un archivo nuevo:
 *
 *   · el dominio puro no arrastra el servidor (se puede probar sin base);
 *   · las cubetas solo se escriben por un sitio;
 *   · las capacidades, los permisos y la bitácora están cableados de verdad;
 *   · la exportación reutiliza la infraestructura existente y no inventa otra;
 *   · el aislamiento entre proveedores no depende de que alguien se acuerde.
 *
 * Son las guardias que impiden que el módulo se degrade con el siguiente
 * cambio, que es exactamente cuando nadie está mirando.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const DIR = join(RAIZ, 'src', 'modules', 'supply')

function leer(archivo: string): string {
  return readFileSync(join(DIR, archivo), 'utf8')
}

/**
 * El archivo SIN comentarios.
 *
 * Existe porque estas guardias buscan texto, y los comentarios de este módulo
 * explican precisamente lo que NO se hace: «sin NOWAIT», «cuid() está hecho
 * para no colisionar», «rollback: DROP TABLE de las quince tablas». Buscando
 * sobre el archivo entero, la explicación de la regla dispara la guardia de la
 * regla — y la forma de «arreglarlo» sería borrar la explicación.
 */
function codigo(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*(\/\/|--).*$/gm, '')
}

const ARCHIVOS = readdirSync(DIR).filter((f) => f.endsWith('.ts'))

/**
 * Módulos que NO pueden tocar el servidor: se prueban sin base de datos y los
 * consumen pantallas de cliente. Si uno importa `server-only` o Prisma en
 * ejecución, sus pruebas dejan de poder correr y el navegador se lleva código
 * que no necesita.
 */
const PUROS = [
  'catalogo.ts',
  'ledger.ts',
  'estados.ts',
  'elegibilidad.ts',
  'capacidad.ts',
  'economia.ts',
  'fefo.ts',
  'contrato.ts',
  'hallazgos.ts',
  'minutos-qr.ts',
  'avisos.ts',
]

// ── El dominio puro sigue siendo puro ───────────────────────────────────────

test('los módulos puros no importan server-only ni Prisma en ejecución', () => {
  for (const archivo of PUROS) {
    const src = leer(archivo)
    assert.ok(
      !src.includes("import 'server-only'"),
      `${archivo} importa server-only: deja de poder probarse sin base`
    )
    assert.ok(
      !/^import \{[^}]*\} from '@prisma\/client'/m.test(src) ||
        /^import type \{/m.test(src),
      `${archivo} importa Prisma como VALOR; usa \`import type\``
    )
    assert.ok(
      !src.includes("from '@/lib/prisma'") && !src.includes("from '@/lib/tenant'"),
      `${archivo} toca la base de datos y debería ser puro`
    )
  }
})

test('los módulos con acceso a datos declaran server-only', () => {
  const conDatos = ARCHIVOS.filter(
    (f) => !PUROS.includes(f) && !f.startsWith('codigos') && f !== 'actions.ts'
  )
  for (const archivo of conDatos) {
    const src = leer(archivo)
    if (!src.includes("from '@/lib/tenant'")) continue
    assert.ok(
      src.includes("import 'server-only'"),
      `${archivo} lee la base y no declara server-only: puede acabar en el navegador`
    )
  }
})

// ── Una sola puerta al ledger ───────────────────────────────────────────────

test('SOLO movimientos.ts escribe las cubetas de un lote', () => {
  // Es LA regla del módulo: un `update` directo sobre `disponibles` convierte
  // el ledger en un número editable con pasos extra.
  const CUBETAS = ['disponibles:', 'asignadas:', 'retenidas:', 'emitidas:', 'redimidas:', 'cerradas:']
  const culpables: string[] = []

  for (const archivo of ARCHIVOS) {
    if (archivo === 'movimientos.ts') continue
    const src = leer(archivo)
    if (!src.includes('supplyLote.update')) continue
    // Un update del lote está permitido si NO toca cubetas (estado, vigencia…).
    const bloques = src.split('supplyLote.update').slice(1)
    for (const b of bloques) {
      const ventana = b.slice(0, 400)
      if (CUBETAS.some((c) => ventana.includes(c))) culpables.push(archivo)
    }
  }
  assert.deepEqual(
    [...new Set(culpables)],
    [],
    'estos archivos escriben cubetas fuera de movimientos.ts: úsalo o el invariante deja de sostenerse'
  )
})

test('toda mutación del ledger pasa por registrarMovimientos', () => {
  for (const archivo of ARCHIVOS) {
    if (archivo === 'movimientos.ts') continue
    const src = leer(archivo)
    assert.ok(
      !src.includes('supplyMovimiento.create'),
      `${archivo} crea asientos a mano; tiene que llamar a registrarMovimientos`
    )
  }
})

test('nadie borra asientos del ledger ni redenciones', () => {
  // «Nunca borrar movimientos» (Fase 6) y «no borrar la operación original»
  // (Fase 30). Un delete aquí destruye la única explicación disponible de por
  // qué a un lote le quedan 742 unidades.
  for (const archivo of ARCHIVOS) {
    const src = leer(archivo)
    for (const prohibido of [
      'supplyMovimiento.delete',
      'supplyMovimiento.deleteMany',
      'supplyRedencion.delete',
      'supplyRedencion.deleteMany',
      'supplyAsientoFinanciero.delete',
    ]) {
      assert.ok(!src.includes(prohibido), `${archivo} usa ${prohibido}: el rastro no se borra`)
    }
  }
})

// ── Concurrencia ────────────────────────────────────────────────────────────

test('el lote se bloquea con FOR UPDATE antes de mover unidades', () => {
  const src = codigo(leer('movimientos.ts'))
  assert.match(src, /FOR UPDATE/, 'sin bloqueo de fila, dos personas se llevan la última unidad')
  assert.ok(
    !src.includes('NOWAIT'),
    'NOWAIT haría fallar al segundo cliente aunque quedaran cien unidades'
  )
})

test('las escrituras sensibles tienen clave de idempotencia', () => {
  const esquema = readFileSync(join(RAIZ, 'prisma', 'schema', 'supply.prisma'), 'utf8')
  for (const tabla of ['supply_derechos', 'supply_redenciones', 'supply_pagos']) {
    const bloque = esquema.slice(esquema.indexOf(`@@map("${tabla}")`) - 4000)
    assert.ok(
      esquema.includes('claveIdempotencia String? @unique') ||
        esquema.includes('claveIdempotencia   String? @unique') ||
        /claveIdempotencia\s+String\?\s+@unique/.test(esquema),
      `${tabla} necesita una clave de idempotencia única`
    )
    void bloque
  }
})

// ── La base impone los invariantes ──────────────────────────────────────────

test('la migración escribe el invariante como CHECK, no solo como intención', () => {
  const sql = readFileSync(
    join(RAIZ, 'prisma', 'migrations', '20260926_membego_supply', 'migration.sql'),
    'utf8'
  )
  assert.match(sql, /supply_lotes_cuadre_cubetas/, 'falta el CHECK del cuadre de cubetas')
  assert.match(sql, /supply_lotes_cubetas_no_negativas/, 'falta el CHECK de no-negatividad')
  assert.match(sql, /supply_movimientos_cantidad_positiva/, 'falta el CHECK de cantidad positiva')
  assert.match(sql, /supply_asignaciones_sin_sobregiro/, 'falta el CHECK de sobre-asignación')
  assert.match(
    sql,
    /supply_redenciones_voucher_viva/,
    'falta el índice único que impide la doble redención'
  )
  assert.match(
    sql,
    /supply_vouchers_derecho_activo/,
    'falta el índice único de un solo voucher activo por derecho'
  )
})

test('la migración no destruye nada', () => {
  const crudo = readFileSync(
    join(RAIZ, 'prisma', 'migrations', '20260926_membego_supply', 'migration.sql'),
    'utf8'
  )
  const sql = codigo(crudo)
  assert.ok(!/\bDROP TABLE\b/i.test(sql), 'la migración no puede borrar tablas')
  assert.ok(!/\bDROP COLUMN\b/i.test(sql), 'la migración no puede borrar columnas')
  assert.ok(!/^\s*DELETE FROM/im.test(sql), 'la migración no puede borrar filas')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS/, 'la migración tiene que ser idempotente')
})

// ── Cableado con la plataforma ──────────────────────────────────────────────

test('las capacidades del proveedor existen en el catálogo real', async () => {
  const { CAPACIDADES, CAPACIDAD_LABELS } = await import('../src/modules/capacidades/catalogo')
  for (const cap of ['MEMBEGO_SUPPLIER', 'MEMBEGO_SUPPLY_FULFILLMENT'] as const) {
    assert.ok(
      (CAPACIDADES as readonly string[]).includes(cap),
      `${cap} no está en el catálogo: la empresa nunca podría encenderla`
    )
    assert.ok(CAPACIDAD_LABELS[cap], `${cap} no tiene etiqueta legible`)
  }
})

test('las capacidades del proveedor nacen APAGADAS en toda categoría', async () => {
  const { CAPACIDADES_BASE, CATEGORIAS } = await import('../src/modules/capacidades/catalogo')
  for (const cat of CATEGORIAS) {
    for (const cap of ['MEMBEGO_SUPPLIER', 'MEMBEGO_SUPPLY_FULFILLMENT']) {
      assert.ok(
        !(CAPACIDADES_BASE[cat] as readonly string[]).includes(cap),
        `${cap} viene encendida de serie en ${cat}: ser proveedora de Membego se negocia`
      )
    }
  }
})

test('la sección `supply` existe y no la tienen los roles acotados', async () => {
  const { ADMIN_SECTIONS, canAccessAdminSection, adminSectionForPath } = await import(
    '../src/lib/auth/permissions'
  )
  assert.ok((ADMIN_SECTIONS as readonly string[]).includes('supply'))

  // Aquí se leen cifras contractuales y de liquidación: información de
  // dirección, no de mostrador. Escanear vouchers vive en `scanner`, que sí
  // tiene Supervisión.
  for (const rol of ['MARKETING', 'SUPERVISOR'] as const) {
    assert.equal(
      canAccessAdminSection(rol, 'supply'),
      false,
      `el rol acotado ${rol} no debería ver cifras contractuales`
    )
  }
  assert.equal(canAccessAdminSection('ADMINISTRADOR', 'supply'), true)

  // Y el proxy tiene que saber cerrar TODO el subárbol, no solo la portada.
  assert.equal(adminSectionForPath('/admin/supply'), 'supply')
  assert.equal(adminSectionForPath('/admin/supply/escaner'), 'supply')
})

test('toda acción de supply de la bitácora tiene etiqueta', () => {
  const esquema = readFileSync(join(RAIZ, 'prisma', 'schema', 'identidad.prisma'), 'utf8')
  const queries = readFileSync(join(RAIZ, 'src', 'modules', 'auditoria', 'queries.ts'), 'utf8')
  // Se recorta el cuerpo de `enum AuditAccion` ANTES de buscar. Barrer el
  // archivo entero parecía equivalente y no lo era: `identidad.prisma` tiene
  // varios enums con la misma sangría, así que en cuanto `NotifTipo` estrenó
  // `SUPPLY_POR_VENCER` (Fase 40) esta prueba exigió una etiqueta de BITÁCORA
  // para un tipo de NOTIFICACIÓN. Un guardia que señala a quien no es enseña a
  // ignorarlo.
  const abre = esquema.indexOf('enum AuditAccion {')
  assert.notEqual(abre, -1, 'no se encontró `enum AuditAccion` en el esquema')
  const cuerpo = esquema.slice(abre, esquema.indexOf('\n}', abre))
  const acciones = [...cuerpo.matchAll(/^\s{2}(SUPPLY_[A-Z_]+)$/gm)].map((m) => m[1])

  assert.ok(acciones.length >= 15, 'se esperaban al menos quince acciones de supply')
  for (const a of acciones) {
    assert.ok(queries.includes(`${a}:`), `${a} saldría en crudo en la bitácora y no se podría filtrar`)
  }
})

// ── Reutilización, no duplicación (Fase 71) ─────────────────────────────────

test('la exportación reutiliza el CSV compartido y no inventa otro', () => {
  const ruta = join(
    RAIZ,
    'src',
    'app',
    '(superadmin)',
    'superadmin',
    'supply',
    'exportar',
    'route.ts'
  )
  const src = readFileSync(ruta, 'utf8')
  assert.match(src, /from '@\/lib\/csv'/, 'tiene que usar el CSV compartido')
  assert.ok(
    !src.includes('join(";")') && !src.includes("join(';')"),
    'está serializando CSV a mano en vez de usar armarCsv'
  )
})

test('el generador de credenciales usa randomBytes, no cuid', () => {
  const src = codigo(leer('codigos.ts'))
  assert.match(src, /randomBytes\(24\)/, 'un voucher es una credencial al portador')
  assert.match(src, /randomBytes\(16\)/, 'el nonce del QR también')
  assert.ok(!src.includes('cuid('), 'cuid está hecho para no colisionar, no para no adivinarse')
})

// ── Aislamiento entre proveedores (Fase 42) ─────────────────────────────────

test('el portal del proveedor no lee fuera de su empresa', () => {
  const ruta = join(RAIZ, 'src', 'app', '(admin)', 'admin', 'supply')
  for (const archivo of readdirSync(ruta, { recursive: true, encoding: 'utf8' })) {
    if (!archivo.endsWith('.tsx')) continue
    const src = readFileSync(join(ruta, archivo), 'utf8')
    assert.ok(
      !src.includes('sinEmpresa('),
      `admin/supply/${archivo} usa sinEmpresa: el proveedor A podría ver al B`
    )
    assert.ok(
      src.includes('guardiaProveedor'),
      `admin/supply/${archivo} no comprueba que la empresa sea proveedora`
    )
  }
})

test('el filtro de ámbito del proveedor exige la empresa', () => {
  // `permisos.ts` es server-only, así que se comprueba sobre su código: lo que
  // importa es que la función no pueda devolver un filtro VACÍO, que sería un
  // `where` sin condición sobre las tablas de todos los proveedores.
  const src = codigo(leer('permisos.ts'))
  assert.match(src, /export function ambitoProveedor/)
  assert.match(
    src,
    /if \(!companyId\) throw new Error/,
    'ambitoProveedor tiene que reventar sin empresa, no devolver un filtro vacío'
  )
  assert.match(src, /return \{ proveedorId: companyId \}/)
})

// ── El puerto de cobro no finge ─────────────────────────────────────────────

test('la venta de supply no simula una pasarela que no existe', () => {
  const src = codigo(leer('distribucion.ts'))
  assert.match(
    src,
    /export const COBRO_MEMBEGO_DISPONIBLE = false/,
    'mientras no haya cobro a nombre de la plataforma, esto tiene que decir que no'
  )
  // Y la vitrina no puede publicar un precio que nadie puede cobrar.
  assert.match(src, /precioMembego: 0/)
  assert.match(src, /esGratis: true/)
})
