'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  cambiarEstadoCuentaAction,
  crearCuentaCobroAction,
  type EstadoAccion,
} from '@/modules/supply/actions'

const CAMPO = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-body'

/**
 * Alta de una cuenta de cobro de Membego.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ «ACTIVAR» ES UNA CASILLA APARTE, Y NACE APAGADA
 *
 * Porque activar una cuenta es lo que enciende la venta de supply en toda la
 * plataforma: en cuanto hay una activa, la vitrina publica los precios.
 *
 * Quien teclea un número de cuenta de veinte dígitos quiere releerlo antes de
 * que el mundo empiece a transferir ahí. Guardar y publicar son dos decisiones,
 * y el formulario las pregunta por separado en vez de asumir la segunda.
 */
export function FormCuentaCobro() {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(
    crearCuentaCobroAction,
    {}
  )
  const [tipo, setTipo] = useState('TRANSFERENCIA')

  return (
    <form action={accion} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-caption text-muted-foreground">Tipo</span>
          <select
            name="tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className={CAMPO}
          >
            <option value="TRANSFERENCIA">Transferencia bancaria</option>
            <option value="PRESENCIAL">Pago presencial</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-caption text-muted-foreground">Nombre que ve el cliente</span>
          <input
            name="nombre"
            required
            maxLength={120}
            placeholder="Banco Popular · Membego SRL"
            className={CAMPO}
          />
        </label>

        <label className="space-y-1">
          <span className="text-caption text-muted-foreground">Titular</span>
          <input name="titular" maxLength={120} placeholder="Membego SRL" className={CAMPO} />
        </label>

        <label className="space-y-1">
          <span className="text-caption text-muted-foreground">
            Número de cuenta{tipo === 'TRANSFERENCIA' ? '' : ' (opcional)'}
          </span>
          <input
            name="numeroCuenta"
            maxLength={60}
            required={tipo === 'TRANSFERENCIA'}
            placeholder="000-0000000-0"
            className={CAMPO}
          />
        </label>

        <label className="space-y-1">
          <span className="text-caption text-muted-foreground">Tipo de cuenta</span>
          <input name="tipoCuenta" maxLength={40} placeholder="Corriente" className={CAMPO} />
        </label>

        <label className="space-y-1">
          <span className="text-caption text-muted-foreground">Moneda</span>
          <input name="moneda" maxLength={3} defaultValue="DOP" className={CAMPO} />
        </label>
      </div>

      <label className="space-y-1 block">
        <span className="text-caption text-muted-foreground">
          Instrucciones para el cliente (opcional)
        </span>
        <input
          name="instrucciones"
          maxLength={500}
          placeholder="Pon tu número de pedido en el concepto de la transferencia"
          className={CAMPO}
        />
      </label>

      <label className="flex items-start gap-2">
        <input type="checkbox" name="activa" className="mt-1 size-4" />
        <span className="text-caption">
          <strong>Activar ahora.</strong> En cuanto haya una cuenta activa, la vitrina empieza a
          publicar las ofertas de pago. Déjalo sin marcar si quieres revisar el número antes.
        </span>
      </label>

      <Button type="submit" disabled={pendiente}>
        {pendiente ? 'Guardando…' : 'Dar de alta'}
      </Button>

      {estado.error && <p className="text-caption text-destructive">{estado.error}</p>}
      {estado.success && <p className="text-caption text-success">{estado.success}</p>}
    </form>
  )
}

/** Enciende o apaga una cuenta ya existente. Nunca borra: ver `cobro.ts`. */
export function BotonEstadoCuenta({ cuentaId, activa }: { cuentaId: string; activa: boolean }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(
    cambiarEstadoCuentaAction,
    {}
  )

  return (
    <form action={accion} className="flex flex-col gap-1">
      <input type="hidden" name="cuentaId" value={cuentaId} />
      <input type="hidden" name="activa" value={activa ? 'false' : 'true'} />
      <Button type="submit" size="sm" variant="secondary" disabled={pendiente}>
        {pendiente ? '…' : activa ? 'Desactivar' : 'Activar'}
      </Button>
      {estado.error && <span className="text-caption text-destructive">{estado.error}</span>}
      {estado.success && <span className="text-caption">{estado.success}</span>}
    </form>
  )
}
