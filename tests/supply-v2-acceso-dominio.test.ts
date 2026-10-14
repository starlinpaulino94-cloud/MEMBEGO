import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPACIDADES_DE_COMERCIO_MERCHANT,
  OVERRIDES_SUPPLIER_LITE,
  PRESETS_ROL_PROVEEDOR,
  ROLES_DE_PROVEEDOR,
  TRANSICIONES_ACCESO,
  clasificarProveedor,
  esCodigoDePrueba,
  evaluarPreparacion,
  motivoNoOperativo,
  permisosDePreset,
  puedeTransicionarAcceso,
  tipoDeOrganizacion,
  validarMotivoDispensa,
} from '../src/modules/supply-v2/suppliers/acceso-dominio'
import { FUNCIONES_POR_SECCION } from '../src/lib/auth/funciones'
import { CAPACIDADES, CAPACIDADES_BASE, CATEGORIAS } from '../src/modules/capacidades/catalogo'
import { funcionPermitida, seccionPermitida } from '../src/lib/auth/permissions'

/**
 * SUPPLIER & FULFILLMENT COMMERCE · Slice 1 · reglas puras del acceso del proveedor.
 * Ejecutar: npm test
 */

const base = { status: 'ACTIVE' as const, readinessWaivedAt: null, fulfillmentReadyAt: null }

test('el ciclo de acceso: DRAFT → INVITED → ACTIVATION_PENDING → ACTIVE ⇄ SUSPENDED → TERMINATED, y TERMINATED no vuelve', () => {
  assert.ok(puedeTransicionarAcceso('DRAFT', 'INVITED'))
  assert.ok(puedeTransicionarAcceso('INVITED', 'ACTIVATION_PENDING'))
  assert.ok(puedeTransicionarAcceso('ACTIVATION_PENDING', 'ACTIVE'))
  assert.ok(puedeTransicionarAcceso('ACTIVE', 'SUSPENDED'))
  assert.ok(puedeTransicionarAcceso('SUSPENDED', 'ACTIVE'))
  assert.ok(puedeTransicionarAcceso('ACTIVE', 'TERMINATED'))
  assert.equal(puedeTransicionarAcceso('TERMINATED', 'ACTIVE'), false)
  assert.equal(puedeTransicionarAcceso('DRAFT', 'ACTIVATION_PENDING'), false, 'sin invitación no hay nadie dentro')
  assert.equal(TRANSICIONES_ACCESO.TERMINATED.length, 0)
})

test('la lista de preparación exige los cinco pasos y nombra los pendientes', () => {
  const todo = evaluarPreparacion({ usuarioActivo: true, sucursalConfigurada: true, operadorConfigurado: true, contratoAceptado: true, qrProbado: true })
  assert.equal(todo.lista, true)
  assert.equal(todo.completos, 5)
  const falta = evaluarPreparacion({ usuarioActivo: true, sucursalConfigurada: true, operadorConfigurado: true, contratoAceptado: false, qrProbado: false })
  assert.equal(falta.lista, false)
  assert.deepEqual(falta.pendientes, ['contratoAceptado', 'qrProbado'])
  assert.equal(falta.completos, 3)
})

test('operativo para acuerdos/ofertas nuevos: ACTIVE sí; en el ciclo sin completar, no; DRAFT solo en modo no estricto; la dispensa siempre pasa', () => {
  assert.equal(motivoNoOperativo({ ...base, accessStatus: 'ACTIVE' }), null)
  assert.equal(motivoNoOperativo({ ...base, accessStatus: 'DRAFT' }), null, 'proveedor histórico: compatibilidad')
  assert.match(motivoNoOperativo({ ...base, accessStatus: 'DRAFT' }, true) ?? '', /invítalo/)
  assert.match(motivoNoOperativo({ ...base, accessStatus: 'INVITED' }) ?? '', /no activó/)
  assert.match(motivoNoOperativo({ ...base, accessStatus: 'ACTIVATION_PENDING' }) ?? '', /preparación/)
  assert.match(motivoNoOperativo({ ...base, accessStatus: 'SUSPENDED' }) ?? '', /suspendido/)
  assert.match(motivoNoOperativo({ ...base, accessStatus: 'TERMINATED' }) ?? '', /baja/)
  assert.equal(motivoNoOperativo({ ...base, accessStatus: 'ACTIVATION_PENDING', readinessWaivedAt: new Date() }), null)
  assert.match(motivoNoOperativo({ ...base, status: 'BLOCKED', accessStatus: 'ACTIVE' }) ?? '', /bloqueado/)
})

test('relevamiento (§61): con acceso, sin acceso, histórico con dispensa, inactivo', () => {
  assert.equal(clasificarProveedor({ ...base, accessStatus: 'ACTIVE', fulfillmentReadyAt: new Date() }), 'ACTIVE_WITH_ACCESS')
  assert.equal(clasificarProveedor({ ...base, accessStatus: 'ACTIVE', readinessWaivedAt: new Date() }), 'LEGACY')
  assert.equal(clasificarProveedor({ ...base, accessStatus: 'DRAFT' }), 'ACTIVE_WITHOUT_ACCESS')
  assert.equal(clasificarProveedor({ ...base, accessStatus: 'INVITED' }), 'ACTIVE_WITHOUT_ACCESS')
  assert.equal(clasificarProveedor({ ...base, status: 'INACTIVE', accessStatus: 'ACTIVE' }), 'INACTIVE')
})

test('tipo de organización (§4) se deriva de las capacidades, sin enum nuevo', () => {
  assert.equal(tipoDeOrganizacion(['MEMBEGO_SUPPLIER'], true), 'SUPPLIER_ONLY')
  assert.equal(tipoDeOrganizacion(['CATALOGO_UNIFICADO', 'PEDIDOS_MEMBEGO'], false), 'MERCHANT_ONLY')
  assert.equal(tipoDeOrganizacion(['CATALOGO_UNIFICADO', 'MEMBEGO_SUPPLIER'], true), 'MERCHANT_SUPPLIER')
  assert.equal(tipoDeOrganizacion(['MEMBEGO_SUPPLIER'], false), 'NONE', 'la capacidad sin proveedor vinculado no hace proveedor')
  for (const c of CAPACIDADES_DE_COMERCIO_MERCHANT) assert.ok((CAPACIDADES as readonly string[]).includes(c))
})

test('Supplier Lite nace sin Business OS: solo la capacidad de proveedor encendida; todo lo comercial apagado y en el catálogo real', () => {
  assert.equal(OVERRIDES_SUPPLIER_LITE.MEMBEGO_SUPPLIER, true)
  for (const [cap, valor] of Object.entries(OVERRIDES_SUPPLIER_LITE)) {
    assert.ok((CAPACIDADES as readonly string[]).includes(cap), `${cap} no existe en el catálogo`)
    if (cap !== 'MEMBEGO_SUPPLIER' && cap !== 'MEMBEGO_SUPPLY_FULFILLMENT') assert.equal(valor, false, `${cap} debería nacer apagada en un Supplier Lite`)
  }
  // Todo lo que el paquete base de CUALQUIER categoría enciende queda apagado explícitamente.
  for (const cat of CATEGORIAS) {
    for (const cap of CAPACIDADES_BASE[cat]) {
      assert.equal(OVERRIDES_SUPPLIER_LITE[cap], false, `${cap} viene en el paquete base de ${cat} y el Supplier Lite no la apaga`)
    }
  }
})

test('los presets de rol del proveedor se apoyan en el RBAC existente y las funciones que niegan están en el catálogo de `supply`', () => {
  const codigos = new Set((FUNCIONES_POR_SECCION.supply ?? []).map((f) => f.codigo))
  assert.ok(codigos.size >= 7, 'la sección supply tiene sus funciones en el catálogo')
  for (const rol of ROLES_DE_PROVEEDOR) {
    const preset = PRESETS_ROL_PROVEEDOR[rol]
    for (const f of preset.negadas) assert.ok(codigos.has(f), `${rol} niega ${f}, que no está en el catálogo`)
    const permisos = permisosDePreset(rol)
    if (rol === 'SUPPLIER_OWNER') {
      assert.equal(permisos, null, 'el dueño es ADMINISTRADOR y lo trae todo')
      assert.ok(seccionPermitida(preset.appRole, 'supply', null))
      continue
    }
    assert.ok(permisos, `${rol} necesita ajustes de permisos`)
    assert.ok(seccionPermitida(preset.appRole, 'supply', permisos), `${rol} debe poder entrar al portal`)
    for (const f of preset.negadas) assert.equal(funcionPermitida(preset.appRole, 'supply', f, permisos), false, `${rol} no debería poder ${f}`)
  }
  // Operador escanea y registra extras; finanzas y solo lectura, no.
  assert.ok(funcionPermitida('CAJERO', 'supply', 'escanear', permisosDePreset('SUPPLIER_OPERATOR')))
  assert.ok(funcionPermitida('CAJERO', 'supply', 'ventas_adicionales', permisosDePreset('SUPPLIER_OPERATOR')))
  assert.equal(funcionPermitida('GERENTE', 'supply', 'escanear', permisosDePreset('SUPPLIER_FINANCE')), false)
  assert.ok(funcionPermitida('GERENTE', 'supply', 'liquidaciones', permisosDePreset('SUPPLIER_FINANCE')))
  assert.equal(funcionPermitida('SUPERVISOR', 'supply', 'ventas_adicionales', permisosDePreset('SUPPLIER_VIEWER')), false)
})

test('código de prueba y motivo de dispensa', () => {
  assert.ok(esCodigoDePrueba('TEST-ABC123'))
  assert.ok(esCodigoDePrueba('test-abc'))
  assert.equal(esCodigoDePrueba('ABC-TEST'), false)
  assert.match(validarMotivoDispensa('') ?? '', /motivo/)
  assert.match(validarMotivoDispensa('corto') ?? '', /motivo/)
  assert.equal(validarMotivoDispensa('Proveedor histórico con acuerdos vivos.'), null)
})
