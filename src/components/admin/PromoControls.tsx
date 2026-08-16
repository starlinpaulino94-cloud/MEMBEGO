'use client'

import { Pause, Play, Copy, Archive, ArchiveRestore } from 'lucide-react'
import {
  alternarPausaPromocion,
  duplicarPromocion,
  alternarArchivoPromocion,
  type PromocionState,
} from '@/modules/admin/promocionActions'
import { BotonConfirmado } from '@/components/ui/boton-confirmado'

const init: PromocionState = {}

/**
 * Pausar, duplicar y archivar una promoción.
 *
 * Los tres botones eran el mismo `ControlButton` local con su formulario, su
 * `useActionState`, su `useEffect` de toasts y su diálogo. Ahora lo pone
 * `BotonConfirmado`; aquí solo queda lo que de verdad cambia entre los tres.
 *
 * Solo archivar pregunta, y solo cuando se archiva —no al restaurar—: pausar y
 * duplicar se deshacen con otro clic, y preguntar por todo enseña a confirmar
 * sin leer.
 */
export function PromoControls({
  id,
  titulo,
  activo,
  archivada,
}: {
  id: string
  titulo: string
  activo: boolean
  archivada: boolean
}) {
  return (
    <div className="flex items-center">
      {!archivada && (
        <BotonConfirmado
          accion={alternarPausaPromocion}
          estadoInicial={init}
          campos={{ id }}
          size="icon"
          variant="ghost"
          ariaLabel={activo ? 'Pausar' : 'Reanudar'}
          mensajeExito={activo ? `"${titulo}" pausada.` : `"${titulo}" reanudada.`}
        >
          {activo ? (
            <Pause className="h-4 w-4 text-warning" aria-hidden />
          ) : (
            <Play className="h-4 w-4 text-success" aria-hidden />
          )}
        </BotonConfirmado>
      )}

      <BotonConfirmado
        accion={duplicarPromocion}
        estadoInicial={init}
        campos={{ id }}
        size="icon"
        variant="ghost"
        ariaLabel="Duplicar"
        mensajeExito={`Copia de "${titulo}" creada (pausada).`}
      >
        <Copy className="h-4 w-4 text-muted-foreground" aria-hidden />
      </BotonConfirmado>

      <BotonConfirmado
        accion={alternarArchivoPromocion}
        estadoInicial={init}
        campos={{ id }}
        size="icon"
        variant="ghost"
        ariaLabel={archivada ? 'Restaurar' : 'Archivar'}
        mensajeExito={archivada ? `"${titulo}" restaurada.` : `"${titulo}" archivada.`}
        confirmacion={
          archivada
            ? undefined
            : {
                titulo: `¿Archivar "${titulo}"?`,
                descripcion: 'Saldrá de todos los listados. Puedes restaurarla después.',
                textoConfirmar: 'Archivar',
              }
        }
      >
        {archivada ? (
          <ArchiveRestore className="h-4 w-4 text-info" aria-hidden />
        ) : (
          <Archive className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
      </BotonConfirmado>
    </div>
  )
}
