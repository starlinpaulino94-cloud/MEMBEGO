/**
 * ROTAR EL SECRETO COMPARTIDO DE UN SATÉLITE — SIN CORTE (auditoría A-7).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN SCRIPT Y NO UN BOTÓN
 *
 * `SistemaConectado` lo administra el operador de la plataforma con
 * `registrar-sistema.ts`, no una empresa desde su panel. La rotación vive en el
 * mismo sitio: es una operación de infraestructura entre MembeGo y el satélite.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL FLUJO, EN DOS PASOS Y SIN CORTE
 *
 *   1. `--rotar`    genera el secreto NUEVO y abre una ventana de solape (7 días).
 *                   MembeGo sigue FIRMANDO lo saliente con el secreto de siempre
 *                   —así ningún satélite que no haya actualizado se rompe— y
 *                   empieza a ACEPTAR lo entrante firmado con cualquiera de los
 *                   dos. El script imprime el nuevo secreto UNA vez.
 *
 *   (el operador instala el nuevo secreto en el .env del satélite y comprueba
 *    que el SSO de entrada sigue funcionando)
 *
 *   2. `--promover` mueve el nuevo a primario: lo saliente pasa a firmarse con
 *                   él y el viejo se descarta. A partir de aquí el satélite ya no
 *                   necesita el viejo.
 *
 * Si nadie promueve dentro de la ventana, el cron descarta la pendiente: nunca
 * se promueve sola, porque cambiar el secreto saliente a uno que el satélite
 * quizá no instaló sería el corte que todo esto evita.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * USO
 *
 *   tsx scripts/rotar-secreto-sistema.ts <slug> --rotar
 *   tsx scripts/rotar-secreto-sistema.ts <slug> --promover
 */

import { prisma } from '@/lib/prisma'
import { rotarSecretoSistema, promoverSecretoSistema } from '@/modules/plataforma/rotacion-secreto'

async function main() {
  const args = process.argv.slice(2)
  const slug = args.find((a) => !a.startsWith('--'))
  const rotar = args.includes('--rotar')
  const promover = args.includes('--promover')

  if (!slug || (!rotar && !promover) || (rotar && promover)) {
    console.error('Uso: tsx scripts/rotar-secreto-sistema.ts <slug> --rotar | --promover')
    process.exit(1)
  }

  const sistema = await prisma.sistemaConectado.findUnique({
    where: { slug },
    select: { id: true, nombre: true },
  })
  if (!sistema) {
    console.error(`No existe ningún sistema con slug «${slug}».`)
    process.exit(1)
  }

  if (rotar) {
    const r = await rotarSecretoSistema(sistema.id)
    if (!r.ok) {
      console.error(`No se pudo abrir la rotación (${r.motivo}).`)
      process.exit(1)
    }
    console.log(`\n  Rotación abierta para «${sistema.nombre}» (${slug}).`)
    console.log(`  Instala este secreto NUEVO en el .env del satélite:\n`)
    console.log(`      ${r.secreto}\n`)
    console.log(`  Se acepta la entrada con el viejo Y el nuevo hasta ${r.hasta.toISOString()}.`)
    console.log(`  Lo saliente sigue firmándose con el VIEJO hasta que ejecutes --promover.\n`)
    process.exit(0)
  }

  const r = await promoverSecretoSistema(sistema.id)
  if (!r.ok) {
    console.error(
      r.motivo === 'sin_pendiente'
        ? '  No hay ninguna rotación pendiente que promover. Ejecuta --rotar primero.'
        : `  No se pudo promover (${r.motivo ?? 'error'}).`
    )
    process.exit(1)
  }
  console.log(`\n  Promovida. Lo saliente de «${sistema.nombre}» ya se firma con el secreto nuevo.`)
  console.log(`  El satélite puede retirar el secreto viejo de su .env.\n`)
  process.exit(0)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
