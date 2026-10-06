/**
 * MEMBEGO SUPPLY · pruebas de PERMISOS y de BITÁCORA.
 * Ejecutar: npm test
 *
 * Quedaron de las pruebas de contrato del Supply original (retirado): las
 * capacidades `MEMBEGO_SUPPLIER` / `MEMBEGO_SUPPLY_FULFILLMENT` y la sección
 * `supply` siguen siendo las del Supply vigente, y las acciones `SUPPLY_*` de
 * la bitácora conservan su historial, así que necesitan etiqueta aunque ya no
 * se generen.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()

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
