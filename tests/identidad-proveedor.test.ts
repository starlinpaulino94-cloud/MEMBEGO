/**
 * VERIFICACIÓN DE IDENTIDAD · Fase 2 · el proveedor, sin red ni base de datos:
 * la traducción de Didit a MEMBEGO, la firma de los avisos y el interruptor automático.
 * (El cliente HTTP y el flujo completo se prueban contra PostgreSQL en
 * `tests/postgres/identidad-proveedor.db.test.ts`.)
 *
 * Los datos son sintéticos: ningún documento ni persona reales.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { CODIGOS_RAZON, resolverDecision } from '../src/modules/identidad/identidadCore'
import { Circuito } from '../src/modules/identidad/proveedor/circuito'
import { ErrorDeProveedor } from '../src/modules/identidad/proveedor/contrato'
import {
  MAX_BYTES_AVISO,
  TOLERANCIA_AVISO_S,
  canonizar,
  categoriaDeDocumento,
  extraerDocumento,
  leerAviso,
  traducirAdvertencias,
  traducirDecisionDeDidit,
  verificarFirmaDeDidit,
} from '../src/modules/identidad/proveedor/diditMapeo'

// ── Fixtures ────────────────────────────────────────────────────────────────

const INTENTO = 'cmintentosintetico0001'
const aprobado = (extra: Record<string, unknown> = {}) => ({
  session_id: '11111111-2222-3333-4444-555555555555',
  status: 'Approved',
  vendor_data: INTENTO,
  id_verifications: [
    { node_id: 'n1', status: 'Approved', document_type: 'Identity Card', issuing_state: 'DOM', personal_number: '001-0000000-1', document_number: 'AB123456', warnings: [{ risk: 'QR_NOT_DETECTED', log_type: 'information' }] },
  ],
  liveness_checks: [{ node_id: 'n2', status: 'Approved', method: 'ACTIVE_3D', score: 99, warnings: [] }],
  face_matches: [{ node_id: 'n3', status: 'Approved', score: 92, warnings: [] }],
  ...extra,
})
const declinado = (riesgos: string[]) => ({
  status: 'Declined',
  vendor_data: INTENTO,
  id_verifications: [{ status: 'Declined', warnings: riesgos.map((risk) => ({ risk, log_type: 'error' })) }],
  liveness_checks: null,
  face_matches: null,
})

// ── Estados ─────────────────────────────────────────────────────────────────

test('una aprobación completa (documento + vida + rostro) es «aprobada» y trae el documento para el hash', () => {
  const r = traducirDecisionDeDidit(aprobado())
  assert.deepEqual(r.decision, { resultado: 'aprobada' })
  assert.equal(r.referenciaDelCliente, INTENTO)
  assert.equal(r.nivel, 'documento_selfie')
  assert.deepEqual(r.documento, { tipoDocumento: 'CEDULA', numeroDocumento: '001-0000000-1', pais: 'DOM' })
})

test('UNA APROBACIÓN SIN LAS TRES PRUEBAS NO ACREDITA: va a revisión (un flujo mal configurado en la consola no puede dar identidad)', () => {
  for (const sinEso of ['id_verifications', 'liveness_checks', 'face_matches'] as const) {
    const r = traducirDecisionDeDidit(aprobado({ [sinEso]: null }))
    assert.deepEqual(r.decision, { resultado: 'en_revision', codigos: ['FLUJO_INCOMPLETO'] }, sinEso)
    assert.equal(r.documento, null, 'ni se extrae el documento')
  }
  // Presentes pero sin ninguna aprobada.
  const r = traducirDecisionDeDidit(aprobado({ liveness_checks: [{ status: 'Declined' }] }))
  assert.equal(r.decision.resultado, 'en_revision')
  assert.equal(resolverDecision(r.decision).codigoRazon, 'FLUJO_INCOMPLETO')
  assert.equal(CODIGOS_RAZON.FLUJO_INCOMPLETO.visible, false)
})

test('cada estado de sesión de Didit se traduce al vocabulario neutral (y los de «sin novedad» no mueven nada)', () => {
  const caso = (status: string) => traducirDecisionDeDidit({ status, vendor_data: INTENTO }).decision.resultado
  assert.equal(caso('Not Started'), 'iniciada')
  assert.equal(caso('In Progress'), 'en_proceso')
  assert.equal(caso('Resubmitted'), 'en_proceso')
  assert.equal(caso('Awaiting User'), 'reenvio_requerido')
  assert.equal(caso('In Review'), 'en_revision')
  assert.equal(caso('Declined'), 'rechazada')
  assert.equal(caso('Expired'), 'expirada')
  assert.equal(caso('Kyc Expired'), 'expirada')
  assert.equal(caso('Abandoned'), 'abandonada')
})

test('una respuesta que no es lo esperado LANZA en vez de adivinar', () => {
  for (const malo of [null, 'texto', [], {}, { status: 'approved' }, { status: 'Aprobado' }, { status: 42 }]) {
    assert.throws(() => traducirDecisionDeDidit(malo), (e: unknown) => e instanceof ErrorDeProveedor && e.codigo === 'respuesta_invalida', JSON.stringify(malo))
  }
})

// ── Advertencias → códigos propios ──────────────────────────────────────────

test('las señales de ataque y de documento alterado van a los códigos que NO se explican ni se reintentan', () => {
  for (const r of ['LIVENESS_FACE_ATTACK', 'FRAME_INJECTION_SUSPECTED', 'VIRTUAL_CAMERA_DETECTED', 'FACE_IN_BLOCKLIST', 'ID_DOCUMENT_IN_BLOCKLIST']) {
    const d = resolverDecision(traducirDecisionDeDidit(declinado([r])).decision)
    assert.deepEqual([d.estado, d.codigoRazon, d.tipoRechazo], ['rechazada_definitiva', 'SOSPECHA_DE_FRAUDE', 'definitivo'], r)
  }
  for (const r of ['PRINTED_COPY_DETECTED', 'SCREEN_CAPTURE_DETECTED', 'PORTRAIT_MANIPULATION_DETECTED']) {
    const d = resolverDecision(traducirDecisionDeDidit(declinado([r])).decision)
    assert.deepEqual([d.estado, d.codigoRazon], ['rechazada_definitiva', 'SOSPECHA_DE_DOCUMENTO_ALTERADO'], r)
  }
  assert.equal(CODIGOS_RAZON.SOSPECHA_DE_FRAUDE.visible, false)
  assert.equal(CODIGOS_RAZON.SOSPECHA_DE_DOCUMENTO_ALTERADO.visible, false)
})

test('los problemas de captura son reintentables, con el motivo en español', () => {
  const casos: [string, string][] = [
    ['DOCUMENT_EXPIRED', 'DOCUMENTO_VENCIDO'],
    ['IMAGE_TOO_BLURRY', 'DOCUMENTO_ILEGIBLE'],
    ['DOCUMENT_NOT_SUPPORTED_FOR_APPLICATION', 'DOCUMENTO_NO_SOPORTADO'],
    ['LOW_FACE_MATCH_SIMILARITY', 'ROSTRO_NO_COINCIDE'],
    ['LOW_FRONT_CAMERA_FACE_MATCH_SIMILARITY', 'ROSTRO_NO_COINCIDE'],
    ['LOW_LIVENESS_SCORE', 'PRUEBA_DE_VIDA_FALLIDA'],
    ['NO_FACE_DETECTED', 'PRUEBA_DE_VIDA_FALLIDA'],
  ]
  for (const [riesgo, esperado] of casos) {
    const d = resolverDecision(traducirDecisionDeDidit(declinado([riesgo])).decision)
    assert.deepEqual([d.estado, d.codigoRazon], ['rechazada_reintentable', esperado], riesgo)
  }
  // La edad es definitiva, pero se explica (es verdad y no ayuda a evadir nada).
  const menor = resolverDecision(traducirDecisionDeDidit(declinado(['MINIMUM_AGE_NOT_MET'])).decision)
  assert.deepEqual([menor.estado, menor.codigoRazon], ['rechazada_definitiva', 'MENOR_DE_EDAD'])
})

test('con varias advertencias manda la más grave, y una rechazada sin advertencias reconocidas es genérica y reintentable', () => {
  const d = resolverDecision(traducirDecisionDeDidit(declinado(['IMAGE_TOO_BLURRY', 'LOW_FACE_MATCH_SIMILARITY', 'LIVENESS_FACE_ATTACK'])).decision)
  assert.equal(d.codigoRazon, 'SOSPECHA_DE_FRAUDE')
  const g = resolverDecision(traducirDecisionDeDidit(declinado(['ALGO_NUEVO_DE_DIDIT'])).decision)
  assert.deepEqual([g.estado, g.codigoRazon], ['rechazada_reintentable', 'RECHAZO_GENERICO'])
  assert.deepEqual(traducirAdvertencias(['QR_NOT_DETECTED', 'POSSIBLE_DUPLICATED_USER', 'BREACHED_EMAIL_DETECTED']), [], 'las informativas no son motivo de nada')
  assert.deepEqual(traducirAdvertencias(['toString', '__proto__', 'constructor']), [], 'un riesgo con nombre de propiedad de objeto no entra')
})

test('las advertencias solo se leen al rechazar o revisar: una aprobada con advertencias informativas sigue aprobada', () => {
  const r = traducirDecisionDeDidit(aprobado({ liveness_checks: [{ status: 'Approved', warnings: [{ risk: 'LIVENESS_FACE_ATTACK' }] }] }))
  assert.equal(r.decision.resultado, 'aprobada', 'si Didit aprobó con todo, MEMBEGO no reinterpreta advertencias sueltas')
  const rev = traducirDecisionDeDidit({ status: 'In Review', vendor_data: INTENTO, face_matches: [{ status: 'In Review', warnings: [{ risk: 'LOW_FACE_MATCH_SIMILARITY' }] }] })
  assert.deepEqual(rev.decision, { resultado: 'en_revision', codigos: ['ROSTRO_NO_COINCIDE'] })
})

// ── El documento para el hash ───────────────────────────────────────────────

test('el hash usa el número PERSONAL (no cambia al renovar la tarjeta) y una categoría cerrada de documento', () => {
  const sinPersonal = extraerDocumento({ id_verifications: [{ status: 'Approved', document_type: 'Identity Card', issuing_state: 'DOM', document_number: 'XY999' }] })
  assert.deepEqual(sinPersonal, { tipoDocumento: 'CEDULA', numeroDocumento: 'XY999', pais: 'DOM' })
  assert.equal(extraerDocumento({ id_verifications: [{ status: 'Approved', document_type: 'Identity Card' }] }), null, 'sin número o sin país no hay hash')
  assert.equal(extraerDocumento({ id_verifications: [] }), null)
  assert.equal(extraerDocumento({}), null)
  for (const [tipo, categoria] of [['Passport', 'PASAPORTE'], ['Driver License', 'LICENCIA'], ['Residence Permit', 'RESIDENCIA'], ['Identity Card', 'CEDULA'], ['Cédula', 'CEDULA'], ['Tarjeta rara', 'OTRO'], [null, 'OTRO']] as const) {
    assert.equal(categoriaDeDocumento(tipo), categoria, String(tipo))
  }
})

// ── Firma de los avisos ─────────────────────────────────────────────────────

const SECRETO = 'secreto-compartido-de-prueba-001'
const ANTERIOR = 'secreto-anterior-de-prueba-0002'
const AHORA = new Date('2026-10-22T15:00:00Z')
const ts = (offsetS = 0) => Math.floor(AHORA.getTime() / 1000) + offsetS
const firmarV2 = (cuerpo: unknown, secreto = SECRETO) => createHmac('sha256', secreto).update(canonizar(cuerpo), 'utf8').digest('hex')
const firmarCruda = (crudo: string, secreto = SECRETO) => createHmac('sha256', secreto).update(crudo, 'utf8').digest('hex')
const aviso = (extra: Record<string, unknown> = {}) => ({
  event_id: 'evt-1', webhook_type: 'status.updated', timestamp: ts(), session_id: '11111111-2222-3333-4444-555555555555',
  status: 'Approved', vendor_data: INTENTO, decision: { id_verifications: [{ score: 100.0, nombre: 'Peña Núñez' }] }, ...extra,
})
const verificar = (crudo: string, cabeceras: Record<string, string | null>, secretos: string[] = [SECRETO], ahora = AHORA) =>
  verificarFirmaDeDidit({ cuerpoCrudo: crudo, cabeceras, secretos, ahora })

test('la forma canónica ordena las claves recursivamente, sin espacios, con Unicode sin escapar', () => {
  assert.equal(canonizar({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'ñ' } }), '{"a":{"c":"ñ","d":[3,{"y":2,"z":1}]},"b":1}')
  assert.equal(canonizar({ n: 100.0 }), '{"n":100}')
})

test('FIRMA V2 válida: se acepta aunque el cuerpo llegue con otro orden de claves y espacios (se firma lo canónico)', () => {
  const cuerpo = aviso()
  const bonito = JSON.stringify(Object.fromEntries(Object.entries(cuerpo).reverse()), null, 4)
  assert.deepEqual(verificar(bonito, { 'x-signature-v2': firmarV2(cuerpo) }), { ok: true })
})

test('la firma sobre los BYTES EXACTOS (X-Signature) también vale, para los casos en que la canónica difiere', () => {
  const crudo = JSON.stringify(aviso())
  assert.deepEqual(verificar(crudo, { 'x-signature': firmarCruda(crudo) }), { ok: true })
  assert.equal(verificar(crudo, { 'x-signature': firmarCruda(crudo + ' ') }).ok, false)
})

test('LA ROTACIÓN: vale cualquiera de los dos secretos, y uno desconocido no', () => {
  const cuerpo = aviso()
  const crudo = JSON.stringify(cuerpo)
  assert.equal(verificar(crudo, { 'x-signature-v2': firmarV2(cuerpo, ANTERIOR) }, [SECRETO, ANTERIOR]).ok, true)
  assert.equal(verificar(crudo, { 'x-signature-v2': firmarV2(cuerpo, ANTERIOR) }, [SECRETO]).ok, false)
  assert.equal(verificar(crudo, { 'x-signature-v2': firmarV2(cuerpo, 'otro-secreto-cualquiera-00000') }, [SECRETO, ANTERIOR]).ok, false)
})

test('UN CUERPO ALTERADO no pasa: cambiar el estado, el intento o la sesión rompe la firma', () => {
  const cuerpo = aviso()
  const firma = firmarV2(cuerpo)
  for (const cambio of [{ status: 'Declined' }, { vendor_data: 'otro-intento' }, { session_id: '99999999-2222-3333-4444-555555555555' }, { event_id: 'evt-2' }]) {
    const r = verificar(JSON.stringify({ ...cuerpo, ...cambio }), { 'x-signature-v2': firma })
    assert.equal(r.ok, false, JSON.stringify(cambio))
    assert.equal(!r.ok && r.codigo, 'FIRMA_INVALIDA')
  }
})

test('REPRODUCCIÓN: un aviso firmado de hace más de 5 minutos (o del futuro) se rechaza, y el instante va DENTRO de lo firmado', () => {
  const viejo = aviso({ timestamp: ts(-(TOLERANCIA_AVISO_S + 1)) })
  const r = verificar(JSON.stringify(viejo), { 'x-signature-v2': firmarV2(viejo) })
  assert.deepEqual([r.ok, !r.ok && r.codigo], [false, 'AVISO_VENCIDO'])
  const futuro = aviso({ timestamp: ts(TOLERANCIA_AVISO_S + 60) })
  assert.equal(verificar(JSON.stringify(futuro), { 'x-signature-v2': firmarV2(futuro) }).ok, false)
  const justo = aviso({ timestamp: ts(-(TOLERANCIA_AVISO_S - 5)) })
  assert.equal(verificar(JSON.stringify(justo), { 'x-signature-v2': firmarV2(justo) }).ok, true)
  // Mover la cabecera X-Timestamp no sirve de nada: lo que cuenta es el instante firmado.
  const reproducido = verificar(JSON.stringify(viejo), { 'x-signature-v2': firmarV2(viejo), 'x-timestamp': String(ts()) })
  assert.equal(reproducido.ok, false)
  // Sin instante firmado no hay frescura que comprobar: se rechaza.
  const sinTs = { ...aviso() } as Record<string, unknown>
  delete sinTs.timestamp
  assert.equal(verificar(JSON.stringify(sinTs), { 'x-signature-v2': firmarV2(sinTs) }).ok, false)
})

test('sin firma, sin secretos o con un cuerpo que no es JSON, nada pasa', () => {
  const cuerpo = aviso()
  const crudo = JSON.stringify(cuerpo)
  assert.equal(verificar(crudo, {}).ok, false)
  assert.equal(verificar(crudo, { 'x-signature-v2': '' }).ok, false)
  const sin = verificarFirmaDeDidit({ cuerpoCrudo: crudo, cabeceras: { 'x-signature-v2': firmarV2(cuerpo) }, secretos: [], ahora: AHORA })
  assert.deepEqual([sin.ok, !sin.ok && sin.codigo], [false, 'SIN_SECRETOS'])
  assert.equal(verificar('no es json', { 'x-signature': firmarCruda('no es json') }).ok, false)
  assert.equal(verificar('[1,2]', { 'x-signature': firmarCruda('[1,2]') }).ok, false)
  // X-Signature-Simple (no cubre la decisión) NO se acepta.
  const simple = createHmac('sha256', SECRETO).update(`${cuerpo.timestamp}:${cuerpo.session_id}:${cuerpo.status}:${cuerpo.webhook_type}`).digest('hex')
  assert.equal(verificar(crudo, { 'x-signature-simple': simple }).ok, false)
})

test('la firma en mayúsculas y con espacios se normaliza, y una de otra longitud no lanza (comparación de tiempo constante)', () => {
  const cuerpo = aviso()
  const crudo = JSON.stringify(cuerpo)
  assert.equal(verificar(crudo, { 'x-signature-v2': `  ${firmarV2(cuerpo).toUpperCase()} ` }).ok, true)
  assert.doesNotThrow(() => verificar(crudo, { 'x-signature-v2': 'abc' }))
  assert.equal(verificar(crudo, { 'x-signature-v2': 'abc' }).ok, false)
})

// ── Lectura del aviso ───────────────────────────────────────────────────────

test('del aviso solo se toma lo necesario; sin event_id o tipo no se puede registrar', () => {
  assert.deepEqual(leerAviso(aviso()), {
    eventoId: 'evt-1', tipo: 'status.updated', estado: 'Approved', sesionId: '11111111-2222-3333-4444-555555555555', intentoId: INTENTO,
  })
  assert.equal(leerAviso({ webhook_type: 'status.updated' }), null)
  assert.equal(leerAviso({ event_id: 'x' }), null)
  assert.equal(leerAviso({ event_id: 'x'.repeat(101), webhook_type: 'status.updated' }), null)
  assert.equal(leerAviso('texto'), null)
  assert.equal(leerAviso(null), null)
  assert.equal(leerAviso([]), null)
  assert.ok(MAX_BYTES_AVISO >= 64 * 1024)
})

// ── El interruptor automático ───────────────────────────────────────────────

test('el circuito se abre tras N fallos seguidos, falla al instante y deja pasar UNA prueba tras el enfriamiento', () => {
  let t = 1_000_000
  const c = new Circuito({ umbralDeFallos: 3, enfriamientoMs: 10_000 }, () => t)
  assert.equal(c.estado(), 'cerrado')
  for (let i = 0; i < 2; i++) {
    assert.equal(c.puedeLlamar(), true)
    c.registrarFallo()
  }
  assert.equal(c.estado(), 'cerrado', 'dos fallos no bastan')
  c.puedeLlamar()
  c.registrarFallo()
  assert.equal(c.estado(), 'abierto')
  assert.equal(c.puedeLlamar(), false)
  assert.equal(c.reintentarEnSegundos(), 10)

  t += 4_000
  assert.equal(c.puedeLlamar(), false)
  assert.equal(c.reintentarEnSegundos(), 6)

  t += 6_000
  assert.equal(c.estado(), 'semiabierto')
  assert.equal(c.puedeLlamar(), true, 'una llamada de prueba')
  assert.equal(c.puedeLlamar(), false, 'solo una a la vez')
  c.registrarFallo() // la prueba falla: vuelve a abrirse con enfriamiento nuevo
  assert.equal(c.estado(), 'abierto')

  t += 10_000
  assert.equal(c.puedeLlamar(), true)
  c.registrarExito()
  assert.equal(c.estado(), 'cerrado')
  assert.equal(c.puedeLlamar(), true)
  assert.equal(c.reintentarEnSegundos(), 0)
})

test('un éxito entre fallos reinicia la cuenta: fallos salteados no abren el circuito', () => {
  const c = new Circuito({ umbralDeFallos: 3, enfriamientoMs: 10_000 }, () => 0)
  for (let i = 0; i < 10; i++) {
    c.puedeLlamar()
    c.registrarFallo()
    c.puedeLlamar()
    c.registrarFallo()
    c.puedeLlamar()
    c.registrarExito()
  }
  assert.equal(c.estado(), 'cerrado')
})

test('ErrorDeProveedor: solo «no disponible» y «circuito abierto» se reintentan', () => {
  assert.equal(new ErrorDeProveedor('no_disponible', 'x').reintentable, true)
  assert.equal(new ErrorDeProveedor('circuito_abierto', 'x').reintentable, true)
  for (const c of ['rechazado', 'respuesta_invalida', 'no_configurado'] as const) assert.equal(new ErrorDeProveedor(c, 'x').reintentable, false, c)
})
