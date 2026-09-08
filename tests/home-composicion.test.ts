/**
 * Home comercial versionado + sinónimos (F2a).
 *
 * La máquina de estados solo admite sus caminos, la revisión efectiva se
 * resuelve sin escribir (programar no necesita cron) y la búsqueda expande
 * con sinónimos propios antes que globales, con tope.
 *
 * Ejecutar: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  revisionEfectiva,
  transicionPermitida,
} from '../src/modules/home/composicion'
import { ComposicionInput } from '../src/modules/home/esquema'
import { admiteAudienciaHome } from '../src/modules/home/audiencia'
import {
  expandirConsulta,
  normalizarTermino,
} from '../src/modules/busqueda/sinonimos'

const RAIZ = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(RAIZ, r), 'utf8')

// ── Máquina de estados ───────────────────────────────────────────────────────

test('borrador se publica, se programa o se archiva; nunca se pausa', () => {
  assert.equal(transicionPermitida('BORRADOR', 'PUBLICADA'), true)
  assert.equal(transicionPermitida('BORRADOR', 'PROGRAMADA'), true)
  assert.equal(transicionPermitida('BORRADOR', 'ARCHIVADA'), true)
  assert.equal(transicionPermitida('BORRADOR', 'PAUSADA'), false)
})

test('archivada es terminal y publicada solo se pausa o archiva', () => {
  assert.equal(transicionPermitida('ARCHIVADA', 'BORRADOR'), false)
  assert.equal(transicionPermitida('PUBLICADA', 'BORRADOR'), false)
  assert.equal(transicionPermitida('PUBLICADA', 'PAUSADA'), true)
  assert.equal(transicionPermitida('PAUSADA', 'PUBLICADA'), true)
})

test('la efectiva es la publicada más nueva o la programada vencida más nueva', () => {
  const t0 = new Date('2026-01-01T00:00:00Z')
  const t1 = new Date('2026-02-01T00:00:00Z')
  const vieja = { id: 'a', estado: 'PUBLICADA' as const, programadaPara: null, createdAt: t0 }
  const nueva = { id: 'b', estado: 'PUBLICADA' as const, programadaPara: null, createdAt: t1 }
  assert.equal(revisionEfectiva([vieja, nueva], t1)?.id, 'b')
  const futura = {
    id: 'c',
    estado: 'PROGRAMADA' as const,
    programadaPara: new Date('2026-03-01T00:00:00Z'),
    createdAt: new Date('2026-02-15T00:00:00Z'),
  }
  assert.equal(revisionEfectiva([nueva, futura], t1)?.id, 'b')
  assert.equal(
    revisionEfectiva([nueva, futura], new Date('2026-04-01T00:00:00Z'))?.id,
    'c'
  )
  assert.equal(revisionEfectiva([futura], t1), null)
})

// ── Validación de la composición ─────────────────────────────────────────────

function base(over: Record<string, unknown> = {}) {
  return {
    territorio: 'Higüey',
    bloques: [
      { tipo: 'CABECERA', activo: true, titulo: null, config: {} },
      {
        tipo: 'HERO',
        activo: true,
        titulo: null,
        config: {
          slides: [
            {
              titulo: 'Cuida tu vehículo',
              subtitulo: 'Especialistas',
              empresaId: 'emp1',
              imagenUrl: null,
              ctaTexto: 'Ver oferta',
              ctaDestino: { tipo: 'empresa', id: 'emp1' },
            },
          ],
        },
      },
    ],
    segmentacion: { membresia: 'CUALQUIERA', radioKm: 15, hasta: null },
    ...over,
  }
}

test('una composición mínima válida pasa', () => {
  assert.equal(ComposicionInput.safeParse(base()).success, true)
})

test('bloques duplicados o sin cabecera primera se rechazan', () => {
  const dup = base({
    bloques: [
      { tipo: 'HERO', activo: true, titulo: null, config: {} },
      { tipo: 'HERO', activo: true, titulo: null, config: {} },
    ],
  })
  assert.equal(ComposicionInput.safeParse(dup).success, false)
  const sinCabecera = base({
    bloques: [{ tipo: 'HERO', activo: true, titulo: null, config: {} }],
  })
  assert.equal(ComposicionInput.safeParse(sinCabecera).success, false)
})

test('hero sin diapositivas o vigencia pasada se rechaza', () => {
  const sinSlides = base({
    bloques: [
      { tipo: 'CABECERA', activo: true, titulo: null, config: {} },
      { tipo: 'HERO', activo: true, titulo: null, config: { slides: [] } },
    ],
  })
  assert.equal(ComposicionInput.safeParse(sinSlides).success, false)
  const pasada = base({
    segmentacion: { membresia: 'CUALQUIERA', radioKm: 15, hasta: '2020-01-01T00:00:00Z' },
  })
  assert.equal(ComposicionInput.safeParse(pasada).success, false)
})

// ── Sinónimos puros ──────────────────────────────────────────────────────────

test('normalizar ignora mayúsculas y espacios', () => {
  assert.equal(normalizarTermino('  Carro  Veloz '), 'carro veloz')
})

test('expandir deduplica y respeta el tope', () => {
  assert.deepEqual(expandirConsulta('carro', ['Vehículo', 'carro', 'auto']), [
    'carro',
    'vehículo',
    'auto',
  ])
  assert.equal(expandirConsulta('x', ['a', 'b', 'c', 'd', 'e', 'f']).length, 5)
  assert.deepEqual(expandirConsulta('   ', ['a']), [])
})

// ── El esquema y la migración sostienen el modelo ────────────────────────────

test('modelos home y auditoría de publicación existen', () => {
  const schema = leer('prisma/schema/home.prisma')
  assert.match(schema, /model HomeRevision/)
  assert.match(schema, /model HomeBloque/)
  assert.match(schema, /model BusquedaSinonimo/)
  assert.match(schema, /@@unique\(\[revisionId, tipo\]\)/)
  const identidad = leer('prisma/schema/identidad.prisma')
  assert.match(identidad, /COMPOSICION_PUBLICADA/)
  const mig = leer('prisma/migrations/20260913_home_composicion/migration.sql')
  assert.match(mig, /CREATE TABLE "home_revisiones"/)
  assert.match(mig, /CREATE TABLE "home_bloques"/)
  assert.match(mig, /CREATE TABLE "busqueda_sinonimos"/)
})

test('las acciones exigen sección, validan y auditan', () => {
  const src = leer('src/modules/home/acciones.ts')
  assert.match(src, /requireSection\('personalizacion'\)/)
  assert.match(src, /resolveCompanyId\(user\)/)
  assert.match(src, /COMPOSICION_GUARDADA/)
  assert.match(src, /heroPublico/)
})

test('el editor publica por acciones y previsualiza sin mutar', () => {
  const ed = leer('src/components/admin/EditorInicio.tsx')
  assert.match(ed, /guardarBorrador/)
  assert.match(ed, /publicarEdicion/)
  assert.match(ed, /new Date\(programarPara\)/)
  assert.match(ed, /Vista previa/)
  const pag = leer('src/app/(admin)/admin/personalizacion/page.tsx')
  assert.match(pag, /EditorInicio/)
  assert.match(pag, /PersonalizacionForm/)
})

// ── Segmentación de audiencia ────────────────────────────────────────────────
//
// La regresión que estas guardias vigilan: el radio devolvía `false` cuando
// faltaba la ubicación de la persona o del negocio, y eso dejaba el Inicio
// publicado invisible para casi todo el mundo — sin error, sin aviso, cayendo
// a la pantalla anterior. Un filtro de cercanía solo puede excluir a quien
// sabemos dónde está.

const SEGMENTO = { membresia: 'CUALQUIERA' as const, radioKm: 15, hasta: null }
const HIGUEY = { latitud: 18.6, longitud: -68.7 }
const AHORA = new Date('2026-09-08T12:00:00.000Z')

test('sin ubicación conocida, el radio no excluye a nadie', () => {
  assert.equal(
    admiteAudienciaHome(SEGMENTO, { membresiaActiva: false, ubicacion: null, centro: HIGUEY }, AHORA),
    true,
    'Quien no concedió geolocalización sigue viendo el Inicio de SU empresa.'
  )
  assert.equal(
    admiteAudienciaHome(SEGMENTO, { membresiaActiva: false, ubicacion: HIGUEY, centro: null }, AHORA),
    true,
    'Una empresa sin coordenadas no puede dejar su propia publicación invisible.'
  )
})

test('con los dos puntos conocidos, el radio sí decide', () => {
  const cerca = { latitud: 18.61, longitud: -68.71 }
  const lejos = { latitud: 19.45, longitud: -70.7 } // Santiago, ~200 km
  assert.equal(
    admiteAudienciaHome(SEGMENTO, { membresiaActiva: false, ubicacion: cerca, centro: HIGUEY }, AHORA),
    true
  )
  assert.equal(
    admiteAudienciaHome(SEGMENTO, { membresiaActiva: false, ubicacion: lejos, centro: HIGUEY }, AHORA),
    false
  )
})

test('la vigencia vencida y el segmento «sin plan» sí excluyen siempre', () => {
  const vencida = { ...SEGMENTO, hasta: '2026-09-01T00:00:00.000Z' }
  assert.equal(
    admiteAudienciaHome(vencida, { membresiaActiva: false, ubicacion: null, centro: null }, AHORA),
    false,
    'Una campaña caducada no sigue publicada por falta de ubicación.'
  )
  const soloNuevos = { ...SEGMENTO, membresia: 'SIN_PLAN' as const }
  assert.equal(
    admiteAudienciaHome(soloNuevos, { membresiaActiva: true, ubicacion: null, centro: null }, AHORA),
    false
  )
  assert.equal(
    admiteAudienciaHome(soloNuevos, { membresiaActiva: false, ubicacion: null, centro: null }, AHORA),
    true
  )
})
