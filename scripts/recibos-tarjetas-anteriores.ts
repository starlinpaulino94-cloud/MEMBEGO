/**
 * Genera los recibos de los pagos con tarjeta (CardNET) anteriores al 16-10-2026.
 *
 *   npx tsx scripts/recibos-tarjetas-anteriores.ts                  # SIMULACIÓN: no escribe nada
 *   npx tsx scripts/recibos-tarjetas-anteriores.ts --aplicar        # crea los recibos
 *
 * Opciones: --empresa=<companyId>  --desde=AAAA-MM-DD  --limite=<n>  (500 por defecto)
 *
 * Necesita DATABASE_URL (y DIRECT_URL) de la base a recuperar. Es idempotente:
 * un pago que ya tiene recibo no se toca, así que se puede correr varias veces.
 * La lógica vive en `src/modules/pagos/recibosAnteriores.ts`.
 */
import { prisma } from '@/lib/prisma'
import { emitirRecibosAnteriores, planificarRecibosAnteriores, type MotivoOmision } from '@/modules/pagos/recibosAnteriores'

const MOTIVOS: Record<MotivoOmision, string> = {
  ENTREGA_FALLIDA: 'cobrado pero la entrega falló (conciliar a mano)',
  ENTREGA_EN_PROCESO: 'cobrado y la entrega sigue en proceso',
  COBRADO_SIN_ENTREGAR: 'cobrado sin entregar',
  SIN_CLIENTE: 'sin cliente asociado',
}

function arg(nombre: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${nombre}=`))?.slice(nombre.length + 3)
}

const rd = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`
const dia = (d: Date) => d.toISOString().slice(0, 10)

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar')
  const desdeTxt = arg('desde')
  const desde = desdeTxt ? new Date(`${desdeTxt}T00:00:00-04:00`) : undefined
  if (desde && Number.isNaN(desde.getTime())) throw new Error(`--desde no es una fecha válida: ${desdeTxt}`)
  const limiteTxt = arg('limite')
  const limite = limiteTxt ? Number(limiteTxt) : undefined
  if (limite !== undefined && !(Number.isInteger(limite) && limite > 0)) throw new Error(`--limite no es un entero positivo: ${limiteTxt}`)

  const plan = await planificarRecibosAnteriores({ companyId: arg('empresa'), desde, limite })

  console.log(aplicar ? 'MODO: APLICAR (crea los recibos)' : 'MODO: SIMULACIÓN (no escribe nada; usa --aplicar para crearlos)')
  console.log(`Pagos con tarjeta aprobados revisados: ${plan.porEmitir.length + plan.yaTenian + plan.omitidos.length}`)
  console.log(`  · ya tenían recibo:          ${plan.yaTenian}`)
  console.log(`  · recibos por crear:         ${plan.porEmitir.length}  (${rd(plan.porEmitir.reduce((s, r) => s + r.monto, 0))})`)
  console.log(`  · omitidos (conciliar):      ${plan.omitidos.length}`)

  const porEmpresa = new Map<string, { n: number; total: number }>()
  for (const r of plan.porEmitir) {
    const e = porEmpresa.get(r.empresa) ?? { n: 0, total: 0 }
    porEmpresa.set(r.empresa, { n: e.n + 1, total: e.total + r.monto })
  }
  if (porEmpresa.size > 0) {
    console.log('\nPor empresa:')
    for (const [empresa, e] of porEmpresa) console.log(`  ${empresa}: ${e.n} recibo(s), ${rd(e.total)}`)
    console.log('\nRecibos por crear (los 25 primeros):')
    for (const r of plan.porEmitir.slice(0, 25)) {
      console.log(`  ${dia(r.cobradoEn)}  ${rd(r.monto).padStart(14)}  ${r.detalle}  [${r.empresa}]${r.autorizacion ? `  Aut. ${r.autorizacion}` : ''}`)
    }
  }
  if (plan.omitidos.length > 0) {
    console.log('\nOmitidos (no se emite recibo; revisar):')
    for (const o of plan.omitidos) console.log(`  ${dia(o.cobradoEn)}  ${rd(o.monto).padStart(14)}  ${MOTIVOS[o.motivo]}  [${o.empresa}]  intento ${o.intentoId}`)
  }

  if (!aplicar) return
  const res = await emitirRecibosAnteriores(plan)
  console.log(`\nCreados: ${res.creados.length}`)
  for (const c of res.creados.slice(0, 25)) console.log(`  ${c.codigo}  ${c.ticketNumero}  (intento ${c.intentoId})`)
  if (res.fallidos.length > 0) {
    console.log(`\nNO se pudieron crear (${res.fallidos.length}); el error quedó en el log del servidor. Se puede volver a correr:`)
    for (const f of res.fallidos) console.log(`  intento ${f.intentoId}`)
    process.exitCode = 1
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
