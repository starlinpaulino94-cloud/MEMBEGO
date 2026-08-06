#!/usr/bin/env node
/**
 * AUDITORÍA DE PLACAS Y VEHÍCULOS  (Onboarding v2 · Fase 0)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUÉ EXISTE
 *
 * El rediseño del registro quiere darle a la placa una identidad real
 * (`pais + placa normalizada`, con unique) y precios por categoría de
 * vehículo. Pero un `@@unique` sobre datos sucios ROMPE la migración en el
 * deploy, y una regla nueva aplicada a cuentas viejas rompe a clientes que
 * hoy usan su membresía sin problema.
 *
 * Este script NO cambia nada: lee y reporta los números que deciden cómo
 * migrar. Correrlo contra producción ANTES de la fase que agrega el unique.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ RESPONDE
 *
 *   1. ¿Cuántas placas duplicadas hay (mismo valor normalizado)? → decide si
 *      el unique entra directo o necesita saneamiento previo.
 *   2. ¿Cuántos vehículos no tienen placa o tienen una no normalizable?
 *   3. ¿Cuántos vehículos no tienen categoría (tipoVehiculoId)? → esos no
 *      pueden entrar al precio por categoría sin asignación.
 *   4. ¿Cuántos clientes y membresías ACTIVAS existen sin ningún vehículo?
 *      → ese es el universo PROTEGIDO: las reglas nuevas (placa obligatoria,
 *      elegibilidad por categoría) NO deben aplicarles retroactivamente.
 *
 * USO
 *
 *   npm run auditar:placas          # reporta (solo lectura, exit 0 siempre)
 */

const C = { ok: '\x1b[32m', mal: '\x1b[31m', avi: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }

/**
 * La MISMA normalización que usará el backend en la fase de captura:
 * mayúsculas y solo [A-Z0-9] (fuera espacios, guiones y puntos). Se define
 * aquí duplicada a propósito: este script debe poder correr contra una BD
 * vieja sin depender del código nuevo.
 */
function normalizarPlaca(placa) {
  return (placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function linea(titulo, valor, color = '') {
  console.log(`  ${titulo.padEnd(58, '·')} ${color}${valor}${C.off}`)
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('✗ Falta DATABASE_URL. Corre este script donde haya conexión a la base (o con el .env de producción).')
    process.exit(1)
  }
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()

  try {
    console.log('Auditoría de placas y vehículos (Onboarding v2 · Fase 0)')
    console.log('─'.repeat(64))

    // ── 1 · Universo general ────────────────────────────────────────────────
    const [totalClientes, totalVehiculos] = await Promise.all([
      prisma.cliente.count(),
      prisma.vehiculo.count(),
    ])
    console.log('\nUniverso')
    linea('Clientes', totalClientes)
    linea('Vehículos', totalVehiculos)

    // ── 2 · Placas ──────────────────────────────────────────────────────────
    const vehiculos = await prisma.vehiculo.findMany({
      select: { id: true, placa: true, clienteId: true, tipoVehiculoId: true },
    })

    const sinPlaca = vehiculos.filter((v) => !v.placa || !v.placa.trim())
    const conPlaca = vehiculos.filter((v) => v.placa && v.placa.trim())
    const noNormalizables = conPlaca.filter((v) => normalizarPlaca(v.placa) === '')

    // Duplicados por valor normalizado (la identidad futura del vehículo).
    const porNormalizada = new Map()
    for (const v of conPlaca) {
      const n = normalizarPlaca(v.placa)
      if (!n) continue
      if (!porNormalizada.has(n)) porNormalizada.set(n, [])
      porNormalizada.get(n).push(v)
    }
    const duplicadas = [...porNormalizada.entries()].filter(([, vs]) => vs.length > 1)
    // Duplicado "entre cuentas" (el caso grave: dos clientes con la misma placa)
    // vs "misma cuenta" (el cliente registró su carro dos veces: saneable solo).
    const entreCuentas = duplicadas.filter(([, vs]) => new Set(vs.map((v) => v.clienteId)).size > 1)

    console.log('\nPlacas')
    linea('Vehículos sin placa', sinPlaca.length, sinPlaca.length ? C.avi : C.ok)
    linea('Placas no normalizables (solo símbolos)', noNormalizables.length, noNormalizables.length ? C.mal : C.ok)
    linea('Placas normalizadas duplicadas', duplicadas.length, duplicadas.length ? C.mal : C.ok)
    linea('  … de las cuales entre clientes DISTINTOS', entreCuentas.length, entreCuentas.length ? C.mal : C.ok)
    if (duplicadas.length) {
      console.log(`${C.dim}  Detalle (hasta 20):${C.off}`)
      for (const [n, vs] of duplicadas.slice(0, 20)) {
        const cuentas = new Set(vs.map((v) => v.clienteId)).size
        console.log(`${C.dim}    ${n} → ${vs.length} vehículos, ${cuentas} cliente(s)${C.off}`)
      }
    }

    // ── 3 · Categorías ──────────────────────────────────────────────────────
    const sinCategoria = vehiculos.filter((v) => !v.tipoVehiculoId)
    console.log('\nCategorías de vehículo')
    linea('Vehículos sin categoría (tipoVehiculoId null)', sinCategoria.length, sinCategoria.length ? C.avi : C.ok)

    // ── 4 · Universo PROTEGIDO (grandfathering) ─────────────────────────────
    // Clientes con cuenta pero sin vehículo, y membresías activas de esos
    // clientes: las reglas nuevas NO pueden romperles la app ni el QR.
    const clientesConVehiculo = new Set(vehiculos.map((v) => v.clienteId))
    const clientesSinVehiculo = totalClientes - clientesConVehiculo.size

    const activasSinVehiculo = await prisma.membership.count({
      where: {
        estado: 'ACTIVA',
        cliente: { vehiculos: { none: {} } },
      },
    })
    const activasTotal = await prisma.membership.count({ where: { estado: 'ACTIVA' } })

    console.log('\nUniverso protegido (clientes existentes que las reglas nuevas NO deben tocar)')
    linea('Clientes sin ningún vehículo', clientesSinVehiculo, clientesSinVehiculo ? C.avi : C.ok)
    linea('Membresías ACTIVAS de clientes sin vehículo', `${activasSinVehiculo} de ${activasTotal}`, activasSinVehiculo ? C.avi : C.ok)

    // ── Veredicto ───────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(64))
    if (duplicadas.length === 0 && noNormalizables.length === 0) {
      console.log(`${C.ok}✓${C.off} El unique (pais, placaNormalizada) puede entrar directo: no hay duplicados.`)
    } else {
      console.log(`${C.mal}✗${C.off} Hay datos que chocan con el unique: se necesita fase de saneamiento antes de imponerlo.`)
    }
    if (activasSinVehiculo > 0 || clientesSinVehiculo > 0) {
      console.log(`${C.avi}!${C.off} Hay clientes/membresías sin vehículo: el motor de elegibilidad debe tratarlos como VÁLIDOS tal como están (regla de compatibilidad).`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error('✗ La auditoría falló:', e.message ?? e)
  process.exit(1)
})
