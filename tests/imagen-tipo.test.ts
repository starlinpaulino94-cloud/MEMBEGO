import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EXTENSION_DE_IMAGEN, detectarTipoImagen } from '../src/lib/imagen-tipo'

/**
 * El tipo de una imagen subida lo decide su FIRMA, nunca `file.type` ni
 * `file.name` (los escribe quien sube el archivo).
 */

const bytes = (...n: number[]) => Uint8Array.from(n)
const texto = (s: string) => Uint8Array.from(Buffer.from(s, 'latin1'))

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46)
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d)
const WEBP = Uint8Array.from([...texto('RIFF'), 0x24, 0x00, 0x00, 0x00, ...texto('WEBP'), ...texto('VP8 ')])

test('reconoce JPEG, PNG y WebP por su firma', () => {
  assert.equal(detectarTipoImagen(JPEG), 'image/jpeg')
  assert.equal(detectarTipoImagen(PNG), 'image/png')
  assert.equal(detectarTipoImagen(WEBP), 'image/webp')
})

test('cada tipo reconocido tiene su extensión, decidida por el servidor', () => {
  assert.equal(EXTENSION_DE_IMAGEN['image/jpeg'], 'jpg')
  assert.equal(EXTENSION_DE_IMAGEN['image/png'], 'png')
  assert.equal(EXTENSION_DE_IMAGEN['image/webp'], 'webp')
})

test('un ejecutable o un script NO pasa por imagen aunque se declare como tal', () => {
  assert.equal(detectarTipoImagen(texto('MZ\x90\x00\x03\x00\x00\x00')), null, 'ejecutable de Windows')
  assert.equal(detectarTipoImagen(texto('#!/bin/sh\nrm -rf /')), null, 'script')
  assert.equal(detectarTipoImagen(texto('<html><script>alert(1)</script>')), null, 'HTML')
})

test('un SVG NO se acepta (es XML y puede llevar scripts)', () => {
  assert.equal(detectarTipoImagen(texto('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null)
  assert.equal(detectarTipoImagen(texto('<?xml version="1.0"?><svg/>')), null)
})

test('un GIF o un PDF tampoco: solo JPG, PNG y WebP', () => {
  assert.equal(detectarTipoImagen(texto('GIF89a\x01\x00\x01\x00')), null)
  assert.equal(detectarTipoImagen(texto('%PDF-1.7\n')), null)
})

test('RIFF que no es WebP (un WAV, un AVI) no se confunde con WebP', () => {
  const wav = Uint8Array.from([...texto('RIFF'), 0x24, 0x00, 0x00, 0x00, ...texto('WAVE'), ...texto('fmt ')])
  assert.equal(detectarTipoImagen(wav), null)
})

test('un PNG con la firma truncada no pasa', () => {
  assert.equal(detectarTipoImagen(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a)), null)
})

test('vacío o demasiado corto: null, sin lanzar', () => {
  assert.equal(detectarTipoImagen(new Uint8Array(0)), null)
  assert.equal(detectarTipoImagen(bytes(0xff)), null)
  assert.equal(detectarTipoImagen(bytes(0xff, 0xd8)), null, 'JPEG sin el tercer byte de la firma')
  assert.equal(detectarTipoImagen(texto('RIFF....WEB')), null, 'WebP truncado')
})

test('acepta un Buffer de Node directamente (es lo que llega de file.arrayBuffer())', () => {
  assert.equal(detectarTipoImagen(Buffer.from(PNG)), 'image/png')
})
