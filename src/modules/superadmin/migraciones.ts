import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'

/**
 * Aviso de MIGRACIONES PENDIENTES en el panel del superadmin.
 *
 * POR QUÉ EXISTE: las migraciones se corren A MANO en Supabase, y el código es
 * deliberadamente tolerante a que falten (fail-open) para no tumbar la app.
 * El efecto secundario es que una migración sin correr NO AVISA: en producción
 * faltó `companies.capacidades` y los módulos quedaron apagados en silencio
 * durante días, sin un solo error visible.
 *
 * `npm run db:doctor` ya detecta esto de forma exhaustiva, pero exige que
 * alguien se acuerde de correrlo. Esta comprobación es la red que avisa sola.
 *
 * MANTENIMIENTO: al agregar una migración manual que cree una tabla o columna
 * de la que dependa una función, añádela a `OBJETOS_ESPERADOS`. Para la
 * verificación completa (todo el esquema), sigue siendo `npm run db:doctor`.
 */

interface ObjetoEsperado {
  tabla: string
  /** null = se espera la TABLA completa; si no, la columna dentro de la tabla. */
  columna: string | null
  migracion: string
  /** Qué deja de funcionar si falta. */
  afecta: string
}

const OBJETOS_ESPERADOS: ObjetoEsperado[] = [
  {
    tabla: 'companies',
    columna: 'seguimientoConfig',
    migracion: '20260754_seguimiento_config',
    afecta: 'Configuración del seguimiento de recompensas',
  },
  {
    tabla: 'clientes',
    columna: 'canalOrigen',
    migracion: '20260755_canal_origen',
    afecta: 'Origen de clientes (de dónde llegan)',
  },
  {
    tabla: 'citas',
    columna: 'compraId',
    migracion: '20260756_cita_compra',
    afecta: 'Cita obligatoria antes de entregar el QR del regalo',
  },
  {
    tabla: 'promociones',
    columna: 'shareConfig',
    migracion: '20260757_promo_share_config',
    afecta: 'Textos editables al compartir una promoción',
  },
  {
    tabla: 'companies',
    columna: 'capacidades',
    migracion: '20260758_capacidades',
    afecta: 'Encender y apagar módulos por empresa',
  },
  {
    tabla: 'cola_vehiculos',
    columna: null,
    migracion: '20260759_e5_carwash',
    afecta: 'Cola de vehículos',
  },
  {
    tabla: 'productos_inventario',
    columna: null,
    migracion: '20260759_e5_carwash',
    afecta: 'Inventario',
  },
  {
    tabla: 'movimientos_inventario',
    columna: null,
    migracion: '20260759_e5_carwash',
    afecta: 'Movimientos de inventario',
  },
  {
    tabla: 'evidencias_foto',
    columna: null,
    migracion: '20260759_e5_carwash',
    afecta: 'Fotos antes/después',
  },
  {
    tabla: 'campanas_globales',
    columna: null,
    migracion: '20260760_campanas_globales',
    afecta: 'Campañas conjuntas entre empresas',
  },
  {
    tabla: 'campana_global_empresas',
    columna: null,
    migracion: '20260760_campanas_globales',
    afecta: 'Empresas participantes de las campañas conjuntas',
  },
  {
    tabla: 'campana_pasos',
    columna: null,
    migracion: '20260761_campanas_cadena',
    afecta: 'Campañas en cadena entre negocios (un beneficio desbloquea otro)',
  },
  {
    tabla: 'campana_inscripciones',
    columna: null,
    migracion: '20260761_campanas_cadena',
    afecta: 'Avance de los clientes dentro de una campaña en cadena',
  },
  {
    tabla: 'tipos_vehiculo',
    columna: null,
    migracion: '20260762_carwash_fase1',
    afecta: 'Catálogo de la pista: tipos de vehículo y precios por tipo',
  },
  {
    tabla: 'servicios',
    columna: null,
    migracion: '20260762_carwash_fase1',
    afecta: 'Servicios vendibles del car wash',
  },
  {
    tabla: 'bahias',
    columna: null,
    migracion: '20260762_carwash_fase1',
    afecta: 'Bahías y la cabina de pista',
  },
  {
    tabla: 'campanas_globales',
    columna: 'modo',
    migracion: '20260761_campanas_cadena',
    afecta: 'Modo e imagen de las campañas conjuntas',
  },
]

export interface MigracionPendiente {
  migracion: string
  /** Lo que falta, en lenguaje de negocio. */
  afecta: string[]
}

async function leerFaltantes(): Promise<MigracionPendiente[]> {
  // Una sola consulta a information_schema: barata y sin depender de Prisma
  // conociendo las columnas (que es justo lo que puede faltar).
  const tablas = [...new Set(OBJETOS_ESPERADOS.map((o) => o.tabla))]
  const filas = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY(${tablas})
  `

  const columnasPorTabla = new Map<string, Set<string>>()
  for (const f of filas) {
    if (!columnasPorTabla.has(f.table_name)) columnasPorTabla.set(f.table_name, new Set())
    columnasPorTabla.get(f.table_name)!.add(f.column_name)
  }

  const porMigracion = new Map<string, Set<string>>()
  for (const o of OBJETOS_ESPERADOS) {
    const cols = columnasPorTabla.get(o.tabla)
    const falta = o.columna === null ? !cols || cols.size === 0 : !cols?.has(o.columna)
    if (!falta) continue
    if (!porMigracion.has(o.migracion)) porMigracion.set(o.migracion, new Set())
    porMigracion.get(o.migracion)!.add(o.afecta)
  }

  return [...porMigracion.entries()]
    .map(([migracion, afecta]) => ({ migracion, afecta: [...afecta] }))
    .sort((a, b) => a.migracion.localeCompare(b.migracion))
}

/**
 * Migraciones manuales pendientes. Cacheado 10 minutos: es un aviso, no un
 * dato caliente. Ante cualquier error devuelve lista vacía — este chequeo
 * jamás debe impedir que el superadmin entre a su panel.
 */
export const getMigracionesPendientes = unstable_cache(
  async (): Promise<MigracionPendiente[]> => {
    try {
      return await leerFaltantes()
    } catch (e) {
      console.error('[migraciones] verificación:', e)
      return []
    }
  },
  ['migraciones-pendientes'],
  { revalidate: 600, tags: ['migraciones'] }
)
