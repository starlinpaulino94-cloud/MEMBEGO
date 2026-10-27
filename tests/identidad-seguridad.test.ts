/**
 * VERIFICACIÓN DE IDENTIDAD · Fase 6 · seguridad sin base de datos: barridos exhaustivos, fuzz de la firma del proveedor y
 * HIGIENE DEL REPOSITORIO (ni un documento real, ni una clave, ni una imagen de identidad).
 *
 * Cada prueba falla si vuelve el defecto que cierra:
 *   1 · una advertencia del proveedor llega a la persona tal cual, o una señal de fraude se explica;
 *   2 · una advertencia nueva queda sin clasificar, o una clave del lenguaje (`__proto__`, `constructor`) se toma por un código;
 *   3 · un aviso alterado, truncado, anidado a lo bestia o hecho de basura pasa la firma o la rompe con una excepción;
 *   4 · se cuela en el repositorio una imagen/vídeo/PDF de identidad, una cédula con dígito verificador válido o una clave real.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CODIGOS_RAZON, esCodigoRazon, mensajeParaUsuario, motivoEsVisible, resolverDecision } from '../src/modules/identidad/identidadCore'
import { canonizar, leerAviso, traducirAdvertencias, verificarFirmaDeDidit } from '../src/modules/identidad/proveedor/diditMapeo'

const RAIZ = join(__dirname, '..')
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8')

// ── 1 · Las advertencias del proveedor ──────────────────────────────────────

/** Todas las advertencias que el sistema conoce, tal cual están escritas en el mapeo. */
function advertenciasConocidas(): string[] {
  const fuente = leer('src/modules/identidad/proveedor/diditMapeo.ts')
  const bloque = fuente.slice(fuente.indexOf('const ADVERTENCIAS'), fuente.indexOf('/** Traduce una lista de advertencias'))
  return [...bloque.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]!)
}

const FRAUDE = new Set(['SOSPECHA_DE_FRAUDE', 'SOSPECHA_DE_DOCUMENTO_ALTERADO'])

test('1 · CADA ADVERTENCIA CONOCIDA SE TRADUCE A UN CÓDIGO PROPIO, y la persona nunca ve lo que dijo el proveedor', () => {
  const claves = advertenciasConocidas()
  assert.ok(claves.length >= 50, `el barrido encontró ${claves.length} advertencias`)
  for (const clave of claves) {
    const codigos = traducirAdvertencias([clave])
    assert.equal(codigos.length, 1, `${clave} no se traduce`)
    const codigo = codigos[0]!
    assert.ok(esCodigoRazon(codigo), `${clave} → ${codigo} no es del catálogo`)
    const mensaje = mensajeParaUsuario(codigo)
    assert.match(mensaje, /[a-záéíóúñ]{4,}/i, 'el mensaje está en español')
    // Ni la clave del proveedor, ni su forma legible, llegan a la persona.
    for (const forma of [clave, clave.toLowerCase(), clave.replace(/_/g, ' ').toLowerCase(), clave.replace(/_/g, '-').toLowerCase()]) {
      assert.ok(!mensaje.toLowerCase().includes(forma), `el mensaje de ${codigo} contiene «${forma}»`)
    }
  }
})

test('1b · LAS SEÑALES DE FRAUDE NO SE EXPLICAN NI SE REINTENTAN, y todas dicen lo mismo; los problemas de captura sí se explican y se reintentan', () => {
  const neutral = mensajeParaUsuario('SOSPECHA_DE_FRAUDE')
  for (const clave of advertenciasConocidas()) {
    const codigo = traducirAdvertencias([clave])[0]!
    const c = CODIGOS_RAZON[codigo]
    if (FRAUDE.has(codigo)) {
      assert.equal(c.reintentable, false, `${clave}: el fraude no se reintenta`)
      assert.equal(c.visible, false, `${clave}: el motivo del fraude no se explica`)
      assert.equal(mensajeParaUsuario(codigo), neutral, `${clave}: el mensaje es el neutro`)
      assert.equal(motivoEsVisible(codigo), false)
    } else if (codigo === 'MENOR_DE_EDAD') {
      assert.deepEqual([c.reintentable, c.visible], [false, true])
    } else {
      assert.equal(c.reintentable, true, `${clave}: un problema de captura se puede reintentar`)
      assert.equal(c.visible, true, `${clave}: se le dice a la persona qué arreglar`)
    }
  }
  // El mensaje neutro no delata ninguna señal.
  assert.doesNotMatch(neutral, /fraude|alter|ataque|falsific|copia|pantalla|c[aá]mara virtual|lista|bloque/i)
})

test('1c · LAS SEIS FAMILIAS QUE PIDE LA REVISIÓN TIENEN CÓDIGO: documento válido o no, selfie que no coincide, prueba de vida, sesión vencida e incompleta', () => {
  const alcanzables = new Set(advertenciasConocidas().map((k) => traducirAdvertencias([k])[0]))
  for (const codigo of ['DOCUMENTO_VENCIDO', 'DOCUMENTO_ILEGIBLE', 'DOCUMENTO_NO_SOPORTADO', 'ROSTRO_NO_COINCIDE', 'PRUEBA_DE_VIDA_FALLIDA', 'DATOS_NO_COINCIDEN', 'MENOR_DE_EDAD', 'SOSPECHA_DE_DOCUMENTO_ALTERADO', 'SOSPECHA_DE_FRAUDE'] as const) {
    assert.ok(alcanzables.has(codigo), `ninguna advertencia lleva a ${codigo}`)
  }
  // Los demás códigos nacen de otro camino: el estado de la sesión, el equipo o el chequeo de duplicados.
  for (const codigo of ['SESION_EXPIRADA', 'IDENTIDAD_DUPLICADA', 'REVISION_NEGADA', 'FLUJO_INCOMPLETO', 'RECHAZO_GENERICO'] as const) assert.ok(esCodigoRazon(codigo))
  // Una sesión rechazada sin ninguna advertencia reconocida cae en lo genérico y reintentable (nunca en «aprobada»).
  const d = resolverDecision({ resultado: 'rechazada', codigos: [] })
  assert.deepEqual([d.estado, d.tipoRechazo, d.codigoRazon], ['rechazada_reintentable', 'reintentable', 'RECHAZO_GENERICO'])
})

test('2 · LO QUE NO ES UNA ADVERTENCIA CONOCIDA SE DESCARTA, incluidas las claves propias del lenguaje', () => {
  assert.deepEqual(traducirAdvertencias(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__', '', ' ', 'document_expired', 'DOCUMENT_EXPIRED ']), [])
  for (const clave of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'prototype', '']) {
    assert.equal(esCodigoRazon(clave), false, clave)
    assert.equal(mensajeParaUsuario(clave), CODIGOS_RAZON.RECHAZO_GENERICO.mensaje, `«${clave}» cae en el mensaje genérico`)
    assert.equal(motivoEsVisible(clave), true)
  }
  for (const raro of [null, undefined, 42, {}, [], true] as unknown[]) assert.equal(esCodigoRazon(raro), false)
})

// ── 3 · La firma del aviso, a martillazos ───────────────────────────────────

const SECRETO = 'secreto-compartido-de-prueba-001'
const AHORA = new Date('2026-10-22T15:00:00Z')
const ts = () => Math.floor(AHORA.getTime() / 1000)
const firmarV2 = (cuerpo: unknown) => createHmac('sha256', SECRETO).update(canonizar(cuerpo), 'utf8').digest('hex')
const base = () => ({
  event_id: 'evt-fuzz-1',
  webhook_type: 'status.updated',
  timestamp: ts(),
  session_id: '11111111-2222-3333-4444-555555555555',
  status: 'Approved',
  vendor_data: 'cmintentosintetico0001',
  decision: { id_verifications: [{ score: 100, nombre: 'Peña Núñez', lista: [1, 2, { x: 'y' }] }] },
})
const verificar = (crudo: string, cabeceras: Record<string, string | null>) => verificarFirmaDeDidit({ cuerpoCrudo: crudo, cabeceras, secretos: [SECRETO], ahora: AHORA })

/** Un generador pseudoaleatorio con semilla: la prueba es reproducible. */
function aleatorio(semilla: number) {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Cambia UN valor cualquiera del árbol (texto, número o booleano), o añade o quita una clave. */
function mutar(arbol: unknown, azar: () => number): unknown {
  const copia = JSON.parse(JSON.stringify(arbol)) as Record<string, unknown>
  const caminos: (string | number)[][] = []
  const recorrer = (nodo: unknown, camino: (string | number)[]) => {
    if (nodo && typeof nodo === 'object') for (const [k, v] of Object.entries(nodo)) recorrer(v, [...camino, Array.isArray(nodo) ? Number(k) : k])
    else caminos.push(camino)
  }
  recorrer(copia, [])
  const camino = caminos[Math.floor(azar() * caminos.length)]!
  let padre: any = copia
  for (const paso of camino.slice(0, -1)) padre = padre[paso]
  const ultimo = camino[camino.length - 1]!
  const actual = padre[ultimo]
  const modo = Math.floor(azar() * 4)
  if (modo === 0 && typeof actual === 'string') padre[ultimo] = actual.slice(0, -1) + String.fromCharCode(((actual.charCodeAt(actual.length - 1) + 1 + Math.floor(azar() * 20)) % 0xd7ff) || 65)
  else if (modo === 1 && typeof actual === 'number') padre[ultimo] = actual + 1 + Math.floor(azar() * 1000)
  else if (modo === 2) delete padre[ultimo]
  else (copia as Record<string, unknown>)[`extra_${Math.floor(azar() * 1e6)}`] = 'x'
  return copia
}

test('3 · 400 ALTERACIONES AL AZAR DE UN AVISO FIRMADO: ninguna pasa la firma (cambiar un valor, quitar o añadir una clave)', () => {
  const azar = aleatorio(20261022)
  const original = base()
  const firma = firmarV2(original)
  assert.deepEqual(verificar(JSON.stringify(original), { 'x-signature-v2': firma }), { ok: true })
  let probadas = 0
  for (let i = 0; i < 400; i++) {
    const alterado = mutar(original, azar)
    if (canonizar(alterado) === canonizar(original)) continue
    probadas++
    const r = verificar(JSON.stringify(alterado), { 'x-signature-v2': firma })
    assert.equal(r.ok, false, `la alteración ${i} pasó: ${JSON.stringify(alterado).slice(0, 120)}`)
  }
  assert.ok(probadas > 350, `se probaron ${probadas} alteraciones reales`)
})

test('3b · SOLO LO QUE NO CAMBIA EL CONTENIDO PASA: el orden de las claves y los espacios', () => {
  const original = base()
  const firma = firmarV2(original)
  const desordenado = JSON.stringify(Object.fromEntries(Object.entries(original).reverse()), null, 7)
  assert.equal(verificar(desordenado, { 'x-signature-v2': firma }).ok, true)
  assert.equal(verificar(`\n\t${JSON.stringify(original)}  \n`, { 'x-signature-v2': firma }).ok, true)
})

test('3c · LA BASURA NUNCA LANZA: bytes al azar, JSON truncado, anidado extremo, números absurdos, nulos y BOM devuelven «no» sin excepción', () => {
  const azar = aleatorio(777)
  const basura: string[] = ['', ' ', 'null', 'true', '42', '"texto"', '[]', '{}', '{"a":', '{"a":1,}', '﻿{"event_id":"x"}', '{"event_id":"x\u0000y"}', '[' .repeat(50_000), '{"a":'.repeat(30_000), `{"n":${'9'.repeat(5000)}}`, '{"n":1e999}', '{"__proto__":{"admin":true}}', '{"constructor":{"prototype":{"x":1}}}']
  for (let i = 0; i < 200; i++) {
    const largo = Math.floor(azar() * 400)
    basura.push(Array.from({ length: largo }, () => String.fromCharCode(Math.floor(azar() * 0xffff))).join(''))
  }
  const entero = JSON.stringify(base())
  for (let i = 1; i < 60; i++) basura.push(entero.slice(0, Math.floor((entero.length * i) / 60)))
  for (const crudo of basura) {
    for (const cabeceras of [{}, { 'x-signature-v2': 'a'.repeat(64) }, { 'x-signature-v2': 'zz' }, { 'x-signature': firmarV2(base()) }, { 'x-signature-v2': null }] as Record<string, string | null>[]) {
      let r: ReturnType<typeof verificar> | undefined
      assert.doesNotThrow(() => {
        r = verificar(crudo, cabeceras)
      }, `lanzó con ${JSON.stringify(crudo.slice(0, 40))}`)
      assert.equal(r!.ok, false)
    }
    assert.doesNotThrow(() => leerAviso(crudo), `leerAviso lanzó con ${JSON.stringify(crudo.slice(0, 40))}`)
  }
  // Y ni una clave del lenguaje contamina los objetos de la aplicación.
  assert.equal(({} as Record<string, unknown>).admin, undefined)
  assert.equal(({} as Record<string, unknown>).x, undefined)
})

// ── 4 · Higiene del repositorio ─────────────────────────────────────────────

const archivosDelRepo = (() => {
  try {
    return execSync('git ls-files', { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean)
  } catch {
    return null
  }
})()

test('4 · NI UNA IMAGEN, VÍDEO NI PDF EN LAS PRUEBAS, Y NINGÚN ARCHIVO CON NOMBRE DE DOCUMENTO DE IDENTIDAD, EN TODO EL REPOSITORIO', (t) => {
  if (!archivosDelRepo) return t.skip('sin git: no se puede listar el repositorio')
  const multimedia = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|pdf|mp4|mov|webm|avi|mkv|zip)$/i
  const enPruebas = archivosDelRepo.filter((f) => /^(tests|scripts)\//.test(f) && multimedia.test(f))
  assert.deepEqual(enPruebas, [], 'las pruebas usan datos sintéticos en código, nunca imágenes ni documentos')
  const sospechosos = archivosDelRepo.filter((f) => /(c[eé]dula|cedula|selfie|liveness|passport|pasaporte|kyc|id[-_]?card|licencia[-_]?conducir)/i.test(f) && multimedia.test(f))
  assert.deepEqual(sospechosos, [], 'ningún archivo multimedia con nombre de documento de identidad')
})

/** El dígito verificador de la cédula dominicana (módulo 10 con pesos 1 y 2). */
function cedulaValida(d: string): boolean {
  if (!/^\d{11}$/.test(d)) return false
  let suma = 0
  for (let i = 0; i < 10; i++) {
    let p = Number(d[i]) * (i % 2 === 0 ? 1 : 2)
    if (p > 9) p = Math.floor(p / 10) + (p % 10)
    suma += p
  }
  return (10 - (suma % 10)) % 10 === Number(d[10])
}

test('4b · NINGUNA CÉDULA CON DÍGITO VERIFICADOR VÁLIDO EN EL CÓDIGO, LAS PRUEBAS NI LOS DOCUMENTOS (los datos sintéticos no pueden ser reales por casualidad)', (t) => {
  if (!archivosDelRepo) return t.skip('sin git')
  assert.equal(cedulaValida('00100000010'), cedulaValida('00100000010')) // la función es determinista
  assert.equal(cedulaValida('12345'), false)
  const texto = /\.(ts|tsx|mts|mjs|cjs|js|json|md|sql|txt|ya?ml|html|csv)$/
  const PLACEHOLDER = '00000000000' // el marcador «000-0000000-0» de un formulario
  const encontradas: string[] = []
  for (const f of archivosDelRepo.filter((x) => texto.test(x))) {
    let s: string
    try {
      s = readFileSync(join(RAIZ, f), 'utf8')
    } catch {
      continue
    }
    for (const m of s.matchAll(/(?<![\d-])(\d{3})-(\d{7})-(\d)(?![\d-])/g)) {
      const digitos = m[1]! + m[2]! + m[3]!
      if (digitos !== PLACEHOLDER && cedulaValida(digitos)) encontradas.push(`${f}: ${m[0]}`)
    }
  }
  assert.deepEqual(encontradas, [], 'una cédula con dígito verificador válido podría ser de una persona real: usa datos que no lo sean')
})

test('4c · LAS CLAVES DE LA VERIFICACIÓN NO ESTÁN EN EL REPOSITORIO: el ejemplo de entorno las deja vacías y ningún archivo trae una asignada', (t) => {
  if (!archivosDelRepo) return t.skip('sin git')
  const ejemplo = leer('.env.example')
  for (const variable of ['IDENTIDAD_CLAVES_MAESTRAS', 'IDENTIDAD_PEPPER_DEDUPE', 'DIDIT_API_KEY', 'DIDIT_WORKFLOW_ID', 'DIDIT_WEBHOOK_SECRET', 'DIDIT_WEBHOOK_SECRET_ANTERIOR']) {
    const linea = ejemplo.split('\n').find((l) => l.startsWith(`${variable}=`))
    assert.ok(linea !== undefined, `${variable} está documentada en .env.example`)
    assert.equal(linea, `${variable}=`, `${variable} va vacía en el ejemplo`)
  }
  // Ningún archivo versionado asigna un valor largo a estas variables (salvo las pruebas, que las inventan en tiempo de ejecución).
  const infractores: string[] = []
  for (const f of archivosDelRepo.filter((x) => /\.(ts|tsx|mts|mjs|cjs|js|json|md|yml|yaml|env.*|sh)$/.test(x) || /(^|\/)\.env/.test(x))) {
    if (/^tests\//.test(f)) continue
    let s: string
    try {
      s = readFileSync(join(RAIZ, f), 'utf8')
    } catch {
      continue
    }
    if (/\b(DIDIT_API_KEY|DIDIT_WEBHOOK_SECRET(_ANTERIOR)?|IDENTIDAD_PEPPER_DEDUPE|IDENTIDAD_CLAVES_MAESTRAS)[ \t]*[:=][ \t]*['"]?[A-Za-z0-9+/_-]{20,}/.test(s)) infractores.push(f)
  }
  assert.deepEqual(infractores, [], 'una clave real no se versiona')
})
