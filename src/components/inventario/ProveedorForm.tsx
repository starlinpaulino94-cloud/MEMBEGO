'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { actualizarProveedor, cambiarActivoProveedor, crearProveedor } from '@/modules/inventory/actions'
import { MAX_CORREO_PROVEEDOR, MAX_CONTACTO_PROVEEDOR, MAX_DIAS_CREDITO, MAX_NOMBRE_PROVEEDOR, MAX_NOTAS_PROVEEDOR, MAX_RNC_PROVEEDOR, MAX_TELEFONO_PROVEEDOR } from '@/modules/inventory/compras'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface ProveedorEditable {
  id: string
  nombre: string
  rnc: string | null
  contacto: string | null
  telefono: string | null
  correo: string | null
  diasCredito: number
  notas: string | null
  activo: boolean
}

/**
 * Crear un proveedor, o editar uno. Solo el nombre es obligatorio. El servidor vuelve a validar todo (el nombre no se
 * repite sin importar las mayúsculas). Un proveedor no se borra: se desactiva, y deja de recibir pedidos nuevos sin
 * perder su historial.
 */
export function ProveedorForm({ proveedor }: { proveedor?: ProveedorEditable }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [nombre, setNombre] = useState(proveedor?.nombre ?? '')
  const [rnc, setRnc] = useState(proveedor?.rnc ?? '')
  const [contacto, setContacto] = useState(proveedor?.contacto ?? '')
  const [telefono, setTelefono] = useState(proveedor?.telefono ?? '')
  const [correo, setCorreo] = useState(proveedor?.correo ?? '')
  const [dias, setDias] = useState(String(proveedor?.diasCredito ?? 0))
  const [notas, setNotas] = useState(proveedor?.notas ?? '')
  const editando = Boolean(proveedor)

  function guardar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (nombre.trim() === '') {
      toast.error('Escribe el nombre del proveedor.')
      return
    }
    if (!/^\d{1,3}$/.test(dias.trim()) || Number(dias) > MAX_DIAS_CREDITO) {
      toast.error(`Los días de crédito son un número entero de 0 a ${MAX_DIAS_CREDITO} (0 = de contado).`)
      return
    }
    const datos = { nombre, rnc, contacto, telefono, correo, diasCredito: Number(dias), notas }
    start(async () => {
      const r = proveedor ? await actualizarProveedor({ proveedorId: proveedor.id, datos }) : await crearProveedor(datos)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(editando ? `Proveedor «${r.nombre}» actualizado.` : `Proveedor «${r.nombre}» creado.`)
      if (!editando) {
        setNombre('')
        setRnc('')
        setContacto('')
        setTelefono('')
        setCorreo('')
        setDias('0')
        setNotas('')
      }
      router.refresh()
    })
  }

  function cambiarActivo() {
    if (!proveedor) return
    start(async () => {
      const r = await cambiarActivoProveedor({ proveedorId: proveedor.id, activo: !proveedor.activo })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(r.activo ? `«${r.nombre}» está activo otra vez.` : `«${r.nombre}» quedó desactivado: ya no recibe pedidos nuevos.`)
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{editando ? 'Datos del proveedor' : 'Nuevo proveedor'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={guardar} className="space-y-4" aria-label={editando ? 'Editar proveedor' : 'Nuevo proveedor'}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`pv-nombre-${proveedor?.id ?? 'nuevo'}`}>Nombre *</Label>
              <Input id={`pv-nombre-${proveedor?.id ?? 'nuevo'}`} value={nombre} maxLength={MAX_NOMBRE_PROVEEDOR} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Distribuidora Norte" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`pv-rnc-${proveedor?.id ?? 'nuevo'}`}>RNC o documento (opcional)</Label>
              <Input id={`pv-rnc-${proveedor?.id ?? 'nuevo'}`} value={rnc} maxLength={MAX_RNC_PROVEEDOR} onChange={(e) => setRnc(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`pv-contacto-${proveedor?.id ?? 'nuevo'}`}>Contacto (opcional)</Label>
              <Input id={`pv-contacto-${proveedor?.id ?? 'nuevo'}`} value={contacto} maxLength={MAX_CONTACTO_PROVEEDOR} onChange={(e) => setContacto(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`pv-telefono-${proveedor?.id ?? 'nuevo'}`}>Teléfono (opcional)</Label>
              <Input id={`pv-telefono-${proveedor?.id ?? 'nuevo'}`} value={telefono} maxLength={MAX_TELEFONO_PROVEEDOR} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`pv-correo-${proveedor?.id ?? 'nuevo'}`}>Correo (opcional)</Label>
              <Input id={`pv-correo-${proveedor?.id ?? 'nuevo'}`} type="email" value={correo} maxLength={MAX_CORREO_PROVEEDOR} onChange={(e) => setCorreo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`pv-dias-${proveedor?.id ?? 'nuevo'}`}>Días de crédito (0 = de contado)</Label>
              <Input id={`pv-dias-${proveedor?.id ?? 'nuevo'}`} inputMode="numeric" autoComplete="off" value={dias} onChange={(e) => setDias(e.target.value)} className="w-28" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`pv-notas-${proveedor?.id ?? 'nuevo'}`}>Notas (opcional)</Label>
            <Input id={`pv-notas-${proveedor?.id ?? 'nuevo'}`} value={notas} maxLength={MAX_NOTAS_PROVEEDOR} onChange={(e) => setNotas(e.target.value)} placeholder="Ej: entrega los martes y jueves" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              {editando ? 'Guardar cambios' : 'Crear proveedor'}
            </Button>
            {proveedor && (
              <Button type="button" variant="outline" onClick={cambiarActivo} disabled={pending}>
                {proveedor.activo ? 'Desactivar proveedor' : 'Reactivar proveedor'}
              </Button>
            )}
          </div>
          {proveedor && !proveedor.activo && <p className="text-xs text-muted-foreground">Está desactivado: no se le pueden hacer pedidos nuevos ni agregarle productos, pero sus órdenes en curso se siguen recibiendo.</p>}
        </form>
      </CardContent>
    </Card>
  )
}
