import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FEATURES_CONNECT } from '../src/modules/connect/nucleo'

/**
 * MEMBEGO CONNECT · Fase 9 — la llave que faltaba.
 *
 * Lo que se vigila aquí es que la puerta se pueda abrir, que solo la abra
 * quien debe, y que abrirla deje rastro.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const ACCIONES = leer('src/modules/connect/superadminActions.ts')

test('marketplace: la concesión de límites tiene por fin un llamador', () => {
  // Este es el fallo que la Fase 9 vino a arreglar: `asignarEntitlement`
  // existía desde la Fase 1 sin que nada la llamara, así que ninguna empresa
  // podía usar las claves ni los webhooks construidos después.
  assert.match(ACCIONES, /asignarEntitlement\(/)
  assert.match(ACCIONES, /retirarEntitlement\(/)
})

test('marketplace: solo el superadmin concede, y se comprueba DENTRO de la acción', () => {
  const acciones = ACCIONES.match(/^export async function \w+Action/gm) ?? []
  assert.equal(acciones.length, 2)
  for (const bloque of ACCIONES.split('export async function ').slice(1)) {
    assert.match(bloque, /await superadmin\(\)/)
  }
  assert.match(ACCIONES, /user\?\.metadata\.role !== 'SUPERADMIN'/)
})

test('marketplace: conceder deja rastro con nombre y fecha', () => {
  // Conceder claves de API abre los datos de una empresa a terceros: es una
  // decisión con consecuencias de seguridad, no un ajuste cualquiera.
  for (const bloque of ACCIONES.split('export async function ').slice(1)) {
    assert.match(bloque, /auditarConnect\('CONNECT_/)
  }
})

test('marketplace: vacío devuelve al valor por defecto, y CERO prohíbe', () => {
  // No son lo mismo aunque hoy coincidan: quien concede «cero» quiere cero, no
  // «lo que traiga el sistema el día que alguien cambie el default».
  assert.match(ACCIONES, /if \(bruto === ''\)/)
  assert.match(ACCIONES, /accion: 'por_defecto'/)
  // Y un número fuera de rango no pasa.
  assert.match(ACCIONES, /limite < 0 \|\| limite > 10_000/)
})

test('marketplace: no se acepta una función inventada', () => {
  assert.match(ACCIONES, /!\(feature in FEATURES_CONNECT\)/)
  // Las tres features del sistema siguen siendo las que la pantalla ofrece.
  const panel = leer('src/components/superadmin/ConcesionesPanel.tsx')
  for (const clave of Object.keys(FEATURES_CONNECT)) {
    assert.ok(panel.includes(`'${clave}'`), `la pantalla no ofrece ${clave}`)
  }
})

test('marketplace: retirar un conector no borra nada', () => {
  const modulo = leer('src/modules/connect/superadmin.ts')
  // Solo cambia el estado: borrar la fila del catálogo arrastraría en cascada
  // las conexiones y credenciales que las empresas construyeron encima.
  assert.match(modulo, /tx\.conector\.updateMany\(\{ where: \{ id \}, data: \{ estado \} \}\)/)
  assert.ok(!/tx\.conector\.delete/.test(modulo))
})

test('marketplace: la adopción cuenta conexiones VIVAS, no históricas', () => {
  const modulo = leer('src/modules/connect/superadmin.ts')
  // Una empresa que conectó y desconectó no es adopción.
  assert.match(modulo, /conexiones\.filter\(\(x\) => x\.estado === 'CONNECTED'\)/)
})

test('marketplace: el panel separa «activo» de «configurado aquí»', () => {
  // Un conector ACTIVE sin sus variables no se ofrece a nadie. Confundir las
  // dos cosas lleva a buscar el fallo en la empresa cuando está en el entorno.
  const panel = leer('src/components/superadmin/CatalogoAdminPanel.tsx')
  assert.match(panel, /Activos pero sin configurar en este despliegue/)
  assert.match(panel, /Sin configurar aquí/)
})

test('marketplace: la migración solo añade valores al enum', () => {
  const m = leer('prisma/migrations/20260902_connect_marketplace/migration.sql')
  assert.match(m, /ADD VALUE IF NOT EXISTS 'CONNECT_CONCEDIDO'/)
  assert.match(m, /ADD VALUE IF NOT EXISTS 'CONNECT_CONECTOR_ESTADO'/)
  // Nada de DROP ni de DELETE en una migración de esta fase.
  assert.ok(!/DROP |DELETE /i.test(m))
})
