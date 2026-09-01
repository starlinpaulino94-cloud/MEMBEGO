import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CODIGOS_ERROR } from '../src/modules/plataforma/errores'

/**
 * CANJE POR API (Fase 3b).
 *
 * El canje vivía dentro de un Server Action de 937 líneas que empezaba con
 * `getUser()`. Estas pruebas vigilan lo que la extracción tenía que preservar y
 * lo que no puede volver a mezclarse.
 *
 * La verificación de COMPORTAMIENTO —que un canje descuente una vez, que dos
 * llamadas con la misma clave descuenten una sola, que un QR usado no valga—
 * se hizo contra PostgreSQL real; aquí se fijan las invariantes estructurales,
 * que son las que se rompen en silencio al refactorizar.
 */

const CANJE = join('src', 'modules', 'visitas', 'canje.ts')
const ACTIONS = join('src', 'modules', 'visitas', 'actions.ts')
const REDEMPTIONS = join('src', 'app', 'api', 'platform', 'v1', 'redemptions', 'route.ts')

const leer = (p: string) => readFileSync(p, 'utf8')

// ── Una sola implementación ─────────────────────────────────────────────────

/**
 * LA PRUEBA QUE JUSTIFICA LA FASE.
 *
 * Dos implementaciones de la ruta del dinero divergen —siempre— en el caso raro
 * que nadie probó, y aquí el caso raro es alguien consumiendo dos veces. Si
 * `/redemptions` deja de llamar al mismo servicio que el mostrador, esto lo
 * para.
 */
test('el endpoint de canje usa el MISMO servicio que el mostrador', () => {
  const api = leer(REDEMPTIONS)
  const action = leer(ACTIONS)
  assert.ok(api.includes('ejecutarCanje'), '/redemptions debe llamar a ejecutarCanje')
  assert.ok(action.includes('ejecutarCanje'), 'confirmarVisita debe llamar a ejecutarCanje')
})

test('ni el endpoint ni el action reimplementan el descuento', () => {
  // Se vigilan las ESCRITURAS, no las menciones: `buscarPorToken` lee
  // `lavadosRestantes` para pintarlo en pantalla y eso es legítimo. Lo que no
  // puede repetirse fuera del servicio es mover el saldo, crear la visita o
  // emitir la transacción oficial — los tres efectos del canje.
  for (const archivo of [REDEMPTIONS, ACTIONS]) {
    const src = leer(archivo)
    assert.ok(!/lavadosRestantes:\s*\{\s*decrement/.test(src), `${archivo} descuenta saldo`)
    assert.ok(!/membership\.update/.test(src), `${archivo} escribe sobre la membresía`)
    assert.ok(!src.includes('crearTransaccionAplicada'), `${archivo} crea la transacción aparte`)
    assert.ok(!src.includes('visit.create'), `${archivo} crea la visita aparte`)
  }
  // Y en el servicio sí están los tres, que es donde deben estar.
  const canje = leer(CANJE)
  assert.match(canje, /lavadosRestantes:\s*\{\s*decrement:\s*1\s*\}/)
  assert.ok(canje.includes('tx.visit.create'))
  assert.ok(canje.includes('crearTransaccionAplicada'))
})

// ── Lo que la extracción tenía que preservar ────────────────────────────────

/**
 * Las tres defensas contra carreras del núcleo original. Se rompen
 * reescribiéndolas «más limpias»: un `findUnique` + `update` en vez de un
 * `updateMany` con guard parece igual y deja de ser atómico.
 */
test('el núcleo atómico conserva sus guardas contra carreras', () => {
  const src = leer(CANJE)

  // 1 · QR de un solo uso: el where lleva `activo: true`, y count===0 aborta.
  assert.match(src, /qrToken\.updateMany\(\{[\s\S]*?activo:\s*true/)
  assert.match(src, /invalidado\.count === 0/)

  // 2 · Estado y vencimiento dentro del where del update, no leídos antes.
  assert.match(src, /guardVigente[\s\S]*?estado:\s*'ACTIVA'/)
  assert.match(src, /fechaVencimiento:\s*\{\s*gt:\s*now\s*\}/)
  assert.match(src, /lavadosRestantes:\s*\{\s*gt:\s*0\s*\}/)
  assert.match(src, /upd\.count === 0/)

  // 3 · Saldo releído tras el decremento: el valor leído antes sería stale
  // frente a escaneos concurrentes.
  assert.match(src, /const fresco = await tx\.membership\.findUnique/)
})

test('la auditoría va DENTRO de la transacción', () => {
  // Una visita no puede quedar registrada sin su rastro. Si `createMany` de
  // auditoría saliera del callback, un fallo entre medias dejaría el descuento
  // hecho y la auditoría no.
  const src = leer(CANJE)
  const inicioTx = src.indexOf('conEmpresa(membership.companyId, async (tx)')
  const auditoria = src.indexOf('tx.auditLog.createMany')
  const transaccion = src.indexOf('crearTransaccionAplicada(tx')
  assert.ok(inicioTx > 0 && auditoria > inicioTx, 'la auditoría quedó fuera de la transacción')
  assert.ok(transaccion > inicioTx, 'la transacción oficial quedó fuera del núcleo atómico')
})

test('las lecturas pesadas siguen FUERA de la transacción', () => {
  // pgBouncer en transaction-mode retiene una conexión real durante todo el
  // callback. Meter ahí la lectura de la membresía con sus includes deshace una
  // optimización que ya se pagó una vez.
  const src = leer(CANJE)
  const lecturaMembresia = src.indexOf("sinEmpresa('canje: buscar membresía")
  const inicioTx = src.indexOf('conEmpresa(membership.companyId, async (tx)')
  assert.ok(lecturaMembresia > 0 && lecturaMembresia < inicioTx)
})

test('el Server Action quedó como autenticación y parseo', () => {
  // Si vuelve a crecer, es que la lógica se está colando otra vez en el sitio
  // donde solo la puede usar un navegador.
  const action = leer(ACTIONS)
  const desde = action.indexOf('export async function confirmarVisita')
  const hasta = action.indexOf('export interface ImpresionState')
  const cuerpo = action.slice(desde, hasta)
  const lineas = cuerpo.split('\n').length
  assert.ok(lineas < 100, `confirmarVisita tiene ${lineas} líneas; la lógica volvió al action`)
  assert.ok(cuerpo.includes('getUser()'))
  assert.ok(cuerpo.includes('confirmarVisitaSchema'))
})

// ── El actor ────────────────────────────────────────────────────────────────

test('un satélite no se hace pasar por un empleado', () => {
  // `dbUserId: null` es deliberado: inventar un usuario para que el campo no
  // quede vacío sería falsificar quién atendió al cliente.
  const src = leer(REDEMPTIONS)
  assert.match(src, /origen:\s*'SISTEMA'/)
  assert.match(src, /dbUserId:\s*null/)
  // Desde Connect · F3 el principal es una unión discriminada y el satélite se
  // obtiene con `exigeSistema(ctx)`. Lo que se vigila es lo mismo: que el canje
  // viaje con el slug de QUIEN LLAMA y no con uno de otra procedencia.
  assert.match(src, /sistemaSlug:\s*sistema\.sistemaSlug/)
})

test('la empresa se comprueba dos veces, no una', () => {
  // `autenticarSobreEmpresa` la valida contra las habilitaciones; `ejecutarCanje`
  // vuelve a exigir que la membresía sea de ella. Dos cierres independientes.
  assert.ok(leer(REDEMPTIONS).includes('autenticarSobreEmpresa'))
  assert.match(leer(CANJE), /actor\.companyId && membership\.companyId !== actor\.companyId/)
})

// ── Idempotencia y códigos ──────────────────────────────────────────────────

test('las escrituras exigen Idempotency-Key', () => {
  for (const ruta of [
    REDEMPTIONS,
    join('src', 'app', 'api', 'platform', 'v1', 'transactions', 'route.ts'),
  ]) {
    const src = leer(ruta)
    assert.ok(src.includes('IDEMPOTENCY_KEY_REQUIRED'), `${ruta} no exige la clave`)
    assert.ok(src.includes('conIdempotencia'), `${ruta} no reserva la clave`)
  }
})

/**
 * La reserva ANTES de ejecutar. Al revés —canjear y luego registrar— dos
 * reintentos simultáneos consumirían los dos antes de que ninguno guardara, que
 * es exactamente el fallo que la clave viene a impedir.
 */
test('la clave se reserva antes de canjear', () => {
  const src = leer(REDEMPTIONS)
  assert.ok(src.indexOf('conIdempotencia') < src.indexOf('ejecutarCanje'))
})

/**
 * Un rechazo también se guarda. Si no, el reintento de un satélite que ya
 * recibió «sin usos» volvería a ejecutar el canje y podría encontrarlo
 * recargado: dos respuestas distintas para la misma petición.
 */
test('también se guarda la respuesta de un rechazo', () => {
  const src = leer(REDEMPTIONS)
  const rechazo = src.indexOf('if (!resultado.ok)')
  const guardar = src.indexOf('idem.guardar', rechazo)
  assert.ok(rechazo > 0 && guardar > rechazo, 'el rechazo no se guarda en la clave')
})

/**
 * ESTE FALLO EXISTIÓ, y lo encontró la prueba contra base real, no el análisis
 * estático: la respuesta repetida salía por `respuestaApi`, que siempre
 * responde 200. Así, el reintento de un canje RECHAZADO —«sin usos»— devolvía
 * 200 con un cuerpo de error dentro. Un satélite que mira el código HTTP habría
 * concluido que el canje funcionó y le habría dado al cliente un beneficio que
 * MembeGo acababa de negarle.
 */
test('la respuesta repetida conserva su código HTTP', () => {
  const src = readFileSync(join('src', 'modules', 'plataforma', 'idempotencia.ts'), 'utf8')
  assert.match(src, /status:\s*estado/, 'la repetición debe usar el estado guardado')
  // Se busca la LLAMADA, no la palabra: el comentario que explica este fallo
  // menciona `respuestaApi`, y una guardia que no distinga texto de código
  // fallaría por su propia documentación.
  assert.ok(
    !/respuestaApi\(/.test(src),
    'respuestaApi siempre responde 200: no vale para repetir'
  )
  assert.ok(src.includes("'X-Idempotent-Replay'"), 'la repetición debe distinguirse en los logs')
})

test('cada motivo de rechazo tiene su código HTTP', () => {
  // 422 = el negocio dice que no (no reintentar igual).
  // 409 = alguien se adelantó (reintentar con datos frescos).
  // 404 = no existe... o es de otra empresa, y son el mismo error a propósito.
  assert.equal(CODIGOS_ERROR.BENEFIT_NOT_ELIGIBLE, 422)
  assert.equal(CODIGOS_ERROR.REDEMPTION_CONFLICT, 409)

  const src = leer(REDEMPTIONS)
  const mapa = src.slice(src.indexOf('HTTP_POR_MOTIVO'), src.indexOf('export async function POST'))
  for (const motivo of [
    'MEMBRESIA_NO_ENCONTRADA', 'SUCURSAL_NO_ENCONTRADA', 'EMPRESA_AJENA',
    'VEHICULO_NO_AUTORIZADO', 'MEMBRESIA_NO_ACTIVA', 'MEMBRESIA_VENCIDA',
    'SIN_USOS', 'QR_INVALIDO', 'CONFLICTO', 'ERROR_INTERNO',
  ]) {
    assert.ok(mapa.includes(motivo), `el motivo "${motivo}" no tiene código HTTP`)
  }
})

test('una membresía de otra empresa da 404, no 403', () => {
  // Distinguir «no existe» de «existe pero no es tuya» confirmaría, membresía a
  // membresía, de quién es cada una.
  const src = leer(REDEMPTIONS)
  assert.match(src, /EMPRESA_AJENA:\s*'NOT_FOUND'/)
})

// ── Eco ─────────────────────────────────────────────────────────────────────

/**
 * Un satélite que canjea ya tiene la respuesta síncrona. Devolverle por webhook
 * la noticia de su propia acción es un eco, y una implementación ingenua lo
 * trata como un evento nuevo, actúa otra vez y vuelve a llamarnos.
 */
test('el evento no vuelve al sistema que lo provocó', () => {
  const despacho = leer(join('src', 'modules', 'integraciones', 'despacho.ts'))
  assert.ok(despacho.includes('sistemaOrigenDe'))
  assert.match(despacho, /sistemasDestino\(evento\.companyId,\s*sistemaOrigenDe\(evento\.payload\)\)/)
  assert.match(despacho, /!excluirSlug \|\| s\.slug !== excluirSlug/)

  // Y el canje lo pone en el payload cuando el origen es un satélite.
  assert.match(leer(CANJE), /sistemaOrigen:\s*actor\.sistemaSlug/)
})

test('un canje del mostrador no marca ningún sistema de origen', () => {
  // Si lo marcara, el evento dejaría de llegar a un satélite por error.
  const src = leer(CANJE)
  assert.match(src, /actor\.sistemaSlug \? \{ sistemaOrigen: actor\.sistemaSlug \} : \{\}/)
})

// ── Lo que /transactions NO hace ────────────────────────────────────────────

test('registrar una venta no descuenta ningún beneficio', () => {
  // Es un puente de informes, no un canje. Si empieza a tocar membresías, se
  // convierte en una segunda puerta al saldo sin las guardas del canje.
  const src = leer(join('src', 'app', 'api', 'platform', 'v1', 'transactions', 'route.ts'))
  for (const prohibido of ['lavadosRestantes', 'qrToken', 'ejecutarCanje', 'membership.update']) {
    assert.ok(!src.includes(prohibido), `/transactions no puede tocar ${prohibido}`)
  }
  assert.match(src, /tipo:\s*'SALE'/)
  assert.match(src, /empleadoId:\s*null/)
})

test('una venta con un cliente de otra empresa se registra sin cliente', () => {
  // Rechazarla perdería el importe del informe por un dato accesorio;
  // atribuirla a ciegas metería la venta en la ficha de un cliente ajeno.
  const src = leer(join('src', 'app', 'api', 'platform', 'v1', 'transactions', 'route.ts'))
  assert.match(src, /findFirst\(\{\s*where:\s*\{\s*id:\s*cuerpo\.customerId,\s*companyId\s*\}/)
  assert.match(src, /clienteId:\s*cliente\?\.id \?\? null/)
})
