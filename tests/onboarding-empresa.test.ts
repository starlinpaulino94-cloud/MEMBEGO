import './support/sin-server-only'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pasosDeOnboarding, resumenDeOnboarding, type DatosDeOnboarding } from '../src/modules/empresas/onboarding'
import { conRetornoAlAsistente, PARAM_DESDE_ONBOARDING, VALOR_DESDE_ONBOARDING } from '../src/modules/empresas/onboarding-retorno'

/**
 * EL ASISTENTE DE CONFIGURACIÓN DE LA EMPRESA (auditoría admin · fase 7, tarea 7.5; 01 · §5).
 *
 * El inventario decía: «completo pero mínimo: sin sucursal, cobro ni horario; sin enlace de retorno». La sucursal ya se había añadido
 * (experiencia comercial, 2026-10-08); faltaban el HORARIO y el COBRO, y ningún paso dejaba un camino de vuelta al asistente. Las dos cosas
 * nuevas se recomiendan pero NO bloquean publicar.
 */

const leer = (r: string) => readFileSync(r, 'utf8')
const vacio: DatosDeOnboarding = {
  logoUrl: null,
  bannerUrl: null,
  description: null,
  ciudad: null,
  direccion: null,
  telefono: null,
  whatsapp: null,
  horario: null,
  sucursalesConHorario: 0,
  categorias: 0,
  planes: 0,
  promos: 0,
  sucursales: 0,
  metodosDePago: 0,
  productos: 0,
  productosPublicados: 0,
  conInventario: 0,
  conExistencias: 0,
  ofertas: 0,
}
const perfilCompleto: DatosDeOnboarding = { ...vacio, logoUrl: 'l', bannerUrl: 'b', description: 'x'.repeat(30), ciudad: 'Higüey', telefono: '809', categorias: 1 }
const paso = (d: DatosDeOnboarding, key: string) => pasosDeOnboarding(d).find((i) => i.key === key)!

test('el orden: el perfil, el horario, la sucursal, el cobro y después el catálogo y las ofertas', () => {
  assert.deepEqual(
    pasosDeOnboarding(vacio).map((i) => i.key),
    ['logo', 'banner', 'descripcion', 'ubicacion', 'contacto', 'categorias', 'horario', 'sucursal', 'cobro', 'producto', 'inventario', 'publicar', 'oferta', 'plan']
  )
})

test('el horario cuenta si hay texto en el perfil o un horario estructurado en alguna sucursal activa; un texto en blanco no cuenta', () => {
  assert.equal(paso(vacio, 'horario').done, false)
  assert.equal(paso({ ...vacio, horario: '   ' }, 'horario').done, false, 'solo espacios')
  assert.equal(paso({ ...vacio, horario: 'Lun-Vie 8:00-18:00' }, 'horario').done, true)
  assert.equal(paso({ ...vacio, sucursalesConHorario: 1 }, 'horario').done, true)
})

test('el cobro cuenta con al menos un método de pago activo', () => {
  assert.equal(paso(vacio, 'cobro').done, false)
  assert.equal(paso({ ...vacio, metodosDePago: 1 }, 'cobro').done, true)
  assert.match(paso(vacio, 'cobro').href, /^\/admin\/metodos-pago\/nuevo\?/)
})

test('el horario y el cobro se recomiendan pero NO bloquean publicar: una empresa con el perfil completo sigue lista', () => {
  assert.equal(paso(vacio, 'horario').requeridoParaPublicar, false)
  assert.equal(paso(vacio, 'cobro').requeridoParaPublicar, false)
  const r = resumenDeOnboarding(pasosDeOnboarding(perfilCompleto), false)
  assert.equal(r.listoParaPublicar, true, 'las empresas que ya estaban listas no dejan de estarlo')
  assert.equal(resumenDeOnboarding(pasosDeOnboarding(vacio), false).listoParaPublicar, false)
  assert.equal(resumenDeOnboarding(pasosDeOnboarding({ ...perfilCompleto, categorias: 0 }), false).listoParaPublicar, false, 'sin categoría sigue sin poder publicar')
})

test('el progreso cuenta los pasos hechos sobre el total', () => {
  const r = resumenDeOnboarding(pasosDeOnboarding({ ...perfilCompleto, horario: 'Todos los días', metodosDePago: 2 }), true)
  assert.equal(r.total, 14)
  assert.equal(r.completados, 8)
  assert.equal(r.publicado, true)
})

// ── El camino de vuelta ─────────────────────────────────────────────────────────────────────────────────────────────

test('todo enlace del asistente lleva la marca de «vengo del asistente»', () => {
  for (const i of pasosDeOnboarding(vacio)) {
    assert.equal(new URL(i.href, 'http://x').searchParams.get(PARAM_DESDE_ONBOARDING), VALOR_DESDE_ONBOARDING, i.key)
  }
})

test('la marca se añade sin romper lo que el enlace ya traía', () => {
  assert.equal(conRetornoAlAsistente('/admin/perfil'), '/admin/perfil?desde=onboarding')
  assert.equal(conRetornoAlAsistente('/admin/catalogo?estado=ACTIVE'), '/admin/catalogo?estado=ACTIVE&desde=onboarding')
  assert.equal(conRetornoAlAsistente('/admin/perfil#horario'), '/admin/perfil?desde=onboarding#horario')
  assert.equal(conRetornoAlAsistente('/admin/perfil?desde=otro'), '/admin/perfil?desde=onboarding', 'no se duplica')
  assert.equal(conRetornoAlAsistente(conRetornoAlAsistente('/a')), '/a?desde=onboarding', 'es idempotente')
})

test('la franja de vuelta está en el panel y no arrastra la base de datos al navegador', () => {
  const franja = leer('src/components/onboarding/RetornoAlAsistente.tsx')
  assert.match(franja, /^'use client'/)
  assert.match(franja, /from '@\/modules\/empresas\/onboarding-retorno'/)
  assert.doesNotMatch(franja, /from '@\/modules\/empresas\/onboarding'/, 'importar onboarding.ts llevaría Prisma al cliente')
  assert.match(franja, /href="\/onboarding"/)
  assert.match(franja, /sessionStorage/, 'sobrevive al cambio de pantalla')
  assert.match(franja, /try \{[\s\S]*?sessionStorage[\s\S]*?\} catch/, 'el almacenamiento bloqueado no rompe nada')
  assert.match(franja, /pathname === '\/onboarding'/, 'no se pinta dentro del propio asistente')
  assert.match(leer('src/app/(admin)/layout.tsx'), /<RetornoAlAsistente \/>/)
  assert.doesNotMatch(leer('src/modules/empresas/onboarding-retorno.ts'), /import /, 'sin dependencias')
})

test('el asistente dice qué es recomendado, cuántos pasos obligatorios faltan y deja volver desde el equipo', () => {
  const asistente = leer('src/components/onboarding/WizardEmpresa.tsx')
  assert.match(asistente, /Recomendado · no impide publicar/)
  assert.match(asistente, /paso obligatorio/)
  assert.doesNotMatch(asistente, /Completa todos los pasos para poder publicar/, 'ya no promete que todos los pasos bloquean')
  assert.match(asistente, /conRetornoAlAsistente\('\/admin\/empleados'\)/)
})

test('el aviso de «completa antes de publicar» solo lista lo que de verdad bloquea', () => {
  const acciones = leer('src/modules/empresas/perfilActions.ts')
  assert.match(acciones, /filter\(\(i\) => i\.requeridoParaPublicar && !i\.done\)/)
})
