import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CAPABILITIES,
  FUERA_DEL_PUERTO,
  SCOPES_POR_CAPABILITY,
  scopesDelManifiesto,
  validarManifiesto,
} from '@membego/contracts'
import {
  MAX_NOMBRE,
  esIdLocal,
  normalizarAlta,
  nuevoIdLocal,
  tieneIdentificador,
} from '../src/modules/plataforma/alta-cliente-nucleo'
import {
  medirRamificaciones,
  ramificacionesEn,
  sinComentarios,
} from '../scripts/nucleo-sin-verticales.mjs'

/** Código, sin lo que explica el código. Ver `sinComentarios`. */
const codigoDe = (p: string): string => sinComentarios(readFileSync(p, 'utf8'))

/**
 * EL PRIMER SATÉLITE DE VERDAD (Fase 7).
 *
 * La Fase 6 metió a Car Wash por el contrato y contestó «¿sirve para operar?».
 * Queda la otra pregunta, la que decide si esto es una plataforma o un monolito
 * con una API delante: **¿se integra un sistema nuevo sin tocar el Core?**
 */

// ── El Core no conoce a ningún vertical ─────────────────────────────────────

/**
 * LA GUARDIA CENTRAL DE LA FASE.
 *
 * Lo que rompe la arquitectura no es nombrar un vertical —MembeGo tiene
 * restaurantes de verdad en su marketplace— sino RAMIFICAR por él:
 *
 *     if (sistema.slug === 'restaurant') { ... }
 *
 * Cada una de esas líneas es un despliegue de MembeGo por cada vertical nuevo,
 * que es el techo que esta arquitectura existe para quitar.
 */
test('la capa de plataforma no ramifica por ningún vertical', () => {
  const hallazgos = medirRamificaciones()
  assert.equal(
    hallazgos.length,
    0,
    'la plataforma decide según el vertical concreto:\n' +
      hallazgos.map((h) => `  ${h.archivo}:${h.linea}  ${h.texto}`).join('\n')
  )
})

/**
 * Y LA GUARDIA TIENE QUE SABER BUSCAR.
 *
 * Una medida que siempre da cero porque no encuentra nada es indistinguible de
 * un código limpio — y peor, porque nadie vuelve a mirarla. Es el mismo fallo
 * que la Fase 6 descubrió en la medida del acoplamiento, contando 22 donde
 * había 25.
 */
test('la guardia detecta una ramificación cuando la hay', () => {
  assert.equal(ramificacionesEn(`if (sistema.slug === 'restaurant') return 1`).length, 1)
  assert.equal(ramificacionesEn(`if (categoria !== "CAR_WASH") return 2`).length, 1)
  assert.equal(ramificacionesEn(`if (['gym','spa'].includes(slug)) return 3`).length, 1)
  // Y lo que documenta no se juzga: si no, la guardia enseña a borrar comentarios.
  assert.equal(ramificacionesEn(`// if (slug === 'restaurant') sería la deuda`).length, 0)
  assert.equal(ramificacionesEn(`/* slug === 'restaurant' */`).length, 0)
})

// ── El manifiesto ───────────────────────────────────────────────────────────

const RESTAURANT = JSON.parse(
  readFileSync(join('examples', 'manifiestos', 'restaurant.json'), 'utf8')
)

test('el manifiesto de ejemplo es válido', () => {
  const v = validarManifiesto(RESTAURANT)
  assert.ok(v.ok, v.ok ? '' : v.errores.join(' · '))
})

/**
 * LO QUE HACE QUE UN MANIFIESTO NO SEA UN AGUJERO.
 *
 * Se piden capabilities; los scopes los deriva el Core. Si el manifiesto
 * llevara scopes, una línea añadida al archivo de un satélite SERÍA el permiso.
 * Llevando capabilities, la lista de lo concedible vive aquí y un valor que no
 * esté en ella falla en vez de conceder algo que nadie revisó.
 */
test('un manifiesto no puede concederse un scope a sí mismo', () => {
  const v = validarManifiesto({
    ...RESTAURANT,
    capabilities: [...RESTAURANT.capabilities, 'benefits:redeem'],
  })
  assert.ok(!v.ok)
  assert.ok(v.ok || v.errores.some((e) => e.includes('benefits:redeem')))

  // Y los scopes que sí salen son exactamente los de sus capabilities.
  const ok = validarManifiesto(RESTAURANT)
  assert.ok(ok.ok)
  const esperados = [
    ...new Set(ok.manifiesto.capabilities.flatMap((c) => SCOPES_POR_CAPABILITY[c])),
  ].sort()
  assert.deepEqual(scopesDelManifiesto(ok.manifiesto), esperados)
})

test('el manifiesto exige https, porque por ahí viaja un token SSO', () => {
  const v = validarManifiesto({ ...RESTAURANT, urlBase: 'http://restaurant.membego.com' })
  assert.ok(!v.ok)
  assert.ok(v.ok || v.errores.some((e) => e.includes('https')))
  // Salvo localhost: sin eso no se puede desarrollar un satélite.
  assert.ok(validarManifiesto({ ...RESTAURANT, urlBase: 'http://localhost:3001' }).ok)
})

test('el manifiesto devuelve todos los errores, no el primero', () => {
  const v = validarManifiesto({ slug: 'MAYÚSCULAS', urlBase: 'no-es-una-url' })
  assert.ok(!v.ok)
  // Quien da de alta un sistema está delante de una terminal: enseñarle los
  // cinco problemas de una vez le ahorra cinco intentos.
  assert.ok(v.ok || v.errores.length >= 4, `solo ${v.ok ? 0 : v.errores.length} errores`)
})

test('un sistema sin vertical y sin capabilities no se registra', () => {
  const v = validarManifiesto({ ...RESTAURANT, businessTypes: [], capabilities: [] })
  assert.ok(!v.ok)
})

/**
 * Registrar un vertical es ESCRIBIR FILAS. El día que haga falta editar un
 * `switch` del Core para añadir uno, esta prueba sigue verde y la arquitectura
 * ya habrá fallado — por eso además está la guardia de ramificaciones.
 */
test('dar de alta un sistema no exige editar código del Core', () => {
  const src = readFileSync(join('scripts', 'registrar-sistema.ts'), 'utf8')
  for (const tabla of [
    'tipoNegocio.upsert',
    'sistemaConectado.upsert',
    'sistemaTipoNegocio.upsert',
    'credencialSistema.create',
    'empresaSistema.upsert',
  ]) {
    assert.ok(src.includes(tabla), `el registro no escribe ${tabla}`)
  }
  // Un tipo de negocio nuevo se CREA: era un `as const` de cuatro valores y por
  // eso pasó a ser tabla en la Fase 1b.
  assert.match(src, /create: \{ codigo, nombre/)
})

test('un sistema recién registrado nace en DRAFT', () => {
  // Registrar no es lanzar. Nacer activo saltaría la única revisión humana que
  // hay entre «alguien corrió un script» y «este sistema abre sesiones».
  const src = readFileSync(join('scripts', 'registrar-sistema.ts'), 'utf8')
  assert.match(src, /estado: 'DRAFT'/)
  assert.match(src, /activo: false/)
})

test('reregistrar no reactiva un sistema suspendido', () => {
  // Correr el script para cambiar una URL no puede deshacer una suspensión: eso
  // es una decisión operativa que alguien tomó mirando un incidente.
  const src = codigoDe(join('scripts', 'registrar-sistema.ts'))
  const desde = src.indexOf('sistemaConectado.upsert')
  const update = src.slice(src.indexOf('update: {', desde), src.indexOf('create: {', desde))
  assert.ok(update.includes('urlBase'), 'el trozo mirado no es el update del sistema')
  assert.ok(!update.includes('estado'), 'el update del sistema no puede tocar `estado`')
  assert.ok(!update.includes('autoHabilitar'), 'ni `autoHabilitar`')
})

// ── El vertical de una empresa ──────────────────────────────────────────────

/**
 * EL DEFECTO QUE ESTA FASE DESTAPÓ, Y QUE NINGUNA REVISIÓN DE DISEÑO DIJO.
 *
 * La Fase 1b convirtió los tipos de negocio en tabla para que registrar un
 * vertical nuevo fuera escribir filas. Pero el vertical de una EMPRESA seguía
 * saliendo de `categoriaDeType(type)`: un `switch` de cuatro casos con
 * `default: 'CAR_WASH'`.
 *
 * Con eso se podía dar de alta el sistema de un hotel y NINGUNA empresa podía
 * ser compatible con él jamás. El registro era datos; la compatibilidad seguía
 * siendo código — y el techo de cuatro verticales seguía puesto, escondido.
 *
 * Lo encontró la prueba contra base real, al crear una empresa con
 * `type: "restaurant"` y verla clasificada como lavadero.
 */
test('la plataforma resuelve el vertical por la tabla, no por una lista fija', () => {
  const src = codigoDe(join('src', 'modules', 'plataforma', 'registro.ts'))
  // La columna manda, y se lee ANTES del mapeo heredado.
  assert.match(src, /tipoNegocioCodigo/)
  const fn = src.slice(src.indexOf('function tipoNegocioDe'))
  assert.ok(
    fn.indexOf('tipoNegocioCodigo') < fn.indexOf('capacidadesEfectivas'),
    'el mapeo heredado no puede ganarle a la columna: volvería el techo de cuatro verticales'
  )
})

test('una empresa sin la columna sigue resolviéndose como antes', () => {
  // Nullable a propósito: devolver null a una empresa anterior a la migración
  // le quitaría el acceso a los sistemas que hoy tiene.
  const src = codigoDe(join('src', 'modules', 'plataforma', 'registro.ts'))
  const fn = src.slice(src.indexOf('function tipoNegocioDe'))
  assert.match(fn.slice(0, 1200), /capacidadesEfectivas\(empresa\.type/)

  // Y el camino de respaldo NO puede pedir la columna: si se entra ahí es
  // porque la migración no está aplicada. Pedirla haría fallar el respaldo
  // también, y el resultado no sería «como antes» sino «sin ningún sistema».
  const legado = src.slice(src.indexOf('empresaSelectLegado ='))
  assert.ok(!legado.slice(0, 200).includes('tipoNegocioCodigo'))
})

test('la migración rellena el vertical reproduciendo la resolución de hoy', () => {
  const sql = readFileSync(
    join('prisma', 'migrations', '20260810_vertical_de_empresa', 'migration.sql'),
    'utf8'
  )
  // Aditiva, idempotente, y el relleno DENTRO del guard para que corra una vez.
  assert.match(sql, /ADD COLUMN "tipoNegocioCodigo"/)
  assert.match(sql, /IF NOT EXISTS \(\s*\n?\s*SELECT 1 FROM information_schema\.columns/)
  const guard = sql.slice(sql.indexOf('IF NOT EXISTS'), sql.indexOf('END IF'))
  assert.ok(guard.includes('UPDATE "companies"'), 'el relleno tiene que ir dentro del guard')
  // Los cuatro de siempre tienen que existir, o el relleno dejaría códigos
  // que no apuntan a ningún tipo y todo quedaría incompatible con todo.
  for (const codigo of ['CAR_WASH', 'RESTAURANTE', 'BARBERIA', 'GYM']) {
    assert.ok(sql.includes(`'${codigo}'`), `falta sembrar ${codigo}`)
  }
})

// ── El alta de clientes ─────────────────────────────────────────────────────

/**
 * La Fase 6 terminó diciendo que el contrato no aguantaba escribir. Esta es la
 * escritura, y llega por el camino que la propia Fase 6 dejó escrito: «como
 * escrituras del Core cuando un satélite real las necesite».
 */
test('el puerto ya ofrece dar de alta un cliente', () => {
  const puerto = readFileSync(join('packages', 'contracts', 'src', 'puerto.ts'), 'utf8')
  assert.match(puerto, /createCustomer\(/)
  assert.ok(!FUERA_DEL_PUERTO.includes('customers:create' as never))
})

/**
 * PERO SOLO ESA. Crear vehículos sigue fuera porque ningún satélite real lo ha
 * pedido: Restaurant no tiene coches. Añadirlo «ya que estamos» sería diseñar
 * contra un caso imaginado, que es cómo se llenan las APIs de métodos que nadie
 * usa y nadie puede quitar.
 */
test('lo que ningún satélite ha pedido sigue fuera del puerto', () => {
  assert.deepEqual([...FUERA_DEL_PUERTO].sort(), [
    'customers:merge',
    'staff:list',
    'vehicles:create',
  ])
  const puerto = readFileSync(join('packages', 'contracts', 'src', 'puerto.ts'), 'utf8')
  const interfaz = puerto.slice(
    puerto.indexOf('export interface ClientePlataforma'),
    puerto.indexOf('export const FUERA_DEL_PUERTO')
  )
  for (const prohibido of ['createVehicle', 'mergeCustomer', 'staff']) {
    assert.ok(!interfaz.includes(prohibido), `el puerto no puede ofrecer "${prohibido}"`)
  }
})

test('solo el nombre es obligatorio para registrar a alguien', () => {
  // Exigir correo o documento en la puerta es la forma más rápida de que el
  // encargado deje de usar el sistema y vuelva al cuaderno.
  const v = normalizarAlta({ nombre: 'Juan' })
  assert.ok(v.ok)
  assert.equal(v.ok && v.datos.email, '')
  assert.equal(v.ok && v.datos.telefono, null)

  assert.ok(!normalizarAlta({ nombre: '   ' }).ok)
  assert.ok(!normalizarAlta({ nombre: 'Juan', email: 'no-es-un-correo' }).ok)
})

test('el correo se guarda en minúsculas', () => {
  // Si entra como `Maria@X.com` y la búsqueda pregunta por `maria@x.com`, el
  // cliente existe y el sistema dice que no — el mismo fallo que la Fase 6
  // encontró en los teléfonos, en otra columna.
  const v = normalizarAlta({ nombre: 'María', email: '  Maria@X.COM ' })
  assert.ok(v.ok)
  assert.equal(v.ok && v.datos.email, 'maria@x.com')
})

test('el nombre se recorta, no se rechaza', () => {
  const largo = 'a'.repeat(500)
  const v = normalizarAlta({ nombre: largo })
  assert.ok(v.ok)
  assert.equal(v.ok && v.datos.nombre.length, MAX_NOMBRE)
})

/**
 * SIN IDENTIFICADOR NO SE DEDUPLICA, y esa es la respuesta correcta.
 *
 * Dos «Juan» en el mismo restaurante son dos personas. Fusionarlos por el
 * nombre mezclaría el historial de dos clientes reales, y ese daño no tiene
 * vuelta atrás — es peor que la ficha de más.
 */
test('sin identificador no hay nada que deduplicar', () => {
  const solo = normalizarAlta({ nombre: 'Juan' })
  assert.ok(solo.ok && !tieneIdentificador(solo.datos))

  const conTel = normalizarAlta({ nombre: 'Juan', telefono: '809-555-1234' })
  assert.ok(conTel.ok && tieneIdentificador(conTel.datos))

  const conMail = normalizarAlta({ nombre: 'Juan', email: 'j@x.com' })
  assert.ok(conMail.ok && tieneIdentificador(conMail.datos))
})

/**
 * Y por eso la clave de idempotencia es obligatoria: el caso normal de una mesa
 * —alguien que llega solo con su nombre— no tiene con qué deduplicarse, así que
 * un reintento por una respuesta perdida crearía la segunda ficha.
 */
test('el alta exige clave de idempotencia en los dos caminos', () => {
  const ruta = readFileSync(
    join('src', 'app', 'api', 'platform', 'v1', 'customers', 'route.ts'),
    'utf8'
  )
  assert.match(ruta, /IDEMPOTENCY_KEY_REQUIRED/)
  assert.match(ruta, /conIdempotencia/)

  const sdk = readFileSync(join('packages', 'platform-sdk', 'src', 'cliente.ts'), 'utf8')
  const metodo = sdk.slice(sdk.indexOf('async createCustomer'))
  assert.match(metodo.slice(0, 700), /idempotencyKey es obligatoria/)
})

test('la identidad de un cliente sin cuenta no puede iniciar sesión', () => {
  // Supabase solo emite UUID: un id con este prefijo jamás sale de una sesión
  // real. No es una comprobación que haya que acordarse de escribir.
  const id = nuevoIdLocal()
  assert.ok(esIdLocal(id))
  assert.ok(!esIdLocal('550e8400-e29b-41d4-a716-446655440000'))
  assert.notEqual(nuevoIdLocal(), nuevoIdLocal())
})

/**
 * TRES SITIOS ESCRIBÍAN LA MISMA FILA: el mostrador, la pista y ahora la API.
 * Con filas ya escritas, unificarlas deja de ser un refactor y pasa a ser una
 * migración de datos.
 */
test('nadie crea clientes por su cuenta fuera del servicio del Core', () => {
  for (const archivo of [
    join('src', 'modules', 'carwash', 'mostrador-actions.ts'),
    join('src', 'modules', 'carwash', 'cola-actions.ts'),
    join('src', 'app', 'api', 'platform', 'v1', 'customers', 'route.ts'),
    join('src', 'modules', 'plataforma', 'cliente-local.ts'),
  ]) {
    const src = codigoDe(archivo)
    assert.ok(src.includes('altaCliente'), `${archivo} no usa el alta del Core`)
    assert.ok(
      !/\b(tx|prisma)\s*\.\s*cliente\s*\.\s*create\b/.test(src.replace(/\s+/g, ' ')),
      `${archivo} crea clientes por su cuenta`
    )
  }
})

test('el alta deja de quién vino, para poder distinguirlo después', () => {
  // Una ficha creada por el satélite del restaurante y una creada en el
  // mostrador no pueden ser indistinguibles el día que alguien pregunte de
  // dónde salen los clientes nuevos.
  const src = readFileSync(join('src', 'modules', 'plataforma', 'alta-cliente.ts'), 'utf8')
  assert.match(src, /canalOrigen: origen/)
  const ruta = readFileSync(
    join('src', 'app', 'api', 'platform', 'v1', 'customers', 'route.ts'),
    'utf8'
  )
  // `exigeSistema(ctx)` desde Connect · F3: mismo dato, obtenido de forma que
  // el tipo garantice que hay un satélite detrás.
  assert.match(ruta, /sistema\.sistemaSlug/)
})

// ── El vocabulario ──────────────────────────────────────────────────────────

test('cada capability declara los scopes que concede', () => {
  for (const c of CAPABILITIES) {
    const scopes = SCOPES_POR_CAPABILITY[c]
    assert.ok(scopes && scopes.length > 0, `${c} no concede ningún scope`)
  }
  // Escribir sin poder leer sería mentir: el alta deduplica y devuelve la ficha
  // que ya existía, así que por ahí se leen clientes igual.
  assert.deepEqual([...SCOPES_POR_CAPABILITY.CUSTOMER_REGISTRATION], [
    'customers:read',
    'customers:write',
  ])
})
