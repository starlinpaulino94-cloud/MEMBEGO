import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  dedupeDescuadre,
  dedupeVencimiento,
  dineroRD,
  esAvisable,
  semanaIso,
  textoDescuadre,
  textoVencimiento,
  textoVencimientoProveedor,
} from '../src/modules/supply/avisos'
import { UMBRALES_VENCIMIENTO } from '../src/modules/supply/catalogo'

/**
 * MEMBEGO SUPPLY · AVISOS (Fase 40).
 *
 * El cron sabía desde el primer día que 170 pizzas por RD$51.000 vencían en
 * diez días. Lo devolvía en el JSON de su respuesta —que no lee nadie— y no
 * escribía en `Notificacion`. Lo que se prueba aquí no es que el texto quede
 * bonito, sino LA PARTE QUE SE ROMPE EN SILENCIO: las claves de deduplicación.
 *
 * El cron corre todos los días a las 07:00 UTC. Una clave inestable no da
 * error, no rompe ninguna pantalla y no sale en ningún log: simplemente, al mes
 * hay treinta avisos del mismo lote y nadie vuelve a mirar la campanita.
 */

const ALERTA = {
  loteId: 'lot_1',
  codigo: 'MBG-LITRE-2026-001',
  item: 'Pizza Pepperoni Grande',
  proveedorNombre: 'Litre Pizza',
  enRiesgo: 120,
  expuestas: 50,
  exposicionFinanciera: 51_000,
}

// ── Deduplicación: la parte que importa ─────────────────────────────────────

test('LA CLAVE ES ESTABLE: dos ejecuciones del mismo día dan la misma', () => {
  assert.equal(dedupeVencimiento('lot_1', 7), dedupeVencimiento('lot_1', 7))
})

test('la clave NO lleva fecha ni hora de ejecución', () => {
  const k = dedupeVencimiento('lot_1', 7)
  const ahora = new Date()
  // Ni el año, ni el mes, ni nada que cambie solo por correr el cron otra vez.
  assert.ok(!k.includes(String(ahora.getFullYear())), k)
  assert.ok(!/\d{2}:\d{2}/.test(k), k)
})

test('cada umbral suena UNA vez: cruzar 14 no repite el aviso de 30', () => {
  const claves = new Set(UMBRALES_VENCIMIENTO.map((u) => dedupeVencimiento('lot_1', u)))
  assert.equal(claves.size, UMBRALES_VENCIMIENTO.length)
})

test('dos lotes distintos no se pisan el aviso', () => {
  assert.notEqual(dedupeVencimiento('lot_1', 7), dedupeVencimiento('lot_2', 7))
})

test('el aviso de Membego y el del proveedor no comparten clave', () => {
  // Si la compartieran, quien fuera superadmin Y admin de la empresa recibiría
  // solo uno de los dos: el segundo `createMany` lo saltaría por duplicado.
  const k = dedupeVencimiento('lot_1', 7)
  assert.notEqual(k, `${k}|proveedor`)
})

// ── Descuadres: insisten, pero no cada día ──────────────────────────────────

const HALLAZGO = {
  tipo: 'INVARIANTE_ROTO' as const,
  gravedad: 'CRITICA' as const,
  titulo: 'El lote no cuadra',
  detalle: 'compradas 1000 ≠ 999 en las cubetas',
  entidad: 'supply_lotes',
  entidadId: 'lot_1',
}

test('un descuadre que sigue ahí NO avisa todos los días', () => {
  const lun = new Date('2026-09-21T07:00:00Z')
  const mie = new Date('2026-09-23T07:00:00Z')
  assert.equal(dedupeDescuadre(HALLAZGO, lun), dedupeDescuadre(HALLAZGO, mie))
})

test('pero vuelve a avisar la semana siguiente si nadie lo arregló', () => {
  const estaSemana = new Date('2026-09-23T07:00:00Z')
  const laQueViene = new Date('2026-09-30T07:00:00Z')
  assert.notEqual(dedupeDescuadre(HALLAZGO, estaSemana), dedupeDescuadre(HALLAZGO, laQueViene))
})

test('dos descuadres distintos del mismo lote avisan por separado', () => {
  const ahora = new Date('2026-09-23T07:00:00Z')
  const otro = { ...HALLAZGO, tipo: 'REDENCION_DUPLICADA' as const }
  assert.notEqual(dedupeDescuadre(HALLAZGO, ahora), dedupeDescuadre(otro, ahora))
})

test('solo lo que invalida cifras llega a la campanita', () => {
  assert.equal(esAvisable('CRITICA'), true)
  assert.equal(esAvisable('ALTA'), true)
  // Los MEDIA están en la pantalla de conciliación. Avisar de todo es la forma
  // más segura de que no se lea nada.
  assert.equal(esAvisable('MEDIA'), false)
})

test('la semana ISO no cambia de año a mitad de semana', () => {
  // El 1 de enero de 2027 es viernes: su semana ISO es la 53 de 2026. Sin el
  // salto al jueves, el 31-dic y el 1-ene darían claves distintas y el mismo
  // descuadre avisaría dos veces en tres días.
  assert.equal(semanaIso(new Date('2026-12-31T00:00:00Z')), semanaIso(new Date('2027-01-01T00:00:00Z')))
  assert.match(semanaIso(new Date('2026-09-23T00:00:00Z')), /^2026-W\d{2}$/)
})

// ── Los textos: lo que cada uno puede leer ──────────────────────────────────

test('a Membego se le dice el DINERO primero, no las unidades', () => {
  const t = textoVencimiento(ALERTA, 7)
  assert.match(t.titulo, /vence en 7 días/)
  assert.match(t.titulo, /MBG-LITRE-2026-001/)
  assert.ok(t.mensaje.startsWith('RD$51,000'), t.mensaje)
  assert.match(t.mensaje, /170 unidades/)
  assert.match(t.mensaje, /120 todavía se pueden repartir/)
  assert.match(t.mensaje, /50 ya están entregadas/)
})

test('SEGURIDAD · al proveedor NUNCA se le dice el costo de Membego', () => {
  const t = textoVencimientoProveedor(ALERTA, 7)
  // El costo unitario es información de contrato: su portal no la enseña, y un
  // aviso no puede ser la rendija por donde se escapa.
  assert.ok(!t.mensaje.includes('51'), t.mensaje)
  assert.ok(!t.mensaje.includes('RD$'), t.mensaje)
  assert.ok(!t.titulo.includes('RD$'), t.titulo)
  assert.match(t.mensaje, /170 unidades sin entregar/)
  assert.equal(t.href, '/admin/supply')
})

test('a un día se dice «mañana», no «en 1 días»', () => {
  assert.match(textoVencimiento(ALERTA, 1).titulo, /vence mañana/)
  assert.match(textoVencimientoProveedor(ALERTA, 1).titulo, /vence mañana/)
})

test('una sola unidad se dice en singular', () => {
  const uno = { ...ALERTA, enRiesgo: 1, expuestas: 0 }
  assert.match(textoVencimiento(uno, 3).mensaje, /1 unidad de/)
  assert.match(textoVencimientoProveedor(uno, 3).mensaje, /1 unidad sin entregar/)
})

test('no se mencionan cubetas vacías', () => {
  const soloEntregadas = { ...ALERTA, enRiesgo: 0 }
  const t = textoVencimiento(soloEntregadas, 3)
  assert.ok(!t.mensaje.includes('0 todavía se pueden repartir'), t.mensaje)
})

test('el aviso de descuadre dice DÓNDE mirar', () => {
  const t = textoDescuadre(HALLAZGO)
  assert.match(t.titulo, /crítico/i)
  assert.match(t.mensaje, /supply_lotes lot_1/)
  assert.equal(t.href, '/superadmin/supply/conciliacion')
})

test('dineroRD redondea y separa miles', () => {
  assert.equal(dineroRD(51_000), 'RD$51,000')
  assert.equal(dineroRD(300.4), 'RD$300')
})

// ── Arquitectura ────────────────────────────────────────────────────────────

test('avisos.ts es PURO: se prueba sin base de datos', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'modules', 'supply', 'avisos.ts'), 'utf8')
  assert.ok(!src.includes("import 'server-only'"), 'avisos.ts no puede ser server-only')
  assert.ok(!src.includes("from '@/lib/tenant'"), 'avisos.ts no toca la base')
  // Los tipos de los módulos con datos entran como `import type`, que se borra
  // al compilar: si entraran como valor, esta prueba no podría ni cargar.
  assert.match(src, /import type \{ Hallazgo \}/)
})

test('el envío NO puede tumbar el cron', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'app', 'api', 'cron', 'supply', 'route.ts'), 'utf8')
  const i = src.indexOf('avisarVencimientos(enUmbral)')
  assert.notEqual(i, -1, 'el cron no envía los avisos')
  // Y va envuelto: soltar holds y cerrar lo vencido mueven el ledger, y no se
  // quedan a medias porque falle la campanita.
  const antes = src.slice(0, i)
  assert.match(antes.slice(-400), /try \{/)
  assert.match(src.slice(i), /catch/)
})

test('cada valor nuevo del enum está también en su migración', () => {
  const raiz = join(__dirname, '..')
  const esquema = readFileSync(join(raiz, 'prisma', 'schema', 'identidad.prisma'), 'utf8')
  const migracion = readFileSync(
    join(raiz, 'prisma', 'migrations', '20261001_supply_avisos', 'migration.sql'),
    'utf8'
  )
  for (const v of ['SUPPLY_POR_VENCER', 'SUPPLY_DESCUADRE']) {
    assert.ok(new RegExp(`^\\s+${v}$`, 'm').test(esquema), `${v} no está en el enum`)
    assert.ok(
      migracion.includes(`ADD VALUE IF NOT EXISTS '${v}'`),
      `${v} no está en la migración: el cron lo escribiría y Postgres lo rechazaría`
    )
  }
})

// ════════════════════════════════════════════════════════════════════════════
// AVISOS DE EVENTO (Fase 40, segunda mitad)
//
// Los de arriba nacen de un barrido diario y su riesgo es duplicarse. Estos
// nacen de un clic, y su riesgo es el contrario: filtrar a un tercero algo que
// no le toca. Un aviso al proveedor viaja a la campanita de otra empresa.
// ════════════════════════════════════════════════════════════════════════════

import {
  cuando,
  dedupeBeneficio,
  dedupeBeneficioPorVencer,
  dedupeCapacidad,
  dedupeEntrega,
  dedupeIncidencia,
  dedupeLiquidacion,
  dedupeReserva,
  dedupeVoucherProveedor,
  soloDia,
  textoBeneficioNuevo,
  textoBeneficioPorVencer,
  textoCapacidad,
  textoEntrega,
  textoIncidenciaMembego,
  textoIncidenciaProveedor,
  textoLiquidacion,
  textoReserva,
  textoVoucherNuevo,
  UMBRAL_CAPACIDAD,
} from '../src/modules/supply/avisos'

test('cada evento tiene su clave, y ninguna se pisa con otra', () => {
  const claves = [
    dedupeBeneficio('d1'),
    dedupeVoucherProveedor('d1'),
    dedupeReserva('r1'),
    dedupeEntrega('x1'),
    dedupeIncidencia('i1', 'membego'),
    dedupeIncidencia('i1', 'proveedor'),
    dedupeLiquidacion('p1'),
    dedupeCapacidad('prov1', '2026-10-12'),
    dedupeBeneficioPorVencer('d1', 3),
  ]
  assert.equal(new Set(claves).size, claves.length)
})

test('el mismo derecho no avisa dos veces al cliente ni dos al proveedor', () => {
  // La idempotencia de `entregar` devuelve el derecho que ya existía; el aviso
  // se salta por `reutilizado`, y si aun así llegara, la clave lo para.
  assert.equal(dedupeBeneficio('d1'), dedupeBeneficio('d1'))
  assert.notEqual(dedupeBeneficio('d1'), dedupeVoucherProveedor('d1'))
})

test('una incidencia manda DOS avisos distintos, no uno compartido', () => {
  // Si compartieran clave, quien fuera superadmin Y admin del proveedor
  // recibiría solo el primero — y el que se perdería es el del proveedor, que
  // es quien tiene que reaccionar en el mostrador.
  assert.notEqual(dedupeIncidencia('i1', 'membego'), dedupeIncidencia('i1', 'proveedor'))
})

test('el aviso de cupo es por DÍA, no por reserva', () => {
  // Por reserva sería un aviso cada dos minutos en la hora punta.
  assert.equal(dedupeCapacidad('p1', '2026-10-12'), dedupeCapacidad('p1', '2026-10-12'))
  assert.notEqual(dedupeCapacidad('p1', '2026-10-12'), dedupeCapacidad('p1', '2026-10-13'))
})

test('al cliente se le recuerda su beneficio una vez por umbral', () => {
  const claves = new Set([1, 3, 7].map((u) => dedupeBeneficioPorVencer('d1', u)))
  assert.equal(claves.size, 3)
})

// ── Lo que NO puede salir ───────────────────────────────────────────────────

test('SEGURIDAD · el aviso al proveedor no lleva el nombre del cliente', () => {
  const t = textoVoucherNuevo({ item: 'Pizza Grande', codigo: 'MBG-7X4K2P' })
  // Lo verá al escanear, en el mostrador, y no antes.
  assert.ok(!/cliente|Carlos|nombre/i.test(t.mensaje), t.mensaje)
  assert.match(t.mensaje, /MBG-7X4K2P/)
})

test('SEGURIDAD · el aviso al proveedor no lleva el detalle que escribió el cliente', () => {
  const t = textoIncidenciaProveedor({ tipo: 'Negaron el beneficio', item: 'Pizza Grande' })
  // El detalle es un campo libre que escribe una persona enfadada: puede llevar
  // nombres, teléfonos o lo que se le ocurra, y esto entra en la campanita de
  // un tercero. Lo ve Membego, que es quien media.
  assert.ok(!t.mensaje.includes('detalle'), t.mensaje)
  assert.match(t.mensaje, /Negaron el beneficio/)
  assert.match(t.mensaje, /Membego lo está revisando/)
})

test('a Membego sí se le dice de qué proveedor es la incidencia', () => {
  const t = textoIncidenciaMembego({
    tipo: 'Negaron el beneficio',
    item: 'Pizza Grande',
    proveedorNombre: 'Litre Pizza',
  })
  assert.match(t.titulo, /Litre Pizza/)
  assert.equal(t.href, '/superadmin/supply/incidencias')
})

// ── Los textos del cliente ──────────────────────────────────────────────────

test('el beneficio nuevo dice hasta cuándo, que es lo que se olvida', () => {
  const t = textoBeneficioNuevo({
    item: 'Pizza Grande',
    proveedorNombre: 'Litre Pizza',
    vencAt: new Date('2026-11-30T16:00:00Z'),
  })
  assert.match(t.titulo, /Pizza Grande/)
  assert.match(t.mensaje, /Litre Pizza/)
  assert.match(t.mensaje, /30 de noviembre/)
  assert.equal(t.href, '/cliente/beneficios')
})

test('la entrega es un RECIBO: dice cómo reclamar si no la recibió', () => {
  const t = textoEntrega({ item: 'Pizza Grande', proveedorNombre: 'Litre Pizza', sucursal: 'Bávaro' })
  assert.match(t.mensaje, /Litre Pizza · Bávaro/)
  assert.match(t.mensaje, /Si no lo recibiste/)
})

test('sin sucursal el mensaje no queda con un hueco', () => {
  const t = textoEntrega({ item: 'Pizza', proveedorNombre: 'Litre Pizza', sucursal: null })
  assert.ok(!t.mensaje.includes('·'), t.mensaje)
  assert.ok(!t.mensaje.includes('null'), t.mensaje)
})

test('la reserva dice dónde y cuándo con la hora del comercio', () => {
  const t = textoReserva({
    item: 'Pizza Grande',
    proveedorNombre: 'Litre Pizza',
    sucursal: 'Bávaro',
    inicioAt: new Date('2026-10-12T22:30:00Z'), // 18:30 en Santo Domingo
  })
  assert.match(t.mensaje, /Bávaro/)
  assert.match(t.mensaje, /6:30/)
  assert.ok(!t.mensaje.includes('22:30'), 'se está usando la hora del servidor')
})

test('el beneficio por vencer dice que no se renueva', () => {
  const t = textoBeneficioPorVencer({ item: 'Pizza Grande', proveedorNombre: 'Litre Pizza' }, 1)
  assert.match(t.titulo, /vence mañana/)
  assert.match(t.mensaje, /No se puede renovar/)
})

test('el cupo avisa con las dos cifras y a partir del 80%', () => {
  assert.equal(UMBRAL_CAPACIDAD, 0.8)
  const t = textoCapacidad({ usadas: 41, cupo: 50, dia: new Date('2026-10-12T12:00:00Z') })
  assert.match(t.mensaje, /41 de 50/)
  assert.match(t.titulo, /12 de octubre/)
})

test('la liquidación dice el monto, y la referencia solo si existe', () => {
  assert.match(textoLiquidacion({ monto: 45_000, referencia: 'TRF-99' }).mensaje, /RD\$45,000.*TRF-99/)
  assert.ok(!textoLiquidacion({ monto: 45_000, referencia: null }).mensaje.includes('Referencia'))
})

test('las fechas se formatean en la zona del comercio, no del servidor', () => {
  // Medianoche UTC del 13 es todavía el 12 en Santo Domingo. Con la zona del
  // servidor, un beneficio válido «hasta el 12» diría 13 y el cliente iría un
  // día tarde.
  assert.equal(soloDia(new Date('2026-10-13T02:00:00Z')), '12 de octubre')
  assert.match(cuando(new Date('2026-10-12T22:30:00Z')), /6:30/)
})

// ── Los ganchos están donde tienen que estar ────────────────────────────────

test('ARQUITECTURA · ningún aviso se manda DENTRO de la transacción', () => {
  const raiz = join(__dirname, '..', 'src', 'modules', 'supply')
  const casos: [string, string][] = [
    ['distribucion.ts', 'avisarBeneficioEntregado'],
    ['reservas.ts', 'avisarReservaConfirmada'],
    ['redencion.ts', 'avisarEntregaCompletada'],
    ['incidencias.ts', 'avisarIncidencia'],
    ['finanzas.ts', 'avisarLiquidacion'],
  ]
  for (const [archivo, fn] of casos) {
    const src = readFileSync(join(raiz, archivo), 'utf8')
    const i = src.indexOf(`${fn}(`)
    assert.notEqual(i, -1, `${archivo} no avisa nada`)
    // El envoltorio de inquilino tiene que haberse CERRADO antes: si la llamada
    // cayera dentro del callback de `sinEmpresa`, el aviso abriría una
    // transacción dentro de otra — el riesgo número uno de este código.
    const dentro = src.slice(0, i).lastIndexOf("sinEmpresa('Membego Supply")
    const cierre = src.slice(0, i).lastIndexOf('  })')
    assert.ok(
      dentro === -1 || cierre > dentro,
      `${archivo}: ${fn} parece llamarse dentro de la transacción`
    )
  }
})

test('los ocho valores de evento están en el enum Y en su migración', () => {
  const raiz = join(__dirname, '..')
  const esquema = readFileSync(join(raiz, 'prisma', 'schema', 'identidad.prisma'), 'utf8')
  const migracion = readFileSync(
    join(raiz, 'prisma', 'migrations', '20261002_supply_avisos_evento', 'migration.sql'),
    'utf8'
  )
  const valores = [
    'SUPPLY_BENEFICIO_NUEVO',
    'SUPPLY_BENEFICIO_POR_VENCER',
    'SUPPLY_RESERVA_CONFIRMADA',
    'SUPPLY_ENTREGA_COMPLETADA',
    'SUPPLY_VOUCHER_NUEVO',
    'SUPPLY_CAPACIDAD_AL_LIMITE',
    'SUPPLY_INCIDENCIA',
    'SUPPLY_LIQUIDACION',
  ]
  for (const v of valores) {
    assert.ok(new RegExp(`^\\s+${v}$`, 'm').test(esquema), `${v} no está en el enum`)
    assert.ok(migracion.includes(`ADD VALUE IF NOT EXISTS '${v}'`), `${v} no está en la migración`)
  }
})

test('la campanita sabe dibujar los diez tipos de supply', () => {
  const src = readFileSync(
    join(__dirname, '..', 'src', 'components', 'layout', 'NotificationBell.tsx'),
    'utf8'
  )
  const esquema = readFileSync(join(__dirname, '..', 'prisma', 'schema', 'identidad.prisma'), 'utf8')
  const abre = esquema.indexOf('enum NotifTipo {')
  const cuerpo = esquema.slice(abre, esquema.indexOf('\n}', abre))
  const tipos = [...cuerpo.matchAll(/^\s{2}(SUPPLY_[A-Z_]+)$/gm)].map((m) => m[1])
  assert.ok(tipos.length >= 10, `se esperaban al menos diez, hay ${tipos.length}`)
  for (const t of tipos) {
    assert.ok(src.includes(`${t}: {`), `${t} saldría con el icono genérico`)
  }
})

// ── «Producto listo» · la última pieza de la Fase 40 ────────────────────────
//
// No se pudo hacer en su día porque el modelo no tenía el concepto de pedido
// preparado: guardaba la hora que el cliente eligió y nada más. Ahora hay un
// estado LISTA, y lo que se prueba aquí es el riesgo que ese estado introduce.

import {
  dedupeProductoListo,
  textoProductoListo,
} from '../src/modules/supply/avisos'
import {
  puedeTransicionar,
  RESERVA_OCUPA_CUPO,
  TRANSICIONES_RESERVA,
} from '../src/modules/supply/estados'

test('EL CUPO · una reserva LISTA sigue ocupando el día', () => {
  // La trampa del estado nuevo: la pizza está hecha, el horno la produjo. Si
  // LISTA saliera del cupo, el comercio aceptaría una reserva de más por cada
  // pedido preparado.
  assert.ok(RESERVA_OCUPA_CUPO.includes('CONFIRMADA'))
  assert.ok(RESERVA_OCUPA_CUPO.includes('LISTA'))
  // Y lo que ya no es trabajo pendiente, no ocupa.
  for (const muerto of ['CUMPLIDA', 'CANCELADA', 'NO_ASISTIO'] as const) {
    assert.ok(!RESERVA_OCUPA_CUPO.includes(muerto), muerto)
  }
})

test('ningún sitio cuenta el cupo mirando solo CONFIRMADA', () => {
  const dir = join(__dirname, '..', 'src', 'modules', 'supply')
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const src = readFileSync(join(dir, f), 'utf8')
    // El `create` sí pone 'CONFIRMADA': ese es el estado inicial, no un filtro.
    const filtros = src.match(/where:[^}]*estado: 'CONFIRMADA'/g) ?? []
    assert.equal(filtros.length, 0, `${f} filtra reservas solo por CONFIRMADA y se saltaría las listas`)
  }
})

test('LISTA está EN MEDIO: se puede saltar y de ahí aún se cancela', () => {
  assert.ok(puedeTransicionar(TRANSICIONES_RESERVA, 'CONFIRMADA', 'LISTA'))
  // Quien hace un café no va a pulsar un botón antes de dárselo.
  assert.ok(puedeTransicionar(TRANSICIONES_RESERVA, 'CONFIRMADA', 'CUMPLIDA'))
  assert.ok(puedeTransicionar(TRANSICIONES_RESERVA, 'LISTA', 'CUMPLIDA'))
  // Que la comida esté hecha no obliga al cliente a aparecer.
  assert.ok(puedeTransicionar(TRANSICIONES_RESERVA, 'LISTA', 'NO_ASISTIO'))
  assert.ok(puedeTransicionar(TRANSICIONES_RESERVA, 'LISTA', 'CANCELADA'))
})

test('lo terminal es terminal: no se marca listo algo ya entregado', () => {
  for (const fin of ['CUMPLIDA', 'CANCELADA', 'NO_ASISTIO'] as const) {
    assert.equal(puedeTransicionar(TRANSICIONES_RESERVA, fin, 'LISTA'), false, fin)
  }
})

test('el aviso al cliente dice dónde, y una vez por reserva', () => {
  const t = textoProductoListo({
    item: 'Pizza Grande',
    proveedorNombre: 'Litre Pizza',
    sucursal: 'Bávaro',
  })
  assert.match(t.titulo, /Pizza Grande ya está listo/)
  assert.match(t.mensaje, /Litre Pizza · Bávaro/)
  assert.equal(t.href, '/cliente/beneficios')
  assert.equal(dedupeProductoListo('r1'), dedupeProductoListo('r1'))
  assert.notEqual(dedupeProductoListo('r1'), dedupeProductoListo('r2'))
})

test('sin sucursal el mensaje no queda con un hueco', () => {
  const t = textoProductoListo({ item: 'Café', proveedorNombre: 'La Braza', sucursal: null })
  assert.ok(!t.mensaje.includes('·'), t.mensaje)
  assert.ok(!t.mensaje.includes('null'), t.mensaje)
})

test('SEGURIDAD · marcar listo acota por empresa en el WHERE, no solo antes', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'modules', 'supply', 'reservas.ts'), 'utf8')
  const i = src.indexOf('export async function marcarLista(')
  const fn = src.slice(i, src.indexOf('\n}', src.indexOf('avisarProductoListo', i)))
  assert.match(fn, /where: \{ id: reservaId, proveedorId \}/,
    'un id de reserva ajeno marcaría listo el pedido de otro comercio')
  assert.match(fn, /puedeTransicionar\(TRANSICIONES_RESERVA/)
  // Y el aviso, fuera de la transacción.
  assert.ok(fn.indexOf('avisarProductoListo') > fn.indexOf('supplyReserva.update'))
})

test('el índice que impide dos recogidas vivas incluye LISTA', () => {
  const mig = readFileSync(
    join(__dirname, '..', 'prisma', 'migrations', '20261004_supply_reserva_lista', 'migration.sql'),
    'utf8'
  )
  // Sin esto, el cliente apartaría una SEGUNDA recogida del mismo beneficio
  // mientras la primera está hecha en el mostrador. Un `if` no vale: dos
  // peticiones a la vez lo pasan las dos.
  assert.match(mig, /WHERE "estado" IN \('CONFIRMADA', 'LISTA'\)/)
  assert.match(mig, /ADD VALUE IF NOT EXISTS 'SUPPLY_PRODUCTO_LISTO'/)
})
