'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useActionState } from 'react'
import { CirclePlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  cambiarEstadoConectorAction,
  type ConnectAdminState,
} from '@/modules/connect/superadminActions'
import type { ConectorAdmin } from '@/modules/connect/superadmin'
import { metadatosDe } from '@/modules/connect/proveedores/metadatos'
import {
  CATEGORIAS_INTEGRACION,
  type CategoriaIntegracion,
} from '@/modules/connect/proveedores/tipos'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'
import { StatusBanner } from '@/components/ui/status-banner'
import { LogoIntegracion } from '@/components/connect/LogoIntegracion'

/**
 * El catálogo de conectores, con su adopción y su ciclo de vida (rediseño
 * «hub»: como tarjetas).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRES FILAS QUE NO SE MEZCLAN
 *
 * «Disponible» y «ACTIVE» son cosas distintas y cada tarjeta las separa en
 * filas: IMPLEMENTACIÓN (¿hay código?), CONFIGURACIÓN (¿este despliegue tiene
 * sus variables?) y PUBLICACIÓN (¿el superadmin lo ofrece?). Un conector puede
 * estar ACTIVE en la base y no ofrecerse a nadie porque su configuración falta
 * aquí. Confundirlas llevaría a buscar el fallo en la empresa cuando está en
 * las variables de entorno.
 *
 * Los valores van en monoespaciada, como en la referencia: son hechos del
 * sistema, no frases, y así se distinguen de las etiquetas a su izquierda.
 */

const INIT: ConnectAdminState = {}

const ESTADO = {
  DRAFT: { texto: 'Borrador', tono: 'neutro' },
  ACTIVE: { texto: 'Activo', tono: 'ok' },
  SUSPENDED: { texto: 'Suspendido', tono: 'malo' },
  RETIRED: { texto: 'Retirado', tono: 'neutro' },
} as const

type Tono = 'ok' | 'aviso' | 'malo' | 'neutro' | 'marca'

const PUNTO: Record<Tono, string> = {
  ok: 'bg-success',
  aviso: 'bg-warning',
  malo: 'bg-destructive',
  neutro: 'bg-muted-foreground',
  marca: 'bg-primary',
}

function Fila({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono: Tono }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-caption text-muted-foreground">{etiqueta}</span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', PUNTO[tono])} />
        <span
          className={cn(
            'font-mono text-caption',
            tono === 'neutro' ? 'text-muted-foreground' : 'text-foreground'
          )}
        >
          {valor}
        </span>
      </span>
    </div>
  )
}

function Acciones({ conector }: { conector: ConectorAdmin }) {
  const [estado] = useActionState(cambiarEstadoConectorAction, INIT)
  const siguiente = conector.estado === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'

  return (
    <>
      <BotonConfirmado
        accion={cambiarEstadoConectorAction}
        estadoInicial={INIT}
        campos={{ id: conector.id, estado: siguiente }}
        variant="outline"
        size="sm"
        className="w-full"
        confirmacion={
          siguiente === 'SUSPENDED'
            ? {
                titulo: `¿Suspender ${conector.nombre}?`,
                descripcion:
                  'Deja de ofrecerse a nuevas empresas. Las que ya lo tienen conectado conservan sus credenciales y su historial.',
                textoConfirmar: 'Suspender',
                peligrosa: true,
              }
            : undefined
        }
        mensajeExito={siguiente === 'ACTIVE' ? 'Conector activado.' : 'Conector suspendido.'}
      >
        {siguiente === 'ACTIVE' ? 'Activar' : 'Suspender'}
      </BotonConfirmado>
      {estado.error && <span className="text-caption text-destructive">{estado.error}</span>}
    </>
  )
}

function etiquetaCategoria(categoria: string): string {
  return (CATEGORIAS_INTEGRACION as Record<string, string>)[categoria as CategoriaIntegracion] ?? categoria
}

function TarjetaConector({ conector: c }: { conector: ConectorAdmin }) {
  const meta = metadatosDe(c.slug)
  const publicacion = ESTADO[c.estado as keyof typeof ESTADO] ?? ESTADO.DRAFT

  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card elevation-1 transition-all duration-fast hover:border-primary/40 hover:elevation-2">
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center gap-3">
          {meta ? (
            <LogoIntegracion slug={c.slug} nombre={c.nombre} marca={meta.marca} />
          ) : (
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-base font-black text-muted-foreground"
            >
              {c.nombre.trim().charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-h4 font-semibold">{c.nombre}</p>
            <p className="truncate text-caption text-muted-foreground">
              {etiquetaCategoria(c.categoria)}
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <Fila
            etiqueta="Implementación"
            valor={
              c.implementado ? (c.authTipo === 'OAUTH2' ? 'OAuth 2.0' : 'Clave de API') : 'Prevista'
            }
            tono={c.implementado ? 'marca' : 'neutro'}
          />
          <Fila
            etiqueta="Configuración"
            valor={!c.implementado ? '—' : c.disponible ? 'Configurada' : 'Sin configurar aquí'}
            tono={!c.implementado ? 'neutro' : c.disponible ? 'ok' : 'aviso'}
          />
          <Fila etiqueta="Publicación" valor={publicacion.texto} tono={publicacion.tono} />
        </div>

        <p className="mt-5 text-caption text-muted-foreground">
          {c.conexionesVivas} conectadas · {c.conexionesTotales} en total
          {!c.implementado && ' · si la publicas, se ve como «Próximamente»'}
        </p>
      </div>

      <div className="flex flex-col gap-1 border-t border-border/60 bg-card p-4">
        <Acciones conector={c} />
      </div>
    </li>
  )
}

export function CatalogoAdminPanel({
  conectores,
  conFiltros = false,
  enlaceCatalogo = false,
}: {
  conectores: ConectorAdmin[]
  /** Píldoras de categoría encima de la rejilla (pantalla de catálogo). */
  conFiltros?: boolean
  /** Una tarjeta punteada al final que lleva al catálogo (resumen). */
  enlaceCatalogo?: boolean
}) {
  const [categoria, setCategoria] = useState<string | null>(null)

  // Solo avisa de lo IMPLEMENTADO y sin configurar: una integración prevista
  // se publica a propósito sin código detrás, para que las empresas la vean
  // como «Próximamente». Meterlas en este aviso sería una alarma falsa
  // permanente de once líneas.
  const activosSinConfig = conectores.filter(
    (c) => c.estado === 'ACTIVE' && c.implementado && !c.disponible
  )

  const categorias = useMemo(() => {
    const vistas = new Map<string, string>()
    for (const c of conectores) vistas.set(c.categoria, etiquetaCategoria(c.categoria))
    return [...vistas].sort((a, b) => a[1].localeCompare(b[1], 'es'))
  }, [conectores])

  const visibles = categoria ? conectores.filter((c) => c.categoria === categoria) : conectores

  return (
    <div className="space-y-4">
      {activosSinConfig.length > 0 && (
        <StatusBanner variant="warning" title="Activos pero sin configurar en este despliegue">
          {activosSinConfig.map((c) => c.nombre).join(', ')} no se ofrecen a ninguna empresa
          porque faltan sus variables de entorno. No es un fallo de las empresas.
        </StatusBanner>
      )}

      {conFiltros && categorias.length > 0 && (
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {[[null, 'Todos'] as const, ...categorias].map(([clave, etiqueta]) => (
            <button
              key={clave ?? 'todos'}
              type="button"
              aria-pressed={categoria === clave}
              onClick={() => setCategoria(clave)}
              className={cn(
                'shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium outline-none transition-colors duration-fast focus-visible:ring-2 focus-visible:ring-ring',
                categoria === clave
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {etiqueta}
            </button>
          ))}
        </div>
      )}

      {conectores.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          El catálogo está vacío. Los conectores se siembran con una migración.
        </p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibles.map((c) => (
            <TarjetaConector key={c.id} conector={c} />
          ))}
          {enlaceCatalogo && (
            <li>
              <Link
                href="/superadmin/connect?seccion=catalogo"
                className="flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-sm font-semibold text-muted-foreground outline-none transition-colors duration-fast hover:border-primary/40 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CirclePlus className="h-7 w-7" aria-hidden />
                Explorar catálogo
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
