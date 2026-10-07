import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isValidElement } from 'react'

type CompraState = {
  readonly error?: string
  readonly success?: boolean
  readonly compraId?: string
  readonly activada?: boolean
}

const navigationStub = pathToFileURL(path.resolve('tests/support/next-navigation-stub.mjs')).href
const actionStub = pathToFileURL(path.resolve('tests/support/promotion-action-stub.mjs')).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/navigation') {
      return { url: navigationStub, shortCircuit: true }
    }
    if (specifier === '@/modules/promociones/compraActions') {
      return { url: actionStub, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

test('duplicate purchase error routes the existing CTA to its purchase detail', async () => {
  const pushedRoutes: string[] = []
  Reflect.set(globalThis, '__comprarPromoPushes', pushedRoutes)
  const { ComprarPromoButton } = await import('../src/components/cliente/ComprarPromoButton')

  const button = ComprarPromoButton({
    promocionId: 'promotion-1',
    precio: 1250,
    agotada: false,
    retorno: '/cliente/explorar?categoria=salud',
  })
  assert.equal(isValidElement<{ readonly alFallar?: (state: CompraState) => void }>(button), true)
  if (!isValidElement<{ readonly alFallar?: (state: CompraState) => void }>(button)) {
    assert.fail('ComprarPromoButton must return the confirmation CTA')
  }

  button.props.alFallar?.({
    error: 'Ya tienes una compra de esta promoción en proceso.',
    compraId: 'existing-purchase',
  })

  assert.deepEqual(pushedRoutes, [
    '/cliente/mis-promociones/existing-purchase?retorno=%2Fcliente%2Fexplorar%3Fcategoria%3Dsalud',
  ])
})
