/**
 * VERIFICACIÓN DE IDENTIDAD · Fase 3 · la pantalla web se PINTA en cada estado (render del servidor, sin navegador).
 *
 * No necesita base de datos ni navegador: el shim de las pruebas de dominio sustituye lo que solo existe dentro de Next
 * (el router, `next/headers`, `server-only`). Comprueba lo que una persona vería: el estado dicho con
 * texto, el botón que corresponde, los permisos con su texto exacto y SIN marcar, y que lo que no debe salir no sale.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// El shim va PRIMERO: sustituye next/navigation (useRouter), next/headers y server-only, que los componentes arrastran.
import '../scripts/supply-db/shim-next.mjs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { VerificacionIdentidad } from '../src/components/cliente/identidad/VerificacionIdentidad'
import { ResumenIdentidad } from '../src/components/cliente/identidad/ResumenIdentidad'
import { construirVista, consentimientosParaPantalla, PASOS_DE_VERIFICACION, puntosDePrivacidad, TIPOS_DE_INCIDENCIA, AVISO_DE_INCIDENCIA, MAX_MENSAJE_INCIDENCIA, URL_CONDICIONES_IDENTIDAD } from '../src/modules/identidad/vistaCore'
import { mensajeParaUsuario, type EstadoIdentidadPublico } from '../src/modules/identidad/identidadCore'
import type { PanelDeIdentidad } from '../src/modules/identidad/identidadPuerta'

const AHORA = new Date('2026-10-22T15:00:00Z')

function estado(p: Partial<EstadoIdentidadPublico> = {}): EstadoIdentidadPublico {
  return { estado: 'no_verificada', nivel: null, verificadaEn: null, expiraEn: null, diasParaExpirar: null, revalidacionProxima: false, intentoAbierto: null, ultimoRechazo: null, puedeIniciar: true, motivoNoPuedeIniciar: null, esperarHasta: null, ...p }
}

function panel(e: EstadoIdentidadPublico, opciones: { vigentes?: boolean; tieneDatos?: boolean; visible?: boolean; incidencias?: number } = {}): PanelDeIdentidad {
  const consentimientos = consentimientosParaPantalla(
    new Map(opciones.vigentes ? [['IDENTIDAD_BIOMETRIA', 'identidad-biometria-v1'], ['IDENTIDAD_TRANSFERENCIA_INTERNACIONAL', 'identidad-transferencia-v1']] as const : [])
  )
  return {
    visible: opciones.visible ?? true,
    vista: construirVista(e, { consentimientosObligatoriosVigentes: !!opciones.vigentes, tieneDatos: !!opciones.tieneDatos, ahora: AHORA }),
    intentoId: e.intentoAbierto?.id ?? null,
    consentimientos,
    pasos: PASOS_DE_VERIFICACION,
    privacidad: puntosDePrivacidad(),
    urlCondiciones: URL_CONDICIONES_IDENTIDAD,
    proveedor: 'Didit',
    tiposDeIncidencia: TIPOS_DE_INCIDENCIA,
    avisoDeIncidencia: AVISO_DE_INCIDENCIA,
    maxMensajeIncidencia: MAX_MENSAJE_INCIDENCIA,
    incidenciasAbiertas: Array.from({ length: opciones.incidencias ?? 0 }, (_, i) => ({ id: `inc${i}`, etiqueta: 'No puedo completar la verificación', desde: '22 de octubre de 2026' })),
    soporte: { email: 'contacto@membego.com', whatsapp: '+1 829 961 8220' },
  }
}

function html(p: PanelDeIdentidad, retorno = false): string {
  return renderToStaticMarkup(React.createElement(VerificacionIdentidad, { panel: p, retorno }))
}
const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ')

test('SIN VERIFICAR: explica el proceso, pide los tres permisos sin marcar y el botón no se ofrece habilitado', () => {
  const h = html(panel(estado()))
  const t = texto(h)
  assert.match(t, /Sin verificar/)
  assert.match(t, /Verifica tu identidad/)
  assert.match(t, /opcional: no hace falta para comprar ni para usar tus membresías/)
  assert.match(t, /Verificar mi identidad/)
  assert.match(t, /Cómo funciona/)
  assert.match(t, /Tu privacidad/)
  assert.match(t, /Didit procesa tus datos en la Unión Europea/)
  // Tres casillas: ninguna marcada, la última opcional.
  const casillas = [...h.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((m) => m[0])
  assert.equal(casillas.length, 3)
  assert.ok(casillas.every((c) => !/checked/.test(c)), 'ninguna casilla viene marcada')
  assert.match(t, /\(opcional\)/)
  // El texto exacto del permiso y la versión que se registrará.
  assert.match(h, /name="version:IDENTIDAD_BIOMETRIA" value="identidad-biometria-v1"/)
  assert.match(t, /Autorizo a MembeGo, a través de Didit/)
  // Sin las obligatorias, el botón de enviar está deshabilitado.
  const botonDeEmpezar = [...h.matchAll(/<button[^>]*>[^<]*(?:<[^>]+>[^<]*)*?Verificar mi identidad/g)].at(-1)?.[0] ?? ''
  assert.match(botonDeEmpezar, /\bdisabled\b/, 'sin los permisos obligatorios el botón de empezar está deshabilitado')
  assert.match(h, /href="\/privacy#verificacion-identidad"/)
})

test('VERIFICADA: éxito con sus fechas, sin botón de empezar, con qué ven los negocios y con borrar', () => {
  const p = panel(estado({ estado: 'verificada', nivel: 'documento_selfie', verificadaEn: new Date('2026-10-20T15:00:00Z'), expiraEn: new Date('2029-10-20T15:00:00Z'), diasParaExpirar: 1094 }), { vigentes: true, tieneDatos: true })
  const t = texto(html(p))
  assert.match(t, /Verificada/)
  assert.match(t, /Tu identidad está verificada/)
  assert.match(t, /La verificaste el 20 de octubre de 2026\. Vale hasta el 20 de octubre de 2029\./)
  assert.doesNotMatch(t, /Verificar mi identidad|Continuar verificación|Intentar de nuevo/)
  assert.match(t, /Qué ven los negocios/)
  assert.match(t, /Permitir que lo vean/)
  assert.match(t, /Borrar mis datos de verificación/)
})

test('EN PROCESO y EN REVISIÓN: se dice que se espera y que la pantalla se actualiza; sin botón de empezar', () => {
  const proceso = texto(html(panel(estado({ intentoAbierto: { id: 'i1', estado: 'en_proceso' }, puedeIniciar: false }), { vigentes: true })))
  assert.match(proceso, /Estamos procesando tu verificación/)
  assert.match(proceso, /Comprobando el estado/)
  assert.doesNotMatch(proceso, /Verificar mi identidad|Continuar verificación/)
  const pr = panel(estado({ intentoAbierto: { id: 'i1', estado: 'en_revision' }, puedeIniciar: false }), { vigentes: true })
  assert.match(texto(html(pr)), /Estamos revisando tu verificación/)
  assert.doesNotMatch(`${pr.vista.titulo} ${pr.vista.descripcion}`, /duplic|otra cuenta|fraude/i, 'el estado no dice por qué está en revisión')
})

test('A MEDIAS: se ofrece continuar, sin volver a pedir los permisos ya dados', () => {
  const h = html(panel(estado({ intentoAbierto: { id: 'i1', estado: 'iniciada' }, puedeIniciar: false }), { vigentes: true }))
  assert.match(texto(h), /Continuar verificación/)
  assert.equal([...h.matchAll(/type="checkbox"/g)].length, 0, 'ya están dados: no se piden otra vez')
  assert.equal(panel(estado({ intentoAbierto: { id: 'i1', estado: 'iniciada' }, puedeIniciar: false }), { vigentes: true }).intentoId, 'i1', 'un reporte se refiere a este intento')
})

test('RECHAZO REINTENTABLE: el motivo en español y reintentar; RECHAZO DEFINITIVO: sin motivo, sin reintentar y con «contar mi problema»', () => {
  const blando = texto(html(panel(estado({ ultimoRechazo: { reintentable: true, codigo: 'ROSTRO_NO_COINCIDE', mensaje: mensajeParaUsuario('ROSTRO_NO_COINCIDE') } }), { vigentes: true, tieneDatos: true })))
  assert.match(blando, /La selfie no coincide con la foto del documento/)
  assert.match(blando, /Intentar de nuevo/)
  const pd = panel(estado({ ultimoRechazo: { reintentable: false, codigo: null, mensaje: mensajeParaUsuario('SOSPECHA_DE_FRAUDE') }, puedeIniciar: false }), { vigentes: true, tieneDatos: true })
  const t = texto(html(pd))
  assert.match(t, /No pudimos verificar tu identidad/)
  assert.match(t, /Contacta a soporte/)
  assert.doesNotMatch(t, /Intentar de nuevo/, 'no se ofrece reintentar')
  assert.doesNotMatch(`${pd.vista.titulo} ${pd.vista.descripcion} ${pd.vista.aviso?.texto ?? ''}`, /fraude|falsific|alterad|attack/i, 'el estado no dice qué señal saltó')
  assert.match(t, /Contar mi problema/)
  assert.match(t, /contacto@membego\.com/)
})

test('LA ESPERA TRAS UN RECHAZO dice la hora, sin botón', () => {
  const t = texto(html(panel(estado({ ultimoRechazo: { reintentable: true, codigo: 'DOCUMENTO_ILEGIBLE', mensaje: mensajeParaUsuario('DOCUMENTO_ILEGIBLE') }, puedeIniciar: false, motivoNoPuedeIniciar: 'espera', esperarHasta: new Date('2026-10-22T15:05:00Z') }), { vigentes: true, tieneDatos: true })))
  assert.match(t, /Podrás intentarlo de nuevo a las 11:05/)
  assert.doesNotMatch(t, /Intentar de nuevo<|Verificar mi identidad/)
})

test('AL VOLVER DEL PROVEEDOR se avisa que se está comprobando el resultado', () => {
  const t = texto(html(panel(estado({ intentoAbierto: { id: 'i1', estado: 'en_proceso' }, puedeIniciar: false }), { vigentes: true }), true))
  assert.match(t, /Volviste de la verificación/)
  assert.match(t, /Esta pantalla se actualiza sola/)
  // Y verificada ya no lo dice: el resultado habla por sí solo.
  const ok = texto(html(panel(estado({ estado: 'verificada', verificadaEn: AHORA, expiraEn: new Date('2029-10-22T15:00:00Z'), diasParaExpirar: 1095 }), { vigentes: true, tieneDatos: true }), true))
  assert.doesNotMatch(ok, /Volviste de la verificación/)
})

test('LOS REPORTES abiertos se listan con su tipo y fecha (nunca el texto de la persona)', () => {
  const h = html(panel(estado({ ultimoRechazo: { reintentable: false, codigo: null, mensaje: mensajeParaUsuario('SOSPECHA_DE_FRAUDE') }, puedeIniciar: false }), { vigentes: true, tieneDatos: true, incidencias: 2 }))
  const t = texto(h)
  assert.equal([...t.matchAll(/Reporte abierto desde el 22 de octubre de 2026/g)].length, 2)
  assert.match(t, /Lo estamos revisando/)
})

test('EL RESUMEN de Configuración: el estado y un botón a la pantalla; nada si la verificación no se ofrece', () => {
  const sin = renderToStaticMarkup(React.createElement(ResumenIdentidad, { panel: panel(estado()) }))
  assert.match(texto(sin), /Sin verificar/)
  assert.match(sin, /href="\/cliente\/identidad"/)
  assert.match(texto(sin), /Verificar mi identidad/)
  const ok = renderToStaticMarkup(React.createElement(ResumenIdentidad, { panel: panel(estado({ estado: 'verificada', verificadaEn: AHORA, expiraEn: new Date('2029-10-22T15:00:00Z'), diasParaExpirar: 1095 }), { vigentes: true }) }))
  assert.match(texto(ok), /Ver detalles/)
  assert.equal(renderToStaticMarkup(React.createElement(ResumenIdentidad, { panel: panel(estado(), { visible: false }) })), '')
  assert.equal(renderToStaticMarkup(React.createElement(ResumenIdentidad, { panel: null })), '')
})

test('ACCESIBILIDAD: las casillas están asociadas a su texto, el estado se anuncia y los controles miden al menos 44 px', () => {
  const h = html(panel(estado()))
  for (const m of h.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)) {
    assert.match(m[0], /id="[^"]+"/)
    assert.match(m[0], /aria-describedby="[^"]+"/)
  }
  assert.match(h, /aria-live="polite"/)
  assert.ok((h.match(/min-h-11/g) ?? []).length >= 4)
  assert.match(h, /<summary[^>]*min-h-11/)
})
