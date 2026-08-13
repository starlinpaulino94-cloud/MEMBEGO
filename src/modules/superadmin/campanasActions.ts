'use server'

/**
 * Acciones de las CAMPAÑAS GLOBALES (solo SUPERADMIN).
 *
 * `aplicarCampana` es el motor de reparto: recorre las empresas participantes
 * y crea en cada una una promoción o un plan REAL. Es IDEMPOTENTE — si una
 * empresa ya recibió su copia no se duplica, así que se puede volver a aplicar
 * cuando entra una empresa nueva sin miedo. Los fallos se guardan POR EMPRESA:
 * que una falle no aborta el resto.
 */

import { revalidatePath } from 'next/cache'
import { getUser } from '@/lib/auth'
import { getRequestMeta } from '@/lib/server-utils'
import { conEmpresa, sinEmpresa, type Tx } from '@/lib/tenant'
import {
  CAMPANA_TIPOS,
  estadoTrasAplicar,
  leerPlantilla,
  type CampanaTipo,
  type PlantillaPlan,
  type PlantillaPromocion,
} from './campanasGlobales'
import { anotarFallo } from '@/lib/prisma-errors'

export interface CampanaActionState {
  error?: string
  success?: string
}

const RUTA = '/superadmin/campanas'

async function soloSuperadmin() {
  const user = await getUser()
  if (!user || user.metadata.role !== 'SUPERADMIN') return null
  return user
}

/** Crea la campaña en BORRADOR con sus empresas participantes. */
export async function crearCampanaGlobal(
  _prev: CampanaActionState,
  formData: FormData
): Promise<CampanaActionState> {
  // Autorizar ANTES de abrir la transacción.
  const user = await soloSuperadmin()
  if (!user) return { error: 'Solo el superadmin puede crear campañas globales.' }

  try {
    return await sinEmpresa('superadmin: crear campaña conjunta', async (tx) => {
    const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 120)
    const tipo = String(formData.get('tipo') ?? '').trim() as CampanaTipo
    const descripcion = String(formData.get('descripcion') ?? '').trim().slice(0, 500)
    if (!nombre) return { error: 'Ponle un nombre a la campaña.' }
    if (formData.get('modo') !== 'CADENA' && !(CAMPANA_TIPOS as readonly string[]).includes(tipo)) {
      return { error: 'Elige qué se va a crear en cada empresa.' }
    }

    const modo = formData.get('modo') === 'CADENA' ? 'CADENA' : 'COPIA'
    const imagenUrl = String(formData.get('imagenUrl') ?? '').trim() || null

    // ── Campaña EN CADENA: cada empresa aporta un beneficio distinto ────────
    if (modo === 'CADENA') {
      // Los pasos llegan como arrays paralelos (paso_companyId[], paso_titulo[]…).
      const companies = formData.getAll('paso_companyId').map(String)
      const titulos = formData.getAll('paso_titulo').map((v) => String(v).trim())
      const descs = formData.getAll('paso_descripcion').map((v) => String(v).trim())
      const imgs = formData.getAll('paso_imagenUrl').map((v) => String(v).trim())
      const descuentos = formData.getAll('paso_descuento').map((v) => String(v).trim())
      const usos = formData.getAll('paso_usos').map((v) => String(v).trim())

      const pasos = companies
        .map((companyId, i) => ({
          companyId,
          orden: i + 1,
          titulo: titulos[i] || `Paso ${i + 1}`,
          descripcion: descs[i] || null,
          imagenUrl: imgs[i] || null,
          plantilla: {
            titulo: titulos[i] || `Paso ${i + 1}`,
            descripcion: descs[i] || '',
            tipo: 'general',
            descuento: Number(descuentos[i]) || null,
            imagenUrl: imgs[i] || imagenUrl,
            esComprable: false,
            usosPorCompra: Number(usos[i]) || 1,
          },
        }))
        .filter((p) => p.companyId)

      if (pasos.length < 2) {
        return {
          error:
            'Una campaña en cadena necesita al menos 2 empresas: el beneficio de la primera desbloquea el de la siguiente.',
        }
      }
      const empresasUnicas = new Set(pasos.map((p) => p.companyId))
      if (empresasUnicas.size !== pasos.length) {
        return { error: 'Cada empresa puede aparecer una sola vez en la cadena.' }
      }

      await tx.campanaGlobal.create({
        data: {
          nombre,
          tipo: 'PROMOCION',
          modo: 'CADENA',
          imagenUrl,
          descripcion: descripcion || null,
          plantilla: {},
          todasLasEmpresas: false,
          creadaPorId: user.metadata.dbUserId ?? null,
          participantes: { create: pasos.map((p) => ({ companyId: p.companyId })) },
          pasos: {
            create: pasos.map((p) => ({
              companyId: p.companyId,
              orden: p.orden,
              titulo: p.titulo,
              descripcion: p.descripcion,
              imagenUrl: p.imagenUrl,
              plantilla: p.plantilla,
            })),
          },
        },
        select: { id: true },
      })

      revalidatePath(RUTA)
      return {
        success: `Cadena creada en borrador con ${pasos.length} eslabones. Revísala y aplícala cuando estés listo.`,
      }
    }

    const todas = formData.get('todasLasEmpresas') === 'on'
    const elegidas = formData.getAll('empresas').map(String).filter(Boolean)

    // Empresas destino: todas las activas, o las marcadas a mano.
    //
    // «TODAS» NO INCLUYE LAS DE PRÁCTICA. Antes sí: una empresa de
    // entrenamiento recibía la oferta real como cualquier negocio, sin avisar.
    // Se pueden seguir eligiendo a mano —para eso está la lista—, pero hay que
    // pedirlas.
    const empresas = todas
      ? await tx.company.findMany({
          where: { isActive: true, esDemo: false },
          select: { id: true },
        })
      : await tx.company.findMany({
          where: { id: { in: elegidas } },
          select: { id: true },
        })
    if (empresas.length === 0) {
      return { error: 'Selecciona al menos una empresa participante.' }
    }

    // La plantilla se guarda tal cual la escribió el superadmin; `leerPlantilla`
    // la normaliza al aplicar, así que un campo vacío nunca rompe el reparto.
    const num = (k: string) => {
      const v = String(formData.get(k) ?? '').trim().replace(',', '.')
      if (!v) return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    const plantilla =
      tipo === 'PLAN'
        ? {
            nombre: String(formData.get('p_nombre') ?? '').trim() || nombre,
            precio: num('p_precio') ?? 0,
            lavadosIncluidos: num('p_lavados') ?? 0,
            esIlimitado: formData.get('p_ilimitado') === 'on',
            descripcion: String(formData.get('p_descripcion') ?? '').trim() || null,
            // Uno por línea, como en el formulario de plan de cada empresa.
            beneficios: String(formData.get('p_beneficios') ?? '')
              .split('\n')
              .map((b) => b.trim())
              .filter(Boolean),
            orden: num('p_orden') ?? 0,
            vigenciaDias: num('p_vigenciaDias') ?? 30,
            condiciones: String(formData.get('p_condiciones') ?? '').trim() || null,
          }
        : {
            titulo: String(formData.get('p_titulo') ?? '').trim() || nombre,
            descripcion: String(formData.get('p_descripcion') ?? '').trim(),
            tipo: String(formData.get('p_tipoPromo') ?? 'general').trim(),
            descuento: num('p_descuento'),
            imagenUrl: String(formData.get('p_imagenUrl') ?? '').trim() || null,
            vigenciaHasta: String(formData.get('p_vigenciaHasta') ?? '').trim() || null,
            esComprable: formData.get('p_comprable') === 'on',
            precio: num('p_precio'),
            usosPorCompra: num('p_usos') ?? 1,
          }

    await tx.campanaGlobal.create({
      data: {
        nombre,
        tipo,
        modo: 'COPIA',
        imagenUrl,
        descripcion: descripcion || null,
        plantilla,
        todasLasEmpresas: todas,
        creadaPorId: user.metadata.dbUserId ?? null,
        participantes: {
          create: empresas.map((e) => ({ companyId: e.id })),
        },
      },
      select: { id: true },
    })

    revalidatePath(RUTA)
    return {
      success: `Campaña creada en borrador con ${empresas.length} empresa${empresas.length !== 1 ? 's' : ''}. Revísala y aplícala cuando estés listo.`,
    }
    })
  } catch (e) {
    console.error('[campanas globales] crear:', e)
    return {
      error:
        'No se pudo crear. Si acabas de instalar esta versión, corre la migración 20260760_campanas_globales en la base de datos.',
    }
  }
}

/**
 * Reparte la campaña: crea la promoción o el plan en cada empresa que aún no
 * lo tenga. Idempotente y tolerante a fallos individuales.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA TRANSACCIÓN POR EMPRESA, NO UNA PARA TODAS
 *
 * El reparto entero corría dentro de un solo `sinEmpresa`. Con doscientas
 * empresas eso es una transacción larguísima sosteniendo una conexión del pool,
 * y si agotaba su tiempo se perdía TODO — incluidas las copias que ya se habían
 * creado bien. El módulo presume de que «un fallo no aborta el resto», y era
 * cierto para los errores de una empresa, pero no para el reloj.
 *
 * Ahora cada copia va en la suya: lo que se creó, creado queda. La marca en
 * `CampanaGlobalEmpresa` viaja en la MISMA transacción que la fila generada,
 * así que no puede existir una promoción sin su registro (que la duplicaría al
 * volver a aplicar) ni un registro sin promoción.
 *
 * LA AUTORIZACIÓN VA ANTES DE ABRIR NADA. Estaba dentro del `sinEmpresa`: se
 * tomaba una conexión del pool para averiguar después si quien llamaba podía.
 */
export async function aplicarCampanaGlobal(
  campanaId: string
): Promise<{ ok?: true; creadas?: number; fallos?: number; error?: string }> {
  const user = await soloSuperadmin()
  if (!user) return { error: 'Solo el superadmin puede aplicar campañas.' }

  try {
    const campana = await sinEmpresa('superadmin: campaña a repartir', (tx) =>
      tx.campanaGlobal.findUnique({
        where: { id: campanaId },
        select: { id: true, nombre: true, tipo: true, modo: true, estado: true, plantilla: true, imagenUrl: true, todasLasEmpresas: true },
      })
    )
    if (!campana) return { error: 'Campaña no encontrada.' }
    if (campana.estado === 'ARCHIVADA') {
      return { error: 'Esta campaña está archivada.' }
    }

    const userId = user.metadata.dbUserId ?? null
    let creadas = 0
    let fallos = 0

    // ── Cadena: cada eslabón genera SU promoción en SU empresa ─────────────
    if (campana.modo === 'CADENA') {
      const pasos = await sinEmpresa('superadmin: pasos pendientes de la cadena', (tx) =>
        tx.campanaPaso.findMany({
          where: { campanaId, aplicadaAt: null },
          orderBy: { orden: 'asc' },
        })
      )
      for (const paso of pasos) {
        try {
          const t = leerPlantilla('PROMOCION', paso.plantilla) as PlantillaPromocion
          await conEmpresa(paso.companyId, async (tx) => {
            const promo = await tx.promocion.create({
              data: {
                companyId: paso.companyId,
                titulo: paso.titulo || t.titulo,
                descripcion: paso.descripcion ?? t.descripcion,
                tipo: t.tipo,
                descuento: t.descuento ?? null,
                imagenUrl: paso.imagenUrl ?? t.imagenUrl ?? campana.imagenUrl,
                vigenciaHasta: t.vigenciaHasta ? new Date(t.vigenciaHasta) : null,
                esComprable: false,
                precio: null,
                usosPorCompra: t.usosPorCompra ?? 1,
                // Solo el PRIMER eslabón se ofrece al público: los siguientes
                // llegan al cliente por la cadena, no se toman por su cuenta.
                visibilidad: paso.orden === 1 ? 'publica' : 'privada',
                activo: true,
              },
              select: { id: true },
            })
            await tx.campanaPaso.update({
              where: { id: paso.id },
              data: { promocionId: promo.id, aplicadaAt: new Date(), error: null },
            })
            await tx.campanaGlobalEmpresa.updateMany({
              where: { campanaId, companyId: paso.companyId },
              data: { promocionId: promo.id, aplicadaAt: new Date(), error: null },
            })
            await auditarCopia(tx, {
              companyId: paso.companyId,
              userId,
              accion: 'PROMOCION_CREADA',
              entidadId: promo.id,
              campana: campana.nombre,
              campanaId,
            })
          })
          creadas++
        } catch (e) {
          fallos++
          console.error('[campanas globales] paso', paso.orden, e)
          await anotarError('campanaPaso', paso.id, e)
        }
      }
      await cerrarReparto(campanaId, campana, userId, creadas, fallos)
      return { ok: true, creadas, fallos }
    }

    const tipo = campana.tipo as CampanaTipo
    const plantilla = leerPlantilla(tipo, campana.plantilla)

    // Si es "todas las empresas", incorpora las que se hayan creado después.
    //
    // LAS DE PRÁCTICA QUEDAN FUERA salvo que se hayan elegido a mano. «Todas»
    // significaba literalmente todas las activas, así que una empresa de
    // entrenamiento recibía la oferta real como cualquier negocio — sin avisar,
    // y encima al VOLVER a aplicar, mucho después de crearla.
    if (campana.todasLasEmpresas) {
      await sinEmpresa('superadmin: incorporar empresas nuevas a la campaña', async (tx) => {
        const activas = await tx.company.findMany({
          where: { isActive: true, esDemo: false },
          select: { id: true },
        })
        const yaEstan = new Set(
          (
            await tx.campanaGlobalEmpresa.findMany({
              where: { campanaId },
              select: { companyId: true },
            })
          ).map((p) => p.companyId)
        )
        const nuevas = activas.filter((a) => !yaEstan.has(a.id))
        if (nuevas.length > 0) {
          await tx.campanaGlobalEmpresa.createMany({
            data: nuevas.map((n) => ({ campanaId, companyId: n.id })),
            skipDuplicates: true,
          })
        }
      })
    }

    const participantes = await sinEmpresa('superadmin: participantes pendientes', (tx) =>
      tx.campanaGlobalEmpresa.findMany({
        where: { campanaId, aplicadaAt: null },
        select: { id: true, companyId: true },
      })
    )

    for (const p of participantes) {
      try {
        await conEmpresa(p.companyId, async (tx) => {
          if (tipo === 'PLAN') {
            const t = plantilla as PlantillaPlan
            const plan = await tx.plan.create({
              data: {
                companyId: p.companyId,
                nombre: t.nombre,
                precio: t.precio,
                lavadosIncluidos: t.lavadosIncluidos,
                esIlimitado: t.esIlimitado ?? false,
                descripcion: t.descripcion,
                // La plantilla ya trae beneficios y orden: la copia nacía sin
                // ellos y quedaba al final de la vitrina, peor que un plan
                // creado a mano.
                beneficios: t.beneficios ?? [],
                orden: t.orden ?? 0,
                vigenciaDias: t.vigenciaDias ?? 30,
                condiciones: t.condiciones,
                activo: true,
              },
              select: { id: true },
            })
            await tx.campanaGlobalEmpresa.update({
              where: { id: p.id },
              data: { planId: plan.id, aplicadaAt: new Date(), error: null },
            })
            await auditarCopia(tx, {
              companyId: p.companyId,
              userId,
              accion: 'PLAN_CREADO',
              entidadId: plan.id,
              campana: campana.nombre,
              campanaId,
            })
          } else {
            const t = plantilla as PlantillaPromocion
            const promo = await tx.promocion.create({
              data: {
                companyId: p.companyId,
                titulo: t.titulo,
                descripcion: t.descripcion,
                tipo: t.tipo,
                descuento: t.descuento ?? null,
                imagenUrl: t.imagenUrl,
                vigenciaHasta: t.vigenciaHasta ? new Date(t.vigenciaHasta) : null,
                esComprable: t.esComprable ?? false,
                precio: t.esComprable ? (t.precio ?? 0) : null,
                usosPorCompra: t.usosPorCompra ?? 1,
                activo: true,
              },
              select: { id: true },
            })
            await tx.campanaGlobalEmpresa.update({
              where: { id: p.id },
              data: { promocionId: promo.id, aplicadaAt: new Date(), error: null },
            })
            await auditarCopia(tx, {
              companyId: p.companyId,
              userId,
              accion: 'PROMOCION_CREADA',
              entidadId: promo.id,
              campana: campana.nombre,
              campanaId,
            })
          }
        })
        creadas++
      } catch (e) {
        fallos++
        console.error('[campanas globales] aplicar a', p.companyId, e)
        await anotarError('campanaGlobalEmpresa', p.id, e)
      }
    }

    await cerrarReparto(campanaId, campana, userId, creadas, fallos)
    return { ok: true, creadas, fallos }
  } catch (e) {
    console.error('[campanas globales] aplicar:', e)
    return { error: 'No se pudo aplicar la campaña. Intenta de nuevo.' }
  }
}

/**
 * La línea de bitácora de UNA copia, dentro de la transacción que la creó.
 *
 * Aquí sí va junto al cambio, al revés que en `planActions`: allí la línea se
 * escribe aparte porque un enum sin migrar dejaría el catálogo de solo lectura.
 * Aquí el reparto es una operación explícita del superadmin que puede
 * reintentarse entera, y lo que no puede pasar es que exista una promoción en
 * la empresa de otro sin constancia de quién la puso ahí.
 */
async function auditarCopia(
  tx: Tx,
  d: {
    companyId: string
    userId: string | null
    accion: 'PLAN_CREADO' | 'PROMOCION_CREADA'
    entidadId: string
    campana: string
    campanaId: string
  }
) {
  await tx.auditLog.create({
    data: {
      companyId: d.companyId,
      userId: d.userId,
      accion: d.accion,
      entidadTipo: d.accion === 'PLAN_CREADO' ? 'Plan' : 'Promocion',
      entidadId: d.entidadId,
      // `origen` deja claro que no lo creó el negocio: apareció en su panel
      // porque la plataforma repartió una campaña.
      payload: { origen: 'CAMPANA_CONJUNTA', campana: d.campana, campanaId: d.campanaId },
    },
  })
}

/** Guarda el mensaje de error en la fila de la empresa (o del paso) que falló. */
async function anotarError(
  modelo: 'campanaPaso' | 'campanaGlobalEmpresa',
  id: string,
  e: unknown
) {
  const error = e instanceof Error ? e.message.slice(0, 300) : 'Error desconocido'
  await sinEmpresa('superadmin: anotar el fallo de un reparto', async (tx) => {
    if (modelo === 'campanaPaso') {
      await tx.campanaPaso.update({ where: { id }, data: { error } })
    } else {
      await tx.campanaGlobalEmpresa.update({ where: { id }, data: { error } })
    }
  }).catch(anotarFallo(`superadmin:${modelo}.update`))
}

/**
 * Cierra el reparto: estado según el RESULTADO y línea en la bitácora.
 *
 * El estado se escribía siempre como `APLICADA`, aunque hubieran fallado las
 * doce empresas. Y aplicar se auditaba como `NOTA_INTERNA` con un subtipo que
 * ni siquiera estaba en el mapa de etiquetas: salía en crudo y no se podía
 * filtrar. Ver `estadoTrasAplicar`.
 */
async function cerrarReparto(
  campanaId: string,
  campana: { nombre: string; estado: string },
  userId: string | null,
  creadas: number,
  fallos: number
) {
  const estado = estadoTrasAplicar(campana.estado, creadas, fallos)
  const meta = await getRequestMeta()
  await sinEmpresa('superadmin: cerrar el reparto de la campaña', async (tx) => {
    await tx.campanaGlobal.update({
      where: { id: campanaId },
      data: {
        estado,
        // La fecha solo se toca si de verdad salió algo: si no, seguiría
        // diciendo «aplicada el martes» sobre un reparto que no ocurrió.
        ...(creadas > 0 ? { aplicadaAt: new Date() } : {}),
      },
    })
    await tx.auditLog
      .create({
        data: {
          companyId: null,
          userId,
          accion: 'CAMPANA_APLICADA',
          entidadTipo: 'CampanaGlobal',
          entidadId: campanaId,
          payload: { campana: campana.nombre, creadas, fallos, estado },
          ...meta,
        },
      })
      .catch(anotarFallo('superadmin:auditLog.create'))
  })
  revalidatePath(RUTA)
  revalidatePath(`${RUTA}/${campanaId}`)
}

/**
 * Archiva la campaña y DESACTIVA lo que generó en cada empresa (no lo borra:
 * el historial de canjes y compras debe sobrevivir).
 */
export async function archivarCampanaGlobal(
  campanaId: string
): Promise<{ ok?: true; error?: string }> {
  // Autorizar ANTES de abrir la transacción: estaba dentro, así que una llamada
  // no autorizada tomaba una conexión del pool para averiguar después que no
  // podía.
  const user = await soloSuperadmin()
  if (!user) return { error: 'Solo el superadmin puede archivar campañas.' }

  try {
    return await sinEmpresa('superadmin: archivar campaña conjunta', async (tx) => {
    const campana = await tx.campanaGlobal.findUnique({
      where: { id: campanaId },
      select: { nombre: true },
    })
    if (!campana) return { error: 'Campaña no encontrada.' }

    const participantes = await tx.campanaGlobalEmpresa.findMany({
      where: { campanaId },
      select: { promocionId: true, planId: true },
    })
    const pasos = await tx.campanaPaso.findMany({
      where: { campanaId },
      select: { promocionId: true },
    })
    const promos = [
      ...participantes.map((p) => p.promocionId),
      ...pasos.map((p) => p.promocionId),
    ].filter((x): x is string => !!x)
    const planes = participantes.map((p) => p.planId).filter((x): x is string => !!x)

    if (promos.length > 0) {
      await tx.promocion
        .updateMany({ where: { id: { in: promos } }, data: { activo: false } })
        .catch((e) => console.error('[campanas globales] desactivar promos:', e))
    }
    if (planes.length > 0) {
      await tx.plan
        .updateMany({ where: { id: { in: planes } }, data: { activo: false } })
        .catch((e) => console.error('[campanas globales] desactivar planes:', e))
    }

    await tx.campanaGlobal.update({
      where: { id: campanaId },
      data: { estado: 'ARCHIVADA' },
    })

    const meta = await getRequestMeta()
    await tx.auditLog
      .create({
        data: {
          companyId: null,
          userId: user.metadata.dbUserId ?? null,
          // Era `NOTA_INTERNA` con `payload.tipo = 'CAMPANA_GLOBAL_ARCHIVADA'`,
          // un subtipo que no estaba en `SUBTIPO_LABEL`: la línea salía en
          // crudo y la acción no aparecía en el filtro de Auditoría. Archivar
          // apaga ofertas en TODAS las empresas participantes; tiene que poder
          // buscarse por su nombre.
          accion: 'CAMPANA_ARCHIVADA',
          entidadTipo: 'CampanaGlobal',
          entidadId: campanaId,
          payload: {
            campana: campana.nombre,
            promocionesDesactivadas: promos.length,
            planesDesactivados: planes.length,
          },
          ...meta,
        },
      })
      .catch(anotarFallo('superadmin:auditoria-campana'))

    revalidatePath(RUTA)
    revalidatePath(`${RUTA}/${campanaId}`)
    return { ok: true }
    })
  } catch (e) {
    console.error('[campanas globales] archivar:', e)
    return { error: 'No se pudo archivar la campaña.' }
  }
}

/**
 * EDITAR UNA CAMPAÑA EN BORRADOR.
 *
 * Solo había crear, aplicar y archivar: una errata en el nombre obligaba a
 * crear otra campaña desde cero y dejar la primera muerta en la lista.
 *
 * SOLO EN BORRADOR, y eso no es una limitación técnica: en cuanto se aplica hay
 * copias REALES en empresas ajenas. Cambiar la plantilla después no las
 * tocaría —cada negocio ya administra la suya— así que la campaña diría una
 * cosa y las empresas tendrían otra. Un formulario que parece corregir algo y
 * no corrige nada es peor que no tenerlo.
 *
 * Las empresas participantes tampoco se tocan aquí: quitarlas exige decidir qué
 * pasa con las copias, y en borrador todavía no hay ninguna que decidir.
 */
export async function editarCampanaBorrador(
  _prev: CampanaActionState,
  formData: FormData
): Promise<CampanaActionState> {
  const user = await soloSuperadmin()
  if (!user) return { error: 'Solo el superadmin puede editar campañas.' }

  const campanaId = String(formData.get('campanaId') ?? '').trim()
  const nombre = String(formData.get('nombre') ?? '').trim().slice(0, 120)
  const descripcion = String(formData.get('descripcion') ?? '').trim().slice(0, 500)
  if (!campanaId) return { error: 'Campaña no especificada.' }
  if (!nombre) return { error: 'Ponle un nombre a la campaña.' }

  try {
    return await sinEmpresa('superadmin: editar campaña conjunta en borrador', async (tx) => {
      const campana = await tx.campanaGlobal.findUnique({
        where: { id: campanaId },
        select: { estado: true },
      })
      if (!campana) return { error: 'Campaña no encontrada.' }
      // El servidor vuelve a comprobarlo: la pantalla oculta el formulario, y
      // una pantalla que oculta un campo no impide que se envíe desde otra
      // pestaña.
      if (campana.estado !== 'BORRADOR') {
        return {
          error:
            'Esta campaña ya se aplicó: las copias viven en cada empresa y se administran allí.',
        }
      }

      await tx.campanaGlobal.update({
        where: { id: campanaId },
        data: { nombre, descripcion: descripcion || null },
      })

      revalidatePath(RUTA)
      revalidatePath(`${RUTA}/${campanaId}`)
      return { success: 'Campaña actualizada.' }
    })
  } catch (e) {
    console.error('[campanas globales] editar:', e)
    return { error: 'No se pudo guardar. Intenta de nuevo.' }
  }
}
