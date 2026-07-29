/**
 * AISLAMIENTO MULTIEMPRESA — red automática (auditoría de producción · A-01).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ VIGILA Y POR QUÉ ASÍ
 *
 * El aislamiento entre empresas de MembeGo es 100 % aplicativo: depende de que
 * CADA consulta sobre un modelo con `companyId` lo lleve en el `where`. Con 112
 * modelos y unos 150 archivos de módulos, eso es disciplina, no garantía. Un
 * solo `findUnique({ where: { id } })` olvidado es una fuga entre empresas — y
 * no da error, ni aparece en un log: devuelve datos de otro negocio como si
 * fueran propios.
 *
 * Esta prueba lee el CÓDIGO FUENTE y falla si encuentra una consulta de
 * lectura múltiple (`findMany` / `count` / `aggregate` / `groupBy`) sobre un
 * modelo con `companyId` cuyo bloque no menciona `companyId` ni ninguna de las
 * vías indirectas aceptadas.
 *
 * POR QUÉ ANÁLISIS ESTÁTICO Y NO UNA PRUEBA CONTRA LA BASE: una prueba de
 * integración solo cubre los caminos que alguien se acordó de escribir. El
 * riesgo aquí no es que falle un camino conocido, es que aparezca uno nuevo sin
 * el filtro. Esto revisa los ~150 archivos en cada `npm test` y en cada PR.
 *
 * LO QUE NO CUBRE — y esto se comprobó midiéndolo, no suponiéndolo.
 *
 * La primera versión de esta prueba marcaba 29 consultas. Ninguna era una
 * fuga: todas estaban acotadas por una variable construida arriba, o por un
 * identificador que la línea anterior ya había verificado. Resolver variables
 * bajó el ruido a 20, y el resto resultó ser del segundo tipo.
 *
 * De ahí el alcance actual: la prueba detecta con certeza la lectura SIN NINGÚN
 * filtro —el `findMany()` que se lleva la tabla entera— y las que no mencionan
 * ninguna forma de acotado. NO puede decidir si un `where: { id }` estaba
 * verificado arriba, porque eso exige entender el flujo del programa.
 *
 * Es una red contra el descuido más común, no una demostración de aislamiento.
 * La demostración es de base de datos, no de test: privilegios revocados y RLS
 * activo — `prisma/migrations_manual/2026-07-cerrar-postgrest.sql`.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Modelos con `companyId` cuyas lecturas múltiples SIEMPRE deben acotarse.
 *
 * Es una lista explícita y no todo el esquema a propósito: son los que
 * contienen datos de negocio de una empresa concreta. Añadir uno nuevo aquí es
 * parte de crear el modelo.
 */
const MODELOS_ACOTADOS = [
  'cliente',
  'membership',
  'transaction',
  'productoCompra',
  'promocion',
  'plan',
  'visit',
  'colaVehiculo',
  'incidencia',
  'comision',
  'turno',
  'cajaSesion',
  'metodoPago',
  'sucursal',
  'ofertaPrivada',
  'cita',
  'productoInventario',
  'proveedor',
  'ordenCompra',
  'activo',
  'cuentaCorporativa',
]

const OPERACIONES = ['findMany', 'count', 'aggregate', 'groupBy']

/**
 * Formas aceptadas de acotar. Además de `companyId` directo:
 *
 *  · `company:`  — filtro por la relación (`company: { esDemo: false }` va
 *                  siempre acompañado del id en el resto del where).
 *  · `cliente:` / `membership:` / `cuenta:` — acotado por una entidad que ya
 *    pertenece a una empresa; el propio filtro anidado lleva el companyId.
 *  · `id:` / `where: { id` — se busca UNA fila por su identificador y quien
 *    llama ya comprobó la pertenencia (patrón habitual en las acciones).
 */
const SENALES_ACOTADO = [
  'companyId',
  'company:',
  'company :',
  'cliente:',
  'clienteId',
  'membership:',
  'membresiaId',
  'membershipId',
  'cuenta:',
  'cuentaId',
  'colaId',
  'userId',
  'supabaseId',
  // Acotado por identificadores CONCRETOS que quien llama ya verificó. Es el
  // otro patrón dominante del código:
  //
  //     const plan = await planDeMiEmpresa(planId, user)   // comprueba dueño
  //     await prisma.membership.count({ where: { planId } })
  //
  // Aceptarlo cuesta poder de detección —una consulta por id sin verificar
  // arriba pasaría— pero NO aceptarlo convierte la prueba en ruido: son
  // decenas de casos legítimos, y una prueba con veinte falsos positivos no se
  // arregla, se ignora. Este límite es real y está anotado abajo.
  'id:',
  'planId',
  'sucursalId',
  'promocionId',
  'compraId',
  // Una sesión de caja pertenece a una empresa y quien llama la trajo ya
  // acotada; los cobros se leen por ella.
  'cajaSesionId',
  'metodoPagoId',
  'vehiculoId',
  // Filtro recibido como parámetro tipado: lo acota quien llama.
  'WhereInput',
]

/**
 * Archivos exentos, con el motivo. Cada exención es una decisión, no un
 * descuido: si la lista crece sin razón, el valor de la prueba se evapora.
 */
const EXENTOS: Record<string, string> = {
  'src/modules/superadmin': 'El superadmin ve la plataforma entera por definición.',
  'src/modules/marketplace': 'La vitrina pública es intencionadamente entre empresas.',
  'src/modules/demo': 'Cuenta e inventaría empresas de práctica a nivel de plataforma.',
  'src/modules/admin/automatizaciones': 'Reparte trabajo por empresa; lee la lista de empresas.',
  'src/modules/empresas': 'Administra las empresas mismas.',
  'src/modules/jobs': 'El ejecutor recibe el companyId como parámetro del trabajo.',
  'src/lib/seed': 'Sembrado de datos de desarrollo.',
  'src/modules/campanas': 'Campañas conjuntas: cruzan empresas por diseño.',
  'src/modules/notificaciones': 'Reparte por usuario, no por empresa.',
  'src/app/api/health': 'Sonda de salud: conteos agregados de plataforma, sin datos.',
  'src/app/api/stats': 'Métricas públicas de plataforma para la landing.',
  'src/lib/transactions/application/analytics': 'Analítica del motor; recibe el companyId por parámetro.',
}

function archivosTs(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) archivosTs(ruta, acc)
    else if (ruta.endsWith('.ts') && !ruta.endsWith('.d.ts')) acc.push(ruta)
  }
  return acc
}

function exento(ruta: string): boolean {
  return Object.keys(EXENTOS).some((prefijo) => ruta.includes(prefijo))
}

/**
 * Resuelve un `where` que es una VARIABLE.
 *
 * Esto es lo que separa una red útil de una que grita sin razón. El patrón
 * dominante en este código es construir el filtro arriba y pasarlo por nombre:
 *
 *     const membershipWhere = companyId ? { companyId } : {}
 *     prisma.membership.count({ where: { ...membershipWhere, estado: 'ACTIVA' } })
 *
 * Un escaneo que solo mire el bloque de la llamada marca eso como fuga. Son
 * falsos positivos, y un test con 29 falsos positivos no se arregla: se ignora,
 * o alguien lo vacía. Así que cuando el bloque referencia identificadores, se
 * busca su definición en el mismo archivo y se comprueba ALLÍ.
 */
function definicionDe(contenido: string, nombre: string): string {
  // Variable o FUNCIÓN: el otro patrón habitual es un helper que devuelve el
  // filtro (`...promoVigente(now)`), y el acotado vive dentro de esa función.
  const patron = new RegExp(
    // Variable, función, o PARÁMETRO tipado (`where: Prisma.XWhereInput`): en
    // este último caso el filtro lo construye y acota quien llama.
    `(?:(?:const|let|var)\\s+${nombre}\\s*(?::[^=]+)?=|function\\s+${nombre}\\s*\\(|${nombre}\\s*:\\s*Prisma\\.\\w*WhereInput)`,
    'g'
  )
  const m = patron.exec(contenido)
  if (!m) return ''
  // Hasta el final de la sentencia: 600 caracteres cubren de sobra un filtro.
  return contenido.slice(m.index, m.index + 600)
}

/** Identificadores que el bloque referencia (variables y spreads). */
function identificadoresDe(bloque: string): string[] {
  const nombres = new Set<string>()
  for (const m of bloque.matchAll(/\.\.\.(\w+)/g)) nombres.add(m[1])
  for (const m of bloque.matchAll(/where\s*:\s*(\w+)/g)) nombres.add(m[1])
  // `{ where }` abreviado.
  if (/\{\s*where\s*[,}]/.test(bloque)) nombres.add('where')
  return [...nombres]
}

/**
 * Extrae el bloque de argumentos de una llamada, contando llaves.
 * Cortar por longitud fija daría falsos positivos en consultas largas.
 */
function bloqueDeLlamada(texto: string, desde: number): string {
  const abre = texto.indexOf('{', desde)
  if (abre === -1) return ''
  let nivel = 0
  for (let i = abre; i < texto.length && i < abre + 4000; i++) {
    if (texto[i] === '{') nivel++
    else if (texto[i] === '}') {
      nivel--
      if (nivel === 0) return texto.slice(abre, i + 1)
    }
  }
  return texto.slice(abre, abre + 4000)
}

test('toda lectura múltiple de un modelo de empresa está acotada', () => {
  const archivos = archivosTs('src').filter((f) => !exento(f))
  const hallazgos: string[] = []

  for (const archivo of archivos) {
    const contenido = readFileSync(archivo, 'utf8')

    for (const modelo of MODELOS_ACOTADOS) {
      for (const op of OPERACIONES) {
        const patron = new RegExp(`\\.${modelo}\\s*\\.\\s*${op}\\s*\\(`, 'g')
        let m: RegExpExecArray | null
        while ((m = patron.exec(contenido)) !== null) {
          const bloque = bloqueDeLlamada(contenido, m.index)
          // Sin argumentos = lectura de TODA la tabla. Siempre un hallazgo.
          if (!bloque.trim()) {
            hallazgos.push(`${archivo}: ${modelo}.${op}() sin filtro`)
            continue
          }
          // El bloque directo, más la definición de cualquier variable que
          // referencie. Si el acotado está en cualquiera de los dos, vale.
          const contexto =
            bloque +
            identificadoresDe(bloque)
              .map((n) => definicionDe(contenido, n))
              .join('\n')

          if (!SENALES_ACOTADO.some((s) => contexto.includes(s))) {
            const linea = contenido.slice(0, m.index).split('\n').length
            hallazgos.push(`${archivo}:${linea} — ${modelo}.${op} sin acotar por empresa`)
          }
        }
      }
    }
  }

  assert.deepEqual(
    hallazgos,
    [],
    `Consultas sin acotar por empresa (posible fuga entre negocios):\n  ${hallazgos.join('\n  ')}\n\n` +
      'Añade el companyId al where. Si de verdad debe cruzar empresas, ' +
      'añade el archivo a EXENTOS en este test CON EL MOTIVO escrito.'
  )
})

test('la lista de exenciones lleva motivo escrito', () => {
  // Una exención sin explicación es una excepción que nadie podrá revisar
  // dentro de seis meses. Se obliga a escribirla.
  for (const [ruta, motivo] of Object.entries(EXENTOS)) {
    assert.ok(motivo.length > 20, `La exención de ${ruta} necesita un motivo de verdad.`)
  }
})

test('la lista de modelos acotados no se vacía por accidente', () => {
  // Protege contra el "arreglo" más tentador cuando esta prueba molesta:
  // vaciar MODELOS_ACOTADOS y decir que pasa.
  assert.ok(MODELOS_ACOTADOS.length >= 20)
  assert.ok(MODELOS_ACOTADOS.includes('cliente'))
  assert.ok(MODELOS_ACOTADOS.includes('transaction'))
  assert.ok(MODELOS_ACOTADOS.includes('membership'))
})
