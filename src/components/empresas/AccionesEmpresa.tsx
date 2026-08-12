'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Eye, Mail, MoreHorizontal, Pause, Pencil, Phone, Play, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { toggleEmpresa, duplicarEmpresa, eliminarEmpresa } from '@/modules/empresas/actions'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/**
 * El menú de acciones de una empresa. LA ÚNICA ISLA DE CLIENTE del CRM.
 *
 * El resto de la pantalla —filtros, orden, paginación, tarjetas y tabla— pasó a
 * renderizarse en el servidor: el filtrado ya no necesita traerse todas las
 * empresas al navegador. Aquí sí hace falta JavaScript, porque hay que
 * confirmar un borrado y mostrar el resultado de acciones que mutan.
 *
 * Cada tarjeta trae el suyo, con su propio estado de confirmación. Antes el
 * diálogo vivía en el contenedor con un `deleteId` compartido; eso obligaba a
 * que el contenedor entero fuera de cliente por una acción que ocurre una vez
 * cada mucho.
 */
export function AccionesEmpresa({
  empresa,
}: {
  empresa: {
    id: string
    name: string
    isActive: boolean
    email: string | null
    telefono: string | null
  }
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirmar, setConfirmar] = useState(false)
  const [borrando, setBorrando] = useState(false)

  const correr = (fn: () => Promise<{ error?: string; message?: string }>) =>
    startTransition(async () => {
      const res = await fn()
      if (res.error) toast.error(res.error)
      else toast.success(res.message ?? 'Listo')
      router.refresh()
    })

  const borrar = async () => {
    setBorrando(true)
    const res = await eliminarEmpresa(empresa.id)
    setBorrando(false)
    setConfirmar(false)
    if (res.error) toast.error(res.error)
    else {
      toast.success(res.message ?? 'Empresa eliminada')
      router.refresh()
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={pending}
            aria-label={`Acciones de ${empresa.name}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => router.push(`/superadmin/empresas/${empresa.id}`)}>
            <Eye className="mr-2 h-4 w-4" /> Ver dashboard
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => router.push(`/superadmin/empresas/${empresa.id}/editar`)}
          >
            <Pencil className="mr-2 h-4 w-4" /> Editar
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => correr(() => duplicarEmpresa(empresa.id))}>
            <Copy className="mr-2 h-4 w-4" /> Duplicar
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => correr(() => toggleEmpresa(empresa.id, !empresa.isActive))}>
            {empresa.isActive ? (
              <>
                <Pause className="mr-2 h-4 w-4" /> Suspender
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" /> Activar
              </>
            )}
          </DropdownMenuItem>
          {/* Correo y WhatsApp NO aparecían nunca: la consulta del listado no
              seleccionaba `email` ni `telefono`, así que llegaban siempre
              `null`. Ahora se piden, y estas dos entradas existen de verdad. */}
          {empresa.email && (
            <DropdownMenuItem asChild>
              <a href={`mailto:${empresa.email}`}>
                <Mail className="mr-2 h-4 w-4" /> Enviar correo
              </a>
            </DropdownMenuItem>
          )}
          {empresa.telefono && (
            <DropdownMenuItem asChild>
              <a
                href={`https://wa.me/${empresa.telefono.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Phone className="mr-2 h-4 w-4" /> Enviar WhatsApp
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setConfirmar(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            {/* Con el nombre dentro: «¿Eliminar empresa?» a secas no distingue
                cuál, y este diálogo se abre desde una lista de tarjetas iguales. */}
            <AlertDialogTitle>¿Eliminar {empresa.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Solo se puede eliminar si no tiene clientes ni
              usuarios.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={borrar}
              disabled={borrando}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
