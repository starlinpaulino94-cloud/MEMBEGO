/**
 * Soporte · esquemas Zod — validación de tickets, FAQ y configuración
 * (`src/modules/soporte/schema.ts`).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  configComunicacionSchema,
  correoPruebaSchema,
  faqSchema,
  faqActualizarSchema,
  responderTicketSchema,
  notaInternaSchema,
  cambiarEstadoTicketSchema,
  responderClienteSchema,
  crearTicketSchema,
} from '../src/modules/soporte/schema'

const SUPABASE_URL = 'https://proyecto.supabase.co'

function crearTicket(v: Record<string, string>) {
  const anterior = process.env.NEXT_PUBLIC_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL
  try {
    return crearTicketSchema.safeParse({
      asunto: 'No puedo pagar',
      descripcion: 'La pasarela se cae',
      categoria: 'OTRO',
      adjuntoUrl: '',
      ...v,
    })
  } finally {
    if (anterior === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = anterior
  }
}

test('crearTicket válido: categoría válida se conserva', () => {
  const r = crearTicket({ categoria: 'PAGO' })
  assert.equal(r.success, true)
  if (!r.success) return
  assert.equal(r.data.categoria, 'PAGO')
  assert.equal(r.data.adjuntoUrl, null)
})

test('crearTicket: categoría desconocida cae a OTRO', () => {
  const r = crearTicket({ categoria: 'HACK' })
  assert.equal(r.success, true)
  if (!r.success) return
  assert.equal(r.data.categoria, 'OTRO')
})

test('crearTicket: asunto y descripción obligatorios', () => {
  const r = crearTicket({ asunto: '', descripcion: '' })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'El asunto y la descripción son obligatorios.')
})

test('crearTicket: adjunto que no es de nuestro storage', () => {
  const r = crearTicket({ adjuntoUrl: 'https://evil.com/x.jpg' })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'El adjunto no es válido.')
})

test('crearTicket: adjunto de storage con extensión no permitida', () => {
  const r = crearTicket({ adjuntoUrl: `${SUPABASE_URL}/storage/v1/object/public/x.exe?token=1` })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'Formato de adjunto no permitido.')
})

test('crearTicket: adjunto válido de storage', () => {
  const r = crearTicket({ adjuntoUrl: `${SUPABASE_URL}/storage/v1/object/public/recibo.jpg` })
  assert.equal(r.success, true)
  if (!r.success) return
  assert.equal(r.data.adjuntoUrl, `${SUPABASE_URL}/storage/v1/object/public/recibo.jpg`)
})

test('configComunicacion: código de país corto', () => {
  const r = configComunicacionSchema.safeParse({ codigoPais: '', numero: '8299618220', correoSoporte: '' })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'Ingresa un código de país válido (ej: +52).')
})

test('configComunicacion: número corto', () => {
  const r = configComunicacionSchema.safeParse({ codigoPais: '+1', numero: '123', correoSoporte: '' })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'Ingresa un número de WhatsApp válido (solo dígitos).')
})

test('configComunicacion: correo inválido y vacío permitido', () => {
  const malo = configComunicacionSchema.safeParse({
    codigoPais: '+1',
    numero: '8299618220',
    correoSoporte: 'no-es-correo',
  })
  assert.equal(malo.success, false)
  if (malo.success) return
  assert.equal(malo.error.issues[0].message, 'El correo de soporte no tiene un formato válido.')

  const vacio = configComunicacionSchema.safeParse({
    codigoPais: '+1',
    numero: '8299618220',
    correoSoporte: '',
  })
  assert.equal(vacio.success, true)
})

test('correoPrueba: correo obligatorio y válido', () => {
  const vacio = correoPruebaSchema.safeParse({ correoSoporte: '' })
  assert.equal(vacio.success, false)
  if (vacio.success) return
  assert.equal(vacio.error.issues[0].message, 'Ingresa un correo de soporte válido antes de probar.')

  const malo = correoPruebaSchema.safeParse({ correoSoporte: 'x' })
  assert.equal(malo.success, false)
  if (malo.success) return
  assert.equal(malo.error.issues[0].message, 'Ingresa un correo de soporte válido antes de probar.')

  const bueno = correoPruebaSchema.safeParse({ correoSoporte: ' soporte@empresa.com ' })
  assert.equal(bueno.success, true)
  if (bueno.success) assert.equal(bueno.data.correoSoporte, 'soporte@empresa.com')
})

test('faq: pregunta o respuesta vacías', () => {
  const r = faqSchema.safeParse({ pregunta: '', respuesta: '', orden: '' })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'La pregunta y la respuesta son obligatorias.')
})

test('faq válido: orden no numérico a 0', () => {
  const r = faqSchema.safeParse({ pregunta: '¿Qué es?', respuesta: 'Respuesta', orden: 'abc' })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.orden, 0)
})

test('faqActualizar: datos incompletos', () => {
  const r = faqActualizarSchema.safeParse({ id: '', pregunta: 'x', respuesta: 'y', orden: '0' })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'Datos incompletos.')
})

test('responderTicket y notaInterna: cuerpo obligatorio', () => {
  const r = responderTicketSchema.safeParse({ ticketId: 't1', cuerpo: '  ', nuevoEstado: '' })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'Escribe una respuesta.')

  const n = notaInternaSchema.safeParse({ ticketId: 't1', cuerpo: '' })
  assert.equal(n.success, false)
  if (n.success) return
  assert.equal(n.error.issues[0].message, 'Escribe la nota interna.')
})

test('responderTicket válido: nuevoEstado opcional', () => {
  const r = responderTicketSchema.safeParse({
    ticketId: 't1',
    cuerpo: 'Gracias por reportar',
    nuevoEstado: 'EN_PROCESO',
  })
  assert.equal(r.success, true)
  if (r.success) assert.equal(r.data.nuevoEstado, 'EN_PROCESO')
})

test('cambiarEstadoTicket: estado inválido', () => {
  const r = cambiarEstadoTicketSchema.safeParse({ estado: 'BORRADO' })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'Estado inválido.')
})

test('cambiarEstadoTicket: estado válido', () => {
  const r = cambiarEstadoTicketSchema.safeParse({ estado: 'NUEVO' })
  assert.equal(r.success, true)
})

test('responderCliente: cuerpo obligatorio', () => {
  const r = responderClienteSchema.safeParse({ ticketId: 't1', cuerpo: '' })
  assert.equal(r.success, false)
  if (r.success) return
  assert.equal(r.error.issues[0].message, 'Escribe tu mensaje.')
})
