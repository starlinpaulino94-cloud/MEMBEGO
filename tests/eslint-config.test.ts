import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ESLint } from 'eslint'

test('eslint . admite CommonJS sin perder las reglas de Hooks en React web y Expo', async () => {
  const eslint = new ESLint()
  const [commonjs] = await eslint.lintFiles(['scripts/supply-db/shim-next-stub.cjs'])
  assert.equal(commonjs.errorCount, 0)
  for (const file of ['src/app/page.tsx', 'apps/client/src/components/wallet/WalletCard.tsx']) {
    const config = await eslint.calculateConfigForFile(file)
    assert.equal(config.rules['react-hooks/rules-of-hooks'][0], 2)
    assert.equal(config.rules['react-hooks/immutability'][0], 2)
    assert.equal(config.rules['react-hooks/purity'][0], 2)
    assert.equal(config.rules['react-hooks/exhaustive-deps'][0], 1)
  }
})
