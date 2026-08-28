#!/usr/bin/env node
/**
 * REPARACIÓN DE QRS FALTANTES EN MEMBRESÍAS ACTIVAS
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUÉ EXISTE
 *
 * Si una renovación dejó la membresía ACTIVA pero no creó el QrToken, la ficha
 * del cliente muestra "Sin código" y el mostrador no tiene qué escanear. Este
 * script encuentra membresías vigentes, con saldo o ilimitadas, que no tienen
 * ningún QR activo y les emite uno nuevo.
 *
 * USO
 *
 *   npm run reparar:qrs-membresias
 *   npm run reparar:qrs-membresias -- --cliente <clienteId>
 *   npm run reparar:qrs-membresias -- --aplicar
 *   npm run reparar:qrs-membresias -- --aplicar --cliente <clienteId>
 *
 * Por defecto es DRY-RUN: reporta, no escribe. Con --aplicar crea los QRs.
 * Idempotente: una segunda corrida no toca membresías que ya tienen QR activo.
 */

import { randomBytes } from 'node:crypto'

const C = { ok: '\x1b[32m', mal: '\x1b[31m', avi: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }
const args = process.argv.slice(2)
const APLICAR = args.includes('--aplicar')

function valorDespuesDe(flag) {
  const i = args.indexOf(flag)
  if (i === -1) return null
  const valor = args[i + 1]
  return valor && !valor.startsWith('--') ? valor : null
}

function ayuda() {
  console.log(`Repara QRs faltantes en membresías activas.

Uso:
  npm run reparar:qrs-membresias
  npm run reparar:qrs-membresias -- --cliente <clienteId>
  npm run reparar:qrs-membresias -- --aplicar
  npm run reparar:qrs-membresias -- --aplicar --cliente <clienteId>`)
}

if (args.includes('--help') || args.includes('-h')) {
  ayuda()
  process.exit(0)
}

const clienteId = valorDespuesDe('--cliente')

function nuevoTokenQr() {
  return randomBytes(24).toString('base64url')
}

function vencimientoQr(desde = new Date()) {
  const d = new Date(desde)
  d.setDate(d.getDate() + 90)
  return d
}

function linea(titulo, valor, color = '') {
  console.log(`  ${titulo.padEnd(52, '·')} ${color}${valor}${C.off}`)
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('✗ Falta DATABASE_URL. Corre este script donde haya conexión a la base correcta.')
    process.exit(1)
  }

  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  const ahora = new Date()

  try {
    console.log(`Reparación de QRs de membresías activas ${APLICAR ? '(APLICANDO)' : '(dry-run: nada se escribe)'}`)
    console.log('─'.repeat(64))
    if (clienteId) linea('Cliente filtrado', clienteId)

    const where = {
      estado: 'ACTIVA',
      pagoConfirmado: true,
      AND: [
        { OR: [{ fechaVencimiento: null }, { fechaVencimiento: { gt: ahora } }] },
        {
          OR: [
            { lavadosRestantes: { gt: 0 } },
            { lavadosBonoRestantes: { gt: 0 } },
            { plan: { esIlimitado: true } },
          ],
        },
      ],
      qrTokens: { none: { activo: true } },
      ...(clienteId ? { clienteId } : {}),
    }

    const pendientes = await prisma.membership.findMany({
      where,
      select: {
        id: true,
        clienteId: true,
        companyId: true,
        lavadosRestantes: true,
        lavadosBonoRestantes: true,
        fechaVencimiento: true,
        cliente: { select: { nombre: true, email: true } },
        plan: { select: { nombre: true, esIlimitado: true } },
      },
      orderBy: [{ companyId: 'asc' }, { createdAt: 'asc' }],
    })

    linea('Membresías sin QR activo', pendientes.length, pendientes.length ? C.avi : C.ok)

    if (pendientes.length) {
      console.log(`${C.dim}Detalle (hasta 25):${C.off}`)
      for (const m of pendientes.slice(0, 25)) {
        const saldo = m.plan.esIlimitado ? 'ilimitado' : `${m.lavadosRestantes + m.lavadosBonoRestantes} uso(s)`
        console.log(
          `${C.dim}  membership=${m.id} cliente=${m.clienteId} plan="${m.plan.nombre}" saldo=${saldo} nombre="${m.cliente.nombre}"${C.off}`
        )
      }
      if (pendientes.length > 25) console.log(`${C.dim}  ... y ${pendientes.length - 25} más${C.off}`)
    }

    let creados = 0
    if (APLICAR) {
      for (const m of pendientes) {
        await prisma.$transaction(async (tx) => {
          const sigueSinQr = await tx.membership.findFirst({
            where: { id: m.id, qrTokens: { none: { activo: true } } },
            select: { id: true },
          })
          if (!sigueSinQr) return

          const qr = await tx.qrToken.create({
            data: {
              clienteId: m.clienteId,
              membresiaId: m.id,
              token: nuevoTokenQr(),
              expiraAt: vencimientoQr(),
            },
            select: { id: true },
          })

          await tx.auditLog.create({
            data: {
              companyId: m.companyId,
              userId: null,
              accion: 'QR_GENERADO',
              entidadTipo: 'QrToken',
              entidadId: qr.id,
              payload: {
                clienteId: m.clienteId,
                membresiaId: m.id,
                motivo: 'reparacion_membresia_activa_sin_qr',
              },
            },
          })

          creados++
        })
      }
    } else {
      creados = pendientes.length
    }

    linea(APLICAR ? 'QRs creados' : 'QRs que se crearían', creados, creados ? C.ok : C.dim)
    if (!APLICAR && pendientes.length) {
      console.log(`\n${C.dim}Dry-run. Para escribir: npm run reparar:qrs-membresias -- --aplicar${clienteId ? ` --cliente ${clienteId}` : ''}${C.off}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error('✗ La reparación falló:', e.message ?? e)
  process.exit(1)
})
