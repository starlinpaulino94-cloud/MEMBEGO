import './support/sin-server-only'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SateliteUsoCard } from '../src/components/superadmin/SateliteUsoCard'

/**
 * LAS TABLAS RESTANTES DEL PANEL, EN LA `Tabla` DEL SISTEMA (auditoría admin · fase 7, tarea 7.1).
 *
 * Quince `<table>` a mano más: adquisición, audiencia, retención, riesgo, regalos (dos), registros, seguimiento, invitaciones y, en la
 * plataforma, solicitudes, campañas (lista y ficha), membresías, observabilidad y la tarjeta de uso de un satélite. Se quedan a mano,
 * a propósito, tres tipos de tabla: las que son PAPEL (la hoja que se imprime de registros y de seguimiento), las de Car Wash (su
 * futuro es decisión del dueño) y la de concesiones (cada fila es un componente de cliente que se despliega).
 */

const leer = (r: string) => readFileSync(r, 'utf8')
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const A = 'src/app/(admin)/admin/'
const S = 'src/app/(superadmin)/superadmin/'

const MIGRADAS: Record<string, { tabla: string; caption: string }[]> = {
  [A + 'adquisicion/page.tsx']: [{ tabla: 'Tabla', caption: 'Últimos registros' }],
  [A + 'audiencia/page.tsx']: [{ tabla: 'Tabla', caption: 'Rendimiento por promoción' }],
  [A + 'retencion/page.tsx']: [{ tabla: 'Tabla', caption: 'Consumo por plan' }],
  [A + 'riesgo/page.tsx']: [{ tabla: 'Tabla', caption: 'Clientes en riesgo' }],
  [A + 'regalos/page.tsx']: [
    { tabla: 'Tabla', caption: 'Regalos' },
    { tabla: 'Tabla', caption: 'Tarjetas de regalo' },
  ],
  [A + 'registros/page.tsx']: [{ tabla: 'Tabla', caption: 'Comprobantes' }],
  [A + 'seguimiento/page.tsx']: [{ tabla: 'Tabla', caption: 'Recompensas entregadas' }],
  [A + 'invitaciones/[id]/page.tsx']: [{ tabla: 'Tabla', caption: 'Quienes más comparten' }],
  [S + 'solicitudes/page.tsx']: [{ tabla: 'Tabla', caption: 'Solicitudes de negocios' }],
  [S + 'campanas/page.tsx']: [{ tabla: 'Tabla', caption: 'Campañas conjuntas con su tipo, empresas alcanzadas y estado' }],
  [S + 'campanas/[id]/page.tsx']: [{ tabla: 'Tabla', caption: 'Empresas de la campaña' }],
  [S + 'membresias/page.tsx']: [{ tabla: 'Tabla', caption: 'Membresías de todas las empresas' }],
  [S + 'observabilidad/page.tsx']: [{ tabla: 'Tabla', caption: 'Objetivos de servicio' }],
  'src/components/superadmin/SateliteUsoCard.tsx': [{ tabla: 'Tabla', caption: 'Endpoints más llamados' }],
}

test('cada pantalla migrada usa la Tabla, con su título, y ya no pinta la tabla a mano', () => {
  for (const [f, tablas] of Object.entries(MIGRADAS)) {
    const fuente = leer(f)
    const limpio = sinComentarios(fuente)
    assert.match(fuente, /import \{ Tabla[ ,}][^\n]*from '@\/components\/ui\/tabla'/, `${f}: no importa Tabla`)
    for (const t of tablas) {
      assert.match(limpio, /<Tabla\b/, f)
      assert.ok(fuente.includes(`caption="${t.caption}"`), `${f}: falta caption="${t.caption}"`)
    }
    // Las tablas que quedan a mano en estos archivos son las de papel: se cuentan una a una.
    const quedan = (limpio.match(/<table\b/g) ?? []).length
    assert.equal(quedan, f === A + 'registros/page.tsx' ? 1 : 0, `${f}: <table> a mano que quedan`)
  }
})

test('los mapas «estado → clases de color» de estas pantallas pasaron a tonos del EstadoChip', () => {
  const maps: [string, string[], string[]][] = [
    [A + 'regalos/page.tsx', ['GIFTCARD_CHIP', 'ESTADO_CHIP'], ['TONO_GIFTCARD', 'TONO_REGALO']],
    [A + 'registros/page.tsx', ['ESTADO_CHIP'], ['TONO_COMPROBANTE']],
    [A + 'seguimiento/page.tsx', ['ESTADO_CHIP'], ['TONO_SEGUIMIENTO']],
    [S + 'campanas/page.tsx', ['CHIP_ESTADO'], ['TONO_CAMPANA']],
  ]
  for (const [f, viejos, nuevos] of maps) {
    const fuente = leer(f)
    for (const v of viejos) assert.equal(fuente.includes(v), false, `${f} conserva ${v}`)
    for (const n of nuevos) assert.match(fuente, new RegExp(`const ${n}: Record<string, TonoEstado>`), `${f}: falta ${n}`)
    assert.match(fuente, /<EstadoChip tono=/, f)
  }
})

test('los tonos conservan el significado de los colores de antes', () => {
  const tono = (f: string, mapa: string, estado: string) => leer(f).match(new RegExp(`const ${mapa}: Record<string, TonoEstado> = \\{([\\s\\S]*?)\\n\\}`))![1]!.match(new RegExp(`${estado}: '(\\w+)'`))?.[1]
  assert.equal(tono(A + 'regalos/page.tsx', 'TONO_REGALO', 'PENDIENTE'), 'aviso')
  assert.equal(tono(A + 'regalos/page.tsx', 'TONO_REGALO', 'ACEPTADO'), 'exito')
  assert.equal(tono(A + 'regalos/page.tsx', 'TONO_REGALO', 'RECHAZADO'), 'peligro')
  assert.equal(tono(A + 'regalos/page.tsx', 'TONO_REGALO', 'EXPIRADO'), 'neutro')
  assert.equal(tono(A + 'regalos/page.tsx', 'TONO_GIFTCARD', 'PENDIENTE_PAGO'), 'aviso')
  assert.equal(tono(A + 'regalos/page.tsx', 'TONO_GIFTCARD', 'CANCELADA'), 'peligro')
  assert.equal(tono(A + 'registros/page.tsx', 'TONO_COMPROBANTE', 'APPLIED'), 'exito')
  assert.equal(tono(A + 'registros/page.tsx', 'TONO_COMPROBANTE', 'REVERTED'), 'aviso')
  assert.equal(tono(A + 'seguimiento/page.tsx', 'TONO_SEGUIMIENTO', 'SIN_USAR'), 'aviso')
  assert.equal(tono(A + 'seguimiento/page.tsx', 'TONO_SEGUIMIENTO', 'VENCIDO'), 'peligro')
  assert.equal(tono(S + 'campanas/page.tsx', 'TONO_CAMPANA', 'APLICADA_PARCIAL'), 'aviso')
})

test('riesgo y retención se imprimen: ninguna de sus columnas se oculta en pantallas estrechas', () => {
  for (const f of [A + 'riesgo/page.tsx', A + 'retencion/page.tsx']) {
    assert.match(leer(f), /ReporteImprimible/, f)
    assert.doesNotMatch(sinComentarios(leer(f)), /prioridad:\s*[23]/, `${f} oculta columnas en el papel`)
  }
})

test('los botones de cada fila siguen apareciendo solo cuando procedía', () => {
  const regalos = leer(A + 'regalos/page.tsx')
  assert.match(regalos, /r\.estado === 'PENDIENTE' \?\s*\(\s*<CancelarRegaloAdminButton/, 'cancelar un regalo, solo si está pendiente')
  assert.match(regalos, /<GiftCardAdminActions giftCardId=\{g\.id\}/)
  const registros = leer(A + 'registros/page.tsx')
  assert.match(registros, /r\.estado === 'APPLIED' && <AnularTransaccionButton/, 'anular, solo una venta aplicada')
  assert.match(registros, /<FacturaPrintDialog transactionId=\{r\.id\}/)
  const membresias = leer(S + 'membresias/page.tsx')
  assert.match(membresias, /<DeleteMembresiaButton/, 'el botón de borrar se pinta siempre, a propósito')
  assert.match(membresias, /m\.empresaId === empresaActiva/, 'la ficha del cliente solo es enlace si es la empresa activa')
})

test('la lista de membresías distingue «no hay nada» de «ningún resultado» y los dos tienen su texto', () => {
  const membresias = leer(S + 'membresias/page.tsx')
  assert.match(membresias, /hayFiltros=\{hayFiltro\(f\)\}/)
  assert.match(membresias, /vacio=\{\{ titulo: 'No hay membresías' \}\}/)
  assert.match(membresias, /titulo: 'Sin resultados con estos filtros'/)
  assert.match(membresias, /href=\{BASE\} className="text-primary hover:underline"/, 'sigue ofreciendo «Limpiar»')
})

test('la tarjeta de uso de un satélite pinta su tabla con título, marca los errores y no oculta lo importante', () => {
  const satelite = {
    sistemaId: 's1',
    slug: 'car-wash',
    nombre: 'Car Wash',
    estado: 'ACTIVE',
    resumen: {
      total: 1500,
      errores: 3,
      tasaError: 0.002,
      porEndpoint: [
        { endpoint: '/v1/clientes', metodo: 'GET', peticiones: 1200, errores: 0 },
        { endpoint: '/v1/visitas', metodo: 'POST', peticiones: 300, errores: 3 },
      ],
    },
  }
  const out = renderToStaticMarkup(h(SateliteUsoCard, { satelite: satelite as never, dias: 30 }))
  assert.match(out, /<caption[^>]*>Endpoints más llamados</)
  assert.match(out, /<th[^>]*scope="row"[^>]*><span class="font-mono"><span class="text-muted-foreground">GET<\/span> \/v1\/clientes/)
  assert.match(out, /<td[^>]*text-right[^>]*>1[.,\s ]?200</)
  assert.match(out, /text-warning">3</, 'los errores se marcan')
  assert.match(out, /text-muted-foreground">—</, 'sin errores se dice con un guion')
  assert.doesNotMatch(out, /max-(md|lg):hidden/)
})
