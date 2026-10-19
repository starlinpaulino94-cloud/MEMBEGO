import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { cifrarTokenCardnet } from '@/lib/payments/cardnet-vault'

const CONFIRMACION = 'CIFRAR_TOKENS_CARDNET_HISTORICOS'

if (process.env.CARDNET_BACKFILL_CONFIRM !== CONFIRMACION) {
  throw new Error(`Define CARDNET_BACKFILL_CONFIRM=${CONFIRMACION} para ejecutar este backfill.`)
}

const filas = await sinEmpresa(
  'cardnet vault backfill: leer tokens CardNET históricos que todavía no están cifrados',
  (tx) => tx.tarjetaTokenizada.findMany({
    where: { token: { not: null }, tokenCifrado: null },
    select: { id: true, companyId: true, token: true },
  })
)

let cifradas = 0
let cambiadasEnParalelo = 0
for (const fila of filas) {
  if (!fila.token) continue
  const tokenCifrado = cifrarTokenCardnet(fila.token)
  const result = await conEmpresa(fila.companyId, (tx) =>
    tx.tarjetaTokenizada.updateMany({
      where: { id: fila.id, token: fila.token, tokenCifrado: null },
      data: { tokenCifrado, token: null },
    })
  )
  if (result.count === 1) cifradas++
  else cambiadasEnParalelo++
}

console.info('[cardnet-vault] backfill terminado', {
  encontradas: filas.length,
  cifradas,
  omitidasPorCambioConcurrente: cambiadasEnParalelo,
})
