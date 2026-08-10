import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { FUERA_DEL_PUERTO } from '@membego/contracts'
import { PROYECCIONES, camposPermitidos } from '../src/modules/plataforma/proyecciones'
import { mismoTelefono } from '../src/modules/plataforma/consultas-nucleo'
import { medirAcoplamiento } from '../scripts/acoplamiento-vertical.mjs'

/**
 * VALIDACIÓN DEL CONTRATO CON UN VERTICAL DE VERDAD (Fase 6).
 *
 * La pregunta que ninguna documentación contesta: ¿sirve este contrato para
 * operar? Se contesta metiendo a Car Wash por él —el vertical que MembeGo ya
 * opera todos los días— en vez de esperar al primer satélite.
 */

// ── El techo ────────────────────────────────────────────────────────────────

/**
 * Cuántas veces el vertical toca las tablas del Core directamente. Cada una es
 * una línea que habrá que reescribir el día de la extracción.
 *
 * ESTE NÚMERO SOLO PUEDE BAJAR. Subirlo significa que alguien añadió
 * acoplamiento nuevo justo cuando el proyecto va en la otra dirección.
 *
 * 25 al empezar la Fase 6 · 22 al cerrarla · 20 tras la Fase 7, donde el alta
 * de clientes pasó a ser una escritura del Core y dejó de escribirse a mano en
 * el mostrador y en la pista.
 */
const TECHO_ACOPLAMIENTO = 20

test('el acoplamiento del vertical con el núcleo no crece', () => {
  const { total, porArchivo } = medirAcoplamiento()
  assert.ok(
    total <= TECHO_ACOPLAMIENTO,
    `El vertical toca el Core ${total} veces (techo ${TECHO_ACOPLAMIENTO}).\n` +
      'Lo nuevo va por @membego/contracts, no por las tablas:\n' +
      Object.entries(porArchivo)
        .sort((a, b) => b[1] - a[1])
        .map(([f, n]) => `  ${n}  ${f}`)
        .join('\n')
  )
})

/**
 * Y la medida tiene que seguir siendo capaz de ver. La primera versión usaba
 * `tx.cliente.` y no encontraba esto —que es como está escrito medio código—:
 *
 *     tx.vehiculo
 *       .findFirst({ ... })
 *
 * Contaba 22 donde había 25. Un número que se cree y es falso es peor que no
 * medir, porque se toman decisiones con él.
 */
test('la medida ve las consultas partidas en varias líneas', () => {
  const src = readFileSync(join('scripts', 'acoplamiento-vertical.mjs'), 'utf8')
  assert.ok(
    src.includes("replace(/\\s+/g, ' ')"),
    'sin normalizar espacios, un salto de línea esconde el acoplamiento'
  )
})

// ── Las dos implementaciones ────────────────────────────────────────────────

/**
 * LA PRUEBA QUE HACE QUE ESTO SIRVA.
 *
 * `MembegoClient` (HTTP) y `clienteLocal` (en proceso) declaran las dos
 * `implements ClientePlataforma`. Si una se queda atrás, `tsc` lo dice antes de
 * que nadie despliegue — que es exactamente lo que pasó al añadir los
 * vehículos: el compilador paró las dos.
 */
test('las dos implementaciones declaran el mismo puerto', () => {
  const sdk = readFileSync(join('packages', 'platform-sdk', 'src', 'cliente.ts'), 'utf8')
  const local = readFileSync(join('src', 'modules', 'plataforma', 'cliente-local.ts'), 'utf8')
  assert.match(sdk, /class MembegoClient implements ClientePlataforma/)
  assert.match(local, /\): ClientePlataforma \{/)
})

/**
 * Las consultas las hacen los DOS caminos. Escritas por separado, el satélite y
 * el vertical embebido darían respuestas distintas sobre el mismo cliente — y
 * descubrir cuál es la buena exigiría leer las dos.
 */
test('la API y el cliente en proceso comparten las consultas', () => {
  const consultas = ['clientePorId', 'clientePorEmail', 'clientePorTelefono', 'clientePorPlaca']
  const local = readFileSync(join('src', 'modules', 'plataforma', 'cliente-local.ts'), 'utf8')
  const resolve = readFileSync(
    join('src', 'app', 'api', 'platform', 'v1', 'customers', 'resolve', 'route.ts'),
    'utf8'
  )
  for (const c of ['clientePorEmail', 'clientePorTelefono', 'clientePorPlaca']) {
    assert.ok(resolve.includes(c), `la API no usa la consulta compartida "${c}"`)
  }
  for (const c of consultas) {
    assert.ok(local.includes(c), `el cliente en proceso no usa la consulta compartida "${c}"`)
  }
})

test('el cliente en proceso no acepta operar sobre otra empresa', () => {
  // Un vertical embebido opera dentro de UNA. Corregirlo en silencio escondería
  // que alguien está razonando sobre otra — un error sin ningún síntoma.
  const src = readFileSync(join('src', 'modules', 'plataforma', 'cliente-local.ts'), 'utf8')
  assert.match(src, /const mismaEmpresa = \(recibida: string\)/)
  assert.match(src, /throw new Error\(\s*`clienteLocal: se pidió sobre/)
})

/**
 * El vertical embebido NO evalúa beneficios por su cuenta. Está a un paso de
 * decidir el canje, y ese paso es el que crearía la segunda implementación de
 * la ruta del dinero que la Fase 3b existió para evitar.
 */
test('el cliente en proceso no duplica la evaluación ni el cobro', () => {
  const src = readFileSync(join('src', 'modules', 'plataforma', 'cliente-local.ts'), 'utf8')
  const evaluar = src.slice(src.indexOf('async evaluateBenefits'))
  assert.match(evaluar.slice(0, 900), /throw new Error/)
  const transaccion = src.slice(src.indexOf('async recordTransaction'))
  assert.match(transaccion.slice(0, 900), /throw new Error/)
  // Y el canje sí: por el MISMO servicio que el mostrador.
  assert.ok(src.includes('ejecutarCanje'))
})

// ── Los huecos que el ejercicio destapó ─────────────────────────────────────

/**
 * `plate` no estaba en el contrato. En un lavadero el cliente se identifica por
 * la matrícula, no por su correo — y eso no lo dijo ninguna revisión de diseño,
 * lo dijo intentar que Car Wash usara el contrato.
 */
test('resolver por matrícula existe en los dos caminos', () => {
  const ruta = readFileSync(
    join('src', 'app', 'api', 'platform', 'v1', 'customers', 'resolve', 'route.ts'),
    'utf8'
  )
  assert.ok(ruta.includes('clientePorPlaca'))
  assert.match(ruta, /plate/)

  const sdk = readFileSync(join('packages', 'platform-sdk', 'src', 'cliente.ts'), 'utf8')
  assert.match(sdk, /\{ plate: string \}/)
})

test('resolver exige exactamente un identificador', () => {
  // Con dos, ¿cuál manda? Elegir en silencio devolvería un cliente por un
  // criterio que quien llamó no eligió.
  const ruta = readFileSync(
    join('src', 'app', 'api', 'platform', 'v1', 'customers', 'resolve', 'route.ts'),
    'utf8'
  )
  assert.match(ruta, /puestos\.length !== 1/)
})

test('buscar y resolver son cosas distintas', () => {
  // `resolve` exige identificador exacto y devuelve uno; `search` acepta texto
  // parcial. Sin las dos barreras del search —mínimo y tope—, «buscar» es
  // «descargarse la base de clientes a base de probar letras».
  const src = readFileSync(join('src', 'modules', 'plataforma', 'consultas.ts'), 'utf8')
  assert.match(src, /MINIMO_BUSQUEDA = \d+/)
  assert.match(src, /MAX_BUSQUEDA = \d+/)
  assert.match(src, /q\.length < MINIMO_BUSQUEDA/)
  assert.match(src, /take: MAX_BUSQUEDA/)
})

/**
 * El vehículo es una entidad COMPARTIDA, y de las pocas: MembeGo es su dueño
 * —las membresías se atan a vehículos (§13)— y a la vez un lavadero no puede
 * operar sin ella. Sin esto, el contrato no servía al vertical que MembeGo ya
 * opera todos los días.
 */
test('el vehículo entró al contrato de proyección con su límite', () => {
  const campos = camposPermitidos('Vehicle')
  assert.deepEqual([...campos].sort(), ['customerId', 'id', 'marca', 'modelo', 'placa'])
  // Sin color, sin año, sin categoría tarifaria: el vertical identifica y
  // nombra el coche; lo demás es de MembeGo o del propio vertical.
  for (const prohibido of ['color', 'anio', 'tipoVehiculoId', 'placaNormalizada']) {
    assert.ok(!campos.includes(prohibido), `"${prohibido}" no debe salir del Core`)
  }

  const v = PROYECCIONES.find((p) => p.entidad === 'Vehicle')
  assert.ok(v)
  assert.match(v!.usoPermitido, /NO para decidir|canje/i, 'debe decir que no decide la cobertura')
})

// ── El teléfono ─────────────────────────────────────────────────────────────

/**
 * ESTE FALLO EXISTIÓ, y lo encontró la prueba contra base real, no el análisis
 * estático: la comparación era en UNA sola dirección
 * (`guardado.endsWith(consultado)`). Con el cliente guardado como
 * «809-555-1234» y un satélite preguntando por «+18095551234» —E.164, el
 * formato que manda cualquier integración seria— la respuesta era «no existe».
 *
 * Y es el peor fallo posible aquí: el empleado concluye que el cliente no tiene
 * membresía y le cobra el precio completo.
 */
test('el mismo número escrito de otra forma se reconoce', () => {
  assert.ok(mismoTelefono('809-555-1234', '+1 809 555 1234'))
  assert.ok(mismoTelefono('+18095551234', '8095551234'))
  assert.ok(mismoTelefono('(809) 555-1234', '809.555.1234'))
})

/**
 * Y la comparación está ACOTADA. Sin tope, «5551234» casaría con cualquier
 * número del mundo que acabe igual — y confundir dos clientes es peor que no
 * encontrar a uno: se enseñan los datos de otra persona.
 */
test('un sufijo suelto NO es el mismo número', () => {
  // Sobran cuatro dígitos: eso ya no es un prefijo, es otro número.
  assert.equal(mismoTelefono('8095551234', '99998095551234'), false)
  assert.equal(mismoTelefono('1234567', '99991234567'), false)
  // Y por debajo del mínimo no identifica a nadie, ni consigo mismo.
  assert.equal(mismoTelefono('551234', '551234'), false)
  assert.equal(mismoTelefono('', '8095551234'), false)
})

/**
 * EL LÍMITE ESTÁ DONDE ESTÁ POR UNA DECISIÓN, no por casualidad: hasta tres
 * dígitos de más se aceptan como prefijo.
 *
 * Eso hace que «555-1234» case con «809-555-1234» —el mismo número guardado sin
 * el código de zona, que es lo normal en una ficha vieja—. Es un riesgo
 * asumido: dos personas distintas con esos dos números se confundirían.
 *
 * Se acepta porque el fallo contrario es peor y mucho más frecuente: no
 * encontrar al cliente que sí existe hace que el empleado le cobre el precio
 * completo, todos los días. Subir el tope a 4 metería códigos de país enteros
 * y el riesgo dejaría de estar acotado.
 */
test('el margen de prefijo es de tres dígitos, ni más ni menos', () => {
  assert.equal(mismoTelefono('5551234', '8095551234'), true, 'tres de margen: pasa')
  assert.equal(mismoTelefono('5551234', '18095551234'), false, 'cuatro: ya no')
})

/**
 * La regla está separada de `consultas.ts` porque ese archivo lleva
 * `server-only` y con él la prueba no falla: NO CARGA, que es mucho peor —el
 * archivo entero desaparece del recuento sin que nadie lo note—.
 *
 * Lo que hay que impedir es que la separación se convierta en una copia: la
 * consulta real usando una versión y esta prueba dando el visto bueno a otra.
 */
test('la consulta real usa exactamente esta comparación, no una copia', () => {
  const src = readFileSync(join('src', 'modules', 'plataforma', 'consultas.ts'), 'utf8')
  assert.match(src, /from '@\/modules\/plataforma\/consultas-nucleo'/)
  assert.ok(
    !/export function mismoTelefono/.test(src),
    'si se reimplanta aquí, la prueba estaría avalando otra función'
  )
  // Se busca el IMPORT, no la palabra: el archivo la nombra en su cabecera para
  // explicar por qué existe, y una prueba que falla con su propia
  // documentación enseña a borrar la documentación.
  const nucleo = readFileSync(join('src', 'modules', 'plataforma', 'consultas-nucleo.ts'), 'utf8')
  assert.ok(
    !/^\s*import 'server-only'/m.test(nucleo),
    'el núcleo tiene que poder cargarse sin Next'
  )
})

// ── Lo que el puerto NO da, y por qué ───────────────────────────────────────

/**
 * Un puerto sin límites documentados invita a suponer que lo que falta es un
 * olvido. Estos cuatro son decisiones, y la razón vive en el código para que
 * quien busque un método y no lo encuentre la lea ahí.
 */
test('cada límite del puerto lleva escrita su razón', () => {
  // La LISTA de límites la congela `platform-satelite.test.ts`, porque en la
  // Fase 7 cambió: `customers:create` salió de aquí por el camino que esta
  // misma fase dejó escrito —«llegan como escrituras del Core cuando un
  // satélite real las necesite»—, y el satélite llegó.
  //
  // Lo que esta prueba sigue vigilando es lo que NO puede cambiar: que un
  // límite sin razón escrita no existe. Un método que falta sin explicación se
  // lee como un olvido, y el siguiente lo añade.
  const src = readFileSync(join('packages', 'contracts', 'src', 'puerto.ts'), 'utf8')
  for (const razon of ['irreversible', 'SSO', 'ningún satélite real']) {
    assert.ok(src.includes(razon), `falta la razón de un límite: "${razon}"`)
  }
  assert.ok(FUERA_DEL_PUERTO.length > 0, 'un puerto sin límites no es un puerto')
})

// ── Higiene de los paquetes ─────────────────────────────────────────────────

test('el puerto no arrastra nada del Core', () => {
  const dir = join('packages', 'contracts', 'src')
  const recorrer = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f)
      return statSync(p).isDirectory() ? recorrer(p) : p.endsWith('.ts') ? [p] : []
    })
  for (const archivo of recorrer(dir)) {
    const src = readFileSync(archivo, 'utf8')
    for (const prohibido of ["from '@/", "from 'next", "from '@prisma"]) {
      assert.ok(!src.includes(prohibido), `${archivo} importa ${prohibido}`)
    }
  }
})

test('el vertical pide por el contrato en los sitios ya migrados', () => {
  // Si alguien los devuelve a consultar tablas, la extracción vuelve a crecer.
  for (const archivo of ['cola-actions.ts', 'catalogo-actions.ts']) {
    const src = readFileSync(join('src', 'modules', 'carwash', archivo), 'utf8')
    assert.ok(src.includes('clienteLocal'), `${archivo} dejó de usar el contrato`)
  }
})
