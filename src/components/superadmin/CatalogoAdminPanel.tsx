'use client'

import { useActionState } from 'react'
import {
  cambiarEstadoConectorAction,
  type ConnectAdminState,
} from '@/modules/connect/superadminActions'
import type { ConectorAdmin } from '@/modules/connect/superadmin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'
import { StatusBanner } from '@/components/ui/status-banner'

/**
 * El catálogo de conectores, con su adopción y su ciclo de vida.
 *
 * «Disponible» y «ACTIVE» son cosas distintas y la pantalla las separa: un
 * conector puede estar ACTIVE en la base y no ofrecerse a nadie porque su
 * configuración falta en este despliegue. Confundirlas llevaría a buscar el
 * fallo en la empresa cuando está en las variables de entorno.
 */

const INIT: ConnectAdminState = {}

const ESTADO = {
  DRAFT: { texto: 'Borrador', variante: 'secondary' },
  ACTIVE: { texto: 'Activo', variante: 'default' },
  SUSPENDED: { texto: 'Suspendido', variante: 'destructive' },
  RETIRED: { texto: 'Retirado', variante: 'outline' },
} as const

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

export function CatalogoAdminPanel({ conectores }: { conectores: ConectorAdmin[] }) {
  const activosSinConfig = conectores.filter((c) => c.estado === 'ACTIVE' && !c.disponible)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Catálogo de aplicaciones</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {activosSinConfig.length > 0 && (
          <StatusBanner variant="warning" title="Activos pero sin configurar en este despliegue">
            {activosSinConfig.map((c) => c.nombre).join(', ')} no se ofrecen a ninguna empresa
            porque faltan sus variables de entorno. No es un fallo de las empresas.
          </StatusBanner>
        )}

        {conectores.length === 0 ? (
          <p className="text-caption text-muted-foreground">
            El catálogo está vacío. Los conectores se siembran con una migración.
          </p>
        ) : (
          <ul className="space-y-2">
            {conectores.map((c) => {
              const e = ESTADO[c.estado as keyof typeof ESTADO] ?? ESTADO.DRAFT
              return (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border/60 px-3 py-2"
                >
                  <span className="font-medium">{c.nombre}</span>
                  <Badge variant={e.variante}>{e.texto}</Badge>
                  <Badge variant="secondary">{c.categoria}</Badge>
                  {!c.disponible && (
                    <span className="text-caption text-warning">Sin configurar aquí</span>
                  )}
                  <span className="text-caption text-muted-foreground">
                    {c.conexionesVivas} conectadas · {c.conexionesTotales} en total
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <Acciones conector={c} />
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
