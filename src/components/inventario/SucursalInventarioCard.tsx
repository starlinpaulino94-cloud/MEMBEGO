'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  ajustarInventario,
  contarInventario,
  fijarUmbralInventario,
  registrarDanoInventario,
  registrarDevolucionInventario,
  registrarEntradaInventario,
  resolverDanadoInventario,
} from '@/modules/inventory/actions'
import { BADGE_ESTADO_STOCK, ETIQUETA_ESTADO_STOCK, OPERACIONES, formatearCantidad, type OperacionManual } from '@/modules/inventory/formato'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { nuevaClave } from './clave'

export interface SaldoSucursalVista {
  sucursalId: string
  nombre: string
  activa: boolean
  onHand: number
  reserved: number
  damaged: number
  disponible: number
  lowStockThreshold: number
  estado: 'AGOTADO' | 'BAJO' | 'OK'
}

function Cifra({ etiqueta, valor, fuerte = false }: { etiqueta: string; valor: number; fuerte?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className={fuerte ? 'text-2xl font-semibold tabular-nums' : 'text-lg tabular-nums'}>{formatearCantidad(valor)}</p>
    </div>
  )
}

/**
 * Las existencias de una variante en UNA sucursal, con el formulario de
 * movimientos manuales y el umbral de stock bajo. El estado de cada formulario
 * vive aquí; lo que hay en la base se refresca con `router.refresh()`.
 */
export function SucursalInventarioCard({ varianteId, saldo, puedeAjustar }: { varianteId: string; saldo: SaldoSucursalVista; puedeAjustar: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [operacion, setOperacion] = useState<OperacionManual>('ENTRADA')
  // Cantidad y motivo son estado controlado: `form.reset()` devolvería el <select>
  // (también controlado) a su primera opción sin avisar a React.
  const [cantidad, setCantidad] = useState('')
  const [motivo, setMotivo] = useState('')
  const clave = useRef(nuevaClave())
  const k = saldo.sucursalId

  const def = OPERACIONES.find((o) => o.valor === operacion) ?? OPERACIONES[0]
  const disponibles = OPERACIONES.filter((o) => !o.soloConDanados || saldo.damaged > 0)

  function registrar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const numero = Number(cantidad.trim())
    if (cantidad.trim() === '' || !Number.isInteger(numero) || (operacion === 'CONTEO' ? numero < 0 : numero < 1)) {
      toast.error(operacion === 'CONTEO' ? 'Escribe cuántas unidades contaste (0 o más).' : 'Escribe una cantidad entera de 1 en adelante.')
      return
    }
    const base = { varianteId, sucursalId: saldo.sucursalId, motivo, clave: clave.current }
    start(async () => {
      let r: { ok: true; mensaje: string } | { ok: false; error: string }
      switch (operacion) {
        case 'ENTRADA': {
          const x = await registrarEntradaInventario({ ...base, cantidad: numero })
          r = x.ok ? { ok: true, mensaje: `Entrada registrada. Disponible: ${formatearCantidad(x.saldo.disponible)}.` } : x
          break
        }
        case 'DEVOLUCION': {
          const x = await registrarDevolucionInventario({ ...base, cantidad: numero })
          r = x.ok ? { ok: true, mensaje: `Devolución registrada. Disponible: ${formatearCantidad(x.saldo.disponible)}.` } : x
          break
        }
        case 'AJUSTE_SOBRANTE':
        case 'AJUSTE_FALTANTE': {
          const x = await ajustarInventario({ ...base, cambio: operacion === 'AJUSTE_SOBRANTE' ? numero : -numero })
          r = x.ok ? { ok: true, mensaje: `Ajuste registrado. Disponible: ${formatearCantidad(x.saldo.disponible)}.` } : x
          break
        }
        case 'CONTEO': {
          const x = await contarInventario({ varianteId, sucursalId: saldo.sucursalId, conteo: numero, motivo })
          r = x.ok
            ? { ok: true, mensaje: x.diferencia === 0 ? 'El conteo coincide con el sistema: no hubo cambios.' : `Conteo registrado (${x.diferencia > 0 ? '+' : '−'}${formatearCantidad(Math.abs(x.diferencia))}).` }
            : x
          break
        }
        case 'DANO': {
          const x = await registrarDanoInventario({ ...base, cantidad: numero })
          r = x.ok ? { ok: true, mensaje: `Daño registrado. Dañado: ${formatearCantidad(x.saldo.damaged)}.` } : x
          break
        }
        case 'DANADO_VENDIBLE':
        case 'DANADO_BAJA': {
          const x = await resolverDanadoInventario({ ...base, cantidad: numero, destino: operacion === 'DANADO_VENDIBLE' ? 'VENDIBLE' : 'BAJA' })
          r = x.ok ? { ok: true, mensaje: `Listo. Dañado: ${formatearCantidad(x.saldo.damaged)}.` } : x
          break
        }
      }
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(r.mensaje)
      clave.current = nuevaClave()
      setCantidad('')
      setMotivo('')
      router.refresh()
    })
  }

  function guardarUmbral(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const umbral = Number(String(f.get('umbral') ?? '').trim())
    if (!Number.isInteger(umbral) || umbral < 0) {
      toast.error('El umbral es un número entero, 0 o más.')
      return
    }
    start(async () => {
      const r = await fijarUmbralInventario({ varianteId, sucursalId: saldo.sucursalId, umbral })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(r.umbral === 0 ? 'Sin aviso de stock bajo.' : `Te avisaremos cuando queden ${formatearCantidad(r.umbral)} o menos.`)
      router.refresh()
    })
  }

  return (
    <Card data-sucursal={saldo.nombre}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">
          {saldo.nombre}
          {!saldo.activa && <span className="ml-2 text-xs font-normal text-muted-foreground">(sucursal desactivada)</span>}
        </CardTitle>
        <Badge variant={BADGE_ESTADO_STOCK[saldo.estado]}>{ETIQUETA_ESTADO_STOCK[saldo.estado]}</Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" aria-label={`Existencias en ${saldo.nombre}`}>
          <Cifra etiqueta="Disponible" valor={saldo.disponible} fuerte />
          <Cifra etiqueta="Apartado" valor={saldo.reserved} />
          <Cifra etiqueta="Dañado" valor={saldo.damaged} />
          <Cifra etiqueta="En existencia" valor={saldo.onHand} />
        </div>

        {puedeAjustar ? (
          <>
            <form onSubmit={registrar} className="space-y-3 border-t pt-4" aria-label={`Registrar movimiento en ${saldo.nombre}`}>
              <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
                <div className="space-y-1.5">
                  <Label htmlFor={`op-${k}`}>Movimiento</Label>
                  <select
                    id={`op-${k}`}
                    value={operacion}
                    onChange={(e) => setOperacion(e.target.value as OperacionManual)}
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  >
                    {disponibles.map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.etiqueta}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`cant-${k}`}>{def.campo}</Label>
                  <Input id={`cant-${k}`} name="cantidad" inputMode="numeric" autoComplete="off" required value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{def.ayuda}</p>
              <div className="space-y-1.5">
                <Label htmlFor={`motivo-${k}`}>{def.motivoObligatorio ? 'Motivo *' : 'Motivo (opcional)'}</Label>
                <Input id={`motivo-${k}`} name="motivo" maxLength={300} required={def.motivoObligatorio} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={def.motivoObligatorio ? 'Qué pasó' : 'Ej: factura 123 del proveedor'} />
              </div>
              <Button type="submit" size="sm" disabled={pending}>
                {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Registrar
              </Button>
            </form>

            <form onSubmit={guardarUmbral} className="flex flex-wrap items-end gap-3 border-t pt-4" aria-label={`Umbral de stock bajo en ${saldo.nombre}`}>
              <div className="space-y-1.5">
                <Label htmlFor={`umbral-${k}`}>Avisar cuando queden</Label>
                <Input id={`umbral-${k}`} name="umbral" inputMode="numeric" defaultValue={saldo.lowStockThreshold} className="w-32" />
              </div>
              <Button type="submit" size="sm" variant="outline" disabled={pending}>
                Guardar umbral
              </Button>
              <p className="basis-full text-xs text-muted-foreground">0 = sin aviso. Cuenta lo disponible (sin lo apartado).</p>
            </form>
          </>
        ) : (
          <p className="border-t pt-4 text-sm text-muted-foreground">No tienes permiso para mover existencias.</p>
        )}
      </CardContent>
    </Card>
  )
}
