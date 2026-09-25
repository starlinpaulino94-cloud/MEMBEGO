import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  dedupeDescuadre,
  dedupeVencimiento,
  dineroRD,
  esAvisable,
  semanaIso,
  textoDescuadre,
  textoVencimiento,
  textoVencimientoProveedor,
} from '../src/modules/supply/avisos'
import { UMBRALES_VENCIMIENTO } from '../src/modules/supply/catalogo'

/**
 * MEMBEGO SUPPLY · AVISOS (Fase 40).
 *
 * El cron sabía desde el primer día que 170 pizzas por RD$51.000 vencían en
 * diez días. Lo devolvía en el JSON de su respuesta —que no lee nadie— y no
 * escribía en `Notificacion`. Lo que se prueba aquí no es que el texto quede
 * bonito, sino LA PARTE QUE SE ROMPE EN SILENCIO: las claves de deduplicación.
 *
 * El cron corre todos los días a las 07:00 UTC. Una clave inestable no da
 * error, no rompe ninguna pantalla y no sale en ningún log: simplemente, al mes
 * hay treinta avisos del mismo lote y nadie vuelve a mirar la campanita.
 */

const ALERTA = {
  loteId: 'lot_1',
  codigo: 'MBG-LITRE-2026-001',
  item: 'Pizza Pepperoni Grande',
  proveedorNombre: 'Litre Pizza',
  enRiesgo: 120,
  expuestas: 50,
  exposicionFinanciera: 51_000,
}

// ── Deduplicación: la parte que importa ─────────────────────────────────────

test('LA CLAVE ES ESTABLE: dos ejecuciones del mismo día dan la misma', () => {
  assert.equal(dedupeVencimiento('lot_1', 7), dedupeVencimiento('lot_1', 7))
})

test('la clave NO lleva fecha ni hora de ejecución', () => {
  const k = dedupeVencimiento('lot_1', 7)
  const ahora = new Date()
  // Ni el año, ni el mes, ni nada que cambie solo por correr el cron otra vez.
  assert.ok(!k.includes(String(ahora.getFullYear())), k)
  assert.ok(!/\d{2}:\d{2}/.test(k), k)
})

test('cada umbral suena UNA vez: cruzar 14 no repite el aviso de 30', () => {
  const claves = new Set(UMBRALES_VENCIMIENTO.map((u) => dedupeVencimiento('lot_1', u)))
  assert.equal(claves.size, UMBRALES_VENCIMIENTO.length)
})

test('dos lotes distintos no se pisan el aviso', () => {
  assert.notEqual(dedupeVencimiento('lot_1', 7), dedupeVencimiento('lot_2', 7))
})

test('el aviso de Membego y el del proveedor no comparten clave', () => {
  // Si la compartieran, quien fuera superadmin Y admin de la empresa recibiría
  // solo uno de los dos: el segundo `createMany` lo saltaría por duplicado.
  const k = dedupeVencimiento('lot_1', 7)
  assert.notEqual(k, `${k}|proveedor`)
})

// ── Descuadres: insisten, pero no cada día ──────────────────────────────────

const HALLAZGO = {
  tipo: 'INVARIANTE_ROTO' as const,
  gravedad: 'CRITICA' as const,
  titulo: 'El lote no cuadra',
  detalle: 'compradas 1000 ≠ 999 en las cubetas',
  entidad: 'supply_lotes',
  entidadId: 'lot_1',
}

test('un descuadre que sigue ahí NO avisa todos los días', () => {
  const lun = new Date('2026-09-21T07:00:00Z')
  const mie = new Date('2026-09-23T07:00:00Z')
  assert.equal(dedupeDescuadre(HALLAZGO, lun), dedupeDescuadre(HALLAZGO, mie))
})

test('pero vuelve a avisar la semana siguiente si nadie lo arregló', () => {
  const estaSemana = new Date('2026-09-23T07:00:00Z')
  const laQueViene = new Date('2026-09-30T07:00:00Z')
  assert.notEqual(dedupeDescuadre(HALLAZGO, estaSemana), dedupeDescuadre(HALLAZGO, laQueViene))
})

test('dos descuadres distintos del mismo lote avisan por separado', () => {
  const ahora = new Date('2026-09-23T07:00:00Z')
  const otro = { ...HALLAZGO, tipo: 'REDENCION_DUPLICADA' as const }
  assert.notEqual(dedupeDescuadre(HALLAZGO, ahora), dedupeDescuadre(otro, ahora))
})

test('solo lo que invalida cifras llega a la campanita', () => {
  assert.equal(esAvisable('CRITICA'), true)
  assert.equal(esAvisable('ALTA'), true)
  // Los MEDIA están en la pantalla de conciliación. Avisar de todo es la forma
  // más segura de que no se lea nada.
  assert.equal(esAvisable('MEDIA'), false)
})

test('la semana ISO no cambia de año a mitad de semana', () => {
  // El 1 de enero de 2027 es viernes: su semana ISO es la 53 de 2026. Sin el
  // salto al jueves, el 31-dic y el 1-ene darían claves distintas y el mismo
  // descuadre avisaría dos veces en tres días.
  assert.equal(semanaIso(new Date('2026-12-31T00:00:00Z')), semanaIso(new Date('2027-01-01T00:00:00Z')))
  assert.match(semanaIso(new Date('2026-09-23T00:00:00Z')), /^2026-W\d{2}$/)
})

// ── Los textos: lo que cada uno puede leer ──────────────────────────────────

test('a Membego se le dice el DINERO primero, no las unidades', () => {
  const t = textoVencimiento(ALERTA, 7)
  assert.match(t.titulo, /vence en 7 días/)
  assert.match(t.titulo, /MBG-LITRE-2026-001/)
  assert.ok(t.mensaje.startsWith('RD$51,000'), t.mensaje)
  assert.match(t.mensaje, /170 unidades/)
  assert.match(t.mensaje, /120 todavía se pueden repartir/)
  assert.match(t.mensaje, /50 ya están entregadas/)
})

test('SEGURIDAD · al proveedor NUNCA se le dice el costo de Membego', () => {
  const t = textoVencimientoProveedor(ALERTA, 7)
  // El costo unitario es información de contrato: su portal no la enseña, y un
  // aviso no puede ser la rendija por donde se escapa.
  assert.ok(!t.mensaje.includes('51'), t.mensaje)
  assert.ok(!t.mensaje.includes('RD$'), t.mensaje)
  assert.ok(!t.titulo.includes('RD$'), t.titulo)
  assert.match(t.mensaje, /170 unidades sin entregar/)
  assert.equal(t.href, '/admin/supply')
})

test('a un día se dice «mañana», no «en 1 días»', () => {
  assert.match(textoVencimiento(ALERTA, 1).titulo, /vence mañana/)
  assert.match(textoVencimientoProveedor(ALERTA, 1).titulo, /vence mañana/)
})

test('una sola unidad se dice en singular', () => {
  const uno = { ...ALERTA, enRiesgo: 1, expuestas: 0 }
  assert.match(textoVencimiento(uno, 3).mensaje, /1 unidad de/)
  assert.match(textoVencimientoProveedor(uno, 3).mensaje, /1 unidad sin entregar/)
})

test('no se mencionan cubetas vacías', () => {
  const soloEntregadas = { ...ALERTA, enRiesgo: 0 }
  const t = textoVencimiento(soloEntregadas, 3)
  assert.ok(!t.mensaje.includes('0 todavía se pueden repartir'), t.mensaje)
})

test('el aviso de descuadre dice DÓNDE mirar', () => {
  const t = textoDescuadre(HALLAZGO)
  assert.match(t.titulo, /crítico/i)
  assert.match(t.mensaje, /supply_lotes lot_1/)
  assert.equal(t.href, '/superadmin/supply/conciliacion')
})

test('dineroRD redondea y separa miles', () => {
  assert.equal(dineroRD(51_000), 'RD$51,000')
  assert.equal(dineroRD(300.4), 'RD$300')
})

// ── Arquitectura ────────────────────────────────────────────────────────────

test('avisos.ts es PURO: se prueba sin base de datos', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'modules', 'supply', 'avisos.ts'), 'utf8')
  assert.ok(!src.includes("import 'server-only'"), 'avisos.ts no puede ser server-only')
  assert.ok(!src.includes("from '@/lib/tenant'"), 'avisos.ts no toca la base')
  // Los tipos de los módulos con datos entran como `import type`, que se borra
  // al compilar: si entraran como valor, esta prueba no podría ni cargar.
  assert.match(src, /import type \{ Hallazgo \}/)
})

test('el envío NO puede tumbar el cron', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'app', 'api', 'cron', 'supply', 'route.ts'), 'utf8')
  const i = src.indexOf('avisarVencimientos(enUmbral)')
  assert.notEqual(i, -1, 'el cron no envía los avisos')
  // Y va envuelto: soltar holds y cerrar lo vencido mueven el ledger, y no se
  // quedan a medias porque falle la campanita.
  const antes = src.slice(0, i)
  assert.match(antes.slice(-400), /try \{/)
  assert.match(src.slice(i), /catch/)
})

test('cada valor nuevo del enum está también en su migración', () => {
  const raiz = join(__dirname, '..')
  const esquema = readFileSync(join(raiz, 'prisma', 'schema', 'identidad.prisma'), 'utf8')
  const migracion = readFileSync(
    join(raiz, 'prisma', 'migrations', '20261001_supply_avisos', 'migration.sql'),
    'utf8'
  )
  for (const v of ['SUPPLY_POR_VENCER', 'SUPPLY_DESCUADRE']) {
    assert.ok(new RegExp(`^\\s+${v}$`, 'm').test(esquema), `${v} no está en el enum`)
    assert.ok(
      migracion.includes(`ADD VALUE IF NOT EXISTS '${v}'`),
      `${v} no está en la migración: el cron lo escribiría y Postgres lo rechazaría`
    )
  }
})
