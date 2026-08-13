'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Archive, Loader2, Send } from 'lucide-react'
import {
  aplicarCampanaGlobal,
  archivarCampanaGlobal,
} from '@/modules/superadmin/campanasActions'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { plural } from '@/lib/plural'

/**
 * Aplicar (repartir a las empresas) y archivar una campaña global.
 *
 * LAS DOS PIDEN CONFIRMACIÓN, y ahora con el diálogo del sistema en vez de
 * `window.confirm`. No es una preferencia estética: son las operaciones que más
 * filas escriben del panel —crean o apagan ofertas en N negocios ajenos— y su
 * texto hay que poder leerlo con calma. Un `confirm` del navegador aparece
 * pegado a la barra de direcciones, no se puede formatear y se descarta con
 * Enter sin haberlo leído.
 */
export function CampanaGlobalAcciones({
  campanaId,
  estado,
  pendientes,
}: {
  campanaId: string
  estado: string
  /** Empresas que aún no han recibido su copia. */
  pendientes: number
}) {
  const [pending, startTransition] = useTransition()
  const [confirmarAplicar, setConfirmarAplicar] = useState(false)
  const [confirmarArchivar, setConfirmarArchivar] = useState(false)

  function aplicar() {
    setConfirmarAplicar(false)
    startTransition(async () => {
      const res = await aplicarCampanaGlobal(campanaId)
      if (res.error) {
        toast.error(res.error)
        return
      }
      const creadas = res.creadas ?? 0
      const fallos = res.fallos ?? 0
      if (creadas === 0 && fallos > 0) {
        // El estado se queda en borrador: que el aviso diga lo mismo.
        toast.error(`No se creó ninguna copia: ${plural(fallos, 'empresa falló', 'empresas fallaron')}.`)
        return
      }
      const partes = [plural(creadas, 'copia creada', 'copias creadas')]
      if (fallos) partes.push(plural(fallos, 'con error', 'con error'))
      if (fallos) toast.warning(`Campaña aplicada a medias: ${partes.join(', ')}.`)
      else toast.success(`Campaña aplicada: ${partes.join(', ')}.`)
    })
  }

  function archivar() {
    setConfirmarArchivar(false)
    startTransition(async () => {
      const res = await archivarCampanaGlobal(campanaId)
      if (res.error) toast.error(res.error)
      else toast.success('Campaña archivada y desactivada en todas las empresas.')
    })
  }

  if (estado === 'ARCHIVADA') {
    return <span className="text-sm text-muted-foreground">Campaña archivada.</span>
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        onClick={() => setConfirmarAplicar(true)}
        disabled={pending}
        className="gap-1.5"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {estado === 'BORRADOR' ? 'Aplicar a las empresas' : 'Volver a aplicar'}
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setConfirmarArchivar(true)}
        disabled={pending}
        className="gap-1.5 text-muted-foreground hover:text-destructive"
      >
        <Archive className="h-4 w-4" /> Archivar
      </Button>

      <ConfirmDialog
        open={confirmarAplicar}
        title={
          pendientes === 0
            ? '¿Volver a revisar la campaña?'
            : `¿Crear la oferta en ${plural(pendientes, 'empresa', 'empresas')}?`
        }
        description={
          pendientes === 0
            ? 'Todas las empresas participantes ya recibieron su copia. Se buscarán empresas nuevas que hayan entrado desde entonces.'
            : 'Cada empresa recibirá su propia copia, visible para sus clientes de inmediato. Las que ya la tienen no se duplican.'
        }
        confirmText="Aplicar"
        isLoading={pending}
        onConfirm={aplicar}
        onCancel={() => setConfirmarAplicar(false)}
      />

      <ConfirmDialog
        open={confirmarArchivar}
        title="¿Archivar esta campaña?"
        description="Se desactivará la oferta en TODAS las empresas participantes. El historial de canjes y compras se conserva."
        confirmText="Archivar"
        isDangerous
        isLoading={pending}
        onConfirm={archivar}
        onCancel={() => setConfirmarArchivar(false)}
      />
    </div>
  )
}
