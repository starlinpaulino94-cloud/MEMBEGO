'use client'

import { useActionState, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { BUCKET_COMPROBANTES } from '@/modules/storage/tipos'
import { pedirSubidaComprobante } from '@/modules/storage/comprobantes'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  adjuntarComprobanteAction,
  cancelarPedidoAction,
  type EstadoAccion,
} from '@/modules/supply/actions'
import { TEXTO_ESTADO_PEDIDO, type EstadoPedido } from '@/modules/supply/cobro-nucleo'

export interface PedidoVista {
  id: string
  numero: string
  estado: EstadoPedido
  producto: string
  monto: number
  motivoRechazo: string | null
  expiraAt: string
}

export interface CuentaVista {
  id: string
  nombre: string
  titular: string | null
  numeroCuenta: string | null
  tipoCuenta: string | null
  instrucciones: string | null
}

/**
 * MEMBEGO SUPPLY · lo que el cliente ve de su compra (Fases 22-23).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA PANTALLA TIENE QUE DEJAR CLARÍSIMO
 *
 * Que todavía NO tiene el beneficio. Ha apartado una unidad y tiene un plazo.
 *
 * Es el punto donde una compra por transferencia se rompe de verdad: la persona
 * pulsa «Comprar», ve una pantalla amable, y se va convencida de que ya está.
 * Vuelve tres días después, el pedido expiró y la culpa parece del sitio. Por eso
 * aquí se dice el estado con palabras, se enseña la hora límite, y el botón que
 * queda pendiente es el de enviar el comprobante — no un «listo».
 */
export function MisPedidos({
  pedidos,
  cuentas,
  clienteId,
}: {
  pedidos: PedidoVista[]
  cuentas: CuentaVista[]
  clienteId: string
}) {
  if (pedidos.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="text-h3 font-semibold">Mis pedidos</h2>
      {pedidos.map((p) => (
        <Pedido key={p.id} pedido={p} cuentas={cuentas} clienteId={clienteId} />
      ))}
    </section>
  )
}

function Pedido({
  pedido,
  cuentas,
  clienteId,
}: {
  pedido: PedidoVista
  cuentas: CuentaVista[]
  clienteId: string
}) {
  const [envio, enviar, enviando] = useActionState<EstadoAccion, FormData>(
    adjuntarComprobanteAction,
    {}
  )
  const [cancel, cancelar, cancelando] = useActionState<EstadoAccion, FormData>(
    cancelarPedidoAction,
    {}
  )

  const [ruta, setRuta] = useState('')
  const [nombreArchivo, setNombreArchivo] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const archivoRef = useRef<HTMLInputElement>(null)

  /**
   * Sube el archivo al bucket PRIVADO y se queda con la ruta.
   *
   * La ruta y el permiso los decide el SERVIDOR: el navegador solo dice qué
   * extensión trae y recibe un token que sirve para esa ruta y para ninguna
   * otra. El archivo no pasa por la server action —las server actions tienen un
   * tope de tamaño y una foto de un comprobante lo roza— sino directo al bucket
   * con ese token.
   */
  async function subir(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    // Tope de comodidad para el usuario, no una defensa: el navegador es del
    // atacante. El límite de verdad lo impone el bucket.
    if (file.size > 5 * 1024 * 1024) {
      toast.error('El archivo pasa de 5 MB. Sube una foto más liviana.')
      return
    }

    setSubiendo(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const permiso = await pedirSubidaComprobante('pedido', pedido.id, ext)
      if (permiso.error || !permiso.subida) {
        toast.error(permiso.error ?? 'No se pudo preparar la subida.')
        return
      }

      const { error } = await createClient()
        .storage.from(BUCKET_COMPROBANTES)
        .uploadToSignedUrl(permiso.subida.path, permiso.subida.token, file)
      if (error) throw error

      setRuta(permiso.subida.path)
      setNombreArchivo(file.name)
      toast.success('Comprobante adjuntado. Ahora pulsa «Enviar comprobante».')
    } catch (err) {
      console.error('[supply-pedido] subida de comprobante:', err)
      toast.error('No se pudo subir el archivo. Intenta de nuevo.')
    } finally {
      setSubiendo(false)
    }
  }

  const esperandoComprobante = pedido.estado === 'INICIADO' && !envio.success
  const limite = new Intl.DateTimeFormat('es-DO', {
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(pedido.expiraAt))

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-semibold">{pedido.producto}</p>
            <p className="text-caption text-muted-foreground">Pedido {pedido.numero}</p>
          </div>
          <Badge variant={pedido.estado === 'PAGADO' ? 'success' : 'secondary'}>
            {TEXTO_ESTADO_PEDIDO[pedido.estado]}
          </Badge>
        </div>

        <p className="text-h3 font-semibold">RD${pedido.monto.toLocaleString('es-DO')}</p>

        {pedido.motivoRechazo && (
          <p className="rounded-lg bg-destructive/10 p-3 text-caption">{pedido.motivoRechazo}</p>
        )}

        {esperandoComprobante && (
          <>
            <p className="text-caption text-muted-foreground">
              Apartamos tu unidad hasta el <strong>{limite}</strong>. Transfiere el monto exacto y
              envíanos el comprobante: hasta entonces el beneficio no se puede usar.
            </p>

            {cuentas.length > 0 && (
              <div className="space-y-2 rounded-lg bg-muted/50 p-3">
                {cuentas.map((c) => (
                  <div key={c.id} className="text-caption">
                    <p className="font-medium">{c.nombre}</p>
                    {c.titular && <p className="text-muted-foreground">Titular: {c.titular}</p>}
                    {c.numeroCuenta && (
                      <p className="text-muted-foreground">
                        Cuenta: {c.numeroCuenta}
                        {c.tipoCuenta ? ` (${c.tipoCuenta})` : ''}
                      </p>
                    )}
                    {c.instrucciones && <p className="text-muted-foreground">{c.instrucciones}</p>}
                  </div>
                ))}
              </div>
            )}

            <form action={enviar} className="space-y-2">
              <input type="hidden" name="pedidoId" value={pedido.id} />
              <input type="hidden" name="clienteId" value={clienteId} />
              {/* La RUTA que devolvió el servidor, no un enlace que teclee
                  nadie. Sin archivo subido no hay ruta, y sin ruta el botón de
                  enviar no se habilita. */}
              <input type="hidden" name="comprobantePath" value={ruta} />

              <input
                ref={archivoRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={subir}
                className="hidden"
              />
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={subiendo}
                onClick={() => archivoRef.current?.click()}
              >
                {subiendo
                  ? 'Subiendo…'
                  : ruta
                    ? `Cambiar archivo (${nombreArchivo})`
                    : 'Adjuntar foto o PDF del comprobante'}
              </Button>

              <input
                name="nota"
                maxLength={500}
                placeholder="Nota (opcional): banco, hora de la transferencia…"
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-body"
              />
              <Button type="submit" className="w-full" disabled={enviando || !ruta}>
                {enviando ? 'Enviando…' : 'Enviar comprobante'}
              </Button>
            </form>

            <form action={cancelar}>
              <input type="hidden" name="pedidoId" value={pedido.id} />
              <input type="hidden" name="clienteId" value={clienteId} />
              <Button type="submit" variant="ghost" size="sm" disabled={cancelando}>
                {cancelando ? 'Cancelando…' : 'Cancelar pedido'}
              </Button>
            </form>
          </>
        )}

        {envio.success && <p className="text-caption text-success">{envio.success}</p>}
        {envio.error && <p className="text-caption text-destructive">{envio.error}</p>}
        {cancel.error && <p className="text-caption text-destructive">{cancel.error}</p>}
      </CardContent>
    </Card>
  )
}
