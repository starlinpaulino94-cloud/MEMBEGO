import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CLASES_VENCIMIENTO,
  DIAS_URGENTE,
  VENTANAS_DIAS,
  VENTANA_POR_DEFECTO,
  avisoPorVencer,
  avisoVencidos,
  claseDeVencimiento,
  esClaseVencimiento,
  limiteDeVentana,
  semanaIso,
  urgenciaDe,
  vendibleDeLote,
  ventanaValida,
} from '../src/modules/inventory/vencimientos'
import { consultaDeFiltrosVencimientos, leerFiltrosVencimientos } from '../src/modules/inventory/filtros'
import { vencimientosToCsv } from '../src/modules/inventory/exportacion'
import { costoDeDecimal } from '../src/modules/inventory/costos'
import type { FilaVencimiento, VencimientosVista } from '../src/modules/inventory/vencimientos-queries'
import { adminSectionForPath } from '../src/lib/auth/permissions'

/**
 * INV-5b1 · LO QUE VENCE PRONTO — las reglas puras (la ventana, las clases, la urgencia, la semana de los avisos), el CSV, los filtros de
 * la URL y las guardias estáticas del informe (la ruta de descarga, la pantalla, las lecturas, el aviso del barrido).
 *
 * Ejecutar: npm test
 */

const leer = (ruta: string) => readFileSync(ruta, 'utf8')
const sinComent = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const HOY = '2027-06-15'
const ZONA = 'America/Santo_Domingo'
const AHORA = new Date('2027-06-15T16:00:00.000Z')

// ── La ventana ───────────────────────────────────────────────────────────────

test('la ventana solo puede ser una de las que hay; cualquier otra cosa vuelve a la de siempre (30 días)', () => {
  assert.deepEqual([...VENTANAS_DIAS], [7, 15, 30, 60, 90])
  assert.equal(VENTANA_POR_DEFECTO, 30)
  for (const d of VENTANAS_DIAS) {
    assert.equal(ventanaValida(d), d)
    assert.equal(ventanaValida(String(d)), d)
    assert.equal(ventanaValida(`  ${d} `), d, 'con espacios')
  }
  for (const malo of [undefined, null, '', 'abc', '45', 45, 0, -7, 7.5, '7.5', NaN, Infinity, {}, [], true, '1e1']) assert.equal(ventanaValida(malo), 30, JSON.stringify(malo))
})

test('el límite de la ventana es hoy más los días, entre meses, años y bisiestos', () => {
  assert.equal(limiteDeVentana('2027-06-15', 30), '2027-07-15')
  assert.equal(limiteDeVentana('2027-06-15', 7), '2027-06-22')
  assert.equal(limiteDeVentana('2027-12-20', 15), '2028-01-04')
  assert.equal(limiteDeVentana('2028-02-20', 10), '2028-03-01', '2028 es bisiesto: febrero tiene 29 días')
  assert.equal(limiteDeVentana('2027-02-20', 10), '2027-03-02')
  assert.equal(limiteDeVentana('2027-06-15', 0), '2027-06-15')
})

// ── Las clases y la urgencia ─────────────────────────────────────────────────

test('un lote está vencido si su día ya pasó, por vencer si cae en la ventana (el último día incluido) y fuera si no', () => {
  assert.deepEqual([...CLASES_VENCIMIENTO], ['VENCIDO', 'POR_VENCER'])
  assert.equal(claseDeVencimiento('2027-06-14', HOY, 30), 'VENCIDO', 'ayer')
  assert.equal(claseDeVencimiento('2000-01-01', HOY, 30), 'VENCIDO', 'hace años')
  assert.equal(claseDeVencimiento('2027-06-15', HOY, 30), 'POR_VENCER', 'vence hoy: todavía se vende')
  assert.equal(claseDeVencimiento('2027-06-16', HOY, 30), 'POR_VENCER', 'mañana')
  assert.equal(claseDeVencimiento('2027-07-15', HOY, 30), 'POR_VENCER', 'el día 30 entra')
  assert.equal(claseDeVencimiento('2027-07-16', HOY, 30), null, 'el día 31 no')
  assert.equal(claseDeVencimiento('2027-06-23', HOY, 7), null, 'con la ventana de 7, el día 8 no')
  assert.equal(claseDeVencimiento('2027-06-22', HOY, 7), 'POR_VENCER', 'y el día 7 sí')
  assert.equal(claseDeVencimiento(null, HOY, 90), null, 'un lote que no vence nunca sale')
  assert.equal(esClaseVencimiento('VENCIDO'), true)
  assert.equal(esClaseVencimiento('POR_VENCER'), true)
  for (const x of ['VIGENTE', 'vencido', '', undefined, null, 3, {}]) assert.equal(esClaseVencimiento(x), false, String(x))
})

test('la urgencia: vencido por debajo de cero, urgente hasta 7 días (hoy incluido) y por vencer después', () => {
  assert.equal(DIAS_URGENTE, 7)
  assert.equal(urgenciaDe(-30), 'VENCIDO')
  assert.equal(urgenciaDe(-1), 'VENCIDO')
  assert.equal(urgenciaDe(0), 'URGENTE')
  assert.equal(urgenciaDe(1), 'URGENTE')
  assert.equal(urgenciaDe(7), 'URGENTE')
  assert.equal(urgenciaDe(8), 'PRONTO')
  assert.equal(urgenciaDe(90), 'PRONTO')
})

test('lo vendible de un lote es lo que hay menos lo apartado, y nunca queda en negativo', () => {
  assert.equal(vendibleDeLote({ onHand: 10, reserved: 4 }), 6)
  assert.equal(vendibleDeLote({ onHand: 4, reserved: 4 }), 0)
  assert.equal(vendibleDeLote({ onHand: 0, reserved: 0 }), 0)
  assert.equal(vendibleDeLote({ onHand: 3, reserved: 5 }), 0, 'un dato imposible no da negativo')
})

// ── La semana de los avisos ──────────────────────────────────────────────────

test('la semana ISO: de lunes a domingo, con el año de la semana (que puede no ser el del día)', () => {
  assert.equal(semanaIso('2027-06-15'), '2027-W24')
  assert.equal(semanaIso('2021-01-04'), '2021-W01', 'lunes 4 de enero de 2021')
  assert.equal(semanaIso('2021-01-03'), '2020-W53', 'domingo: todavía la última semana de 2020')
  assert.equal(semanaIso('2021-01-01'), '2020-W53')
  assert.equal(semanaIso('2020-12-31'), '2020-W53')
  assert.equal(semanaIso('2024-12-30'), '2025-W01', 'el lunes 30 de diciembre de 2024 ya es de 2025')
  assert.equal(semanaIso('2024-12-29'), '2024-W52')
  assert.equal(semanaIso('2027-01-01'), '2026-W53', 'el 1 de enero de 2027 es viernes de la semana 53 de 2026')
  assert.equal(semanaIso('2027-01-04'), '2027-W01')
  // Los siete días de una semana comparten clave; el siguiente lunes, no.
  const semana = ['2027-06-14', '2027-06-15', '2027-06-16', '2027-06-17', '2027-06-18', '2027-06-19', '2027-06-20']
  assert.equal(new Set(semana.map(semanaIso)).size, 1)
  assert.notEqual(semanaIso('2027-06-21'), semanaIso('2027-06-20'))
  assert.notEqual(semanaIso('2027-06-13'), semanaIso('2027-06-14'), 'el domingo anterior es de la semana anterior')
  assert.match(semanaIso('2030-03-03'), /^\d{4}-W\d{2}$/)
})

test('los avisos dicen cuántos lotes, cuántas unidades y qué hacer, en singular y en plural, y el urgente se nota', () => {
  const uno = avisoPorVencer({ lotes: 1, urgentes: 0, unidades: 1, dias: 30 })
  assert.equal(uno.titulo, 'Lotes por vencer')
  assert.match(uno.mensaje, /^1 lote vence en los próximos 30 días, con 1 unidad vendible\./)
  assert.doesNotMatch(uno.mensaje, /de ellos/)
  const varios = avisoPorVencer({ lotes: 4, urgentes: 2, unidades: 37, dias: 30 })
  assert.equal(varios.titulo, 'Lotes por vencer: hay urgentes')
  assert.match(varios.mensaje, /^4 lotes vencen en los próximos 30 días, 2 de ellos dentro de 7 días, con 37 unidades vendibles\./)
  assert.match(avisoPorVencer({ lotes: 3, urgentes: 1, unidades: 5, dias: 30 }).mensaje, /1 de ellos dentro de 7 días/)
  const v1 = avisoVencidos({ lotes: 1, unidades: 1 })
  assert.equal(v1.titulo, 'Mercancía vencida')
  assert.match(v1.mensaje, /^Venció 1 lote y 1 unidad pasó de vendible a dañado \(motivo «Vencido»\)\./)
  assert.match(avisoVencidos({ lotes: 3, unidades: 20 }).mensaje, /^Venció 3 lotes y 20 unidades pasaron de vendible a dañado/)
})

// ── Los filtros de la URL ────────────────────────────────────────────────────

test('los filtros de la URL: la ventana, el estado, la sucursal, el texto y la página; lo inválido vuelve a lo de siempre y lo de siempre no se escribe', () => {
  assert.deepEqual(leerFiltrosVencimientos({}), { dias: 30, pagina: 1 })
  assert.deepEqual(leerFiltrosVencimientos({ dias: '7', estado: 'VENCIDO', sucursal: 'abc', q: ' crema ', pagina: '3' }), { dias: 7, clase: 'VENCIDO', sucursalId: 'abc', q: 'crema', pagina: 3 })
  assert.equal(leerFiltrosVencimientos({ dias: '45' }).dias, 30, 'una ventana que no existe')
  assert.equal('clase' in leerFiltrosVencimientos({ estado: 'VIGENTE' }), false, 'un estado que no existe se ignora')
  assert.equal('clase' in leerFiltrosVencimientos({ estado: 'vencido' }), false, 'y distingue mayúsculas')
  assert.equal(leerFiltrosVencimientos({ pagina: '0' }).pagina, 1)
  assert.equal(leerFiltrosVencimientos({ pagina: '-2' }).pagina, 1)
  assert.equal(leerFiltrosVencimientos({ pagina: 'x' }).pagina, 1)
  assert.equal(leerFiltrosVencimientos({ pagina: '9999999' }).pagina, 1, 'más allá del tope de páginas')
  assert.equal(leerFiltrosVencimientos({ dias: ['60', '7'] }).dias, 60, 'el primero si vienen varios')
  // La consulta omite lo que es el valor de siempre.
  assert.equal(consultaDeFiltrosVencimientos({ dias: 30, pagina: 1 }), '')
  assert.equal(consultaDeFiltrosVencimientos({ dias: 60, clase: 'POR_VENCER', sucursalId: 's1', q: 'a b', pagina: 2 }), 'dias=60&estado=POR_VENCER&sucursal=s1&q=a+b&pagina=2')
  assert.equal(consultaDeFiltrosVencimientos({ dias: 30, pagina: 4 }, 1), '', 'pedir otra página')
  assert.equal(consultaDeFiltrosVencimientos({ dias: 30, pagina: 1 }, 5), 'pagina=5')
  // Ida y vuelta: lo que la pantalla escribe, la pantalla (y el archivo) lo leen igual.
  const f = { dias: 15, clase: 'VENCIDO' as const, sucursalId: 'suc-1', q: 'lote 7', pagina: 3 }
  assert.deepEqual(leerFiltrosVencimientos(Object.fromEntries(new URLSearchParams(consultaDeFiltrosVencimientos(f)))), f)
})

// ── El CSV ───────────────────────────────────────────────────────────────────

const c = (n: string) => costoDeDecimal(n)

function filaDePrueba(o: Partial<FilaVencimiento> = {}): FilaVencimiento {
  return {
    saldoPorLoteId: 'b1',
    loteId: 'l1',
    codigo: 'L-1',
    vencimiento: '2027-06-20',
    clase: 'POR_VENCER',
    urgencia: 'URGENTE',
    diasRestantes: 5,
    texto: 'Vence en 5 días',
    varianteId: 'v1',
    itemId: 'i1',
    nombre: 'Crema',
    sku: 'CR-1',
    sucursalId: 's1',
    sucursalNombre: 'Centro',
    sucursalActiva: true,
    vendible: 6,
    apartado: 2,
    danado: 1,
    costo: null,
    valor: null,
    ...o,
  }
}

function vistaDePrueba(conCostos: boolean, total = 2): VencimientosVista {
  const filas = [
    filaDePrueba({ costo: conCostos ? c('12.5') : null, valor: conCostos ? c('75') : null }),
    filaDePrueba({ saldoPorLoteId: 'b2', loteId: 'l2', codigo: 'VIEJO', vencimiento: '2027-06-10', clase: 'VENCIDO', urgencia: 'VENCIDO', diasRestantes: -5, texto: 'Venció hace 5 días', nombre: 'Jabón', sku: 'JB-1', vendible: 3, apartado: 0, danado: 0 }),
  ]
  return {
    dias: 30,
    hoy: HOY,
    filas,
    total,
    pagina: 1,
    porPagina: 50,
    resumen: { lotes: 2, lotesVencidos: 1, unidades: 9, valor: conCostos ? c('75') : null, unidadesSinCosto: conCostos ? 3 : null },
  }
}

test('vencimientosToCsv: dice la ventana, los filtros y la zona; los días van en negativo si ya venció; lo sin costo va vacío y sin costos no hay dinero', () => {
  const con = vencimientosToCsv(vistaDePrueba(true), { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [['Sucursal', 'Centro']], tope: 20000 })
  assert.match(con, /Lotes que vencen en 30 dias o ya vencieron/)
  assert.match(con, /Ventana \(dias\);30/)
  assert.match(con, /Hoy \(dia de la empresa\);2027-06-15/)
  assert.match(con, /Filtro: Sucursal;Centro/)
  assert.match(con, /Lotes distintos;2/)
  assert.match(con, /Lotes ya vencidos;1/)
  assert.match(con, /Unidades vendibles;9/)
  assert.match(con, /Valor de lo vendible \(solo lo que tiene costo\);75\.00/)
  assert.match(con, /Unidades SIN costo \(no suman al valor\);3/)
  assert.match(con, /Datos completos;Si/)
  assert.match(con, /Producto;SKU;Sucursal;Lote;Vence;Dias restantes;Estado;Urgencia;Vendible;Apartado;Danado;Costo unitario;Valor/)
  assert.match(con, /Crema;CR-1;Centro;L-1;2027-06-20;5;Por vencer;Urgente;6;2;1;12\.50;75\.00/)
  assert.match(con, /Jabón;JB-1;Centro;VIEJO;2027-06-10;-5;Vencidos;Vencido;3;0;0;;$/m, 'vencido: días negativos y costo y valor VACÍOS')
  const sin = vencimientosToCsv(vistaDePrueba(false), { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [], tope: 20000 })
  assert.doesNotMatch(sin, /Costo unitario|Valor de lo vendible|SIN costo/, 'sin la función de costos el archivo no trae dinero')
  assert.match(sin, /Producto;SKU;Sucursal;Lote;Vence;Dias restantes;Estado;Urgencia;Vendible;Apartado;Danado\r?\n/)
  const corto = vencimientosToCsv(vistaDePrueba(true, 30000), { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [], tope: 20000 })
  assert.match(corto, /Datos completos;"?NO - el archivo trae solo los primeros 20000 de 30000 lotes/)
})

test('vencimientosToCsv: un nombre, un SKU o un lote que empiece como una fórmula no se ejecuta al abrir el archivo, y una sucursal desactivada lo dice', () => {
  const v = vistaDePrueba(false)
  v.filas[0] = filaDePrueba({ nombre: '=HYPERLINK("http://x")', sku: '+SUMA(1)', codigo: '@LOTE', sucursalNombre: '-Norte', sucursalActiva: false })
  const csv = vencimientosToCsv(v, { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [['Producto o lote', '=1+1']], tope: 20000 })
  assert.match(csv, /'=HYPERLINK/)
  assert.match(csv, /'\+SUMA\(1\)/)
  assert.match(csv, /'@LOTE/)
  assert.match(csv, /'-Norte \(desactivada\)/)
  assert.match(csv, /Filtro: Producto o lote;'=1\+1/)
  assert.doesNotMatch(csv, /(^|;)=HYPERLINK/m)
})

// ── Guardias ─────────────────────────────────────────────────────────────────

const REPORTES = 'src/app/(admin)/admin/inventario/reportes'

test('INV-5b1 · la descarga se guarda ANTES de tocar la base, la empresa sale de la sesión y el costo solo se lee con «costos»', () => {
  const s = sinComent(leer(`${REPORTES}/vencimientos/exportar/route.ts`))
  assert.match(s, /requireSection\('inventario'\)/)
  assert.doesNotMatch(s, /requireSection\('inventario', '/, 'la función «costos» NO es requisito para descargar: solo decide si el archivo lleva dinero')
  assert.match(s, /if \(!user\) return NextResponse\.json\(\{ error: 'No autorizado\.' \}, \{ status: 403 \}\)/)
  assert.match(s, /resolveCompanyId\(user\)/)
  assert.ok(s.indexOf('requireSection(') < s.indexOf('conEmpresa('), 'toca la base antes de autorizar')
  assert.match(s, /const conCostos = await puedeFuncion\('inventario', 'costos'\)/)
  assert.ok(s.indexOf("puedeFuncion('inventario', 'costos')") < s.indexOf('conEmpresa('), 'decide los costos antes de leer')
  assert.match(s, /vencimientosEnTx\(tx, companyId, [^)]*[{,]\s*conCostos\s*[,}]/, 'no pasa SU conCostos a la lectura (ni un true fijo)')
  assert.match(s, /todas: true/, 'el archivo trae todo (hasta su tope), no una página')
  assert.doesNotMatch(s, /\bprisma\./)
  assert.match(s, /respuestaCsv\(/)
  assert.match(s, /sucursalesDeLaEmpresaEnTx\(tx, companyId\)/, 'la sucursal de la URL solo filtra si es de la empresa')
  assert.match(s, /delete f\.sucursalId/)
  assert.match(s, /leerFiltrosVencimientos\(crudo\)/, 'lee la URL con la misma función que la pantalla')
})

test('INV-5b1 · la pantalla pide los costos a «costos», se los pasa a la lectura y enseña dinero solo si la lectura lo trajo', () => {
  const s = sinComent(leer(`${REPORTES}/vencimientos/page.tsx`))
  assert.match(s, /const conCostos = await puedeFuncion\('inventario', 'costos'\)/)
  assert.match(s, /vencimientosEnTx\(tx, companyId, [^)]*[{,]\s*conCostos\s*[,}]/, 'no pasa SU conCostos (ni un true fijo)')
  assert.doesNotMatch(s, /\|\|\s*(true|1)\b/, 'una condición que siempre se cumple')
  assert.match(s, /<NavegacionInventario actual="reportes"/)
  assert.match(s, /<BotonExportar /, 'usa el botón compartido')
  assert.doesNotMatch(s, /<a [^>]*exportar|download=/, 'sin botón de exportar a mano')
  assert.match(s, /describirFalloDeCarga\(/, 'dice por qué no cargó')
  assert.match(s, /requireRole\(ADMIN_ROLES\)/)
  assert.match(s, /requireCompanyContext\(user\)/)
  assert.match(s, /if \(!sucursales\.some\(\(s\) => s\.id === f\.sucursalId\)\) delete f\.sucursalId/, 'la sucursal de la URL solo vale si es de esta empresa')
  assert.doesNotMatch(s, /@\/lib\/prisma|from '@prisma\/client'/, 'la página no abre su propia conexión')
  for (const uso of s.matchAll(/formatear(?:Monto|Costo)\(/g)) {
    const antes = s.slice(Math.max(0, uso.index! - 400), uso.index!)
    assert.match(antes, /conCostos|v\.resumen\.valor !== null/, `dinero sin condición de costos → …${antes.slice(-120)}`)
  }
  assert.match(s, /\{v\.resumen\.valor !== null && \(\s*<Card aria-label="Dinero en riesgo">/)
  assert.match(s, /\{conCostos && \(v\.resumen\.unidadesSinCosto \?\? 0\) > 0 && \(/)
  assert.match(s, /\{conCostos &&\s*\(l\.valor === null \|\| l\.costo === null/)
  // El hub la ofrece (a todos: no pide «costos») y solo habla de dinero a quien puede verlo.
  const hub = sinComent(leer(`${REPORTES}/page.tsx`))
  assert.match(hub, /href: '\/admin\/inventario\/reportes\/vencimientos'/)
  assert.doesNotMatch(hub.slice(hub.indexOf("'/admin/inventario/reportes/vencimientos'"), hub.indexOf("'/admin/inventario/reportes/rotacion'")), /soloCostos/, 'no es un informe solo para quien ve costos')
  for (const ruta of ['/admin/inventario/reportes/vencimientos', '/admin/inventario/reportes/vencimientos/exportar']) assert.equal(adminSectionForPath(ruta), 'inventario', ruta)
})

test('INV-5b1 · las lecturas solo LEEN, escriben la empresa en CADA consulta y el costo ni se une sin «conCostos»', () => {
  const f = sinComent(leer('src/modules/inventory/vencimientos-queries.ts'))
  assert.doesNotMatch(f, /\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$executeRaw|INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM/i, 'una lectura no escribe')
  assert.doesNotMatch(f, /Prisma\.raw\(|\$queryRawUnsafe/, 'nada se concatena a mano')
  const sqls = [...f.matchAll(/\$queryRaw<[^>]*>`([\s\S]*?)`/g)]
  assert.equal(sqls.length, 3, 'filas, totales y resumen; si cambia, revisa esta prueba')
  for (const [, sql] of sqls) assert.match(sql, /\$\{companyId\}|\$\{desde\}/, `una consulta sin la empresa → ${sql.slice(0, 80)}`)
  // El FROM compartido filtra por la empresa y cada unión también (un id ajeno no cruza empresas).
  const desde = f.slice(f.indexOf('const desde = Prisma.sql`'), f.indexOf('const resumenFilas'))
  assert.match(desde, /WHERE b\."companyId" = \$\{companyId\}/)
  for (const union of desde.matchAll(/JOIN "(\w+)" (\w+) ON ([^\n]+)/g)) assert.match(union[3], /"companyId"/, `la unión con ${union[1]} no ata la empresa`)
  // Los costos: la tabla ni se une sin la función, y la columna es un NULL constante.
  assert.match(f, /const costoSql = opciones\.conCostos \? Prisma\.sql`COALESCE\(c\."averageCost", v\."cost"\)` : Prisma\.sql`NULL::numeric`/)
  assert.match(f, /const unirCostos = opciones\.conCostos \? Prisma\.sql`LEFT JOIN "inventory_variant_costs" c ON [^`]*"companyId" = v\."companyId"` : Prisma\.empty/)
  assert.match(f, /valor: opciones\.conCostos \? costoDeDecimal\(r\?\.valor \?\? 0\) : null/)
  assert.match(f, /unidadesSinCosto: opciones\.conCostos \? Number\(r\?\.sinCosto \?\? 0\) : null/)
  // El resumen del dashboard y del aviso no lee costos NUNCA.
  const resumen = f.slice(f.indexOf('export async function resumenVencimientosEnTx'))
  assert.doesNotMatch(resumen, /cost|Cost/, 'el resumen son conteos: ningún costo')
  assert.match(resumen, /tx\.inventoryLotTracking\.findFirst\(\{ where: \{ companyId \}/)
  // Lo vendible es lo que hay menos lo apartado; lo dañado no cuenta.
  assert.match(f, /b\."onHand" > 0/, 'solo lotes con existencias vendibles o apartadas')
  assert.match(f, /l\."expiresOn" IS NOT NULL AND l\."expiresOn" <= \$\{limite\}::date/, 'sin fecha nunca sale; el día del límite entra')
  assert.match(f, /AND l\."expiresOn" < \$\{hoy\}::date/, 'vencido: su día ya pasó (hoy todavía se vende)')
  assert.match(f, /AND l\."expiresOn" >= \$\{hoy\}::date/)
  assert.match(f, /ORDER BY l\."expiresOn" ASC, i\."name", v\."sku", l\."code", s\."nombre", b\."id"/, 'orden total: lo que antes vence primero y el empate no depende de la base')
})

test('INV-5b1 · lo PURO sigue siendo puro y el aviso del barrido tiene sus claves, su orden y su red', () => {
  const pura = leer('src/modules/inventory/vencimientos.ts')
  assert.doesNotMatch(pura, /server-only|from '@\/lib\/prisma'|from '@\/lib\/tenant'|@prisma\/client'/, 'vencimientos.ts debe ser puro')
  assert.doesNotMatch(sinComent(pura), /new Date\(\)|Date\.now\(\)/, 'este módulo nunca mira el reloj: «hoy» lo da quien llama, en la zona de la empresa')
  const a = sinComent(leer('src/modules/inventory/avisos.ts'))
  const aviso = a.slice(a.indexOf('export async function avisarVencimientos'))
  assert.match(aviso, /dedupeKey: `lotes-por-vencer:\$\{companyId\}:\$\{semanaIso\(dia\)\}:\$\{nivel\}`/, 'una vez por semana y por nivel de urgencia')
  assert.match(aviso, /dedupeKey: `lotes-vencidos:\$\{companyId\}:\$\{dia\}`/, 'una vez por día')
  assert.match(aviso, /const nivel = resumen\.porVencer\.urgentes > 0 \? 'urgente' : 'normal'/, 'el nivel va en la clave: la escalada a urgente avisa otra vez')
  assert.match(aviso, /resumen\.llevaLotes && resumen\.porVencer\.lotes > 0/, 'una empresa sin lotes no recibe nada')
  assert.match(aviso, /v && v\.unidades > 0/, 'sin unidades sacadas no hay aviso de vencidos')
  assert.match(aviso, /catch \(e\) \{[\s\S]*return 0/, 'best-effort: nunca lanza')
  assert.match(aviso, /diaLocal\(ahora, zona\)/, 'el día y la semana son los de la empresa')
  const b = sinComent(leer('src/modules/inventory/barrido.ts'))
  assert.match(b, /VENTANA_POR_DEFECTO \+ 1\) \* 86_400_000/, 'el barrido recorre también las empresas con lotes dentro de la ventana de aviso')
  assert.match(b, /avisosDeVencimiento \+= await avisarVencimientos\(companyId, \{ ahora, \.\.\.\(lotes\.unidades > 0 \? \{ vencidos: lotes \} : \{\}\) \}\)/)
  assert.ok(b.indexOf('vencerLotesEnTx(tx, companyId, ahora)') < b.indexOf('avisarVencimientos(companyId'), 'avisa DESPUÉS de barrer')
  // Y la tarjeta del dashboard no lee dinero para esto.
  const d = sinComent(leer('src/modules/inventory/dashboard.ts'))
  assert.match(d, /resumenVencimientosEnTx\(tx, companyId, \{ zonaHoraria, ahora: opciones\.ahora \}\)/)
})

test('INV-5b1 · la tarjeta del dashboard ofrece «Vence pronto» solo si la empresa lleva lotes, lleva a lo vencido cuando lo hay y no pinta dinero', () => {
  const t = sinComent(leer('src/components/admin/TarjetaInventario.tsx'))
  const desde = t.indexOf('{resumen.vencimientos.llevaLotes ? (')
  assert.ok(desde > 0, 'la cifra cuelga de que la empresa lleve lotes')
  const tile = t.slice(desde, t.indexOf('/admin/inventario/reportes/mermas'))
  assert.match(tile, /href=\{resumen\.vencimientos\.vencidos\.lotes > 0 \? '\/admin\/inventario\/reportes\/vencimientos\?estado=VENCIDO' : '\/admin\/inventario\/reportes\/vencimientos'\}/, 'con algo vencido lleva directo a lo vencido')
  assert.match(tile, /resumen\.vencimientos\.porVencer\.lotes === 0 && resumen\.vencimientos\.vencidos\.lotes === 0/, 'dice que no vence nada solo si tampoco hay vencidos')
  assert.doesNotMatch(tile, /dinero\(|formatMoney|\.valor\b/, 'es de conteos: sin la función de costos también se ve')
  assert.match(t, /const n = 2 \+ \(r\.conCostos \? 1 : 0\) \+ \(r\.vencimientos\.llevaLotes \? 1 : 0\)/, 'las columnas cuentan sus cifras')
  const d = sinComent(leer('src/modules/inventory/dashboard.ts'))
  assert.match(d, /vencimientos: ResumenVencimientos/)
  assert.match(d, /return \{ mes, conCostos: opciones\.conCostos, unidadesEnExistencia, valor, unidadesSinCosto, margen, perdido, vencimientos \}/)
})
