import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatMoneyRD, formatRD } from '@/lib/format'

// El signo va DELANTE del símbolo: «RD$-300.00» parece un guion y no es como se escribe un importe.
describe('formatRD', () => {
  it('pone el signo delante de RD$', () => {
    assert.equal(formatRD(-300), `-RD$${(300).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`)
    assert.ok(!formatRD(-300).includes('RD$-'))
    assert.equal(formatMoneyRD(-1600), `-RD$${(1600).toLocaleString('es-DO')}`)
  })

  it('deja igual los positivos y el cero', () => {
    assert.equal(formatRD(1600), `RD$${(1600).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`)
    assert.equal(formatRD(0), `RD$${(0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`)
    assert.ok(!formatRD(-0).includes('-'))
  })

  it('acepta el Decimal en texto que llega de Prisma y no inventa NaN', () => {
    assert.equal(formatRD('-45.5'), `-RD$${(45.5).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`)
    assert.ok(!formatRD('abc').includes('NaN'))
  })
})
