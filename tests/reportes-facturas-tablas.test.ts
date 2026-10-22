import './support/sin-server-only'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComprobantesTabla, estadoDeComprobante, totalDeComprobante, type ComprobanteFila } from '../src/components/facturas/ComprobantesTabla'
import { TablaDetalle } from '../src/components/reportes/TablaDetalle'
import type { MetaCampo } from '../src/modules/reportes/orden-detalle'

/**
 * COMPROBANTES Y DETALLES DE REPORTES EN LA `Tabla` DEL SISTEMA (auditoría admin · fase 7, tarea 7.1).
 *
 * Cinco `<table>` a mano pasan a la primitiva: el historial de comprobantes y los cuatro detalles de reportes (finanzas, operación,
 * citas y membresías). Lo delicado de los detalles es que ordenar CAMBIA LA CONSULTA (la lista viene recortada a 300): la cabecera sigue
 * siendo un enlace, y solo es enlace la columna que es un campo de la pantalla.
 */

const html = (n: unknown) => renderToStaticMarkup(n as never)
const leer = (r: string) => readFileSync(r, 'utf8')
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const DETALLES = ['finanzas', 'operacion', 'citas', 'membresias'].map((r) => `src/app/(admin)/admin/reportes/${r}/detalle/page.tsx`)

test('ni los comprobantes ni los detalles de reportes pintan ya una <table> a mano', () => {
  for (const f of [...DETALLES, 'src/app/(admin)/admin/facturas/page.tsx']) {
    assert.equal(/<table\b/.test(sinComentarios(leer(f))), false, f)
  }
})

test('la pantalla de comprobantes ya no lleva sus mapas de color ni sus formateadores', () => {
  const pagina = leer('src/app/(admin)/admin/facturas/page.tsx')
  for (const viejo of ['ESTADO_CHIP', 'ESTADO_LABEL', 'TIPO_LABEL', 'fmtRD', 'fmtFecha']) assert.equal(pagina.includes(viejo), false, viejo)
  assert.match(pagina, /<ComprobantesTabla/)
  // La paginación es el pie de la tabla (y solo existe si hay filas, porque la tabla solo se pinta entonces).
  assert.match(pagina, /pie=\{<TablaPaginacion paginacion=\{paginacion\} total=\{totalFacturas\} params=\{sp\} etiqueta="comprobantes" \/>\}/)
  assert.equal((pagina.match(/<TablaPaginacion/g) ?? []).length, 1)
})

// ── Comprobantes ────────────────────────────────────────────────────────────────────────────────────────────────────

const fila = (p: Partial<ComprobanteFila> = {}): ComprobanteFila => ({
  id: 'c1',
  ticketNumero: 'T-0001',
  codigo: 'TX-AAAA',
  tipo: 'SALE',
  cliente: 'Ana Pérez',
  detalle: 'Lavado completo',
  detalleSecundario: 'Efectivo · Sede Norte',
  empleado: 'Luis',
  monto: 1500,
  estado: 'APPLIED',
  impresiones: 0,
  creado: new Date('2026-10-01T15:30:00Z'),
  accion: h('button', { type: 'button', id: 'reimprimir' }, 'Ver'),
  ...p,
})

test('comprobantes · caption, el comprobante como identificador, total a la derecha y la acción de reimprimir', () => {
  const out = html(h(ComprobantesTabla, { filas: [fila()], pie: h('p', { id: 'pie' }, 'Mostrando 1–1') }))
  assert.match(out, /<caption[^>]*>Comprobantes</)
  assert.match(out, /<th[^>]*scope="row"[^>]*>[\s\S]*T-0001[\s\S]*TX-AAAA/)
  assert.match(out, /text-right[^>]*><span[^>]*>RD\$1,500\.00|text-right[^>]*><span[^>]*>RD\$1\.500,00/)
  assert.match(out, /Pagada/)
  assert.match(out, /Venta/)
  assert.match(out, /id="reimprimir"/)
  assert.match(out, /<th[^>]*scope="col"[^>]*><span class="sr-only">Reimprimir<\/span>/)
  assert.match(out, /id="pie"/)
  assert.match(out, /<time dateTime="2026-10-01T15:30:00\.000Z"/)
  assert.match(out, /Efectivo · Sede Norte/)
})

test('comprobantes · el total, el estado y las impresiones se dicen como antes', () => {
  assert.equal(totalDeComprobante('SALE', 0), '—')
  assert.equal(totalDeComprobante('SALE', null), '—')
  assert.equal(totalDeComprobante('MEMBERSHIP_REDEMPTION', null), 'GRATIS')
  assert.equal(totalDeComprobante('MEMBERSHIP_REDEMPTION', 0), 'GRATIS')
  assert.match(totalDeComprobante('SALE', 25), /^RD\$25[.,]00$/)

  assert.deepEqual(estadoDeComprobante('CANCELLED'), { etiqueta: 'Cancelada', tono: 'peligro' })
  assert.deepEqual(estadoDeComprobante('REVERTED'), { etiqueta: 'Revertida', tono: 'aviso' })
  assert.deepEqual(estadoDeComprobante('ALGO_NUEVO'), { etiqueta: 'ALGO_NUEVO', tono: 'neutro' })

  const una = html(h(ComprobantesTabla, { filas: [fila({ impresiones: 1 })] }))
  assert.match(una, /1 impresión</)
  const varias = html(h(ComprobantesTabla, { filas: [fila({ impresiones: 3 })] }))
  assert.match(varias, /3 impresiones</)
  assert.doesNotMatch(html(h(ComprobantesTabla, { filas: [fila()] })), /impresi/)
})

test('comprobantes · sin cliente ni detalle se dice «Sin dato», el empleado va bajo el cliente, el tipo y la fecha con el comprobante', () => {
  const out = html(h(ComprobantesTabla, { filas: [fila({ cliente: null, detalle: null, empleado: null })] }))
  assert.ok((out.match(/Sin dato/g) ?? []).length >= 1)
  const con = html(h(ComprobantesTabla, { filas: [fila()] }))
  assert.match(con, /Ana Pérez<\/span><span class="block whitespace-nowrap text-caption text-muted-foreground">Atendió Luis/)
  assert.match(con, /<th[^>]*scope="row"[\s\S]*?Venta ·[\s\S]*?<time dateTime="2026-10-01T15:30:00\.000Z"/, 'el tipo y la fecha van con el comprobante')
  assert.doesNotMatch(out, /Atendió/)
  const th = (t: string) => out.match(new RegExp(`<th[^>]*>${t}</th>`))?.[0] ?? ''
  assert.doesNotMatch(th('Total'), /hidden/)
  assert.doesNotMatch(th('Estado'), /hidden/)
  assert.match(th('Detalle'), /max-lg:hidden/)
  assert.equal((out.match(/<th[^>]*scope="col"/g) ?? []).length, 6, 'seis columnas: la reimpresión cabe en un escritorio')
})

// ── Detalles de reportes ────────────────────────────────────────────────────────────────────────────────────────────

const CAMPOS: MetaCampo[] = [
  { clave: 'fecha', label: 'Cuándo', inicial: 'desc', tope: () => 'las más recientes' },
  { clave: 'cliente', label: 'Cliente', inicial: 'asc', tope: () => 'por cliente' },
]
type Fila = { id: string; fecha: string; cliente: string; motivo: string | null }
const FILAS: Fila[] = [{ id: 'a', fecha: 'ayer', cliente: 'Ana', motivo: null }]
const COLUMNAS = [
  { clave: 'fecha', encabezado: 'Cuándo', valor: (f: Fila) => f.fecha },
  { clave: 'cliente', encabezado: 'Cliente', valor: (f: Fila) => f.cliente },
  { clave: 'motivo', encabezado: 'Motivo', valor: (f: Fila) => f.motivo },
]
const detalle = (orden: { clave: string; direccion: 'asc' | 'desc' }) =>
  html(
    h(TablaDetalle<Fila>, {
      caption: 'Pagos del mes',
      columnas: COLUMNAS,
      filas: FILAS,
      claveDe: (f: Fila) => f.id,
      campos: CAMPOS,
      orden,
      enlaceOrden: (clave: string) => `/r?o=${clave}`,
    })
  )

test('detalle · solo es enlace de orden la columna que es un campo de la pantalla', () => {
  const out = detalle({ clave: 'fecha', direccion: 'desc' })
  assert.match(out, /<caption[^>]*>Pagos del mes</)
  assert.match(out, /<a[^>]*href="\/r\?o=fecha"/)
  assert.match(out, /<a[^>]*href="\/r\?o=cliente"/)
  assert.doesNotMatch(out, /href="\/r\?o=motivo"/, '«Motivo» no es un campo: no se puede pedir ordenar por él')
  assert.match(out, /<th[^>]*>Motivo<\/th>/)
})

test('detalle · el orden vigente se dice con aria-sort y el cliente es el identificador de la fila', () => {
  const out = detalle({ clave: 'fecha', direccion: 'desc' })
  assert.match(out, /<th[^>]*aria-sort="descending"[^>]*>[\s\S]*Cuándo/)
  assert.doesNotMatch(out.match(/<th[^>]*>[^<]*<a[^>]*o=cliente[\s\S]*?<\/th>/)?.[0] ?? '', /aria-sort/)
  assert.match(out, /<th[^>]*scope="row"[^>]*>Ana</)
  const ascendente = detalle({ clave: 'cliente', direccion: 'asc' })
  assert.match(ascendente, /aria-sort="ascending"/)
})

test('detalle · ninguna columna se oculta en pantallas estrechas (un reporte se imprime y el papel cuenta como pantalla estrecha)', () => {
  const out = detalle({ clave: 'fecha', direccion: 'desc' })
  assert.doesNotMatch(out, /max-(md|lg):hidden/)
  for (const f of DETALLES) {
    const fuente = readFileSync(f, 'utf8')
    assert.doesNotMatch(fuente, /prioridad:\s*[23]/, `${f} oculta columnas`)
  }
})

test('cada detalle pasa a la tabla sus campos, su orden y su enlace de orden, y ninguna columna lleva una clave que choque con un dato oculto', () => {
  for (const f of DETALLES) {
    const fuente = readFileSync(f, 'utf8')
    assert.match(fuente, /<TablaDetalle\b/, f)
    assert.match(fuente, /campos=\{(campos|CAMPOS)\}/, f)
    assert.match(fuente, /enlaceOrden=\{enlaceOrden\}/, f)
    if (fuente.includes('ver_empleados')) {
      // Un dato que el permiso esconde no se puede ordenar: ni su columna lleva la clave de un campo ni hay un campo suyo.
      for (const prohibida of ["clave: 'empleado'", "clave: 'atendida'", "clave: 'revertidaPor'"]) assert.equal(fuente.includes(prohibida), false, `${f}: ${prohibida}`)
    }
  }
})
