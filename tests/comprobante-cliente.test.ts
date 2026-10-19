import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * COMPROBANTE DE PAGO: PARA EL NEGOCIO Y PARA EL CLIENTE (16-10-2026).
 *
 * Los pagos con tarjeta activaban la membresía o la compra sin dejar la venta
 * oficial: ni el negocio tenía qué imprimir en Facturas ni el cliente tenía
 * recibo. Y «Mis pagos» del cliente nunca ofreció imprimir nada. Estas pruebas
 * fijan las dos decisiones: (1) todo punto de entrega de un pago por pasarela
 * deja recibo, idempotente por intento; (2) el cliente llega a su comprobante
 * con sesión (web) o con un enlace firmado y caduco (app → navegador).
 */

process.env.SUPABASE_JWT_SECRET ??= 'secreto-de-pruebas-para-firmar-comprobantes-0123456789'

const RAIZ = process.cwd()
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8')

test('el enlace firmado abre su transacción, y solo mientras vive', async () => {
  const { firmarEnlaceComprobante, verificarEnlaceComprobante, VIGENCIA_ENLACE_MIN } = await import(
    '../src/modules/transacciones/enlaceComprobante'
  )
  const ahora = Date.UTC(2026, 9, 16, 12, 0, 0)
  const token = firmarEnlaceComprobante('cmtx1234abcd', ahora)
  assert.equal(verificarEnlaceComprobante(token, ahora), 'cmtx1234abcd')
  assert.equal(verificarEnlaceComprobante(token, ahora + (VIGENCIA_ENLACE_MIN * 60 - 1) * 1000), 'cmtx1234abcd', 'vivo hasta el último segundo')
  assert.equal(verificarEnlaceComprobante(token, ahora + (VIGENCIA_ENLACE_MIN * 60 + 1) * 1000), null, 'caducado')

  // Ni el id ni la caducidad se pueden tocar sin romper la firma.
  const [id, exp, firma] = token.split('.')
  assert.equal(verificarEnlaceComprobante(`otraTx.${exp}.${firma}`, ahora), null, 'otro id con la misma firma')
  assert.equal(verificarEnlaceComprobante(`${id}.${Number(exp) + 3600}.${firma}`, ahora), null, 'caducidad alargada')
  assert.equal(verificarEnlaceComprobante(`${id}.${exp}.${firma.slice(0, -2)}zz`, ahora), null, 'firma alterada')
  assert.equal(verificarEnlaceComprobante(`${id}.${exp}`, ahora), null, 'sin firma')
  assert.equal(verificarEnlaceComprobante('', ahora), null)
  assert.throws(() => firmarEnlaceComprobante('id con espacios.y puntos', ahora), 'solo se firman ids con forma de id')
})

test('todo punto de entrega de un pago por pasarela deja su recibo por UN solo camino (idempotente por intento)', () => {
  // El recibo lo escribe `asegurarVentaDelIntento` (ledger TARJETA, único por `pagoIntentoId`) tras cada entrega: ya no hay un segundo
  // camino (`reciboPasarela`) que escribiera otra venta del mismo cobro.
  assert.equal(existsSync(join('src', 'modules', 'pagos', 'reciboPasarela.ts')), false, 'el recibo paralelo se retiró: dos caminos = dos ventas')
  const intentos = leer('src/modules/pagos/intentos.ts')
  assert.ok((intentos.match(/await asegurarVentaDelIntento\(/g) ?? []).length >= 3, 'tras entregar, al repetir y al reintentar')
  assert.doesNotMatch(intentos, /registrarReciboDePasarela|dejarRecibo/)
  // La renovación automática también.
  const renovacion = leer('src/modules/pagos/cardnetTokenGuardado.ts')
  assert.match(renovacion, /await asegurarVentaDelIntento\(intento\.id\)/)
  assert.doesNotMatch(renovacion, /registrarReciboDePasarela/)

  const venta = leer('src/modules/pagos/venta-tarjeta.ts')
  assert.match(venta, /pagoIntentoId: intento\.id/, 'un intento = una venta, por el índice único del libro')
  assert.match(venta, /snapshot: \{ path: \['intentoId'\], equals: intento\.id \}/, 'y adopta un recibo escrito por el camino anterior en vez de duplicarlo')
})

test('el cliente llega a su comprobante: con sesión en la web, con enlace firmado desde la app', () => {
  const queries = leer('src/modules/cliente/queries.ts')
  assert.match(queries, /comprobantes: ComprobanteCliente\[\]/)
  assert.match(queries, /where: \{ clienteId: \{ in: clienteIds \}, tipo: 'SALE', estado: 'APPLIED' \}/, 'solo ventas aplicadas, de cualquiera de sus fichas')
  assert.match(queries, /transaccionId: l\.accion === 'PAGO_APROBADO' \? \(venta\?\.id \?\? ventaDe\(/, 'cada pago aprobado del historial enlaza con su venta (exacta si fue con tarjeta)')

  const propiedad = leer('src/modules/transacciones/comprobanteCliente.ts')
  assert.match(propiedad, /if \(!mios\.includes\(t\.clienteId\)\) return null/, 'la propiedad decide: una transacción ajena no existe')
  assert.match(propiedad, /t\.tipo !== 'SALE' \|\| t\.estado !== 'APPLIED'/)

  const enlace = leer('src/app/api/v1/cliente/comprobantes/[id]/enlace/route.ts')
  assert.match(enlace, /getApiClientUser\(request\)/, 'la app pide el enlace con su sesión Bearer')
  assert.match(enlace, /ticketParaCliente\(id, user\.supabaseId\)/, 'y solo para una venta suya')

  const publica = leer('src/app/comprobante/[token]/page.tsx')
  assert.match(publica, /verificarEnlaceComprobante\(token\)/)
  assert.match(publica, /robots: \{ index: false, follow: false \}/)

  // Las dos pantallas imprimen por el mismo canal que el mostrador.
  const vista = leer('src/components/cliente/pagos/ComprobanteImprimible.tsx')
  assert.match(vista, /<AreaDeImpresion papel="carta" solicitud=\{solicitud\}/)
  assert.doesNotMatch(vista, /window\.print|@media print/)

  // La API de pagos de la app lleva los comprobantes y la app los enseña.
  assert.match(leer('src/app/api/v1/cliente/pagos/route.ts'), /comprobantes: data\.comprobantes/)
  assert.match(leer('apps/client/src/lib/api.ts'), /getComprobanteEnlace: \(transactionId: string\)/)
  assert.match(leer('apps/client/src/lib/comprobantes.ts'), /WebBrowser\.openBrowserAsync\(url\)/, 'imprime el navegador del teléfono, no una WebView')
  assert.match(leer('apps/client/app/pagos.tsx'), /<ComprobantesDePago items=\{comprobantes\} \/>/)
})
