/**
 * VERIFICACIÓN DE IDENTIDAD · Fase 3 · lo que la persona VE, sin pantallas ni base de datos.
 *
 * La web y la app móvil no deciden nada: pintan la vista que arma `vistaCore.ts`. Por eso aquí se
 * prueba cada estado con valores: qué se dice, qué botón se ofrece y qué NO se dice nunca.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CODIGOS_RAZON,
  POLITICA_IDENTIDAD,
  mensajeParaUsuario,
  type EstadoIdentidadPublico,
} from '../src/modules/identidad/identidadCore'
import {
  TIPOS_CONSENTIMIENTO_IDENTIDAD,
  VERSION_VIGENTE,
  type TipoConsentimientoIdentidad,
} from '../src/modules/identidad/identidadConsentimientosCore'
import {
  AVISO_DE_INCIDENCIA,
  MAX_INCIDENCIAS_ABIERTAS,
  MAX_MENSAJE_INCIDENCIA,
  PASOS_DE_VERIFICACION,
  TIPOS_DE_INCIDENCIA,
  consentimientosParaPantalla,
  construirVista,
  esTipoDeIncidencia,
  fechaLarga,
  horaCorta,
  mensajeDeNoPudoEmpezar,
  puntosDePrivacidad,
} from '../src/modules/identidad/vistaCore'
import { avisaEsteResultado, claveDeAviso, redactarAvisoDeIdentidad } from '../src/modules/identidad/avisosCore'
import { armarCorreoDeIdentidad } from '../src/modules/identidad/correoAviso'

const AHORA = new Date('2026-10-22T15:00:00Z')
const DIA = 24 * 60 * 60 * 1000

function estado(parche: Partial<EstadoIdentidadPublico> = {}): EstadoIdentidadPublico {
  return {
    estado: 'no_verificada',
    nivel: null,
    verificadaEn: null,
    expiraEn: null,
    diasParaExpirar: null,
    revalidacionProxima: false,
    intentoAbierto: null,
    ultimoRechazo: null,
    puedeIniciar: true,
    motivoNoPuedeIniciar: null,
    esperarHasta: null,
    ...parche,
  }
}
const ctx = (p: Partial<Parameters<typeof construirVista>[1]> = {}) => ({ consentimientosObligatoriosVigentes: false, tieneDatos: false, ahora: AHORA, ...p })

// ── Cada estado, dicho con texto ────────────────────────────────────────────

test('SIN VERIFICAR: se ofrece verificar, se dice que es OPCIONAL y se piden los consentimientos si faltan', () => {
  const v = construirVista(estado(), ctx())
  assert.deepEqual([v.tono, v.etiqueta, v.accion, v.textoAccion, v.requiereConsentimientos], ['neutro', 'Sin verificar', 'verificar', 'Verificar mi identidad', true])
  assert.match(v.descripcion, /opcional/)
  assert.match(v.descripcion, /no hace falta para comprar ni para usar tus membresías/)
  assert.equal(v.sondear, false)
  assert.equal(v.puedeBorrar, false)
  // Con los consentimientos ya dados no se vuelven a pedir.
  assert.equal(construirVista(estado(), ctx({ consentimientosObligatoriosVigentes: true })).requiereConsentimientos, false)
})

test('VERIFICADA: éxito con sus fechas, sin botón, y se puede decidir qué ven los negocios', () => {
  const v = construirVista(
    estado({ estado: 'verificada', nivel: 'documento_selfie', verificadaEn: new Date('2026-10-20T15:00:00Z'), expiraEn: new Date('2029-10-20T15:00:00Z'), diasParaExpirar: 1094 }),
    ctx({ consentimientosObligatoriosVigentes: true, tieneDatos: true })
  )
  assert.deepEqual([v.tono, v.etiqueta, v.accion, v.mostrarDivulgacion, v.puedeBorrar], ['exito', 'Verificada', 'ninguna', true, true])
  assert.match(v.descripcion, /La verificaste el 20 de octubre de 2026\. Vale hasta el 20 de octubre de 2029\./)
  assert.equal(v.aviso, null, 'lejos del vencimiento no hay aviso')
  assert.equal(v.requiereConsentimientos, false)
})

test('VERIFICADA y a punto de vencer: aviso con los días, en singular y plural', () => {
  const base = { estado: 'verificada' as const, verificadaEn: new Date('2023-10-25T15:00:00Z'), expiraEn: new Date('2026-11-21T15:00:00Z'), revalidacionProxima: true }
  assert.match(construirVista(estado({ ...base, diasParaExpirar: 30 }), ctx()).aviso?.texto ?? '', /vence en 30 días/)
  assert.match(construirVista(estado({ ...base, diasParaExpirar: 1 }), ctx()).aviso?.texto ?? '', /vence en 1 día\./)
  assert.match(construirVista(estado({ ...base, diasParaExpirar: 0 }), ctx()).aviso?.texto ?? '', /vence hoy/)
})

test('EN PROCESO y EN REVISIÓN: se espera, sin botón, la pantalla sondea y se puede reportar un problema', () => {
  for (const intento of ['enviada', 'en_proceso'] as const) {
    const v = construirVista(estado({ intentoAbierto: { id: 'i1', estado: intento }, puedeIniciar: false, motivoNoPuedeIniciar: 'intento_abierto' }), ctx({ consentimientosObligatoriosVigentes: true }))
    assert.deepEqual([v.tono, v.etiqueta, v.accion, v.textoAccion, v.sondear, v.puedeReportar], ['info', 'En proceso', 'esperar', null, true, true], intento)
  }
  const r = construirVista(estado({ intentoAbierto: { id: 'i1', estado: 'en_revision' }, puedeIniciar: false, motivoNoPuedeIniciar: 'intento_abierto' }), ctx())
  assert.deepEqual([r.etiqueta, r.accion, r.sondear], ['En revisión', 'esperar', true])
  assert.match(r.descripcion, /Te avisaremos/)
  assert.doesNotMatch(r.descripcion, /duplic|otra cuenta|fraude/i, 'la revisión no dice por qué')
})

test('A MEDIAS: se ofrece CONTINUAR (y repetir un paso si el proveedor lo pidió)', () => {
  for (const intento of ['creada', 'iniciada'] as const) {
    const v = construirVista(estado({ intentoAbierto: { id: 'i1', estado: intento }, puedeIniciar: false, motivoNoPuedeIniciar: 'intento_abierto' }), ctx({ consentimientosObligatoriosVigentes: true }))
    assert.deepEqual([v.etiqueta, v.accion, v.textoAccion], ['Pendiente', 'continuar', 'Continuar verificación'], intento)
    assert.match(v.titulo, /a medias/)
  }
  const r = construirVista(estado({ intentoAbierto: { id: 'i1', estado: 'reenvio_requerido' }, puedeIniciar: false }), ctx({ consentimientosObligatoriosVigentes: true }))
  assert.match(r.titulo, /repitas un paso/)
})

test('RECHAZO REINTENTABLE: el motivo en español y «Intentar de nuevo»; en espera, la hora; al tope, soporte', () => {
  const rechazo = { reintentable: true, codigo: 'ROSTRO_NO_COINCIDE' as const, mensaje: mensajeParaUsuario('ROSTRO_NO_COINCIDE') }
  const puede = construirVista(estado({ ultimoRechazo: rechazo }), ctx({ consentimientosObligatoriosVigentes: true }))
  assert.deepEqual([puede.tono, puede.accion, puede.textoAccion], ['aviso', 'reintentar', 'Intentar de nuevo'])
  assert.match(puede.descripcion, /selfie no coincide/)

  const espera = construirVista(
    estado({ ultimoRechazo: rechazo, puedeIniciar: false, motivoNoPuedeIniciar: 'espera', esperarHasta: new Date('2026-10-22T15:05:00Z') }),
    ctx({ consentimientosObligatoriosVigentes: true })
  )
  assert.deepEqual([espera.accion, espera.textoAccion, espera.requiereConsentimientos], ['esperar', null, false])
  assert.match(espera.aviso?.texto ?? '', /Podrás intentarlo de nuevo a las 11:05/, 'en la hora de Santo Domingo (UTC-4)')

  const tope = construirVista(estado({ ultimoRechazo: rechazo, puedeIniciar: false, motivoNoPuedeIniciar: 'demasiados_rechazos' }), ctx({ consentimientosObligatoriosVigentes: true }))
  assert.deepEqual([tope.accion, tope.puedeReportar], ['contactar', true])
  assert.match(tope.aviso?.texto ?? '', /límite de intentos de esta semana/)
})

test('RECHAZO DEFINITIVO: no se explica el motivo, no se ofrece reintentar y se ofrece contar el problema', () => {
  const v = construirVista(
    estado({ ultimoRechazo: { reintentable: false, codigo: null, mensaje: mensajeParaUsuario('SOSPECHA_DE_FRAUDE') }, puedeIniciar: false, motivoNoPuedeIniciar: 'bloqueada_por_rechazo_definitivo' }),
    ctx({ consentimientosObligatoriosVigentes: true })
  )
  assert.deepEqual([v.tono, v.accion, v.textoAccion, v.puedeReportar], ['peligro', 'contactar', 'Contar mi problema', true])
  assert.doesNotMatch(JSON.stringify(v), /fraude|falsific|alterad|liveness|attack/i)
  assert.match(v.descripcion, /soporte/)
})

test('VENCIDA, REVALIDACIÓN y RETIRADA: se puede volver a verificar (o contar el problema si no se puede)', () => {
  const vencida = construirVista(estado({ estado: 'expirada' }), ctx({ consentimientosObligatoriosVigentes: true }))
  assert.deepEqual([vencida.etiqueta, vencida.accion, vencida.textoAccion], ['Vencida', 'verificar', 'Verificar de nuevo'])
  assert.match(vencida.descripcion, new RegExp(`vale ${POLITICA_IDENTIDAD.validezMeses / 12} años`))
  assert.equal(construirVista(estado({ estado: 'requiere_revalidacion' }), ctx({ consentimientosObligatoriosVigentes: true })).accion, 'verificar')
  const retirada = construirVista(estado({ estado: 'revocada', puedeIniciar: true }), ctx({ consentimientosObligatoriosVigentes: true }))
  assert.deepEqual([retirada.tono, retirada.accion, retirada.puedeReportar], ['peligro', 'verificar', true])
  assert.equal(construirVista(estado({ estado: 'revocada', puedeIniciar: false }), ctx()).accion, 'contactar')
})

test('el estado se dice SIEMPRE con texto (principio P3), y nunca se promete lo que no se hace', () => {
  const todos = [
    estado(),
    estado({ estado: 'verificada', verificadaEn: AHORA, expiraEn: new Date(AHORA.getTime() + 3 * 365 * DIA), diasParaExpirar: 1095 }),
    estado({ estado: 'expirada' }),
    estado({ estado: 'revocada' }),
    estado({ intentoAbierto: { id: 'i', estado: 'en_proceso' } }),
    estado({ ultimoRechazo: { reintentable: true, codigo: 'DOCUMENTO_VENCIDO', mensaje: mensajeParaUsuario('DOCUMENTO_VENCIDO') } }),
  ]
  for (const e of todos) {
    const v = construirVista(e, ctx())
    assert.ok(v.etiqueta.length > 2 && v.titulo.length > 5 && v.descripcion.length > 10, JSON.stringify(v))
    assert.doesNotMatch(JSON.stringify(v), /garantiz|100 ?%|nunca (se )?comparte|conserv\w+ (tu|la|las) (foto|selfie|cédula)/i)
  }
})

// ── Privacidad, pasos, consentimientos, errores ─────────────────────────────

test('la información de privacidad sale de la política: el plazo es el del sistema y nombra al proveedor, la UE y el borrado', () => {
  const t = puntosDePrivacidad().join('\n')
  assert.match(t, new RegExp(`durante ${POLITICA_IDENTIDAD.validezMeses / 12} años`))
  assert.match(t, /Didit procesa tus datos en la Unión Europea/)
  assert.match(t, /elimina las imágenes y los datos biométricos al concluir/)
  assert.match(t, /Nunca ven tu cédula ni tu selfie/)
  assert.match(t, /borremos tus datos de verificación cuando quieras/)
  // Si cambia la política, cambia el texto (no hay un «3» escrito a mano).
  assert.match(puntosDePrivacidad({ ...POLITICA_IDENTIDAD, validezMeses: 60 }).join(' '), /durante 5 años/)
  assert.equal(PASOS_DE_VERIFICACION.length, 3)
})

test('los consentimientos de la pantalla traen el texto REGISTRADO con su versión, y marcan cuáles ya están dados', () => {
  const nada = consentimientosParaPantalla(new Map())
  assert.deepEqual(nada.map((c) => c.tipo), [...TIPOS_CONSENTIMIENTO_IDENTIDAD])
  assert.deepEqual(nada.filter((c) => c.obligatorio).map((c) => c.tipo), ['IDENTIDAD_BIOMETRIA', 'IDENTIDAD_TRANSFERENCIA_INTERNACIONAL'])
  assert.ok(nada.every((c) => !c.vigente && c.titulo.length > 10 && c.detalle.length > 10 && c.textoVersion === VERSION_VIGENTE[c.tipo]))
  assert.match(nada[0].titulo + nada[0].detalle, /Didit/)
  assert.doesNotMatch(JSON.stringify(nada), /\{proveedor\}/)

  const dados = new Map<TipoConsentimientoIdentidad, string>([
    ['IDENTIDAD_BIOMETRIA', VERSION_VIGENTE.IDENTIDAD_BIOMETRIA],
    ['IDENTIDAD_TRANSFERENCIA_INTERNACIONAL', 'identidad-transferencia-v0'], // de un texto que ya no es el vigente
  ])
  const parcial = consentimientosParaPantalla(dados)
  assert.deepEqual(parcial.map((c) => c.vigente), [true, false, false], 'un permiso de un texto anterior no cuenta: hay que volver a darlo')
})

test('cada motivo de «no se pudo empezar» tiene su mensaje en español; ninguno es un código técnico', () => {
  for (const m of ['falta_consentimiento', 'espera', 'demasiados_rechazos', 'bloqueada_por_rechazo_definitivo', 'ya_verificada', 'en_revision', 'no_habilitada', 'proveedor_no_disponible', 'persona_no_encontrada', 'texto_cambio', 'demasiadas_solicitudes', 'lo_que_sea']) {
    const t = mensajeDeNoPudoEmpezar(m)
    assert.ok(t.length > 15 && /[a-záéíóú]/.test(t) && !/_/.test(t), `${m}: ${t}`)
  }
  assert.match(mensajeDeNoPudoEmpezar('espera', new Date('2026-10-22T15:05:00Z')), /11:05/)
})

test('las fechas se escriben en español y en la hora de Santo Domingo', () => {
  assert.equal(fechaLarga(new Date('2026-10-22T02:00:00Z')), '21 de octubre de 2026', 'a las 2 a. m. UTC todavía es el día anterior en RD')
  assert.match(horaCorta(new Date('2026-10-22T15:45:00Z')), /11:45/)
})

test('las incidencias: tipos cerrados, límites y el aviso de no escribir la cédula', () => {
  assert.deepEqual(TIPOS_DE_INCIDENCIA.map((t) => t.valor), ['no_puedo_completar', 'rechazo_incorrecto', 'datos_incorrectos', 'otro'])
  assert.equal(esTipoDeIncidencia('otro'), true)
  assert.equal(esTipoDeIncidencia('hackear'), false)
  assert.equal(esTipoDeIncidencia(undefined), false)
  assert.ok(MAX_MENSAJE_INCIDENCIA >= 200 && MAX_INCIDENCIAS_ABIERTAS >= 1 && MAX_INCIDENCIAS_ABIERTAS <= 5)
  assert.match(AVISO_DE_INCIDENCIA, /cédula/)
})

// ── Los avisos ──────────────────────────────────────────────────────────────

test('avisan solo los resultados que la persona espera, y la clave es única por intento y resultado', () => {
  for (const r of ['aprobada', 'rechazada_reintentable', 'rechazada_definitiva', 'en_revision']) assert.equal(avisaEsteResultado(r), true, r)
  for (const r of ['creada', 'iniciada', 'enviada', 'en_proceso', 'reenvio_requerido', 'expirada', 'abandonada', 'cancelada']) assert.equal(avisaEsteResultado(r), false, r)
  assert.equal(claveDeAviso('int1', 'aprobada'), 'identidad:int1:aprobada')
  assert.notEqual(claveDeAviso('int1', 'en_revision'), claveDeAviso('int1', 'aprobada'), 'una revisión y su resolución son dos avisos')
})

test('EL AVISO NO FILTRA lo que no debe: ni el fraude, ni el documento repetido, ni datos personales', () => {
  const aprobada = redactarAvisoDeIdentidad('aprobada', null)
  assert.deepEqual([aprobada.tipoNotificacion, aprobada.tono], ['IDENTIDAD_VERIFICADA', 'exito'])
  const revision = redactarAvisoDeIdentidad('en_revision', 'IDENTIDAD_DUPLICADA')
  assert.equal(revision.tipoNotificacion, 'IDENTIDAD_EN_REVISION')
  assert.doesNotMatch(JSON.stringify(revision), /otra cuenta|duplic|asociado/i, 'no se dice que el documento ya está en otra cuenta')

  for (const codigo of ['SOSPECHA_DE_FRAUDE', 'SOSPECHA_DE_DOCUMENTO_ALTERADO']) {
    const a = redactarAvisoDeIdentidad('rechazada_definitiva', codigo)
    assert.equal(a.tipoNotificacion, 'IDENTIDAD_RECHAZADA')
    assert.doesNotMatch(JSON.stringify(a), /fraude|falsific|alterad|copia|pantalla/i, codigo)
    assert.match(a.mensaje, /soporte/)
    assert.equal(a.boton, 'Contar mi problema')
  }
  const reintentable = redactarAvisoDeIdentidad('rechazada_reintentable', 'DOCUMENTO_VENCIDO')
  assert.match(reintentable.mensaje, /vencido/)
  assert.equal(reintentable.boton, 'Intentar de nuevo')
  // Un código que el catálogo no conoce cae en el genérico: nunca texto del proveedor.
  assert.equal(redactarAvisoDeIdentidad('rechazada_reintentable', 'LOW_FACE_MATCH_SIMILARITY').parrafos[0], CODIGOS_RAZON.RECHAZO_GENERICO.mensaje)
  for (const r of ['aprobada', 'en_revision', 'rechazada_reintentable', 'rechazada_definitiva'] as const) {
    const a = redactarAvisoDeIdentidad(r, 'ROSTRO_NO_COINCIDE')
    assert.equal(a.href, '/cliente/identidad')
    assert.doesNotMatch(JSON.stringify(a), /cédula \d|\d{3}-\d{7}|@/, r)
  }
})

test('EL CORREO: sin datos personales, con el botón a la pantalla de identidad, escapado, y sin enlace roto si falta la URL base', () => {
  const aviso = redactarAvisoDeIdentidad('aprobada', null)
  const { html, text } = armarCorreoDeIdentidad(aviso, { urlBase: 'https://app.membego.test/' })
  assert.match(html, /href="https:\/\/app\.membego\.test\/cliente\/identidad"/)
  assert.match(text, /Ver mi verificación: https:\/\/app\.membego\.test\/cliente\/identidad/)
  assert.doesNotMatch(html + text, /undefined|null/)
  const sin = armarCorreoDeIdentidad(aviso, {})
  assert.doesNotMatch(sin.html, /<a /)
  assert.doesNotMatch(sin.text, /http/)
  const hostil = armarCorreoDeIdentidad({ ...aviso, titulo: '<script>x</script>', parrafos: ['"><img src=x>'] }, {})
  assert.doesNotMatch(hostil.html, /<script>|<img/)
})
