#!/usr/bin/env node
/**
 * MIGRAR LOS MEDIOS AL PREFIJO DE EMPRESA
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ HACE
 *
 * Los buckets `promociones` y `evidencias` guardaban los archivos así:
 *
 *     <promocionId>/<archivo>            invitaciones/<campanaId>/<archivo>
 *     <colaId>/<archivo>                 nueva/<archivo>   sueltas/<archivo>
 *
 * `nueva/` y `sueltas/` las compartían TODAS las empresas: cualquier usuario
 * autenticado podía sobrescribir el archivo recién subido de otra. El código
 * ya no escribe ahí (ver `src/lib/storage-rutas.ts`), pero lo subido antes
 * sigue donde estaba.
 *
 * Este script los mueve a `<companyId>/<ruta anterior>` y actualiza las URL
 * guardadas en la base, que es la mitad que se olvida: mover el archivo sin
 * reescribir la URL deja la imagen rota en el panel y en el enlace compartido.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CÓMO AVERIGUA DE QUIÉN ES CADA ARCHIVO
 *
 * NO por la ruta: `nueva/x.jpg` no dice nada. Se hace al revés — se leen todas
 * las entidades que guardan una URL, se construye un índice ruta → empresa, y
 * cada objeto del bucket se busca ahí. Un archivo al que no apunta ninguna
 * entidad es huérfano: se INFORMA y no se toca. Adivinar su dueño sería peor
 * que dejarlo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * USO
 *
 *   # Simulacro. No mueve nada, no escribe nada. Es el modo por defecto.
 *   DATABASE_URL="…" SUPABASE_URL="…" SUPABASE_SERVICE_ROLE_KEY="…" \
 *     node scripts/migrar-medios-a-empresa.mjs
 *
 *   # De verdad.
 *   … node scripts/migrar-medios-a-empresa.mjs --aplicar
 *
 * Hace falta la SERVICE ROLE key: las políticas nuevas deniegan a
 * `authenticated` justamente las rutas heredadas que hay que mover.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SEGURIDAD DE LA OPERACIÓN
 *
 * `storage.move` es atómico por archivo. Si el script se corta a la mitad, lo
 * movido está movido y con su URL actualizada, y lo demás sigue intacto:
 * volver a ejecutarlo continúa donde se quedó. No hay estado a medias porque
 * cada archivo se mueve y se actualiza antes de pasar al siguiente.
 */

import { PrismaClient } from '@prisma/client'
import { createClient } from '@supabase/supabase-js'

const APLICAR = process.argv.includes('--aplicar')
const BUCKETS = ['promociones', 'evidencias']

const C = { ok: '\x1b[32m', mal: '\x1b[31m', avi: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    `${C.mal}✗${C.off} Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.\n` +
      '  Se necesita la service role: las políticas nuevas deniegan a `authenticated`\n' +
      '  las rutas heredadas que hay que mover.'
  )
  process.exit(1)
}

const prisma = new PrismaClient()
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

/** De una URL pública de Supabase saca la ruta dentro del bucket. */
function rutaDeUrl(url, bucket) {
  if (!url) return null
  const marca = `/storage/v1/object/public/${bucket}/`
  const i = url.indexOf(marca)
  return i === -1 ? null : decodeURIComponent(url.slice(i + marca.length))
}

/**
 * Índice ruta → { companyId, actualizar() }. `actualizar` reescribe la URL
 * guardada en la fila que apunta a ese archivo.
 */
async function construirIndice() {
  const indice = new Map()

  const anotar = (url, bucket, companyId, actualizar) => {
    const ruta = rutaDeUrl(url, bucket)
    if (ruta) indice.set(`${bucket}:${ruta}`, { companyId, urlVieja: url, actualizar })
  }

  const promos = await prisma.promocion.findMany({
    select: { id: true, companyId: true, imagenUrl: true, imagenes: true },
  })
  for (const p of promos) {
    anotar(p.imagenUrl, 'promociones', p.companyId, (nueva) =>
      prisma.promocion.update({ where: { id: p.id }, data: { imagenUrl: nueva } })
    )
    for (const vieja of p.imagenes ?? []) {
      anotar(vieja, 'promociones', p.companyId, (nueva) =>
        prisma.promocion.update({
          where: { id: p.id },
          data: { imagenes: (p.imagenes ?? []).map((u) => (u === vieja ? nueva : u)) },
        })
      )
    }
  }

  const marketing = await prisma.marketingCampaign.findMany({
    select: { id: true, companyId: true, imagenUrl: true, bannerUrl: true },
  })
  for (const m of marketing) {
    anotar(m.imagenUrl, 'promociones', m.companyId, (nueva) =>
      prisma.marketingCampaign.update({ where: { id: m.id }, data: { imagenUrl: nueva } })
    )
    anotar(m.bannerUrl, 'promociones', m.companyId, (nueva) =>
      prisma.marketingCampaign.update({ where: { id: m.id }, data: { bannerUrl: nueva } })
    )
  }

  const invit = await prisma.campanaInvitacion.findMany({
    select: { id: true, companyId: true, imagenUrl: true, bannerUrl: true },
  })
  for (const c of invit) {
    anotar(c.imagenUrl, 'promociones', c.companyId, (nueva) =>
      prisma.campanaInvitacion.update({ where: { id: c.id }, data: { imagenUrl: nueva } })
    )
    anotar(c.bannerUrl, 'promociones', c.companyId, (nueva) =>
      prisma.campanaInvitacion.update({ where: { id: c.id }, data: { bannerUrl: nueva } })
    )
  }

  const fotos = await prisma.evidenciaFoto.findMany({
    select: { id: true, companyId: true, url: true },
  })
  for (const f of fotos) {
    anotar(f.url, 'evidencias', f.companyId, (nueva) =>
      prisma.evidenciaFoto.update({ where: { id: f.id }, data: { url: nueva } })
    )
  }

  return indice
}

/** Lista TODOS los objetos de un bucket, recorriendo sus carpetas. */
async function listarTodo(bucket, prefijo = '') {
  const salida = []
  let desde = 0
  for (;;) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefijo, { limit: 100, offset: desde })
    if (error) throw new Error(`listar ${bucket}/${prefijo}: ${error.message}`)
    if (!data || data.length === 0) break
    for (const e of data) {
      const ruta = prefijo ? `${prefijo}/${e.name}` : e.name
      // Sin `id` es una carpeta, no un archivo.
      if (e.id === null || e.id === undefined) salida.push(...(await listarTodo(bucket, ruta)))
      else salida.push(ruta)
    }
    if (data.length < 100) break
    desde += 100
  }
  return salida
}

async function main() {
  console.log(
    `Migración de medios al prefijo de empresa — ${APLICAR ? `${C.avi}MODO REAL${C.off}` : 'simulacro'}`
  )
  console.log('─'.repeat(70))

  const empresas = new Set((await prisma.company.findMany({ select: { id: true } })).map((c) => c.id))
  const indice = await construirIndice()
  console.log(`${C.dim}Entidades con imagen indexadas: ${indice.size}${C.off}`)

  let movidos = 0
  let yaBien = 0
  const huerfanos = []
  const fallos = []

  for (const bucket of BUCKETS) {
    const objetos = await listarTodo(bucket)
    console.log(`\n${bucket}: ${objetos.length} archivo(s)`)

    for (const ruta of objetos) {
      // Ya está en el formato nuevo si su primer segmento es una empresa real.
      if (empresas.has(ruta.split('/')[0])) {
        yaBien++
        continue
      }

      const entrada = indice.get(`${bucket}:${ruta}`)
      if (!entrada) {
        huerfanos.push(`${bucket}/${ruta}`)
        continue
      }

      const destino = `${entrada.companyId}/${ruta}`
      if (!APLICAR) {
        console.log(`${C.dim}  movería  ${ruta}  →  ${destino}${C.off}`)
        movidos++
        continue
      }

      const { error } = await supabase.storage.from(bucket).move(ruta, destino)
      if (error) {
        fallos.push(`${bucket}/${ruta}: ${error.message}`)
        continue
      }
      const { data } = supabase.storage.from(bucket).getPublicUrl(destino)
      try {
        await entrada.actualizar(data.publicUrl)
      } catch (e) {
        // El archivo ya se movió: dejar la URL vieja sería una imagen rota.
        // Se deshace el movimiento para que el estado siga siendo coherente.
        await supabase.storage.from(bucket).move(destino, ruta)
        fallos.push(`${bucket}/${ruta}: no se pudo actualizar la URL (${e.message}); movimiento deshecho`)
        continue
      }
      movidos++
    }
  }

  console.log('\n' + '─'.repeat(70))
  console.log(`${C.ok}✓${C.off} Ya en el formato nuevo: ${yaBien}`)
  console.log(`${APLICAR ? `${C.ok}✓${C.off} Movidos` : '  Se moverían'}: ${movidos}`)

  if (huerfanos.length > 0) {
    console.log(
      `\n${C.avi}⚠${C.off}  ${huerfanos.length} archivo(s) sin ninguna entidad que los referencie.` +
        ` NO se tocan:\n${C.dim}   ${huerfanos.slice(0, 15).join('\n   ')}${C.off}` +
        (huerfanos.length > 15 ? `\n${C.dim}   … y ${huerfanos.length - 15} más${C.off}` : '')
    )
    console.log(
      `${C.dim}   Son restos de subidas que nunca se guardaron. Adivinarles dueño sería\n` +
        `   peor que dejarlos; se pueden borrar a mano tras revisarlos.${C.off}`
    )
  }

  if (fallos.length > 0) {
    console.log(`\n${C.mal}✗ ${fallos.length} fallo(s):${C.off}`)
    for (const f of fallos) console.log(`   ${f}`)
  }

  if (!APLICAR && movidos > 0) {
    console.log(`\n${C.dim}Para hacerlo de verdad: node scripts/migrar-medios-a-empresa.mjs --aplicar${C.off}`)
  }

  process.exitCode = fallos.length > 0 ? 1 : 0
}

main()
  .catch((e) => {
    console.error(`${C.mal}✗${C.off} ${e.message}`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
