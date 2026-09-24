import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ADMIN_SECTIONS,
  ROLES_CON_PERMISOS,
  ROLES_EXENTOS_PERMISOS,
  adminSectionForPath,
  resolverPermisosUsuario,
  seccionPermitida,
  type AdminSection,
} from '../src/lib/auth/permissions'
import {
  accesoASeccion,
  accesosDeEmpleado,
  explicarAcceso,
  loQueTraeElRol,
  resumirAccesos,
} from '../src/modules/permisos/accesos'
import type { AppRole } from '../src/types'

/**
 * PANTALLA «qué ve cada empleado».
 *
 * Lo que tiene que ser verdad para que la pantalla sirva de algo: que decida
 * EXACTAMENTE lo mismo que la guardia real. Una pantalla de accesos que se
 * equivoca es peor que no tenerla — se mira una vez, se da por buena y nadie
 * vuelve a comprobarlo a mano.
 */

const TODO_ENCENDIDO = () => true
const TODO_APAGADO = () => false

// ───────────────── el porqué, en puro ─────────────────

test('lo que trae el rol se lee como «lo trae su rol»', () => {
  const a = accesoASeccion('CAJERO', null, 'pagos', TODO_ENCENDIDO)
  assert.equal(a.puede, true)
  assert.equal(a.origen, 'rol')
  assert.equal(explicarAcceso(a), 'Lo trae su rol')
})

test('lo que el rol NO trae se lee como «su rol no lo trae», no como negado', () => {
  // El caso del reporte: un cajero no tiene por qué ver Campañas. Decir
  // «se lo quitaron» mandaría a buscar a quién, y no hay a quién.
  const a = accesoASeccion('CAJERO', null, 'campanas', TODO_ENCENDIDO)
  assert.equal(a.puede, false)
  assert.equal(a.motivo, 'rol')
  assert.equal(explicarAcceso(a), 'Su rol no lo trae')
})

test('una concesión a mano se distingue de la herencia', () => {
  const permisos = resolverPermisosUsuario({ secciones: { campanas: true } })
  const a = accesoASeccion('CAJERO', permisos, 'campanas', TODO_ENCENDIDO)
  assert.equal(a.puede, true)
  assert.equal(a.origen, 'concedido')
  assert.equal(explicarAcceso(a), 'Concedido a mano')
})

test('una negación explícita se distingue de «el rol no lo trae»', () => {
  const permisos = resolverPermisosUsuario({ secciones: { pagos: false } })
  const a = accesoASeccion('GERENTE', permisos, 'pagos', TODO_ENCENDIDO)
  assert.equal(a.puede, false)
  assert.equal(a.motivo, 'negado')
  assert.equal(explicarAcceso(a), 'Se lo quitaron')
})

test('un módulo apagado en la empresa no se le achaca a la persona', () => {
  // Lo trae su rol Y se lo concedieron: aun así no lo ve, y el motivo no está
  // en su ficha. Sin esta distinción, el admin abriría sus permisos a buscar
  // algo que allí no está.
  const permisos = resolverPermisosUsuario({ secciones: { citas: true } })
  const a = accesoASeccion('GERENTE', permisos, 'citas', TODO_APAGADO)
  assert.equal(a.puede, false)
  assert.equal(a.motivo, 'capacidad')
  assert.equal(explicarAcceso(a), 'Apagado en la empresa')
})

test('al superadmin las capacidades no lo gatean — igual que en requireSection', () => {
  const a = accesoASeccion('SUPERADMIN', null, 'citas', TODO_APAGADO)
  assert.equal(a.puede, true)
})

test('las funciones negadas salen con su nombre legible, no con su código', () => {
  const permisos = resolverPermisosUsuario({
    funciones: { reportes: { ver_financieros: false, inventado: false } },
  })
  const a = accesoASeccion('GERENTE', permisos, 'reportes', TODO_ENCENDIDO)
  assert.equal(a.puede, true)
  assert.deepEqual(a.funcionesNegadas, ['Ver ingresos y cifras de dinero'])
})

test('el resumen separa el tamaño del acceso de los ajustes que alguien hizo', () => {
  const permisos = resolverPermisosUsuario({
    secciones: { campanas: true, pagos: false },
    funciones: { clientes: { nota_eliminar: false } },
  })
  const r = resumirAccesos(accesosDeEmpleado('CAJERO', permisos, TODO_ENCENDIDO))
  assert.deepEqual(r.concedidos.map((a) => a.section), ['campanas'])
  assert.deepEqual(r.negados.map((a) => a.section), ['pagos'])
  assert.equal(r.funcionesNegadas, 1)
  assert.equal(r.total, ADMIN_SECTIONS.length)
  assert.ok(r.visibles > 0 && r.visibles < r.total)
})

test('un empleado sin concesiones no ve nada del panel', () => {
  const r = resumirAccesos(accesosDeEmpleado('EMPLEADO', null, TODO_ENCENDIDO))
  assert.equal(r.visibles, 0)
})

test('un empleado con una sola concesión ve esa y nada más', () => {
  const permisos = resolverPermisosUsuario({ secciones: { clientes: true } })
  const lista = accesosDeEmpleado('EMPLEADO', permisos, TODO_ENCENDIDO)
  assert.deepEqual(
    lista.filter((a) => a.puede).map((a) => a.section),
    ['clientes']
  )
})

// ───────────────── la pantalla decide lo MISMO que la guardia ─────────────────

const ROLES: AppRole[] = [
  'SUPERADMIN',
  'ADMINISTRADOR',
  'ADMIN_EMPRESA',
  'GERENTE',
  'CAJERO',
  'MARKETING',
  'SUPERVISOR',
  'EMPLEADO',
]

test('el veredicto del mapa es el de requireSection: permisos Y capacidades', () => {
  // La regla de requireSection, escrita aparte a propósito: si alguien le
  // quita al mapa la capa de capacidades (o se la aplica al superadmin), esto
  // falla aquí y no en producción.
  const ajustes = [
    null,
    resolverPermisosUsuario({ secciones: { campanas: true, pagos: false } }),
    resolverPermisosUsuario({ secciones: { citas: true } }),
  ]
  const filtros: Array<[string, (s: AdminSection) => boolean]> = [
    ['todo encendido', TODO_ENCENDIDO],
    ['todo apagado', TODO_APAGADO],
    ['solo citas apagada', (s) => s !== 'citas'],
  ]

  for (const role of ROLES) {
    for (const permisos of ajustes) {
      for (const [nombre, encendida] of filtros) {
        for (const section of ADMIN_SECTIONS) {
          const exento = ROLES_EXENTOS_PERMISOS.includes(role)
          const esperado =
            seccionPermitida(role, section, permisos) && (exento || encendida(section))
          assert.equal(
            accesoASeccion(role, permisos, section, encendida).puede,
            esperado,
            `${role} · ${section} · ${nombre}`
          )
        }
      }
    }
  }
})

test('lo que trae el rol de serie sale del mismo sitio que la guardia', () => {
  for (const role of ROLES) {
    for (const section of loQueTraeElRol(role)) {
      assert.equal(
        seccionPermitida(role, section, null),
        true,
        `${role} debería traer ${section} sin ajustes`
      )
    }
  }
})

// ───────────────── estructurales ─────────────────

const sinComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '')

const PAGINA = join('src', 'app', '(admin)', 'admin', 'empleados', 'accesos', 'page.tsx')
const leer = (p: string) => sinComentarios(readFileSync(p, 'utf8'))

test('la pantalla vive bajo una sección guardada, la tenga donde la tenga', () => {
  // La ruta se DERIVA del archivo, no se escribe: si mañana la pantalla se
  // mueve a un sitio que el proxy no reconoce —o a uno sin layout de
  // sección— esto falla en vez de dejarla abierta de par en par.
  const ruta =
    '/' +
    PAGINA.replaceAll('\\', '/')
      .replace(/^src\/app\//, '')
      .replace(/\/page\.tsx$/, '')
      .split('/')
      .filter((seg) => !seg.startsWith('('))
      .join('/')
  const seccion = adminSectionForPath(ruta)
  assert.ok(seccion, `${ruta} no resuelve a ninguna sección: el proxy lo trataría como ruta desconocida`)

  // Y esa sección tiene guardia de layout sobre el subárbol donde vive.
  const carpetaDeLaSeccion = join('src', 'app', '(admin)', 'admin', seccion)
  const layout = leer(join(carpetaDeLaSeccion, 'layout.tsx'))
  assert.match(layout, new RegExp(`guardarSeccion\\('${seccion}'\\)`))
})

test('la pantalla pasa por la capa de capacidades y no se la inventa', () => {
  const src = leer(PAGINA)
  assert.match(src, /filtroDeCapacidades\(companyId\)/)
  assert.match(
    src,
    /accesosDeEmpleado\([^)]*seccionEncendida\)/,
    'el mapa tiene que recibir el filtro real de la empresa, no un «todo encendido»'
  )
})

test('la pantalla es de LECTURA: no despacha ninguna acción', () => {
  const src = leer(PAGINA)
  assert.doesNotMatch(src, /from '@\/modules\/[^']*\/actions'/)
  assert.doesNotMatch(src, /'use server'/)
  assert.doesNotMatch(src, /method="post"/i)
})

test('la puerta del módulo de Permisos es UNA lista, no una copia por pantalla', () => {
  assert.deepEqual(ROLES_CON_PERMISOS, ['SUPERADMIN', 'ADMINISTRADOR', 'ADMIN_EMPRESA'])
  for (const pagina of [PAGINA, join('src', 'app', '(admin)', 'admin', 'empleados', '[id]', 'permisos', 'page.tsx')]) {
    const src = leer(pagina)
    assert.match(src, /requireRole\(ROLES_CON_PERMISOS\)/, `${pagina} tiene que usar la lista compartida`)
    assert.doesNotMatch(
      src,
      /requireRole\(\s*\[/,
      `${pagina} no puede escribir su propia lista de roles a mano`
    )
  }
})

test('el filtro de capacidades y la guardia leen el MISMO mapa sección→capacidad', () => {
  // `filtroDeCapacidades` resuelve de una vez lo que `seccionPermitidaPorCapacidades`
  // resuelve de una en una. Si una de las dos se construyera su propia lista,
  // la pantalla y la guardia podrían contestar distinto sobre el mismo módulo.
  const src = leer(join('src', 'modules', 'capacidades', 'resolver.ts'))
  const usos = src.match(/CAPACIDAD_DE_SECCION\[section\]/g) ?? []
  assert.equal(usos.length, 2, 'las dos funciones tienen que consultar el índice, no una lista propia')
  assert.match(src, /if \(!companyId\) return \(\) => true/, 'sin empresa no hay gate, igual que en tieneCapacidad')
})
