import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * RECIBOS DE LOS PAGOS CON TARJETA ANTERIORES (17-10-2026).
 *
 * Es una operación sobre datos de producción: por defecto NO escribe, no toca
 * nada que ya tenga recibo, no emite recibo de un cobro que no se entregó y
 * los recibos llevan la fecha del cobro. Estas guardas fijan esas decisiones;
 * el comportamiento real contra PostgreSQL lo prueba
 * `tests/postgres/recibo-pasarela.db.test.ts` (prueba 4).
 */

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), 'utf8')

test('el script es una simulación salvo que se pida --aplicar, y solo entonces emite', () => {
  const script = leer('scripts/recibos-tarjetas-anteriores.ts')
  assert.match(script, /const aplicar = process\.argv\.includes\('--aplicar'\)/)
  const iEmitir = script.indexOf('await emitirRecibosAnteriores(plan)')
  const iGuarda = script.indexOf('if (!aplicar) return')
  assert.ok(iGuarda > 0 && iEmitir > iGuarda, 'nada se emite antes de la guarda de simulación')
  assert.equal((script.match(/emitirRecibosAnteriores\(/g) ?? []).length, 1, 'un solo punto de escritura')
})

test('el flujo de GitHub nace en simulación, se lanza a mano y no pierde el código de salida', () => {
  const wf = leer('.github/workflows/recibos-tarjetas-anteriores.yml')
  assert.match(wf, /^on:\s*\n\s*workflow_dispatch:/m, 'solo a mano: nunca por push ni cron')
  assert.doesNotMatch(wf, /^\s*(push|pull_request|schedule):/m)
  assert.match(wf, /aplicar:[\s\S]*?default: false/, 'crear recibos es opt-in')
  assert.match(wf, /environment: production/)
  assert.match(wf, /exit \$CODIGO/, 'un fallo del script pone el job en rojo')
  assert.doesNotMatch(wf, /\|\s*tee/, 'un | tee perdería el código de salida')
  // Las entradas del usuario van por variables de entorno, nunca interpoladas en el script del paso.
  const script = wf.slice(wf.indexOf('        run: |'))
  assert.ok(script.length > 20, 'se encontró el script del paso')
  assert.doesNotMatch(script, /\$\{\{/, 'ninguna expresión ${{ }} dentro del script: inyección de comandos')
})

test('solo se emite recibo de lo cobrado Y entregado, con la fecha del cobro y sin duplicar', () => {
  const mod = leer('src/modules/pagos/recibosAnteriores.ts')
  assert.match(mod, /await reciboDeIntentoExiste\(i\.companyId, i\.id\)/, 'un intento con recibo no se toca')
  assert.match(mod, /i\.fulfillmentEstado === 'COMPLETADA' \|\|/, 'entregado de verdad')
  assert.match(mod, /i\.fulfillmentEstado === 'PENDIENTE' && cobradoEn < INICIO_DEL_CUMPLIMIENTO && productoPagado/, 'antes de P1B el estado de entrega no significa nada: se mira el producto')
  assert.match(mod, /'ENTREGA_FALLIDA'/, 'cobrado sin entregar se lista aparte (conciliación), no se emite')
  assert.match(mod, /ocurridoEn: r\.cobradoEn/, 'el recibo lleva la fecha del cobro')
  assert.match(leer('src/lib/transactions/application/transaction-service.ts'), /createdAt: input\.ocurridoEn,/)
})
