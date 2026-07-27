#!/usr/bin/env tsx
/**
 * INTERRUPTOR DE CAPACIDADES desde la terminal.
 *
 * POR QUÉ EXISTE: encender o apagar una capacidad se hace normalmente en
 * `/superadmin/capacidades`, y esa sigue siendo la vía recomendada. Pero al
 * estrenar una capacidad en producción (ej. NAVEGACION_V2 en la pista) hace
 * falta poder APAGARLA en segundos, desde el celular o por SSH, sin depender
 * de que el panel cargue ni de encontrar la casilla correcta con prisa.
 *
 * NO DUPLICA LÓGICA: importa el catálogo y el resolutor reales
 * (`src/modules/capacidades/catalogo.ts`), así que no puede desincronizarse
 * del comportamiento de la app. Por eso es .ts y corre con tsx.
 *
 * USO:
 *   npm run cap                          → estado de CARTOWN
 *   npm run cap -- estado "Otra Empresa" → estado de otra empresa
 *   npm run cap -- on  NAVEGACION_V2     → encender en CARTOWN
 *   npm run cap -- off NAVEGACION_V2     → apagar en CARTOWN
 *   npm run cap -- reset NAVEGACION_V2   → quitar el override (vuelve al paquete base)
 *   npm run cap -- on NAVEGACION_V2 --si → sin confirmación (para scripts)
 *   npm run cap -- sql on NAVEGACION_V2  → imprime el SQL, no conecta a nada
 *
 * El modo `sql` existe para cuando no hay DATABASE_URL a mano: imprime la
 * sentencia para pegar en el SQL Editor de Supabase.
 */

import { readFileSync, existsSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CAPACIDADES,
  CAPACIDAD_LABELS,
  capacidadesEfectivas,
  resolverConfig,
  type Capacidad,
} from '../src/modules/capacidades/catalogo'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EMPRESA_POR_DEFECTO = 'CARTOWN'

// ── Entorno ─────────────────────────────────────────────────────────────────

/** Carga DATABASE_URL de .env.local o .env si no viene ya en el entorno. */
function cargarEnv(): void {
  if (process.env.DATABASE_URL) return
  for (const archivo of ['.env.local', '.env']) {
    const ruta = join(ROOT, archivo)
    if (!existsSync(ruta)) continue
    for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linea)
      if (!m) continue
      const [, clave, bruto] = m
      if (process.env[clave]) continue
      process.env[clave] = bruto.trim().replace(/^["']|["']$/g, '')
    }
    if (process.env.DATABASE_URL) return
  }
}

// ── Presentación ────────────────────────────────────────────────────────────

const VERDE = '\x1b[32m'
const ROJO = '\x1b[31m'
const GRIS = '\x1b[90m'
const NEGRITA = '\x1b[1m'
const FIN = '\x1b[0m'

function mostrarEstado(
  nombre: string,
  categoria: string,
  activas: Set<Capacidad>,
  overrides: Partial<Record<Capacidad, boolean>>
): void {
  console.log(`\n${NEGRITA}${nombre}${FIN} ${GRIS}· categoría ${categoria}${FIN}\n`)
  for (const cap of CAPACIDADES) {
    const on = activas.has(cap)
    const marca = on ? `${VERDE}● ON ${FIN}` : `${ROJO}○ OFF${FIN}`
    const forzada = cap in overrides ? `${GRIS} (override)${FIN}` : ''
    console.log(`  ${marca}  ${cap.padEnd(20)} ${GRIS}${CAPACIDAD_LABELS[cap]}${FIN}${forzada}`)
  }
  console.log()
}

function ayuda(): void {
  console.log(`
Interruptor de capacidades por empresa.

  npm run cap                           estado de ${EMPRESA_POR_DEFECTO}
  npm run cap -- estado [empresa]       estado de una empresa
  npm run cap -- on    <CAP> [empresa]  encender
  npm run cap -- off   <CAP> [empresa]  apagar
  npm run cap -- reset <CAP> [empresa]  quitar el override (vuelve al paquete base)
  npm run cap -- sql on <CAP> [empresa] imprimir el SQL sin conectar

Opciones:
  --si    no preguntar confirmación

Capacidades: ${CAPACIDADES.join(', ')}
`)
}

// ── Principal ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const sinConfirmar = args.includes('--si')
  const limpios = args.filter((a) => a !== '--si')

  const modoSql = limpios[0] === 'sql'
  if (modoSql) limpios.shift()

  const accion = (limpios[0] ?? 'estado').toLowerCase()
  if (accion === 'ayuda' || accion === '--help' || accion === '-h') {
    ayuda()
    return
  }
  if (!['estado', 'on', 'off', 'reset'].includes(accion)) {
    console.error(`✗ Acción desconocida: "${accion}".`)
    ayuda()
    process.exit(1)
  }

  // `estado` no lleva capacidad; el resto sí.
  const cap = accion === 'estado' ? null : (limpios[1] as Capacidad | undefined) ?? null
  const empresaArg = accion === 'estado' ? limpios[1] : limpios[2]
  const empresa = empresaArg?.trim() || EMPRESA_POR_DEFECTO

  if (accion !== 'estado') {
    if (!cap) {
      console.error('✗ Falta la capacidad. Ej: npm run cap -- on NAVEGACION_V2')
      process.exit(1)
    }
    if (!(CAPACIDADES as readonly string[]).includes(cap)) {
      console.error(`✗ "${cap}" no es una capacidad válida.`)
      console.error(`  Válidas: ${CAPACIDADES.join(', ')}`)
      process.exit(1)
    }
  }

  // Modo SQL: no conecta a nada, solo imprime la sentencia.
  if (modoSql) {
    if (accion === 'estado') {
      console.log(`
-- Estado de capacidades (pegar en el SQL Editor de Supabase)
SELECT name, type, capacidades FROM companies WHERE name ILIKE '%${empresa}%';
`)
      return
    }
    // OJO: aquí NO sirve jsonb_set. Si la fila todavía no tiene la clave
    // `overrides`, jsonb_set no crea el objeto intermedio y el UPDATE reporta
    // éxito sin cambiar nada (verificado contra PostgreSQL 16). Con `||` se
    // fusiona el objeto, creándolo si falta y conservando `categoria` y los
    // demás overrides.
    const mutacion =
      accion === 'reset'
        ? `COALESCE(capacidades->'overrides', '{}'::jsonb) - '${cap}'`
        : `COALESCE(capacidades->'overrides', '{}'::jsonb) || jsonb_build_object('${cap}', ${accion === 'on'})`
    const sql = `UPDATE companies
   SET capacidades = COALESCE(capacidades, '{}'::jsonb)
     || jsonb_build_object('overrides', ${mutacion})
 WHERE name ILIKE '%${empresa}%';`
    console.log(`
-- ${accion.toUpperCase()} ${cap} para "${empresa}" (pegar en el SQL Editor de Supabase)
${sql}

-- Verificar:
SELECT name, capacidades->'overrides' AS overrides
  FROM companies WHERE name ILIKE '%${empresa}%';
`)
    return
  }

  cargarEnv()
  if (!process.env.DATABASE_URL) {
    console.error('✗ Falta DATABASE_URL (ni en el entorno ni en .env.local/.env).')
    console.error('  Alternativa sin conexión: npm run cap -- sql on NAVEGACION_V2')
    process.exit(1)
  }

  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()

  try {
    const encontradas = await prisma.company.findMany({
      where: { name: { contains: empresa, mode: 'insensitive' } },
      select: { id: true, name: true, type: true, capacidades: true },
      take: 5,
    })

    if (encontradas.length === 0) {
      console.error(`✗ No hay ninguna empresa cuyo nombre contenga "${empresa}".`)
      process.exit(1)
    }
    if (encontradas.length > 1) {
      console.error(`✗ "${empresa}" coincide con varias empresas. Sé más específico:`)
      for (const e of encontradas) console.error(`    · ${e.name}`)
      process.exit(1)
    }

    const company = encontradas[0]
    const antes = capacidadesEfectivas(company.type, company.capacidades)
    const configAntes = resolverConfig(company.capacidades)

    if (accion === 'estado') {
      mostrarEstado(company.name, antes.categoria, antes.activas, configAntes.overrides ?? {})
      return
    }

    const capacidad = cap as Capacidad
    const estabaOn = antes.activas.has(capacidad)
    const quedaOn = accion === 'on' ? true : accion === 'off' ? false : null

    // `reset` quita el override; el resultado depende del paquete base.
    const overrides = { ...(configAntes.overrides ?? {}) }
    if (accion === 'reset') delete overrides[capacidad]
    else overrides[capacidad] = quedaOn as boolean

    const configNueva = { ...configAntes, overrides }
    const despues = capacidadesEfectivas(company.type, configNueva)
    const quedaraOn = despues.activas.has(capacidad)

    if (estabaOn === quedaraOn && accion !== 'reset') {
      console.log(
        `\n${GRIS}Sin cambios:${FIN} ${capacidad} ya está ${estabaOn ? `${VERDE}ON${FIN}` : `${ROJO}OFF${FIN}`} en ${company.name}.\n`
      )
      return
    }

    console.log(
      `\n${NEGRITA}${company.name}${FIN}\n` +
        `  ${capacidad} ${GRIS}(${CAPACIDAD_LABELS[capacidad]})${FIN}\n` +
        `  ${estabaOn ? `${VERDE}ON${FIN}` : `${ROJO}OFF${FIN}`}  →  ${quedaraOn ? `${VERDE}ON${FIN}` : `${ROJO}OFF${FIN}`}` +
        (accion === 'reset' ? `${GRIS}  (según el paquete base)${FIN}` : '') +
        '\n'
    )

    if (!sinConfirmar) {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      const r = (await rl.question('¿Aplicar? Esto afecta a la empresa EN PRODUCCIÓN [s/N] ')).trim()
      rl.close()
      if (r.toLowerCase() !== 's' && r.toLowerCase() !== 'si') {
        console.log('Cancelado. No se tocó nada.\n')
        return
      }
    }

    await prisma.company.update({
      where: { id: company.id },
      data: { capacidades: configNueva },
    })

    const verificada = await prisma.company.findUniqueOrThrow({
      where: { id: company.id },
      select: { type: true, capacidades: true },
    })
    const real = capacidadesEfectivas(verificada.type, verificada.capacidades)

    if (real.activas.has(capacidad) !== quedaraOn) {
      console.error('\n✗ La base de datos no quedó como se esperaba. Revisa a mano.\n')
      process.exit(1)
    }

    console.log(`${VERDE}✓${FIN} ${capacidad} quedó ${quedaraOn ? 'ENCENDIDA' : 'APAGADA'} en ${company.name}.`)
    console.log(
      `${GRIS}  El cambio es inmediato: no hay que desplegar. Para revertir:${FIN}\n` +
        `${GRIS}  npm run cap -- ${quedaraOn ? 'off' : 'on'} ${capacidad}${empresaArg ? ` "${empresa}"` : ''}${FIN}\n`
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error('\n✗ Error:', e instanceof Error ? e.message : e)
  process.exit(1)
})
