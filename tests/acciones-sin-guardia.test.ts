import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

/**
 * ACCIONES DE SERVIDOR SIN GUARDIA.
 *
 * Todo lo que exporta un archivo `'use server'` es un endpoint al que cualquier navegador
 * puede llamar, con los argumentos que quiera. Un «ayudante interno» que vive en uno de
 * esos archivos y recibe `companyId` o `userId` como parámetro es una puerta abierta
 * (la auditoría del 2026-10-07 encontró cuatro: venta y comisión de excursiones, las
 * invitaciones pendientes de cualquier empresa y la sincronización de excursiones agotadas).
 *
 * Esta prueba recorre TODOS los archivos `'use server'` de `src/` con el compilador de
 * TypeScript y comprueba que cada función exportada llama —ella o un ayudante local suyo—
 * a una guardia (`require…`, `exigir…`, `guardia…`, `autorizarCron`, `getUser`, `getSession`).
 * Las que NO la llaman tienen que estar en la lista de abajo, cada una con su razón: son
 * públicas por diseño (login, registro, catálogo geográfico…) o no devuelven ni cambian nada.
 *
 * La lista falla en las DOS direcciones: una función nueva sin guardia rompe la prueba, y una
 * entrada de la lista que ya no existe o que ahora sí tiene guardia también (para que no se
 * llene de basura). Si necesitas un ayudante interno, ponlo en un archivo SIN `'use server'`.
 *
 * Es una comprobación de PRESENCIA: no prueba que la guardia sea la correcta.
 */

const RAIZ = join(__dirname, '..')
const SRC = join(RAIZ, 'src')

const GUARDIA = /^(require[A-Z]\w*|exigir\w*|guardia\w*|autorizarCron|getUser|getSession|getCurrentUser)$/

/** `archivo::función` → por qué puede llamarse sin sesión. */
const PUBLICAS: Record<string, string> = {
  'modules/admin/invitacionActions.ts::aceptarInvitacion': 'la persona invitada aún no tiene cuenta: entra con el token de la invitación (y registerLimiter)',
  'modules/auth/actions.ts::logout': 'cierra la sesión de quien llama',
  'modules/auth/loginActions.ts::iniciarSesion': 'es el login (loginLimiter)',
  'modules/auth/recuperarActions.ts::solicitarRecuperacion': 'recuperar contraseña: quien la pide no tiene sesión (recoveryIpLimiter y recoveryEmailLimiter) y la respuesta no revela si el correo existe',
  'modules/checkout/actions.ts::resumirCarrito': 'el carrito se arma sin cuenta: solo lee lo ya público del catálogo de un negocio publicado, con límite por IP; no escribe nada',
  'modules/connect/adminActions.ts::scopesDisponibles': 'lista estática de scopes: no lee ni cambia datos',
  'modules/connect/adminActions.ts::urlDeConexionOauth': 'arma una URL a partir de la configuración pública: no lee datos de ninguna empresa',
  'modules/crm/seguimiento-actions.ts::deleteActividad': 'delega en deleteNota, que exige requireSection(\'clientes\', \'nota_eliminar\')',
  'modules/excursiones/cliente/actions.ts::establecerContrasenaCliente': 'restablecimiento de contraseña con token',
  'modules/excursiones/vendedores/actions.ts::establecerContrasenaVendedor': 'restablecimiento de contraseña con token',
  'modules/geo/catalogo/actions.ts::listarPaisesOperativos': 'catálogo geográfico público',
  'modules/geo/catalogo/actions.ts::listarRegionesDePais': 'catálogo geográfico público',
  'modules/geo/catalogo/actions.ts::listarCiudadesDeRegion': 'catálogo geográfico público',
  'modules/geo/catalogo/actions.ts::listarSectoresDeCiudad': 'catálogo geográfico público',
  'modules/geo/catalogo/actions.ts::buscarCiudadesCat': 'catálogo geográfico público',
  'modules/geo/catalogo/actions.ts::buscarSectoresCat': 'catálogo geográfico público',
  'modules/geo/geocodificacion/actions.ts::autocompletarDireccion': 'geocodificación pública con limitador por IP (API de pago)',
  'modules/geo/geocodificacion/actions.ts::geocodificarDireccion': 'geocodificación pública con limitador por IP (API de pago)',
  'modules/geo/geocodificacion/actions.ts::reverseGeocodificar': 'geocodificación pública con limitador por IP (API de pago)',
  'modules/invitaciones/clienteActions.ts::registrarEventoCampana': 'seguimiento público de una campaña (limitado)',
  'modules/marketplace/actions.ts::recordPromotionView': 'contador público de vistas',
  'modules/marketplace/actions.ts::recordPromotionShare': 'contador público de compartidos',
  'modules/registro/actions.ts::registrarCliente': 'registro público (registerLimiter)',
  'modules/registro/actions.ts::registrarCuentaGeneral': 'registro público (registerLimiter)',
  'modules/registro/empresaActions.ts::registrarEmpresa': 'registro público de empresas (registerLimiter)',
  'modules/solicitudes/actions.ts::enviarSolicitudEmpresa': 'formulario público de solicitud (registerLimiter)',
  'modules/storage/comprobantes.ts::rutaValida': 'función pura sobre un texto',
}

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? archivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}

const esUseServer = (texto: string) => /^\s*(\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*['"]use server['"]/.test(texto)

/** Las funciones exportadas de un archivo `'use server'` que no llaman a ninguna guardia. */
function sinGuardia(archivo: string, texto: string): string[] {
  const sf = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true)
  const funciones = new Map<string, ts.Node>()
  const exportadas = new Set<string>()
  for (const st of sf.statements) {
    const exportada = (ts.canHaveModifiers(st) ? ts.getModifiers(st) ?? [] : []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    if (ts.isFunctionDeclaration(st) && st.name) {
      funciones.set(st.name.text, st)
      if (exportada) exportadas.add(st.name.text)
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          funciones.set(d.name.text, d.initializer)
          if (exportada) exportadas.add(d.name.text)
        }
      }
    }
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause) && !st.moduleSpecifier) {
      for (const e of st.exportClause.elements) exportadas.add(e.name.text)
    }
  }
  const llamadas = (nodo: ts.Node): Set<string> => {
    const r = new Set<string>()
    const visita = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const e = n.expression
        if (ts.isIdentifier(e)) r.add(e.text)
        else if (ts.isPropertyAccessExpression(e)) r.add(e.name.text)
      }
      ts.forEachChild(n, visita)
    }
    visita(nodo)
    return r
  }
  const memo = new Map<string, boolean>()
  const guardada = (nombre: string, vistos = new Set<string>()): boolean => {
    if (memo.has(nombre)) return memo.get(nombre) as boolean
    if (vistos.has(nombre)) return false
    vistos.add(nombre)
    const nodo = funciones.get(nombre)
    if (!nodo) return false
    let ok = false
    for (const c of llamadas(nodo)) {
      if (GUARDIA.test(c) || (funciones.has(c) && c !== nombre && guardada(c, vistos))) {
        ok = true
        break
      }
    }
    memo.set(nombre, ok)
    return ok
  }
  // Solo las funciones: un tipo reexportado no es un endpoint.
  return [...exportadas].filter((n) => funciones.has(n) && !guardada(n))
}

const encontradas = new Map<string, string>()
let archivosUseServer = 0
for (const a of archivos(SRC)) {
  const texto = readFileSync(a, 'utf8')
  if (!esUseServer(texto)) continue
  archivosUseServer++
  for (const fn of sinGuardia(a, texto)) encontradas.set(`${relative(SRC, a).split('\\').join('/')}::${fn}`, fn)
}

test('el escáner ve los archivos \'use server\' del proyecto', () => {
  assert.ok(archivosUseServer > 100, `solo encontró ${archivosUseServer} archivos 'use server'`)
})

test('toda acción de servidor llama a una guardia, o está en la lista de públicas por diseño', () => {
  const huecos = [...encontradas.keys()].filter((k) => !(k in PUBLICAS)).sort()
  assert.deepEqual(
    huecos,
    [],
    `Estas funciones exportadas desde un archivo 'use server' no llaman a ninguna guardia: cualquier navegador puede invocarlas.\n` +
      `Si necesitan recibir la empresa o el usuario como argumento, muévelas a un archivo SIN 'use server'. ` +
      `Si de verdad son públicas, añádelas a PUBLICAS con su razón.\n  ${huecos.join('\n  ')}`
  )
})

test('la lista de públicas no guarda entradas muertas ni funciones que ya tienen guardia', () => {
  const sobrantes = Object.keys(PUBLICAS).filter((k) => !encontradas.has(k)).sort()
  assert.deepEqual(sobrantes, [], `Quita de PUBLICAS lo que ya no existe o ya llama a una guardia:\n  ${sobrantes.join('\n  ')}`)
})

test('los cuatro ayudantes internos de la auditoría no vuelven a un archivo \'use server\'', () => {
  const prohibidos: [string, string][] = [
    ['modules/excursiones/ventas/actions.ts', 'procesarVentaYComisionInterna'],
    ['modules/admin/invitacionActions.ts', 'listInvitacionesPendientes'],
    ['modules/excursiones/catalogo/actions.ts', 'sincronizarEstadoAgotada'],
    ['modules/excursiones/catalogo/actions.ts', 'sincronizarTodasAgotadas'],
  ]
  for (const [archivo, fn] of prohibidos) {
    const t = readFileSync(join(SRC, archivo), 'utf8')
    assert.doesNotMatch(t, new RegExp(`export\\s+(async\\s+)?function\\s+${fn}\\b`), `${fn} no puede exportarse desde ${archivo}`)
  }
})
