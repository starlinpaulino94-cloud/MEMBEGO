#!/usr/bin/env node
/**
 * AUDITORÍA DE NIVELES TARIFARIOS  (Supply · precio por categoría de vehículo)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUÉ EXISTE
 *
 * Supply va a cobrar distinto según el vehículo, y la pieza que une el
 * vehículo del cliente con el precio de la oferta es `TipoVehiculo.nivelTarifario`
 * — por decisión explícita del proyecto se compara ese NÚMERO, nunca el nombre
 * de la categoría.
 *
 * El problema: `nivelTarifario` es `Int @default(1)`. Toda categoría que nadie
 * configuró está en nivel 1, sea un sedán o un camión. Si se enciende el cobro
 * por categoría sobre datos así, **una camioneta cobraría como sedán**.
 *
 * Degrada hacia el lado bueno —cobra de menos, nunca de más, y nunca bloquea
 * una compra—, pero cobrar de menos en silencio sigue siendo dinero perdido y
 * una promesa incumplida al proveedor. Este script NO cambia nada: mide cuánto
 * de ese problema hay, y ese número decide si el cobro por categoría se puede
 * encender o si antes hay que configurar los niveles.
 *
 * Correrlo contra PRODUCCIÓN antes de activar el precio por categoría.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE SCRIPT SÍ MIRA LOS NOMBRES
 *
 * El esquema es tajante: la asociación se decide por nivel, «NUNCA el nombre de
 * la categoría» (`carwash.prisma:165-168`). Esa regla gobierna el COBRO, y está
 * bien: los nombres son libres, cada empresa escribe lo que quiere y nadie
 * puede cobrar en función de una cadena de texto.
 *
 * Auditar es la operación contraria. Aquí la pregunta no es «cuánto cobro»
 * sino «¿configuró alguien esto, o está en el valor por defecto?». Y el nombre
 * es la ÚNICA evidencia independiente de la intención que existe en la base: si
 * una categoría se llama «Jeepeta» y está en nivel 1 junto al sedán, eso no es
 * una decisión, es un campo que nadie tocó. Usar el nombre para cobrar sería el
 * error que el esquema prohíbe; usarlo para detectar que el número no se
 * configuró es precisamente para lo que sirve.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ RESPONDE
 *
 *   1. ¿Cuántas categorías siguen en el nivel por defecto, y cuántos vehículos
 *      cuelgan de ellas? → el tamaño bruto del problema.
 *   2. ¿Qué empresas tienen TODAS sus categorías en nivel 1? → esas no han
 *      configurado nada, y el nivel 1 ahí no significa «sedán», significa
 *      «sin configurar». Es la distinción que de verdad decide.
 *   3. ¿Hay categorías cuyo NOMBRE contradice su nivel? → el caso concreto en
 *      el que se cobraría de menos, con nombre y apellido.
 *   4. ¿Hay niveles repetidos dentro de una empresa? → dos categorías con el
 *      mismo nivel cobrarán lo mismo en Supply, lo quiera la empresa o no.
 *
 * USO
 *
 *   npm run auditar:niveles        # solo lectura; exit 0 salvo error de conexión
 */

const C = { ok: '\x1b[32m', mal: '\x1b[31m', avi: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }

/**
 * Palabras que, en el nombre de una categoría, delatan un vehículo que NO es un
 * sedán. Deliberadamente conservadora: solo términos que en República
 * Dominicana no admiten otra lectura. Un falso positivo aquí cuesta una
 * revisión manual; un falso negativo esconde dinero, así que se prefiere
 * sobre-avisar.
 *
 * No se usa para cobrar nada — ver la nota de arriba.
 */
const DELATAN_NO_SEDAN = [
  'suv', 'jeepeta', 'jeep', 'camioneta', 'pickup', 'pick-up', 'pick up',
  'camion', 'camión', 'van', 'minivan', 'guagua', 'bus', 'autobus', 'autobús',
  'furgon', 'furgón', 'patana', 'remolque', 'grande', 'xl', 'extra',
]

/** Sin acentos y en minúsculas: «Camión» y «camion» son la misma palabra. */
function normalizar(texto) {
  return (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function pareceNoSedan(nombre) {
  const n = normalizar(nombre)
  return DELATAN_NO_SEDAN.some((p) => n.includes(normalizar(p)))
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
    console.log('Auditoría de niveles tarifarios (Supply · precio por categoría)')
    console.log('─'.repeat(64))

    const tipos = await prisma.tipoVehiculo.findMany({
      select: {
        id: true,
        nombre: true,
        nivelTarifario: true,
        activo: true,
        companyId: true,
        company: { select: { name: true } },
        _count: { select: { vehiculos: true } },
      },
      orderBy: [{ companyId: 'asc' }, { nivelTarifario: 'asc' }, { nombre: 'asc' }],
    })

    if (tipos.length === 0) {
      console.log(`\n${C.avi}!${C.off} No hay ninguna categoría de vehículo en esta base: nada que auditar.`)
      return
    }

    const totalVehiculos = await prisma.vehiculo.count()
    const activos = tipos.filter((t) => t.activo)

    // ── 1 · Tamaño bruto ───────────────────────────────────────────────────
    // Solo las ACTIVAS deciden cobros: una categoría desactivada cuenta como
    // «sin categoría» en el motor de elegibilidad, igual que hace hoy
    // `elegibilidad/index.ts`.
    const enDefecto = activos.filter((t) => t.nivelTarifario === 1)
    const vehiculosEnDefecto = enDefecto.reduce((s, t) => s + t._count.vehiculos, 0)

    console.log('\nUniverso')
    linea('Categorías de vehículo (activas / total)', `${activos.length} / ${tipos.length}`)
    linea('Vehículos registrados', totalVehiculos)

    console.log('\nNivel por defecto (1)')
    linea('Categorías activas en nivel 1', `${enDefecto.length} de ${activos.length}`, enDefecto.length ? C.avi : C.ok)
    linea('Vehículos que cuelgan de ellas', vehiculosEnDefecto, vehiculosEnDefecto ? C.avi : C.ok)

    // ── 2 · Empresas sin configurar · LA PREGUNTA QUE DECIDE ───────────────
    // Una empresa con TODAS sus categorías en nivel 1 no ha configurado nada:
    // ahí el nivel 1 no significa «sedán», significa «nadie tocó esto», y todas
    // sus categorías cobrarían el mismo precio. Una empresa con niveles
    // repartidos sí decidió, y sus categorías en nivel 1 son sedanes de verdad.
    const porEmpresa = new Map()
    for (const t of activos) {
      if (!porEmpresa.has(t.companyId)) {
        porEmpresa.set(t.companyId, { nombre: t.company?.name ?? t.companyId, tipos: [] })
      }
      porEmpresa.get(t.companyId).tipos.push(t)
    }

    const sinConfigurar = []
    const configuradas = []
    for (const [id, e] of porEmpresa) {
      const todasEnUno = e.tipos.every((t) => t.nivelTarifario === 1)
      // Con UNA sola categoría no hay nada que distinguir: no es un descuido,
      // es un negocio que no diferencia por vehículo. No cuenta como problema.
      const destino = todasEnUno && e.tipos.length > 1 ? sinConfigurar : configuradas
      destino.push({ id, ...e, vehiculos: e.tipos.reduce((s, t) => s + t._count.vehiculos, 0) })
    }
    const vehiculosSinConfigurar = sinConfigurar.reduce((s, e) => s + e.vehiculos, 0)

    console.log('\nEmpresas (lo que de verdad decide)')
    linea('Empresas con categorías activas', porEmpresa.size)
    linea('… con TODAS sus categorías en nivel 1', sinConfigurar.length, sinConfigurar.length ? C.mal : C.ok)
    linea('   vehículos afectados', vehiculosSinConfigurar, vehiculosSinConfigurar ? C.mal : C.ok)
    if (sinConfigurar.length) {
      console.log(`${C.dim}  Detalle (hasta 20):${C.off}`)
      for (const e of sinConfigurar.slice(0, 20)) {
        const nombres = e.tipos.map((t) => t.nombre).join(', ')
        console.log(`${C.dim}    ${e.nombre} → ${e.tipos.length} categorías, ${e.vehiculos} vehículos: ${nombres}${C.off}`)
      }
    }

    // ── 3 · Nombres que contradicen su nivel ───────────────────────────────
    const contradictorias = activos.filter((t) => t.nivelTarifario === 1 && pareceNoSedan(t.nombre))
    const vehiculosContradictorios = contradictorias.reduce((s, t) => s + t._count.vehiculos, 0)

    console.log('\nNombres que contradicen su nivel (cobrarían como sedán)')
    linea('Categorías en nivel 1 con nombre de NO sedán', contradictorias.length, contradictorias.length ? C.mal : C.ok)
    linea('   vehículos afectados', vehiculosContradictorios, vehiculosContradictorios ? C.mal : C.ok)
    if (contradictorias.length) {
      console.log(`${C.dim}  Detalle (hasta 30):${C.off}`)
      for (const t of contradictorias.slice(0, 30)) {
        console.log(`${C.dim}    ${t.company?.name ?? t.companyId} · «${t.nombre}» nivel 1, ${t._count.vehiculos} vehículos${C.off}`)
      }
    }

    // ── 4 · Niveles repetidos dentro de una empresa ────────────────────────
    // En Supply el nivel resuelve a UNA categoría de plataforma, así que dos
    // categorías de la misma empresa con el mismo nivel cobrarán igual. Puede
    // ser intencional (sedán y hatchback al mismo precio) o un descuido.
    const repetidos = []
    for (const [, e] of porEmpresa) {
      const porNivel = new Map()
      for (const t of e.tipos) {
        if (!porNivel.has(t.nivelTarifario)) porNivel.set(t.nivelTarifario, [])
        porNivel.get(t.nivelTarifario).push(t)
      }
      for (const [nivel, ts] of porNivel) {
        // El nivel 1 compartido ya se cuenta arriba: no se reporta dos veces.
        if (ts.length > 1 && nivel !== 1) repetidos.push({ empresa: e.nombre, nivel, tipos: ts })
      }
    }

    console.log('\nNiveles repetidos (cobrarán lo mismo en Supply)')
    linea('Grupos con nivel repetido (sin contar el 1)', repetidos.length, repetidos.length ? C.avi : C.ok)
    if (repetidos.length) {
      console.log(`${C.dim}  Detalle (hasta 20):${C.off}`)
      for (const r of repetidos.slice(0, 20)) {
        console.log(`${C.dim}    ${r.empresa} · nivel ${r.nivel}: ${r.tipos.map((t) => t.nombre).join(', ')}${C.off}`)
      }
    }

    // ── Veredicto ──────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(64))
    const bloqueantes = sinConfigurar.length + contradictorias.length
    if (bloqueantes === 0) {
      console.log(`${C.ok}✓${C.off} El cobro por categoría se puede encender: no hay categorías en el nivel por defecto que delaten un descuido.`)
      if (enDefecto.length) {
        console.log(`${C.dim}  Hay ${enDefecto.length} categoría(s) en nivel 1, pero en empresas que SÍ repartieron niveles: ahí el 1 es una decisión (sedán), no un olvido.${C.off}`)
      }
    } else {
      console.log(`${C.mal}✗${C.off} NO encender el cobro por categoría todavía. Hay que configurar los niveles primero:`)
      if (sinConfigurar.length) {
        console.log(`    · ${sinConfigurar.length} empresa(s) con todas sus categorías en nivel 1 (${vehiculosSinConfigurar} vehículos): todo cobraría igual.`)
      }
      if (contradictorias.length) {
        console.log(`    · ${contradictorias.length} categoría(s) con nombre de no-sedán en nivel 1 (${vehiculosContradictorios} vehículos): cobrarían como sedán.`)
      }
      console.log(`${C.dim}  Mientras no se arregle, el precio por categoría degrada al precio base: se cobra de menos, nunca de más, y ninguna compra se bloquea.${C.off}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error('✗ La auditoría falló:', e.message ?? e)
  process.exit(1)
})
