import { test } from 'node:test'
import assert from 'node:assert/strict'
import { POST as iniciar } from '../src/app/api/pagos/cardnet/iniciar/route'
import { POST as completar } from '../src/app/api/pagos/cardnet/completar/route'
import { GET as retornoGet, POST as retornoPost } from '../src/app/api/pagos/cardnet/retorno/route'

for (const [nombre, handler] of Object.entries({ iniciar, completar, retornoGet, retornoPost })) {
  test(`CardNET directo: ${nombre} rechaza sin leer la petición ni contactar servicios`, async (t) => {
    t.mock.method(globalThis, 'fetch', () => { throw new Error('No debe contactar ningún proveedor') })
    const request = new Proxy({}, {
      get() { throw new Error('No debe leer cuerpo, URL, cabeceras ni sesión') },
    })
    const response = await Reflect.apply(handler, undefined, [request])
    assert.equal(response.status, 410)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('location'), null)
    assert.deepEqual(await response.json(), {
      error: 'CARDNET_DIRECTO_RETIRADO',
      mensaje: 'Este flujo de pago ya no está disponible. Actualiza la página para usar el pago tokenizado.',
    })
  })
}
