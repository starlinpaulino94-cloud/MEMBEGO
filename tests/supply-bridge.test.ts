import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { CAPACIDADES_PUENTE, diferencias, estadoDeItem, estadoDeVariante, itemDeseado, type OfertaOrigen } from '../src/modules/supply-bridge/domain'

/**
 * SUPPLY BRIDGE · mapeo oferta → ítem y fronteras entre módulos (Fase 2.5).
 * El comportamiento contra la base está en `tests/postgres/supply-bridge.db.test.ts`.
 */

const oferta = (o: Partial<OfertaOrigen> = {}): OfertaOrigen => ({
  slug: 'lavado-mbg-of-2026-000001',
  code: 'MBG-OF-2026-000001',
  title: ' Lavado completo ',
  description: 'Exterior e interior',
  supplier: 'Car Town',
  currency: 'DOP',
  publicPrice: '1000.00',
  salePrice: '650.50',
  status: 'ACTIVE',
  available: true,
  remaining: 40,
  unlimited: false,
  ...o,
})

test('el estado del ítem sigue al de la oferta: activa y agotada publican; programada y pausada pausan; terminada y cancelada archivan; el borrador no tiene ítem', () => {
  assert.equal(estadoDeItem('ACTIVE'), 'ACTIVE')
  assert.equal(estadoDeItem('SOLD_OUT'), 'ACTIVE')
  assert.equal(estadoDeItem('SCHEDULED'), 'PAUSED')
  assert.equal(estadoDeItem('PAUSED'), 'PAUSED')
  assert.equal(estadoDeItem('ENDED'), 'ARCHIVED')
  assert.equal(estadoDeItem('CANCELLED'), 'ARCHIVED')
  assert.equal(estadoDeItem('DRAFT'), null)
  assert.equal(estadoDeItem('ALGO_NUEVO'), null, 'un estado desconocido no publica nada')
  assert.equal(itemDeseado(oferta({ status: 'DRAFT' })), null)
})

test('la variante: agotada si la oferta se agotó o no quedan unidades (salvo las ilimitadas)', () => {
  assert.equal(estadoDeVariante({ status: 'SOLD_OUT', remaining: 5, unlimited: false }), 'OUT_OF_STOCK')
  assert.equal(estadoDeVariante({ status: 'ACTIVE', remaining: 0, unlimited: false }), 'OUT_OF_STOCK')
  assert.equal(estadoDeVariante({ status: 'ACTIVE', remaining: 0, unlimited: true }), 'ACTIVE')
  assert.equal(estadoDeVariante({ status: 'ACTIVE', remaining: 3, unlimited: false }), 'ACTIVE')
  assert.equal(estadoDeVariante({ status: 'PAUSED', remaining: 0, unlimited: false }), 'ACTIVE', 'pausada no es agotada')
})

test('el ítem deseado: nombre recortado, proveedor en la descripción, una variante «Default» con el código como SKU y precio anterior solo si hay descuento', () => {
  const d = itemDeseado(oferta())!
  assert.equal(d.name, 'Lavado completo')
  assert.equal(d.slug, 'lavado-mbg-of-2026-000001')
  assert.equal(d.description, 'Exterior e interior\n\nOfrecido por Car Town.')
  assert.equal(d.status, 'ACTIVE')
  assert.deepEqual(d.variant, { name: 'Default', sku: 'MBG-OF-2026-000001', price: '650.50', compareAtPrice: '1000.00', status: 'ACTIVE' })
  assert.equal(itemDeseado(oferta({ publicPrice: '650.50' }))!.variant.compareAtPrice, null, 'sin descuento no hay precio anterior')
  assert.equal(itemDeseado(oferta({ publicPrice: '100.00' }))!.variant.compareAtPrice, null, 'lista menor que venta: nunca')
  assert.equal(itemDeseado(oferta({ description: null }))!.description, 'Ofrecido por Car Town.')
  assert.equal(itemDeseado(oferta({ description: null, supplier: ' ' }))!.description, null)
  assert.equal(itemDeseado(oferta({ salePrice: '0.00' }))!.variant.price, '0.00', 'una oferta gratis se refleja gratis')
})

test('el ítem puente no se prepara, no se reserva, no pasa por caja y se canjea: lo que es un voucher', () => {
  assert.deepEqual(CAPACIDADES_PUENTE, { trackInventory: false, requiresBooking: false, requiresRedemption: true, requiresPreparation: false, availableMarketplace: true, availablePOS: false })
})

test('diferencias(): vacío si está al día; nombra cada campo que se aparta', () => {
  const d = itemDeseado(oferta())!
  const alDia = { name: d.name, description: d.description, currency: d.currency, status: d.status, variant: { price: d.variant.price, compareAtPrice: d.variant.compareAtPrice, status: d.variant.status } }
  assert.deepEqual(diferencias(alDia, d), [])
  assert.deepEqual(diferencias({ ...alDia, name: 'Otro' }, d), ['nombre'])
  assert.deepEqual(diferencias({ ...alDia, status: 'PAUSED' }, d), ['estado'])
  assert.deepEqual(diferencias({ ...alDia, variant: { ...alDia.variant, price: '1.00', status: 'OUT_OF_STOCK' } }, d).sort(), ['disponibilidad', 'precio'])
  assert.deepEqual(diferencias({ ...alDia, variant: null }, d), ['variante'])
  assert.deepEqual(diferencias({ ...alDia, description: null }, d), ['descripción'])
})

// ── Fronteras entre módulos ──────────────────────────────────────────────────

const importsDe = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .flatMap((f) => [...readFileSync(`${dir}/${f}`, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => ({ f, origen: m[1] })))

test('Commerce Core (catálogo e inventario) NO importa del puente ni de supply-v2: la dependencia va del puente hacia los dos', () => {
  for (const dir of ['src/modules/catalog', 'src/modules/inventory']) {
    for (const { f, origen } of importsDe(dir)) {
      assert.doesNotMatch(origen, /supply-bridge|supply/i, `${dir}/${f} importa ${origen}`)
    }
  }
})

test('el puente solo toca Supply V2 por su read model público (nunca sus servicios, ledger ni costos)', () => {
  const desdeSupply = importsDe('src/modules/supply-bridge').filter((i) => /supply-v2/.test(i.origen))
  assert.ok(desdeSupply.length > 0)
  for (const { f, origen } of desdeSupply) assert.equal(origen, '@/modules/supply-v2/marketplace/read-model', `${f} importa ${origen}`)
  // El mapeo es PURO: solo tipos de Prisma, ningún módulo.
  const dominio = readFileSync('src/modules/supply-bridge/domain.ts', 'utf8')
  const imports = [...dominio.matchAll(/^import (type )?[^\n]*from\s+'([^']+)'/gm)]
  assert.ok(imports.every((m) => m[1]?.trim() === 'type' && m[2] === '@prisma/client'), 'domain.ts debe importar solo tipos de @prisma/client')
})

test('el puente nunca lee ni escribe el costo: el ítem puente no lleva `cost`', () => {
  for (const f of ['service.ts', 'domain.ts', 'barrido.ts']) {
    const s = readFileSync(`src/modules/supply-bridge/${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(s, /\bcost\b|unitCost|landedCost|negotiatedUnitCost/, `${f} toca un costo`)
  }
})

test('cada cambio de una oferta de Supply dispara la sincronización DESPUÉS de responder, sin poder tumbar la acción', () => {
  const s = readFileSync('src/modules/supply-v2/actions-ofertas.ts', 'utf8')
  assert.match(s, /import \{ after \} from 'next\/server'/)
  assert.match(s, /if \(id\) after\(\(\) => sincronizarOfertaMejorEsfuerzo\(id\)\)/)
  const b = readFileSync('src/modules/supply-bridge/mejor-esfuerzo.ts', 'utf8')
  const mejor = b.slice(b.indexOf('export async function sincronizarOfertaMejorEsfuerzo'))
  assert.match(mejor, /try \{[\s\S]*\} catch/, 'nunca lanza')
})

test('el cron del puente existe, está programado, exige el secreto y autoriza antes de barrer', () => {
  const ruta = readFileSync('src/app/api/cron/supply-bridge/route.ts', 'utf8')
  assert.ok(ruta.indexOf('autorizarCron(req)') >= 0 && ruta.indexOf('autorizarCron(req)') < ruta.indexOf('barridoPuente()'))
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string }[] }
  assert.ok(vercel.crons.some((c) => c.path === '/api/cron/supply-bridge'))
})

test('toda lectura y escritura del servicio filtra por la empresa de la casa o por la oferta (el puente cruza empresas a propósito, así que se nota en cada consulta)', () => {
  const s = readFileSync('src/modules/supply-bridge/service.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  // Las escrituras de catálogo van siempre con companyId = la casa.
  for (const m of s.matchAll(/tx\.catalogItem\.create\(\{[\s\S]*?\}\)\n/g)) assert.match(m[0], /companyId: casa\.id/)
  for (const m of s.matchAll(/tx\.catalogVariant\.createMany\(\{[\s\S]*?\}\)\n/g)) assert.match(m[0], /companyId: casa\.id/)
  assert.match(s, /existente\.companyId !== casa\.id/, 'un ítem de otra empresa no se toca')
  assert.match(s, /pg_advisory_xact_lock/)
})

// ── Acciones, panel y descubrimiento ─────────────────────────────────────────

test('las acciones del puente son SOLO del superadmin y comprueban el rol ANTES de tocar la base', () => {
  const s = readFileSync('src/modules/supply-bridge/actions.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const exportadas = [...s.matchAll(/export async function (\w+)/g)].map((m) => m[1])
  assert.deepEqual(exportadas.sort(), ['designarCasaMembego', 'sincronizarPuenteAhora'])
  assert.match(s, /user\.metadata\.role === 'SUPERADMIN'/)
  for (const nombre of exportadas) {
    const desde = s.indexOf(`export async function ${nombre}`)
    const cuerpo = s.slice(desde, s.indexOf('\n}\n', desde))
    const guardia = cuerpo.indexOf('await exigirSuperadmin()')
    const base = Math.min(...['sinEmpresa(', 'barridoPuente('].map((t) => (cuerpo.indexOf(t) < 0 ? Number.POSITIVE_INFINITY : cuerpo.indexOf(t))))
    assert.ok(guardia >= 0, `${nombre} no exige superadmin`)
    assert.ok(guardia < base, `${nombre} toca la base antes de autorizar`)
    assert.match(cuerpo, /if \(!user\) return \{ ok: false/, `${nombre} no corta si no es superadmin`)
  }
})

test('el panel del puente se guarda por rol de superadmin, y los botones no importan el servicio ni Prisma', () => {
  const pagina = readFileSync('src/app/(superadmin)/superadmin/puente-supply/page.tsx', 'utf8')
  assert.match(pagina, /requireRole\('SUPERADMIN'\)/)
  assert.doesNotMatch(pagina, /\bprisma\./)
  const boton = readFileSync('src/components/supply-bridge/PuenteAcciones.tsx', 'utf8')
  for (const m of boton.matchAll(/from\s+'([^']+)'/g)) {
    assert.doesNotMatch(m[1], /supply-bridge\/(service|domain|barrido|errores)$|^@prisma\/client$|lib\/prisma$/, `PuenteAcciones importa ${m[1]}`)
  }
  const nav = readFileSync('src/components/layout/nav-config.ts', 'utf8')
  assert.match(nav, /href: '\/superadmin\/puente-supply'/)
})

test('la tarjeta y la ficha pública mandan una oferta de Membego a la página de compra de Supply (no duplican el checkout)', () => {
  const tarjeta = readFileSync('src/components/catalogo/TarjetaCatalogoPublica.tsx', 'utf8')
  assert.match(tarjeta, /RUTA_OFERTAS_MEMBEGO\}\/\$\{item\.ofertaSlug\}/)
  const cargador = readFileSync('src/modules/comercio/ficha-item.ts', 'utf8')
  assert.match(cargador, /RUTA_OFERTAS_MEMBEGO\}\/\$\{item\.ofertaSlug\}/)
  const ficha = readFileSync('src/components/catalogo/FichaDeItem.tsx', 'utf8')
  assert.match(ficha, /Ver la oferta y comprar/)
})

test('/catalogo valida el origen de la URL contra los valores conocidos y no duplica las ofertas destacadas en la lista', () => {
  const s = readFileSync('src/app/(public)/catalogo/page.tsx', 'utf8')
  assert.match(s, /sp\.origen === 'supply' \|\| sp\.origen === 'empresas' \? sp\.origen : null/)
  assert.match(s, /const conDestacadas = origen === null && !q && !categoria && pagina === 0/)
  assert.match(s, /origen === 'empresas' \|\| \(origen === null && !q\) \? \{ origen: 'EMPRESAS' as const \}/)
})

// ── Acoplamiento transitivo (hallazgo M9 de la auditoría del 2026-10-07) ─────

import { existsSync, statSync } from 'node:fs'
import { dirname, join as unir, normalize } from 'node:path'

/** Resuelve un import del código (alias `@/` o relativo) a un archivo de `src/`, o null si es un paquete externo. */
function resolverImport(desde: string, origen: string): string | null {
  const base = origen.startsWith('@/') ? unir('src', origen.slice(2)) : origen.startsWith('.') ? normalize(unir(dirname(desde), origen)) : null
  if (base === null) return null
  for (const c of [`${base}.ts`, `${base}.tsx`, unir(base, 'index.ts'), unir(base, 'index.tsx'), base]) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

/** Todos los archivos de `src/` que se alcanzan importando desde `entrada` (incluye dinámicos). */
function cierreDeImports(entrada: string): Set<string> {
  const vistos = new Set<string>()
  const pendientes = [entrada]
  while (pendientes.length > 0) {
    const f = pendientes.pop() as string
    if (vistos.has(f)) continue
    vistos.add(f)
    const texto = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const m of texto.matchAll(/(?:from|import\()\s*'([^']+)'/g)) {
      const r = resolverImport(f, m[1])
      if (r && r.startsWith('src')) pendientes.push(r)
    }
  }
  return vistos
}

test('la sincronización que Supply llama tras cada oferta no arrastra, ni transitivamente, pedidos, inventario ni billing', () => {
  const alcanzados = [...cierreDeImports('src/modules/supply-bridge/mejor-esfuerzo.ts')].map((f) => f.split('\\').join('/'))
  const prohibidos = alcanzados.filter((f) => /^src\/modules\/(orders|inventory|billing)\//.test(f) || /^src\/modules\/supply-bridge\/(pedido|barrido)\.ts$/.test(f))
  assert.deepEqual(prohibidos, [], 'Supply importa mejor-esfuerzo.ts: no debe alcanzar el Commerce Core')
})

test('Supply importa la sincronización desde mejor-esfuerzo.ts, no desde el barrido (que importa el envoltorio de pedidos)', () => {
  const s = readFileSync('src/modules/supply-v2/actions-ofertas.ts', 'utf8')
  assert.match(s, /from '@\/modules\/supply-bridge\/mejor-esfuerzo'/)
  assert.doesNotMatch(s, /supply-bridge\/barrido/)
})
