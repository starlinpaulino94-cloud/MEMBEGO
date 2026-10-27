import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResumenPanel } from '../src/components/admin/resumen/ResumenPanel'
import type { DatosResumen } from '../src/modules/admin/resumen/consultas'
import { bloquesDelResumen, type BloquesResumen } from '../src/modules/admin/resumen/bloques'
import { seccionPermitida, type AdminSection } from '../src/lib/auth/permissions'
import type { AppRole } from '../src/types'

/**
 * EL RESUMEN SE PINTA SOLO CON LO QUE LLEGÓ Y SOLO ENLAZA A LO QUE SE PUEDE ABRIR (auditoría admin · fase 5, 5.1; D-01, D-07).
 *
 * Se renderiza la pieza real a HTML (`renderToStaticMarkup`) con datos de ejemplo y se miran las dos garantías que importan:
 * sin permiso no hay enlace —`ve` decide—, y lo que el motor no entregó no se pinta, ni siquiera como hueco.
 */

const REGIONAL = { moneda: 'DOP', idioma: 'es-DO', zonaHoraria: 'America/Santo_Domingo' }

const DATOS_ADMIN: DatosResumen = {
  ventanaMes: '1–20 oct 2026',
  ventanaAnterior: '1–20 sep',
  pagos: { total: 5, transferencias: 2, sucursal: 1, compras: 1, cambios: 1, montoTransferencias: 46_500 },
  vencen: { total: 6, proximos: [{ nombre: 'Rafael Mejía', fecha: new Date('2026-10-21T12:00:00Z') }, { nombre: 'Yamilet Núñez', fecha: new Date('2026-10-22T12:00:00Z') }] },
  mostrador: { canjesHoy: 12, citasHoy: 4, porEmpleado: [{ nombre: 'Rosa Amparo', total: 5 }] },
  mes: {
    ingresos: { valor: 68_400, anterior: 57_700, variacion: 19 },
    membresias: { vigentes: 23, porVencer7: 6 },
    canjes: { mes: 241, hoy: 12 },
    clientesNuevos: 44,
  },
  serie: { tipo: 'canjes', dias: Array.from({ length: 14 }, (_, i) => ({ fecha: `2026-10-${String(7 + i).padStart(2, '0')}`, total: i % 5 })) },
}

const BLOQUES_ADMIN: BloquesResumen = bloquesDelResumen({ puede: () => true, conFinanzas: true, conEmpleados: true })

const pinta = (datos: DatosResumen, bloques: BloquesResumen, ve: (h: string) => boolean) =>
  renderToStaticMarkup(
    h(ResumenPanel, { datos, bloques, ve, company: REGIONAL, fecha: 'martes, 20 de octubre de 2026' }) as never
  )

test('con permiso para todo: enlaza a la cola concreta y enseña el dinero con su ventana', () => {
  const html = pinta(DATOS_ADMIN, BLOQUES_ADMIN, () => true)
  assert.match(html, /href="\/admin\/pagos\?cola=transferencias"/)
  assert.match(html, /href="\/admin\/pagos"/)
  assert.match(html, /Ingresos del mes/)
  assert.match(html, /RD\$68,400/)
  assert.match(html, /1–20 oct 2026/)
  assert.match(html, /frente a 1–20 sep/, 'la comparación dice contra qué tramo es')
  assert.match(html, /Transferencias[\s\S]*2 · RD\$46,500/, 'el monto de las transferencias, con permiso de finanzas')
})

test('sin ninguna sección abrible NO queda ni un enlace al panel, aunque lleguen los datos (D-07)', () => {
  const html = pinta(DATOS_ADMIN, BLOQUES_ADMIN, () => false)
  assert.doesNotMatch(html, /href="\/admin/, 'ningún enlace a /admin cuando ve() dice que no')
  // El contenido informativo sigue (la persona ve el dato, no el atajo).
  assert.match(html, /Pagos por validar/)
})

test('el supervisor sin dinero (se le negó ver_financieros): el motor no entrega ingresos y NO aparece ningún «RD$»', () => {
  const sinDinero: DatosResumen = {
    ...DATOS_ADMIN,
    pagos: { ...DATOS_ADMIN.pagos!, montoTransferencias: null },
    mes: { ...DATOS_ADMIN.mes, ingresos: undefined },
  }
  const bloques = bloquesDelResumen({ puede: () => true, conFinanzas: false, conEmpleados: true })
  const html = pinta(sinDinero, bloques, () => true)
  assert.doesNotMatch(html, /RD\$/, 'ni una cifra de dinero')
  assert.doesNotMatch(html, /Ingresos del mes/, 'ni la tarjeta: el bloque no existe')
  assert.doesNotMatch(html, /Sin permiso/, 'y tampoco un hueco que lo diga')
  assert.match(html, /Membresías activas/)
})

test('Marketing: bloques propios, la interacción dice «Sin dato» y no hay pagos, canjes ni dinero', () => {
  const rolAdmin = (role: AppRole) => (s: AdminSection) => seccionPermitida(role, s, null)
  const bloques = bloquesDelResumen({ puede: rolAdmin('MARKETING'), conFinanzas: false, conEmpleados: false })
  const datos: DatosResumen = {
    ventanaMes: '1–20 oct 2026',
    ventanaAnterior: '1–20 sep',
    riesgo: { vencen7: 6, sinVisitas30: 11 },
    promosVencen: { total: 2, items: [{ id: 'p1', titulo: 'Combo Día de Playa 2×1', hasta: new Date('2026-10-23T12:00:00Z') }] },
    mes: {
      registros: { total: 44, porOrigen: [{ origen: 'Instagram', total: 18 }, { origen: 'Directo', total: 14 }] },
      seguidores: 37,
      beneficioLider: { id: 'p1', titulo: 'Combo Día de Playa 2×1', vistas: 1240, compartidas: 212 },
    },
    serie: { tipo: 'registros', dias: Array.from({ length: 14 }, (_, i) => ({ fecha: `2026-10-${String(7 + i).padStart(2, '0')}`, total: i % 4 })) },
  }
  const html = pinta(datos, bloques, (href) => seccionPermitida('MARKETING', href.startsWith('/admin/riesgo') ? 'riesgo' : href.startsWith('/admin/audiencia') ? 'audiencia' : href.startsWith('/admin/promociones') ? 'promociones' : 'pagos', null))
  assert.match(html, /Clientes en riesgo/)
  assert.match(html, /Beneficios por vencer/)
  assert.match(html, /Interacciones del mes[\s\S]*Sin dato/)
  assert.match(html, /Registros nuevos · últimos 14 días/)
  assert.doesNotMatch(html, /Pagos por validar|Canjes|RD\$|Ingresos/)
  assert.doesNotMatch(html, /href="\/admin\/pagos/)
})

test('la gráfica trae eje, tabla alternativa y su enlace a Reportes solo si se puede abrir', () => {
  const con = pinta(DATOS_ADMIN, BLOQUES_ADMIN, () => true)
  assert.match(con, /Canjes · últimos 14 días/)
  assert.match(con, /Ver como tabla/)
  assert.match(con, /href="\/admin\/reportes"[^>]*>Ver reportes/)
  const sin = pinta(DATOS_ADMIN, BLOQUES_ADMIN, (href) => !href.startsWith('/admin/reportes'))
  assert.doesNotMatch(sin, />Ver reportes/)
})

test('el Resumen es un solo <h1> y cada bloque, una sección con nombre', () => {
  const html = pinta(DATOS_ADMIN, BLOQUES_ADMIN, () => true)
  assert.equal((html.match(/<h1/g) ?? []).length, 1)
  for (const id of ['h-hoy', 'h-mes', 'h-serie', 'h-pagos', 'h-vencen', 'h-mostrador']) {
    assert.match(html, new RegExp(`id="${id}"`), id)
    assert.match(html, new RegExp(`aria-labelledby="${id}"`), `${id} nombra su sección`)
  }
})
