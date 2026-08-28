import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ESTADO_LABEL,
  FILTROS_ESTADO,
  fichasDeFiltro,
  hayFiltro,
  hrefFiltro,
  leerFiltroMembresias,
} from '../src/modules/membresias/filtros'
import { membresiasToCsv } from '../src/modules/membresias/csv'
import type { MembresiaFila } from '../src/modules/membresias/lista'

/**
 * EL PUESTO DE MANDO DE MEMBRESÍAS.
 *
 * Cinco de las seis acciones de esta pantalla mueven dinero o acceso. Las
 * guardias van en ese orden: primero lo que decide una cifra o un permiso,
 * después lo que ordena la pantalla.
 */

const PAGE = readFileSync(
  join('src', 'app', '(superadmin)', 'superadmin', 'membresias', 'page.tsx'),
  'utf8'
)
const LISTA = readFileSync(join('src', 'modules', 'membresias', 'lista.ts'), 'utf8')
const ACCIONES = readFileSync(join('src', 'modules', 'admin', 'actions.ts'), 'utf8')
const CLIENTE_DETALLE = readFileSync(
  join('src', 'app', '(admin)', 'admin', 'clientes', '[id]', 'page.tsx'),
  'utf8'
)
const CARDNET_RENOVACION = readFileSync(
  join('src', 'modules', 'pagos', 'cardnetTokenGuardado.ts'),
  'utf8'
)
const PLAN_ACCIONES = readFileSync(join('src', 'modules', 'admin', 'planActions.ts'), 'utf8')
const SUPER_MEMBRESIA_ACCIONES = readFileSync(
  join('src', 'modules', 'superadmin', 'membresiaActions.ts'),
  'utf8'
)
const BOTONES = readFileSync(
  join('src', 'components', 'admin', 'MembershipAdminActions.tsx'),
  'utf8'
)
const AJUSTAR_VENCIMIENTO = readFileSync(
  join('src', 'components', 'superadmin', 'AjustarVencimiento.tsx'),
  'utf8'
)

/** El código sin comentarios: estos archivos EXPLICAN lo que ya no hacen. */
const sinComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '')

// ───────────────────── M58 · el monto no lo dice el navegador ─────────────────────

/**
 * LA CIFRA QUE ENTRA EN LOS INGRESOS NO PUEDE VENIR DEL FORMULARIO.
 *
 * `renovarMembresia` leía `monto` de un campo oculto pintado con el precio del
 * plan AL RENDERIZAR, y lo escribía en `montoPagado` junto a
 * `pagoConfirmado: true`. No hace falta mala fe: basta dejar la pestaña
 * abierta, que cambie el precio y renovar — se registra el viejo, como
 * cobrado, y nada avisa.
 */
test('el monto de una renovación se calcula en el servidor', () => {
  const bloque = ACCIONES.slice(
    ACCIONES.indexOf('export async function renovarMembresia'),
    ACCIONES.indexOf('export async function crearEmpleado')
  )
  assert.ok(bloque.length > 0, 'no se encontró renovarMembresia')
  assert.ok(
    !/formData\.get\('monto'\)/.test(bloque),
    'el monto NO puede leerse del formulario: acaba en montoPagado con el pago confirmado'
  )
  assert.match(bloque, /const monto = Number\(membership\.plan\.precio\)/)
})

/**
 * RENOVAR TIENE QUE DEVOLVERLE EL CÓDIGO AL CLIENTE.
 *
 * El canje deja de emitir QR cuando se agotan los lavados —lo dice su propio
 * comentario: «la membresía queda 'Sin usos disponibles' hasta la renovación»—
 * así que delega en la renovación la emisión del siguiente. Y la renovación no
 * emitía ninguno.
 *
 * El resultado era una membresía renovada, pagada y con sus lavados repuestos
 * que el cliente NO PODÍA USAR: el panel decía «4 usos» y su app, nada.
 */
test('renovar emite el QR cuando el cliente se quedó sin ninguno', () => {
  const bloque = ACCIONES.slice(
    ACCIONES.indexOf('export async function renovarMembresia'),
    ACCIONES.indexOf('export async function crearEmpleado')
  )
  assert.ok(bloque.length > 0, 'no se encontró renovarMembresia')
  // Se mira si hay uno vivo…
  assert.match(bloque, /qrToken\.findFirst/)
  // …y si no lo hay, se emite.
  assert.match(bloque, /qrToken\.create/)
})

test('y si el cliente SÍ tenía QR, se le estira la vigencia', () => {
  // Renovar antes de gastar los lavados no debe dejar un código que caduque a
  // mitad de un período ya pagado: el fallo aparecería días después sin que
  // nadie lo relacione con la renovación.
  const bloque = ACCIONES.slice(
    ACCIONES.indexOf('export async function renovarMembresia'),
    ACCIONES.indexOf('export async function crearEmpleado')
  )
  assert.match(bloque, /qrToken\.update/)
  assert.match(bloque, /expiraAt: vencimientoQr\(\)/)
})

test('y queda en el registro qué pasó con el código', () => {
  // Sin esto, «renové y el cliente dice que no puede usarlo» no se puede
  // investigar: no habría forma de saber si se emitió, se renovó o no se tocó.
  const bloque = ACCIONES.slice(
    ACCIONES.indexOf('export async function renovarMembresia'),
    ACCIONES.indexOf('export async function crearEmpleado')
  )
  assert.match(bloque, /qrEmitido/)
  assert.match(bloque, /qrRenovado/)
})

test('la renovación automática por tarjeta también devuelve QR escaneable', () => {
  const bloque = CARDNET_RENOVACION.slice(
    CARDNET_RENOVACION.indexOf('export async function renovarMembresiaPorTarjeta'),
    CARDNET_RENOVACION.indexOf('/** Membresías que toca renovar ahora')
  )
  assert.ok(bloque.length > 0, 'no se encontró renovarMembresiaPorTarjeta')
  assert.match(bloque, /qrToken\.findFirst/)
  assert.match(bloque, /qrToken\.create/)
  assert.match(bloque, /qrToken\.update/)
  assert.match(bloque, /accion:\s*'QR_GENERADO'/)
  assert.match(bloque, /qrEmitido/)
  assert.match(bloque, /qrRenovado/)
})

test('la ficha admin muestra el QR de la membresía renovada, no uno cualquiera del cliente', () => {
  assert.match(
    CLIENTE_DETALLE,
    /memberships:\s*\{[\s\S]*?qrTokens:\s*\{\s*where:\s*\{\s*activo:\s*true\s*\},\s*orderBy:\s*\{\s*createdAt:\s*'desc'\s*\},\s*take:\s*1\s*\}/
  )
  assert.match(
    CLIENTE_DETALLE,
    /const token = membership\?\.qrTokens\[0\]\?\.token \?\? cliente\.qrTokens\[0\]\?\.token/
  )
})

test('si una membresía activa quedó sin código, la ficha permite generar QR', () => {
  assert.match(CLIENTE_DETALLE, /import \{ emitirQrMembresia \} from '@\/modules\/admin\/actions'/)
  assert.match(CLIENTE_DETALLE, /const puedeEmitirQr =/)
  assert.match(CLIENTE_DETALLE, /accion=\{emitirQrMembresia\}/)
  assert.match(CLIENTE_DETALLE, /Generar QR/)
})

test('generar QR manual valida la membresía y deja auditoría', () => {
  const bloque = ACCIONES.slice(
    ACCIONES.indexOf('export async function emitirQrMembresia'),
    ACCIONES.indexOf('/** Create a team member')
  )
  assert.ok(bloque.length > 0, 'no se encontró emitirQrMembresia')
  assert.match(bloque, /requireSection\('membresias', 'renovar'\)/)
  assert.match(bloque, /membership\.estado !== 'ACTIVA'/)
  assert.match(bloque, /!membership\.pagoConfirmado/)
  assert.match(bloque, /lavadosRestantes \+ membership\.lavadosBonoRestantes/)
  assert.match(bloque, /qrToken\.findFirst/)
  assert.match(bloque, /qrToken\.create/)
  assert.match(bloque, /accion:\s*'QR_GENERADO'/)
  assert.match(bloque, /reparacion_manual_membresia_sin_qr/)
})

test('y la pantalla ya no manda ese campo oculto', () => {
  assert.ok(
    !/name="monto"/.test(sinComentarios(BOTONES)),
    'un campo que el servidor ignora es una invitación a volver a confiarse de él'
  )
})

// ───────────────────── M60 · renovar no roba días ─────────────────────

/**
 * A quien renovaba con 20 días por delante se le daban 30 y se le quitaban 20.
 * El único que iba a notarlo era el cliente, semanas después.
 */
test('renovar encadena el período cuando aún está vigente', () => {
  assert.match(
    ACCIONES,
    /const sigueVigente = membership\.fechaVencimiento != null && membership\.fechaVencimiento > now/
  )
  assert.match(ACCIONES, /const arranque = sigueVigente \? membership\.fechaVencimiento! : now/)
  assert.match(ACCIONES, /fechaVencimiento: periodEnd\(arranque, vigenciaDias\)/)
})

test('pero el cobro se fecha HOY, no en el futuro', () => {
  // `fechaPago` es cuándo entró el dinero, y de ahí salen los ingresos del mes.
  // Encadenarla al período rompería los informes de caja.
  assert.match(ACCIONES, /fechaPago: now/)
})

// ───────────── M59 · desactivar no es cancelar ─────────────

test('desactivar tiene su propia acción en la bitácora', () => {
  const bloque = PLAN_ACCIONES.slice(PLAN_ACCIONES.indexOf('export async function desactivarMembresia'))
  assert.match(
    bloque,
    /accion: 'MEMBRESIA_DESACTIVADA'/,
    'poner VENCIDA y registrar «cancelada» hace que la bitácora llame igual a dos operaciones distintas'
  )
})

test('desactivar deja la fecha coherente con el estado', () => {
  const bloque = PLAN_ACCIONES.slice(PLAN_ACCIONES.indexOf('export async function desactivarMembresia'))
  assert.match(
    bloque,
    /data: \{ estado: 'VENCIDA', fechaVencimiento: cortada \}/,
    'VENCIDA con fecha futura es un estado que no puede darse solo'
  )
  // Y no se reescribe hacia atrás un vencimiento que ya ocurrió.
  assert.match(bloque, /m\.fechaVencimiento < ahora \? m\.fechaVencimiento : ahora/)
})

// ───────────── M57 · «activa» no es «vigente» ─────────────

test('cada fila dice si vale HOY, no solo qué guarda la base', () => {
  assert.match(LISTA, /vigente:\s*\n?\s*m\.estado === 'ACTIVA' &&/)
  assert.match(LISTA, /m\.fechaVencimiento == null \|\| m\.fechaVencimiento >= ahora/)
})

test('la pantalla avisa cuando la base y la fecha no coinciden', () => {
  assert.match(PAGE, /const desfasada = fila\.estado === 'ACTIVA' && !fila\.vigente/)
  assert.match(PAGE, /ya venció/)
})

test('un solo «ahora» para el filtro, las cifras y cada fila', () => {
  // Leerlo por separado daría instantes distintos dentro de la misma pantalla,
  // y con ello una fila «vigente» que no cuadra con el total de arriba.
  const veces = [...LISTA.matchAll(/new Date\(\)/g)].length
  assert.equal(veces, 1, `el módulo lee el reloj ${veces} veces; tiene que ser una sola`)
})

// ───────────── M66 · lo que llega por la URL se valida ─────────────

test('un estado inventado en la URL no llega a la base', () => {
  // Iba con un `as MembershipEstado` directo al `where`: reventaba en Prisma,
  // se lo tragaba el `catch` y la pantalla salía vacía sin decir por qué.
  assert.equal(leerFiltroMembresias({ estado: 'FOO' }).estado, 'todos')
  assert.equal(leerFiltroMembresias({ estado: 'ACTIVA' }).estado, 'ACTIVA')
  assert.equal(leerFiltroMembresias({ ambito: 'inventado' }).ambito, 'reales')
})

test('sin parámetros, se ven las reales y todos los estados', () => {
  assert.deepEqual(leerFiltroMembresias({}), {
    q: '',
    estado: 'todos',
    empresa: null,
    ambito: 'reales',
  })
  assert.equal(hayFiltro(leerFiltroMembresias({})), false)
})

test('todo filtro de estado tiene etiqueta', () => {
  for (const e of FILTROS_ESTADO) {
    assert.ok(ESTADO_LABEL[e], `${e} saldría en crudo en el desplegable`)
  }
})

test('«vigentes» y «vencidas sin marcar» no son estados de la base', () => {
  // Son preguntas: activa Y sin vencer, y su complemento. Se resuelven con la
  // misma regla que aplica el escáner, no con un `estado = ...`.
  assert.match(LISTA, /if \(f\.estado === 'vigentes'\) and\.push\(membresiaVigente\(ahora\)\)/)
  assert.match(LISTA, /membresiaCaducada\(ahora\)/)
})

test('quitar un filtro conserva los demás', () => {
  const f = leerFiltroMembresias({ q: 'ana', estado: 'ACTIVA', empresa: 'cmp_1', ambito: 'todas' })
  const fichas = fichasDeFiltro(f, '/superadmin/membresias', [{ id: 'cmp_1', name: 'CARTOWN' }])
  assert.deepEqual(fichas.map((x) => x.clave), ['q', 'estado', 'empresa', 'ambito'])

  const quitarEstado = fichas.find((x) => x.clave === 'estado')!.quitarHref
  assert.ok(quitarEstado.includes('q=ana'))
  assert.ok(quitarEstado.includes('empresa=cmp_1'))
  assert.ok(quitarEstado.includes('ambito=todas'))
  assert.ok(!quitarEstado.includes('estado='))
})

test('la ficha de empresa dice el nombre, no el id', () => {
  const f = leerFiltroMembresias({ empresa: 'cmp_1' })
  const [ficha] = fichasDeFiltro(f, '/x', [{ id: 'cmp_1', name: 'CARTOWN' }])
  assert.equal(ficha.texto, 'CARTOWN')
})

test('el superadmin puede alargar el vencimiento desde la tabla', () => {
  assert.match(PAGE, /import \{ AjustarVencimiento \} from '@\/components\/superadmin\/AjustarVencimiento'/)
  assert.match(PAGE, /fechaInputLocal\(m\.fechaVencimiento\)/)
  assert.match(PAGE, /<AjustarVencimiento/)
  assert.match(AJUSTAR_VENCIMIENTO, /ajustarVencimientoMembresia/)
  assert.match(AJUSTAR_VENCIMIENTO, /type="date"/)
  assert.match(AJUSTAR_VENCIMIENTO, /Motivo/)
  assert.match(AJUSTAR_VENCIMIENTO, /router\.refresh\(\)/)
})

test('el superadmin puede alargar el vencimiento desde la ficha del cliente', () => {
  assert.match(
    CLIENTE_DETALLE,
    /import \{ AjustarVencimiento \} from '@\/components\/superadmin\/AjustarVencimiento'/
  )
  assert.match(CLIENTE_DETALLE, /import \{ fechaInputLocal \} from '@\/lib\/periodos'/)
  assert.match(
    CLIENTE_DETALLE,
    /user\.metadata\.role === 'SUPERADMIN' \? \(\s*<AjustarVencimiento/
  )
  assert.match(
    CLIENTE_DETALLE,
    /fechaInputLocal\(\s*membership\.fechaVencimiento,\s*cliente\.company\.zonaHoraria/
  )
})

test('alargar vencimiento exige superadmin, motivo y una fecha posterior', () => {
  const bloque = SUPER_MEMBRESIA_ACCIONES.slice(
    SUPER_MEMBRESIA_ACCIONES.indexOf('export async function ajustarVencimientoMembresia'),
    SUPER_MEMBRESIA_ACCIONES.length
  )
  assert.ok(bloque.length > 0, 'no se encontró ajustarVencimientoMembresia')
  assert.match(bloque, /metadata\.role !== 'SUPERADMIN'/)
  assert.match(bloque, /Escribe el motivo/)
  assert.match(bloque, /finDelDiaLocal/)
  assert.match(bloque, /nuevaFecha <= membership\.fechaVencimiento/)
  assert.match(bloque, /estado: 'ACTIVA'/)
  assert.match(bloque, /tipo: 'AJUSTE_VENCIMIENTO'/)
  assert.match(bloque, /revalidatePath\(`\/admin\/clientes\/\$\{membership\.clienteId\}`\)/)
})

test('el desplegable de empresa ya no se limita a las activas', () => {
  // La tabla SÍ enseñaba membresías de empresas suspendidas; el filtro no
  // dejaba acotarlas. Había filas imposibles de aislar por su empresa.
  const bloque = LISTA.slice(LISTA.indexOf('tx.company.findMany'))
  assert.ok(
    !/isActive/.test(bloque.slice(0, 300)),
    'el desplegable tiene que listar todas las empresas que pueden aparecer en la tabla'
  )
})

// ───────────── M61 · las cifras accionables ─────────────

test('las cifras son del ámbito, no del filtro', () => {
  // Son el trabajo pendiente: si menguaran al filtrar dejarían de servir para
  // decidir qué mirar, que es justo para lo que están.
  assert.match(LISTA, /const ambito: Prisma\.MembershipWhereInput =/)
  assert.match(LISTA, /where: \{ AND: \[ambito, \{ estado: 'PENDIENTE_PAGO' \} \] \}|where: \{ AND: \[ambito, \{ estado: 'PENDIENTE_PAGO' \}\] \}/)
})

/**
 * «VENCIDAS SIN MARCAR» ES UNA ALARMA, NO UNA ESTADÍSTICA.
 *
 * Debería ser 0 siempre: `vencerMembresias()` corre a diario. Si no lo es, el
 * job no está corriendo — y ésta es la única pantalla donde eso se nota antes
 * de que un cliente se plante en el mostrador con un QR que el escáner rechaza.
 */
test('la cifra de vencidas sin marcar se pinta como alarma cuando no es cero', () => {
  assert.match(PAGE, /d\.resumen\.vencidasSinMarcar > 0 \? 'danger' : 'success'/)
  assert.match(PAGE, /El proceso diario no corrió/)
})

// ───────────── M62, M63, M64, M65 · la pantalla ─────────────

test('las membresías de práctica se distinguen de las reales', () => {
  assert.match(PAGE, /m\.empresaEsDemo &&/)
  assert.match(LISTA, /esDemo: true/)
  assert.match(LISTA, /company: \{ esDemo: f\.ambito === 'practica' \}/)
})

test('el título ya no promete solo solicitudes', () => {
  assert.ok(
    !/Solicitudes de membresía/.test(sinComentarios(PAGE)),
    'el título decía «Solicitudes» y la tabla enseñaba activas, vencidas y canceladas'
  )
})

test('se puede abrir la ficha del cliente desde la fila', () => {
  assert.match(PAGE, /href=\{`\/admin\/clientes\/\$\{m\.clienteId\}`\}/)
})

test('el componente de acciones no recibe props que no usa', () => {
  const codigo = sinComentarios(BOTONES)
  // `clienteId` volvió a la lista de props USADAS: la pantalla de renovación
  // lo necesita para enlazar el comprobante del cobro
  // (/admin/clientes/[id]/renovacion/[registroId]). No es una prop muerta —
  // se lee y viaja a `RenovarMembresiaDialog`.
  for (const muerta of ['planLavados', 'planEsIlimitado', 'planPrecio']) {
    assert.ok(
      !codigo.includes(muerta),
      `${muerta} ya no se usa: una prop muerta hace pensar que el dato importa`
    )
  }
})

test('renovar desde el panel exige declarar el cobro', () => {
  // El botón directo se cambió por el diálogo: renovar escribe un ingreso, y
  // un clic suelto no puede afirmar que el dinero se recibió. Si alguien
  // vuelve a poner `renovarMembresia` aquí, esta prueba lo caza.
  const codigo = sinComentarios(BOTONES)
  assert.ok(
    codigo.includes('RenovarMembresiaDialog'),
    'la renovación debe pasar por el diálogo que pide método y referencia'
  )
  assert.ok(
    !codigo.includes('renovarMembresia'),
    'no se debe llamar a la acción directamente desde un botón sin declaración de cobro'
  )
})

test('la columna se llama «Usos», no «Lavados»', () => {
  // Esta pantalla cruza empresas que no lavan carros, y el plan ya dice
  // «usos incluidos».
  assert.ok(!/>Lavados</.test(PAGE))
  assert.match(PAGE, />Usos</)
})

test('nada de «resultado(s)»', () => {
  assert.ok(!sinComentarios(PAGE).includes('resultado(s)'))
  assert.match(PAGE, /plural\(d\.total, 'resultado', 'resultados'\)/)
})

test('el error de una acción se anuncia', () => {
  // Aparece DESPUÉS de pulsar y dentro de una celda: sin `role`, quien no ve la
  // tabla se queda esperando sin saber que falló.
  assert.match(BOTONES, /role="alert"/)
})

// ───────────── M67 · el CSV ─────────────

const FILA: MembresiaFila = {
  id: 'm1',
  estado: 'ACTIVA',
  vigente: false,
  fechaInicio: new Date('2026-01-15T10:00:00Z'),
  fechaVencimiento: new Date('2026-02-14T10:00:00Z'),
  usosRestantes: 2,
  clienteId: 'c1',
  clienteNombre: 'Ana; Pérez',
  clienteEmail: 'ana@ejemplo.do',
  empresaNombre: 'CARTOWN',
  empresaEsDemo: false,
  planNombre: 'Silver',
  planPrecio: 1200,
  planEsIlimitado: false,
  planLavadosIncluidos: 4,
  planVigenciaDias: 30,
  usosRegaloRestantes: 0,
  // Historial: decide si la membresía se puede borrar. Esta de ejemplo SÍ se
  // usó —tiene una visita— así que no sería borrable, que es el caso normal.
  visitas: 1,
  comprobantes: 0,
  pagosConfirmados: 1,
}

test('el CSV separa el estado guardado de si vale hoy', () => {
  // Con una sola columna, quien abra el archivo daría por hecho que «ACTIVA»
  // significa vigente. Son cosas distintas y por eso van aparte.
  const csv = membresiasToCsv([FILA])
  const [cabecera, fila] = csv.split('\n')
  assert.ok(cabecera.includes('Estado;Vigente hoy'))
  assert.ok(fila.includes(';No;'), 'esta fila está ACTIVA pero ya venció')
})

test('el dinero va sin símbolo ni separador de miles', () => {
  // «RD$1,200.00» entra en Excel como texto y deja de sumarse, y la coma se
  // come el separador del propio CSV.
  assert.ok(membresiasToCsv([FILA]).includes(';1200;'))
})

test('un punto y coma en el nombre no parte la fila', () => {
  const csv = membresiasToCsv([FILA])
  assert.ok(csv.includes('"Ana; Pérez"'))
  assert.equal(csv.split('\n').length, 2, 'cabecera y una fila')
})

test('las fechas van en ISO, que es lo único que Excel ordena bien', () => {
  const csv = membresiasToCsv([FILA])
  assert.ok(csv.includes(';2026-01-15;2026-02-14'))
})

test('la exportación se lleva el filtro de la pantalla', () => {
  // Un archivo que ignora los filtros no dice de qué es, y quien lo abre da por
  // hecho que es lo que estaba viendo.
  assert.match(PAGE, /hrefFiltro\(f, `\$\{BASE\}\/exportar`\)/)
  const f = leerFiltroMembresias({ estado: 'vigentes', ambito: 'todas' })
  const url = hrefFiltro(f, '/superadmin/membresias/exportar')
  assert.ok(url.includes('estado=vigentes') && url.includes('ambito=todas'))
})
