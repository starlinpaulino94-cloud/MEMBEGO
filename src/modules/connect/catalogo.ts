import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { limiteDe } from '@/modules/connect/entitlements'
import { estadoAdaptado } from '@/modules/connect/proveedores/adaptadores'
import { METADATOS, metadatosDe } from '@/modules/connect/proveedores/metadatos'
import { proveedorDe } from '@/modules/connect/proveedores/indice'
import {
  ACCION_ESTADO,
  CATEGORIAS_INTEGRACION,
  ETIQUETA_ESTADO,
  decidirEstadoIntegracion,
  esClaseError,
  type CategoriaIntegracion,
  type ClaseProveedor,
  type EstadoIntegracion,
  type MarcaProveedor,
  type SenalesConexion,
} from '@/modules/connect/proveedores/tipos'

/**
 * EL ENSAMBLADOR DEL CATÁLOGO (Connect · Fase 10).
 *
 * Una sola función responde «¿qué ve esta empresa?», y de ella beben LAS TRES
 * superficies: la rejilla de /admin/integraciones, la página de detalle de
 * cada integración, y el componente que aparecerá dentro de Citas, Comunicación
 * o Automatizaciones.
 *
 * Que sea una sola es lo que garantiza la exigencia §19 del rediseño: es
 * imposible que un módulo diga «Conectar» sobre algo que el catálogo da por
 * conectado, porque no hay dos códigos que puedan responder distinto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS CINCO PREGUNTAS, Y DE DÓNDE SALE CADA UNA
 *
 *   1. IMPLEMENTADO   registro de proveedores (código)
 *   2. METADATOS      `proveedores/metadatos.ts`
 *   3. PUBLICADO      fila en `conectores`, estado ACTIVE — el superadmin
 *   4. DESPLIEGUE     `disponible()` del proveedor, que lee el entorno
 *   5. PLAN           entitlement `conexiones.max` de la empresa
 */

/** Cuánto tiempo después de un fallo se sigue considerando «degradada». */
const VENTANA_DEGRADADA_MS = 24 * 60 * 60 * 1000

export interface EntradaCatalogo {
  slug: string
  nombre: string
  descripcion: string
  categoria: CategoriaIntegracion
  categoriaLabel: string
  marca: MarcaProveedor
  /** Null cuando no hay implementación: es una entrada del roadmap. */
  clase: ClaseProveedor | null
  implementado: boolean
  estado: EstadoIntegracion
  /** El estado dicho para una persona. */
  etiqueta: string
  /** El texto del botón, o null cuando no hay acción posible. */
  accion: string | null
  /** A dónde lleva la tarjeta. Las adaptadas apuntan a su módulo de siempre. */
  ruta: string
  conexionId: string | null
  capacidades: readonly string[]
  /**
   * Una línea de contexto bajo el estado: qué falta, qué pasó, o qué cuenta
   * está conectada. Nunca un mensaje técnico del proveedor.
   */
  detalle: string | null
}

/** Fila mínima de conexión que necesita el ensamblador. */
interface FilaConexion {
  id: string
  estado: string
  claseError: string | null
  ultimoOkAt: Date | null
  ultimoErrorAt: Date | null
  conector: { slug: string }
}

/**
 * ¿Está CONNECTED pero fallando? Se mira si el último error es posterior al
 * último éxito y todavía está fresco: un fallo de hace un mes, con envíos
 * correctos después, no es un problema abierto.
 */
function estaDegradada(fila: FilaConexion, ahora: number): boolean {
  if (!fila.ultimoErrorAt) return false
  if (fila.ultimoOkAt && fila.ultimoOkAt.getTime() >= fila.ultimoErrorAt.getTime()) return false
  return ahora - fila.ultimoErrorAt.getTime() < VENTANA_DEGRADADA_MS
}

function senalesDe(fila: FilaConexion | undefined, ahora: number): SenalesConexion | null {
  if (!fila) return null
  const clase = fila.claseError && esClaseError(fila.claseError) ? fila.claseError : null
  return {
    estado: fila.estado as SenalesConexion['estado'],
    claseError: clase,
    degradada: estaDegradada(fila, ahora),
  }
}

/**
 * Qué contarle a la persona debajo del estado. Nunca sale de aquí un mensaje
 * del proveedor: los detalles técnicos van a la bitácora (§32 del rediseño).
 */
function detalleDe(
  estado: EstadoIntegracion,
  queFalta: string,
  detalleAdaptado: string | null
): string | null {
  if (detalleAdaptado) return detalleAdaptado
  switch (estado) {
    case 'PROXIMAMENTE':
      return 'Todavía no está disponible. Estamos trabajando en ella.'
    case 'NO_DISPONIBLE':
      return queFalta || 'Esta integración no está configurada en la plataforma.'
    case 'SIN_PLAN':
      return 'Alcanzaste el máximo de integraciones de tu plan. Escríbenos para ampliarlo.'
    case 'ALTA_SIN_TERMINAR':
      return 'Empezaste a configurarla y quedó a medias.'
    case 'REAUTORIZAR':
      return 'El permiso caducó o fue retirado. Hay que volver a autorizar la cuenta.'
    case 'CON_PROBLEMAS':
      return 'No pudimos usarla la última vez que lo intentamos.'
    case 'REQUIERE_ATENCION':
      return 'Está conectada, pero algo falló recientemente.'
    default:
      return null
  }
}

/**
 * EL CATÁLOGO DE UNA EMPRESA.
 *
 * Devuelve TODO lo que esa empresa puede ver, disponible o prevista, en un
 * solo vocabulario. Ordenar y separar (disponibles arriba, previstas abajo) es
 * cosa de la pantalla; aquí se decide la verdad, no la presentación.
 */
export async function catalogoDeEmpresa(companyId: string): Promise<EntradaCatalogo[]> {
  const ahora = Date.now()

  const [filasCatalogo, conexiones, maxConexiones] = await Promise.all([
    sinEmpresa('connect: catálogo global de conectores (sin datos de empresa)', (tx) =>
      tx.conector.findMany({ select: { slug: true, estado: true } })
    ),
    conEmpresa(companyId, (tx) =>
      tx.conexionEmpresa.findMany({
        where: { companyId },
        select: {
          id: true,
          estado: true,
          claseError: true,
          ultimoOkAt: true,
          ultimoErrorAt: true,
          conector: { select: { slug: true } },
        },
      })
    ),
    limiteDe(companyId, 'conexiones.max'),
  ])

  const publicados = new Map(filasCatalogo.map((f) => [f.slug, f.estado]))
  const porSlug = new Map(conexiones.map((c) => [c.conector.slug, c as FilaConexion]))

  // El límite del plan se mide sobre las conexiones VIVAS: una desconectada no
  // ocupa plaza, o desconectar dejaría a la empresa sin poder volver a probar.
  const vivas = conexiones.filter((c) => c.estado !== 'DISCONNECTED').length
  const hayCupo = maxConexiones === null || vivas < maxConexiones

  const entradas: EntradaCatalogo[] = []

  for (const meta of METADATOS) {
    const estadoFila = publicados.get(meta.slug)
    const conexion = porSlug.get(meta.slug)
    const tieneConexionViva = Boolean(conexion && conexion.estado !== 'DISCONNECTED')

    // VISIBILIDAD, y la manda el superadmin (decisión 1 del rediseño):
    //   sin fila           → no existe para nadie
    //   DRAFT / RETIRED    → oculta
    //   SUSPENDED          → oculta, SALVO que la empresa ya la tenga conectada:
    //                        esconderle una conexión viva le dejaría un token
    //                        activo que no puede ni ver ni apagar.
    if (!estadoFila) continue
    if (estadoFila === 'DRAFT' || estadoFila === 'RETIRED') continue
    if (estadoFila === 'SUSPENDED' && !tieneConexionViva) continue

    const proveedor = proveedorDe(meta.slug)
    const implementado = proveedor !== null

    let estado: EstadoIntegracion
    let detalleAdaptado: string | null = null

    if (proveedor?.clase === 'ADAPTADA') {
      // Su verdad vive en otro subsistema: se lee, no se replica.
      const adaptado = await estadoAdaptado(meta.slug, companyId)
      estado = adaptado?.estado ?? 'NO_DISPONIBLE'
      detalleAdaptado = adaptado?.detalle ?? null
    } else {
      estado = decidirEstadoIntegracion({
        implementado,
        publicado: estadoFila === 'ACTIVE',
        configuradoEnDespliegue: proveedor?.disponible() ?? false,
        permitidoPorPlan: hayCupo,
        conexion: senalesDe(conexion, ahora),
      })
    }

    entradas.push({
      slug: meta.slug,
      nombre: meta.nombre,
      descripcion: meta.descripcion,
      categoria: meta.categoria,
      categoriaLabel: CATEGORIAS_INTEGRACION[meta.categoria],
      marca: meta.marca,
      clase: proveedor?.clase ?? null,
      implementado,
      estado,
      etiqueta: ETIQUETA_ESTADO[estado],
      accion: ACCION_ESTADO[estado],
      ruta:
        proveedor?.clase === 'ADAPTADA' && proveedor.rutaGestionExterna
          ? proveedor.rutaGestionExterna
          : `/admin/integraciones/${meta.slug}`,
      conexionId: conexion?.id ?? null,
      capacidades: proveedor?.capacidades ?? [],
      detalle: detalleDe(estado, proveedor?.queFalta ?? '', detalleAdaptado),
    })
  }

  return entradas
}

/**
 * UNA entrada. La usan la página de detalle y —desde la Fase 13— el componente
 * que aparece dentro de otros módulos. Pasa por el mismo ensamblador a
 * propósito: una segunda ruta de cálculo sería una segunda verdad.
 */
export async function entradaDeCatalogo(
  companyId: string,
  slug: string
): Promise<EntradaCatalogo | null> {
  if (!metadatosDe(slug)) return null
  const todas = await catalogoDeEmpresa(companyId)
  return todas.find((e) => e.slug === slug) ?? null
}
