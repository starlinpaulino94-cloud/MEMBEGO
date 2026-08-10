/**
 * DAR DE ALTA UN SISTEMA VERTICAL — SIN TOCAR EL CORE (plataforma · Fase 7).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA PRUEBA DE LA ARQUITECTURA
 *
 * La pregunta de la Fase 7 es una sola: **¿se integra un sistema nuevo sin
 * modificar MembeGo?** Este script es la respuesta ejecutable. Lee un
 * manifiesto —un archivo de datos— y escribe las filas que hacen existir al
 * vertical:
 *
 *     tipos_negocio          el vertical al que sirve, si aún no está
 *     sistemas_conectados    el sistema, con su URL y su secreto de webhooks
 *     sistemas_tipos_negocio la relación N:M
 *     credenciales_sistema   client_id + secreto, con los scopes DERIVADOS
 *     empresas_sistemas      la habilitación, si se pasa una empresa
 *
 * Ni un `switch`, ni un `as const`, ni un despliegue. Si algún día para añadir
 * un vertical hubiera que editar código del Core, la arquitectura habría
 * fallado y este script dejaría de ser suficiente — que es justamente lo que lo
 * hace útil como prueba.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * USO
 *
 *   tsx scripts/registrar-sistema.ts <manifiesto.json> [--empresa <slug|id>]
 *                                                     [--vertical <CODIGO>]
 *   tsx scripts/registrar-sistema.ts <manifiesto.json> --validar
 *
 * `--validar` no toca la base: comprueba el manifiesto y sale. Sirve para que
 * un satélite revise el suyo antes de mandárselo a nadie.
 *
 * `--vertical` fija el tipo de negocio de la empresa. Hace falta cuando la
 * empresa es de un vertical que no existía antes: habilitar el sistema sin eso
 * deja una habilitación que el acceso rechaza por incompatible, y el mensaje
 * («vertical incompatible») no dice qué arreglar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS SECRETOS SE ENSEÑAN UNA VEZ
 *
 * El `client_secret` y el secreto de webhooks se imprimen y no se guardan en
 * claro: en la base queda el scrypt. Si se pierden, se rotan. Es la propiedad
 * que se busca, no un inconveniente — un secreto recuperable es un secreto que
 * alguien puede recuperar.
 */

import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { scopesDelManifiesto, validarManifiesto } from '@membego/contracts'
import { prisma } from '@/lib/prisma'
import { hashearSecreto } from '@/modules/plataforma/credenciales'

function salir(mensaje: string): never {
  console.error(`\n✗ ${mensaje}\n`)
  process.exit(1)
}

/**
 * Todo dentro de `main`: `tsx` compila este proyecto como CJS, donde el `await`
 * de nivel superior no existe. Sin esto el script no arranca — lo descubrió la
 * prueba contra base real, que lo ejecuta de verdad en vez de leerlo.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const ruta = args.find((a) => !a.startsWith('--'))
  if (!ruta) {
    salir('Uso: tsx scripts/registrar-sistema.ts <manifiesto.json> [--empresa <slug|id>] [--validar]')
  }

  const soloValidar = args.includes('--validar')
  const iEmpresa = args.indexOf('--empresa')
  const empresaRef = iEmpresa >= 0 ? args[iEmpresa + 1] : null
  const iVertical = args.indexOf('--vertical')
  const verticalRef = iVertical >= 0 ? args[iVertical + 1] : null

  const crudo = (() => {
    try {
      return JSON.parse(readFileSync(ruta, 'utf8')) as unknown
    } catch (e) {
      salir(`No se pudo leer ${ruta}: ${(e as Error).message}`)
    }
  })()

  const v = validarManifiesto(crudo)
  if (!v.ok) {
    console.error('\n✗ El manifiesto no es válido:\n')
    for (const e of v.errores) console.error(`   · ${e}`)
    console.error('')
    process.exit(1)
  }
  const manifiesto = v.manifiesto
  // Derivados, nunca declarados: el manifiesto pide capabilities y la lista de lo
  // concedible vive en el Core. Un scope escrito a mano en el archivo del
  // satélite no llega hasta aquí.
  const scopes = scopesDelManifiesto(manifiesto)

  console.log(`\nManifiesto válido — ${manifiesto.nombre} (${manifiesto.slug})`)
  console.log(`  verticales:   ${manifiesto.businessTypes.join(', ')}`)
  console.log(`  capabilities: ${manifiesto.capabilities.join(', ')}`)
  console.log(`  scopes:       ${scopes.join(' ')}`)

  if (soloValidar) {
    console.log('\n--validar: no se ha tocado la base de datos.\n')
    process.exit(0)
  }

  const secretoWebhooks = `whs_${randomBytes(24).toString('hex')}`
  const clientId = `mgc_${randomBytes(12).toString('hex')}`
  const clientSecret = `mgs_${randomBytes(24).toString('hex')}`

  // Todo en UNA transacción: un sistema registrado a medias —sin credencial, o
  // sin su vertical— es peor que uno no registrado, porque parece que está.
  const resultado = await prisma.$transaction(async (tx) => {
    const tipos = []
    for (const codigo of manifiesto.businessTypes) {
      // Un vertical nuevo trae un tipo de negocio nuevo, y crearlo NO puede
      // exigir un despliegue: era un `as const` de cuatro valores y por eso pasó
      // a ser una tabla en la Fase 1b.
      const t = await tx.tipoNegocio.upsert({
        where: { codigo },
        update: {},
        create: { codigo, nombre: codigo.replace(/_/g, ' ').toLowerCase() },
        select: { id: true, codigo: true, createdAt: true, updatedAt: true },
      })
      tipos.push({ ...t, nuevo: t.createdAt.getTime() === t.updatedAt.getTime() })
    }

    const sistema = await tx.sistemaConectado.upsert({
      where: { slug: manifiesto.slug },
      update: {
        nombre: manifiesto.nombre,
        urlBase: manifiesto.urlBase,
        urlWebhook: manifiesto.webhookUrl ?? null,
        accesoPorUsuario: manifiesto.accesoPorUsuario ?? false,
        // `autoHabilitar` y `estado` NO se tocan al reregistrar: son decisiones
        // operativas que alguien tomó desde el panel, y volver a correr el script
        // para actualizar una URL no puede reactivar un sistema suspendido.
      },
      create: {
        slug: manifiesto.slug,
        nombre: manifiesto.nombre,
        urlBase: manifiesto.urlBase,
        urlWebhook: manifiesto.webhookUrl ?? null,
        // Nace en DRAFT: registrar no es lanzar. Alguien tiene que mirarlo y
        // activarlo desde el panel, que es la revisión que un alta automática se
        // saltaría.
        estado: 'DRAFT',
        activo: false,
        autoHabilitar: manifiesto.autoHabilitar ?? false,
        accesoPorUsuario: manifiesto.accesoPorUsuario ?? false,
        secreto: secretoWebhooks,
        // Espejo de legado: la columna sigue existiendo hasta la contracción.
        categoria: manifiesto.businessTypes[0],
      },
      select: { id: true, slug: true, estado: true, secreto: true },
    })

    for (const t of tipos) {
      await tx.sistemaTipoNegocio.upsert({
        where: { sistemaId_tipoId: { sistemaId: sistema.id, tipoId: t.id } },
        update: {},
        create: { sistemaId: sistema.id, tipoId: t.id },
      })
    }

    const credencial = await tx.credencialSistema.create({
      data: {
        sistemaId: sistema.id,
        clientId,
        clientSecretHash: hashearSecreto(clientSecret),
        scopes,
        descripcion: `${manifiesto.nombre} · registrada por registrar-sistema`,
      },
      select: { clientId: true },
    })

    let habilitacion: { companyId: string; nombre: string; aviso: string | null } | null = null
    if (empresaRef) {
      const empresa = await tx.company.findFirst({
        where: { OR: [{ id: empresaRef }, { slug: empresaRef }] },
        select: { id: true, name: true, tipoNegocioCodigo: true },
      })
      if (!empresa) throw new Error(`No existe la empresa "${empresaRef}".`)

      // El vertical de la empresa se fija SOLO si se pide explícitamente. Una
      // habilitación no puede cambiar de vertical a un negocio de paso: eso
      // reconfigura sus capacidades, su panel y qué otros sistemas ve.
      if (verticalRef) {
        if (!manifiesto.businessTypes.includes(verticalRef)) {
          throw new Error(
            `--vertical ${verticalRef} no está en el manifiesto (${manifiesto.businessTypes.join(', ')}).`
          )
        }
        await tx.company.update({
          where: { id: empresa.id },
          data: { tipoNegocioCodigo: verticalRef },
        })
        empresa.tipoNegocioCodigo = verticalRef
      }

      // Habilitar un sistema para una empresa de otro vertical deja una fila que
      // el acceso rechaza por incompatible, y el mensaje que ve quien lo abre
      // («no disponible») no dice qué arreglar. Se avisa aquí, que es donde
      // alguien está mirando.
      const aviso =
        empresa.tipoNegocioCodigo && !manifiesto.businessTypes.includes(empresa.tipoNegocioCodigo)
          ? `la empresa es de vertical ${empresa.tipoNegocioCodigo} y el sistema sirve a ` +
            `${manifiesto.businessTypes.join(', ')}: nadie podrá abrirlo. ` +
            `Usa --vertical <CODIGO> si la empresa cambió de vertical.`
          : !empresa.tipoNegocioCodigo
            ? 'la empresa no tiene vertical asignado; se resolverá con el mapeo heredado.'
            : null

      await tx.empresaSistema.upsert({
        where: { companyId_sistemaId: { companyId: empresa.id, sistemaId: sistema.id } },
        update: { estado: 'ENABLED', habilitadoAt: new Date(), deshabilitadoAt: null },
        create: {
          companyId: empresa.id,
          sistemaId: sistema.id,
          estado: 'ENABLED',
          habilitadoAt: new Date(),
        },
      })
      habilitacion = { companyId: empresa.id, nombre: empresa.name, aviso }
    }

    return { sistema, credencial, tipos, habilitacion }
  })

  console.log('\n────────────────────────────────────────────────────────────')
  console.log(`Sistema registrado: ${resultado.sistema.slug}  (estado ${resultado.sistema.estado})`)
  for (const t of resultado.tipos) {
    console.log(`  vertical ${t.codigo}${t.nuevo ? '  ← creado ahora' : ''}`)
  }
  if (resultado.habilitacion) {
    console.log(`  habilitado para ${resultado.habilitacion.nombre}`)
    if (resultado.habilitacion.aviso) console.log(`  ⚠ ${resultado.habilitacion.aviso}`)
  } else {
    console.log('  sin habilitar para ninguna empresa (--empresa <slug>)')
  }

  console.log('\nESTO SE ENSEÑA UNA SOLA VEZ. Cópialo al .env del satélite:\n')
  console.log(`  MEMBEGO_CLIENT_ID=${resultado.credencial.clientId}`)
  console.log(`  MEMBEGO_CLIENT_SECRET=${clientSecret}`)
  console.log(`  MEMBEGO_WEBHOOK_SECRET=${resultado.sistema.secreto}`)

  if (resultado.sistema.estado === 'DRAFT') {
    console.log(
      '\nEstá en DRAFT: no abre sesiones ni recibe eventos todavía. Actívalo desde\n' +
        'el panel de superadmin cuando lo hayas revisado.'
    )
  }
  console.log('')

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(`\n✗ ${(e as Error).message}\n`)
  process.exit(1)
})
