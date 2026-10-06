import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { FUNCIONES_POR_SECCION } from '../src/lib/auth/funciones'
import {
  funcionPermitida,
  seccionPermitida,
  permisosDesdeSeleccion,
  resolverPermisosUsuario,
} from '../src/lib/auth/permissions'

/**
 * CATÁLOGO DE PERMISOS · lo que una guardia mal nombrada le abre a quien no debe.
 *
 * `scripts/permisos-catalogo.mjs` vigila la forma —que cada función del
 * catálogo tenga guardia y que cada guardia esté en el catálogo— y corre en el
 * CI. Esto vigila la CONSECUENCIA, que es otra cosa y no la ve un guion de
 * texto: a quién le pasa la guardia, y si el interruptor se puede apagar de
 * verdad.
 *
 * EL FALLO QUE FIJA (24-09-2026)
 *
 * Nueve actions del CRM —cinco de prospectos, cuatro de respuestas
 * automáticas— pedían `requireSection('clientes', …)` mientras todo el módulo
 * se gobierna con 'leads': su layout, sus páginas, sus otras actions y la
 * capacidad CRM. CAJERO, SUPERVISOR y GERENTE traen 'clientes' y NO 'leads',
 * así que no podían ni abrir /admin/crm y aun así pasaban las nueve. Una
 * server action se despacha por su id desde cualquier ruta permitida, igual
 * que ya había pasado con `sinonimos`.
 *
 * Y como los nueve códigos no estaban en el catálogo, `guardarPermisosEmpleado`
 * los descartaba al validar: no había casilla, no llegaba ningún `false` a la
 * base, y `funcionPermitida` solo niega ante un `false` explícito. Nueve
 * guardias que en el código parecían permisos finos y en producción eran un
 * `if` que siempre pasaba.
 */

const CRM = [
  'lead_crear',
  'lead_editar',
  'lead_eliminar',
  'lead_mover_etapa',
  'lead_asignar',
  'auto_reply_leer',
  'auto_reply_crear',
  'auto_reply_editar',
  'auto_reply_eliminar',
] as const

/** Roles acotados que traen 'clientes' pero no 'leads' — los que pasaban. */
const SIN_CRM = ['CAJERO', 'SUPERVISOR', 'GERENTE'] as const

function fuente(...ruta: string[]): string {
  return readFileSync(join(__dirname, '..', ...ruta), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('el catálogo declara las nueve funciones del CRM bajo leads, no bajo clientes', () => {
  const leads = (FUNCIONES_POR_SECCION.leads ?? []).map((f) => f.codigo)
  for (const c of CRM) assert.ok(leads.includes(c), `falta ${c} en leads`)
  const clientes = (FUNCIONES_POR_SECCION.clientes ?? []).map((f) => f.codigo)
  for (const c of CRM) assert.ok(!clientes.includes(c), `${c} no va en clientes`)
})

test('SEGURIDAD · quien no puede abrir el CRM tampoco pasa sus nueve actions', () => {
  for (const rol of SIN_CRM) {
    // Premisa del fallo: el rol SÍ trae 'clientes'. Si esto deja de ser cierto
    // la prueba pierde sentido y hay que enterarse.
    assert.equal(seccionPermitida(rol, 'clientes', null), true, `${rol} debería traer clientes`)
    assert.equal(seccionPermitida(rol, 'leads', null), false, `${rol} no debería traer leads`)
    for (const c of CRM) {
      assert.equal(funcionPermitida(rol, 'leads', c, null), false, `${rol} pasó ${c}`)
    }
  }
})

test('SEGURIDAD · ninguna guardia del CRM nombra la sección clientes', () => {
  const archivos = [
    ['src', 'modules', 'crm', 'lead-actions.ts'],
    ['src', 'modules', 'connect', 'autoReply-actions.ts'],
    ['src', 'app', '(admin)', 'admin', 'crm', 'configuracion', 'auto-reply', 'page.tsx'],
  ]
  for (const ruta of archivos) {
    const src = fuente(...ruta)
    for (const c of CRM) {
      assert.ok(
        !new RegExp(`'clientes'\\s*,\\s*'${c}'`).test(src),
        `${ruta.join('/')} guarda ${c} con la sección equivocada`
      )
    }
  }
})

test('las nueve son NEGABLES de verdad (sobreviven a la validación del editor)', () => {
  // Réplica del filtro de `guardarPermisosEmpleado`: lo que no está en el
  // catálogo se descarta, y un código descartado no se puede negar jamás.
  const validas = new Set((FUNCIONES_POR_SECCION.leads ?? []).map((f) => f.codigo))
  const negadas = CRM.filter((c) => validas.has(c))
  assert.equal(negadas.length, CRM.length)

  const permisos = permisosDesdeSeleccion('MARKETING', {
    secciones: { leads: true },
    funcionesNegadas: { leads: [...negadas] },
  })
  const vivos = resolverPermisosUsuario(permisos as unknown)
  assert.equal(seccionPermitida('MARKETING', 'leads', vivos), true)
  for (const c of CRM) {
    assert.equal(funcionPermitida('MARKETING', 'leads', c, vivos), false, `${c} siguió pasando`)
  }
})

test('conceder el módulo sin negar nada deja pasar las nueve (la otra mitad)', () => {
  const permisos = resolverPermisosUsuario(
    permisosDesdeSeleccion('MARKETING', { secciones: { leads: true }, funcionesNegadas: {} }) as unknown
  )
  for (const c of CRM) {
    assert.equal(funcionPermitida('MARKETING', 'leads', c, permisos), true, `${c} se negó de más`)
  }
})
