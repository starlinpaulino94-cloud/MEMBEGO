/**
 * SELLAR LOS SECRETOS DE WEBHOOK EN CLARO (auditoría A-7).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN SCRIPT Y NO UNA MIGRACIÓN SQL
 *
 * El sello se hace con la CLAVE MAESTRA, que vive en el entorno (Vercel) y nunca
 * en la base. Una migración SQL no la tiene, así que no puede sellar nada: el
 * backfill tiene que correr en código de la aplicación, que sí la carga.
 *
 * Es idempotente: una fila ya sellada (`cn1.…`) se deja como está. Se puede
 * volver a correr sin miedo, y una fila creada después del despliegue ya nace
 * sellada, así que este script solo tiene trabajo con lo anterior.
 *
 * Sin clave maestra en el entorno NO hace nada y lo dice: sin ella no hay con
 * qué sellar, y el código de firma sigue leyendo el claro igual que antes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * USO
 *
 *   tsx scripts/sellar-secretos-webhook.ts            (sella de verdad)
 *   tsx scripts/sellar-secretos-webhook.ts --dry-run  (solo cuenta, no escribe)
 */

import { prisma } from '@/lib/prisma'
import { estaSellado, sellarSecretoWebhook } from '@/modules/connect/secreto-webhook'

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const filas = await prisma.suscripcionWebhook.findMany({
    select: { id: true, companyId: true, secreto: true, secretoAnterior: true },
  })

  let sellados = 0
  let yaSellados = 0

  for (const f of filas) {
    const secretoClaro = !estaSellado(f.secreto)
    const anteriorClaro = f.secretoAnterior !== null && !estaSellado(f.secretoAnterior)
    if (!secretoClaro && !anteriorClaro) {
      yaSellados++
      continue
    }

    if (!dryRun) {
      await prisma.suscripcionWebhook.update({
        where: { id: f.id },
        data: {
          ...(secretoClaro ? { secreto: sellarSecretoWebhook(f.companyId, f.secreto) } : {}),
          ...(anteriorClaro
            ? { secretoAnterior: sellarSecretoWebhook(f.companyId, f.secretoAnterior!) }
            : {}),
        },
      })
    }
    sellados++
  }

  // Si de verdad selló y no cambió nada, casi seguro es que no hay clave maestra
  // (el sello devolvió el claro). Se avisa, porque «0 sellados» puede leerse como
  // «ya estaba todo» y no lo estaría.
  const filasReales = await prisma.suscripcionWebhook.count({ where: { secreto: { startsWith: 'cn1.' } } })
  console.log(
    `\n  Suscripciones: ${filas.length} · ya selladas: ${yaSellados} · ${dryRun ? 'sellaría' : 'selladas'}: ${sellados}`
  )
  if (!dryRun && sellados > 0 && filasReales === 0) {
    console.warn(
      '\n  AVISO: ninguna fila quedó con formato `cn1.` — parece que no hay clave\n' +
        '  maestra en el entorno (CONNECT_CLAVES_MAESTRAS). Sin ella no hay con qué\n' +
        '  sellar; el secreto sigue en claro y la firma sigue funcionando igual.\n'
    )
  } else {
    console.log('')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
