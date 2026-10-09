import { test, expect } from '@playwright/test'

for (const ruta of ['iniciar', 'completar', 'retorno']) {
  test(`CardNET directo retirado: POST ${ruta} rechaza incluso JSON inválido`, async ({ request }) => {
    const response = await request.post(`/api/pagos/cardnet/${ruta}`, {
      data: '{"pan":"4111111111111111","cvv":"123",',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(response.status()).toBe(410)
    expect(response.headers()['cache-control']).toBe('no-store')
    expect((await response.json()).error).toBe('CARDNET_DIRECTO_RETIRADO')
    expect(await response.text()).not.toContain('4111111111111111')
  })
}

test('CardNET directo retirado: retorno GET no genera HTML ni refleja datos', async ({ request }) => {
  const response = await request.get('/api/pagos/cardnet/retorno', {
    params: { rd: '</script><script>alert(1)</script>' },
  })
  expect(response.status()).toBe(410)
  expect(response.headers()['content-type']).toContain('application/json')
  expect(response.headers().location).toBeUndefined()
  expect(await response.text()).not.toContain('<script>')
})
