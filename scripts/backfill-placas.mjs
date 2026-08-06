#!/usr/bin/env node
/**
 * BACKFILL DE PLACAS HISTÓRICAS  (Onboarding v2 · Fase 7)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ HACE
 *
 * Rellena `placaNormalizada` en los vehículos ANTERIORES al rediseño (los que
 * tienen `placa` escrita pero `placaNormalizada` NULL), con la MISMA regla de
 * normalización del dominio: mayúsculas y solo A-Z0-9.
 *
 * NUNCA revienta contra el unique (pais, placaNormalizada):
 *   - si dos vehículos históricos normalizan a la misma placa, o la placa ya
 *     existe normalizada en otra cuenta, ese vehículo se SALTA y se reporta
 *     para resolución humana (¿mismo carro dos veces? ¿dueño anterior?);
 *   - los que quedan NULL siguen funcionando como siempre (regla de
 *     compatibilidad): el backfill mejora datos, jamás rompe cuentas.
 *
 * USO
 *
 *   node scripts/backfill-placas.mjs             # DRY-RUN: reporta, no escribe
 *   node scripts/backfill-placas.mjs --aplicar   # escribe los cambios
 *
 * Antes de --aplicar en producción: revisar `npm run auditar:placas`.
 * Idempotente: correrlo dos veces no cambia nada la segunda.
 */

const C = { ok: '\x1b[32m', mal: '\x1b[31m', avi: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }
const APLICAR = process.argv.includes('--aplicar')

/** La misma normalización del dominio (src/modules/onboarding/vehiculo.ts). */
function normalizarPlaca(placa) {
  return (placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('✗ Falta DATABASE_URL.')
    process.exit(1)
  }
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()

  try {
    console.log(`Backfill de placas históricas ${APLICAR ? '(APLICANDO)' : '(dry-run: nada se escribe)'}`)
    console.log('─'.repeat(64))

    const pendientes = await prisma.vehiculo.findMany({
      where: { placaNormalizada: null, placa: { not: null } },
      select: { id: true, placa: true, pais: true, clienteId: true },
      orderBy: { createdAt: 'asc' },
    })
    console.log(`Vehículos con placa sin normalizar: ${pendientes.length}`)

    // Ocupadas: las normalizadas que ya existen en la base (de flujos nuevos).
    const ocupadasFilas = await prisma.vehiculo.findMany({
      where: { placaNormalizada: { not: null } },
      select: { pais: true, placaNormalizada: true },
    })
    const ocupadas = new Set(ocupadasFilas.map((v) => `${v.pais}|${v.placaNormalizada}`))

    let aplicados = 0
    let vacias = 0
    const saltados = []

    for (const v of pendientes) {
      const normalizada = normalizarPlaca(v.placa)
      if (!normalizada) {
        vacias++
        continue // solo símbolos: se queda NULL, el vehículo sigue válido
      }
      const clave = `${v.pais}|${normalizada}`
      if (ocupadas.has(clave)) {
        saltados.push({ id: v.id, placa: v.placa, normalizada, clienteId: v.clienteId })
        continue
      }
      ocupadas.add(clave) // también deduplica DENTRO de esta corrida
      if (APLICAR) {
        // update individual y tolerante: una colisión inesperada (carrera con
        // un registro nuevo) salta ese vehículo en vez de tumbar el backfill.
        try {
          await prisma.vehiculo.update({
            where: { id: v.id },
            data: { placaNormalizada: normalizada },
          })
          aplicados++
        } catch {
          saltados.push({ id: v.id, placa: v.placa, normalizada, clienteId: v.clienteId })
        }
      } else {
        aplicados++
      }
    }

    console.log(`${C.ok}✓${C.off} ${APLICAR ? 'Normalizados' : 'Normalizables'}: ${aplicados}`)
    if (vacias) console.log(`${C.dim}· Placas de solo símbolos (se quedan NULL): ${vacias}${C.off}`)
    if (saltados.length) {
      console.log(`${C.avi}! Saltados por colisión (${saltados.length}) — requieren revisión humana:${C.off}`)
      for (const s of saltados.slice(0, 30)) {
        console.log(`${C.dim}   vehiculo=${s.id} cliente=${s.clienteId} "${s.placa}" → ${s.normalizada}${C.off}`)
      }
      if (saltados.length > 30) console.log(`${C.dim}   … y ${saltados.length - 30} más${C.off}`)
    }
    if (!APLICAR) {
      console.log(`\n${C.dim}Dry-run. Para escribir: node scripts/backfill-placas.mjs --aplicar${C.off}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error('✗ El backfill falló:', e.message ?? e)
  process.exit(1)
})
