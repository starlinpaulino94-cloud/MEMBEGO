import type { ConfigOauthConector } from '@/modules/connect/oauthNucleo'
import { GOOGLE_CALENDAR, oauthGoogleCalendar } from '@/modules/connect/proveedores/googleCalendar'
import { WHATSAPP } from '@/modules/connect/proveedores/whatsapp'
import { CARDNET } from '@/modules/connect/proveedores/cardnet'
import { METADATOS_IMPLEMENTADOS, METADATOS_PREVISTOS } from '@/modules/connect/proveedores/metadatos'
import type { DefinicionProveedor } from '@/modules/connect/proveedores/tipos'

/**
 * EL REGISTRO DE PROVEEDORES.
 *
 * Dar de alta uno nuevo = un archivo en esta carpeta, su metadata en
 * `metadatos.ts` y una línea aquí. No toca la interfaz, no toca las rutas, no
 * toca la base. Ése es el criterio con el que se mide si el framework sirve.
 *
 * Este módulo es PURO (sin `server-only`): las pruebas lo cargan entero.
 */

export const PROVEEDORES: readonly DefinicionProveedor[] = [GOOGLE_CALENDAR, WHATSAPP, CARDNET]

export function proveedorDe(slug: string): DefinicionProveedor | null {
  return PROVEEDORES.find((p) => p.metadatos.slug === slug) ?? null
}

/**
 * ¿Hay código detrás de este slug? Es la pregunta (1) de la regla de cinco
 * factores, y la que separa «Conectar» de «Próximamente».
 */
export function estaImplementado(slug: string): boolean {
  return proveedorDe(slug) !== null
}

/** Slugs que ESTE despliegue puede conectar de verdad (implementado + configurado). */
export function slugsDisponibles(): string[] {
  return PROVEEDORES.filter((p) => p.disponible()).map((p) => p.metadatos.slug)
}

/** Slugs que existen como código, configurados o no. */
export function slugsImplementados(): string[] {
  return PROVEEDORES.map((p) => p.metadatos.slug)
}

/** Los que Connect gestiona de punta a punta (excluye las ADAPTADAS). */
export function slugsNativos(): string[] {
  return PROVEEDORES.filter((p) => p.clase === 'NATIVA').map((p) => p.metadatos.slug)
}

/**
 * La configuración OAuth de un proveedor, o null si no la tiene o su app no
 * está dada de alta en este despliegue.
 */
export function oauthDe(slug: string): ConfigOauthConector | null {
  const p = proveedorDe(slug)
  if (!p || p.autorizacion.tipo !== 'OAUTH2' || !p.disponible()) return null
  if (slug === 'google-calendar') return oauthGoogleCalendar()
  return null
}

/**
 * Invariantes del registro, comprobadas por una prueba y no al importar: si
 * esto reventara al cargar, un descuido en un archivo de metadatos tumbaría
 * la aplicación entera en vez de una prueba.
 *
 * Devuelve la lista de problemas; vacía = registro sano.
 */
export function problemasDelRegistro(): string[] {
  const problemas: string[] = []

  const slugs = PROVEEDORES.map((p) => p.metadatos.slug)
  for (const s of slugs) {
    if (slugs.filter((x) => x === s).length > 1) problemas.push(`slug repetido: ${s}`)
  }

  // Todo lo declarado como implementado tiene definición, y al revés.
  for (const m of METADATOS_IMPLEMENTADOS) {
    if (!estaImplementado(m.slug)) problemas.push(`${m.slug}: metadata de implementado sin definición`)
  }
  for (const s of slugs) {
    if (!METADATOS_IMPLEMENTADOS.some((m) => m.slug === s)) {
      problemas.push(`${s}: definición sin metadata en METADATOS_IMPLEMENTADOS`)
    }
  }

  // Lo previsto NO puede tener código: si lo tuviera, dejaría de ser previsto
  // y aparecería como «Próximamente» algo que sí se puede conectar.
  for (const m of METADATOS_PREVISTOS) {
    if (estaImplementado(m.slug)) problemas.push(`${m.slug}: está en previstos y tiene definición`)
  }

  for (const p of PROVEEDORES) {
    if (p.clase === 'NATIVA' && p.pasos().length === 0) {
      problemas.push(`${p.metadatos.slug}: proveedor nativo sin pasos de alta`)
    }
    if (p.clase === 'ADAPTADA' && !p.rutaGestionExterna) {
      problemas.push(`${p.metadatos.slug}: proveedor adaptado sin ruta de gestión`)
    }
    if (p.capacidades.length === 0) {
      problemas.push(`${p.metadatos.slug}: sin capacidades declaradas`)
    }
    if (!p.disponible() && !p.queFalta) {
      problemas.push(`${p.metadatos.slug}: puede no estar disponible y no dice qué falta`)
    }
  }

  return problemas
}
