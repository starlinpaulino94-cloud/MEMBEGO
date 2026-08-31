'use client'

import { toast } from 'sonner'
import { formatDateTime } from '@/lib/format'
import { RotateCcw, Trash2 } from 'lucide-react'
import {
  descartarMuertoAction,
  reencolarMuertoAction,
  type DifuntoState,
} from '@/modules/jobs/panelActions'
import type { DifuntoPanel, SaludCola } from '@/modules/jobs/muertos'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'
import { StatusBanner } from '@/components/ui/status-banner'

/**
 * Salud del procesamiento asíncrono + trabajos difuntos (Connect · Fase 2).
 *
 * Cuatro números y una lista. Los números son la vista que faltaba: cada pieza
 * de la cola guardaba su estado, pero ninguna pantalla los sumaba, y una cola
 * enferma se descubría consultando la base a mano. La lista son los trabajos
 * que QStash se rindió a entregar — reencolar o descartar es una DECISIÓN, por
 * eso van con `BotonConfirmado` y quedan en la bitácora de auditoría.
 */

const INIT: DifuntoState = {}

/** Cómo se lee cada tipo de trabajo en el panel. */
const TIPO_LABEL: Record<string, string> = {
  notificar: 'Notificaciones',
  automatizaciones: 'Automatizaciones',
  email: 'Correo',
  'evento-estrategia': 'Evento del bus',
  'recompensas-referido': 'Recompensas de referido',
  'campana-dirigida': 'Campaña dirigida',
}

function Numerito({ label, valor, malo }: { label: string; valor: number; malo?: boolean }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
      <p className={`text-lg font-semibold ${valor > 0 && malo ? 'text-destructive' : ''}`}>
        {valor}
      </p>
      <p className="text-caption text-muted-foreground">{label}</p>
    </div>
  )
}

function DifuntoFila({ difunto }: { difunto: DifuntoPanel }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border/60 px-3 py-2">
      <Badge variant="secondary">{TIPO_LABEL[difunto.tipo] ?? difunto.tipo}</Badge>
      <span className="text-caption text-muted-foreground">
        {formatDateTime(difunto.createdAt)}
        {difunto.empresa ? ` · ${difunto.empresa}` : ''}
        {` · ${difunto.intentos} intento${difunto.intentos === 1 ? '' : 's'}`}
      </span>
      {difunto.error && (
        <span className="w-full font-mono text-caption text-muted-foreground">{difunto.error}</span>
      )}
      <span className="ml-auto flex items-center gap-2">
        <BotonConfirmado
          accion={reencolarMuertoAction}
          estadoInicial={INIT}
          campos={{ id: difunto.id }}
          variant="outline"
          size="sm"
          confirmacion={{
            titulo: '¿Reencolar este trabajo?',
            descripcion:
              'Se vuelve a ejecutar con sus efectos reales (notificaciones, correos). Si la causa del fallo sigue ahí, volverá a morir y reaparecerá aquí.',
            textoConfirmar: 'Reencolar',
          }}
          alExito={(e) => toast.success(e.success ?? 'Devuelto a la cola.')}
        >
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
          Reencolar
        </BotonConfirmado>
        <BotonConfirmado
          accion={descartarMuertoAction}
          estadoInicial={INIT}
          campos={{ id: difunto.id }}
          variant="ghost"
          size="sm"
          confirmacion={{
            titulo: '¿Descartar este trabajo?',
            descripcion:
              'No se volverá a ejecutar nunca. La decisión queda en la bitácora de auditoría.',
            textoConfirmar: 'Descartar',
            peligrosa: true,
          }}
          mensajeExito="Descartado. No se volverá a ejecutar."
        >
          <Trash2 className="mr-2 h-4 w-4" aria-hidden />
          Descartar
        </BotonConfirmado>
      </span>
    </li>
  )
}

export function ColaTrabajosCard({
  salud,
  difuntos,
}: {
  salud: SaludCola
  difuntos: DifuntoPanel[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cola de trabajos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Numerito label="Trabajos difuntos" valor={salud.trabajosMuertos} malo />
          <Numerito label="Webhooks en reintento" valor={salud.webhooksPendientes} />
          <Numerito label="Webhooks agotados" valor={salud.webhooksMuertos} malo />
          <Numerito label="Eventos estancados" valor={salud.eventosEstancados} malo />
        </div>

        {difuntos.length > 0 ? (
          <>
            <StatusBanner variant="warning" title="Trabajos que la cola no consiguió ejecutar">
              QStash los reintentó y se rindió. No se pierden: la carga completa está guardada.
              Reencolar los vuelve a intentar; descartar renuncia a ellos para siempre.
            </StatusBanner>
            <ul className="space-y-2">
              {difuntos.map((d) => (
                <DifuntoFila key={d.id} difunto={d} />
              ))}
            </ul>
          </>
        ) : (
          <p className="text-caption text-muted-foreground">
            Ningún trabajo difunto pendiente. Los que agoten sus reintentos aparecerán aquí para
            reencolarlos o descartarlos.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
