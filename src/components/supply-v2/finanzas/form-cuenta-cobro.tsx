'use client'

import { useActionState, useState } from 'react'
import { cambiarEstadoCuentaAction, crearCuentaCobroAction } from '@/modules/supply-v2/actions-cuentas'
import type { EstadoAccion } from '@/modules/supply-v2/actions-util'

const CAMPO = 'h-10 w-full rounded-[8px] border border-sv2-border bg-card px-3 text-[14px] leading-5 text-foreground placeholder:text-sv2-outline focus:border-sv2-accent focus:outline-none focus:ring-2 focus:ring-sv2-accent/15'
const ETIQUETA = 'text-[12px] font-semibold uppercase leading-4 tracking-wider text-sv2-ink-variant'

/**
 * Alta de una cuenta de cobro de Membego. «Activar» es una casilla aparte y
 * nace apagada: activar una cuenta enciende la venta en toda la plataforma, y
 * quien teclea un número de veinte dígitos quiere releerlo antes de que el
 * mundo empiece a transferir ahí.
 */
export function FormCuentaCobro() {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(crearCuentaCobroAction, {})
  const [tipo, setTipo] = useState('TRANSFERENCIA')

  return (
    <form action={accion} className="flex flex-col gap-3" data-testid="form-cuenta-cobro">
      <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={ETIQUETA}>Tipo</span>
          <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={CAMPO}>
            <option value="TRANSFERENCIA">Transferencia bancaria</option>
            <option value="PRESENCIAL">Pago presencial</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={ETIQUETA}>Nombre que ve el cliente</span>
          <input name="nombre" required maxLength={120} placeholder="Banco Popular · Membego SRL" className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ETIQUETA}>Titular</span>
          <input name="titular" maxLength={120} placeholder="Membego SRL" className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ETIQUETA}>Número de cuenta{tipo === 'TRANSFERENCIA' ? '' : ' (opcional)'}</span>
          <input name="numeroCuenta" maxLength={60} required={tipo === 'TRANSFERENCIA'} placeholder="000-0000000-0" className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ETIQUETA}>Tipo de cuenta</span>
          <input name="tipoCuenta" maxLength={40} placeholder="Corriente" className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ETIQUETA}>Moneda</span>
          <input name="moneda" maxLength={3} defaultValue="DOP" className={CAMPO} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className={ETIQUETA}>Instrucciones para el cliente (opcional)</span>
        <input name="instrucciones" maxLength={500} placeholder="Pon tu número de pedido en el concepto de la transferencia" className={CAMPO} />
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" name="activa" className="mt-1 size-4" />
        <span className="text-[13px] leading-[18px]">
          <strong>Activar ahora.</strong> En cuanto haya una cuenta activa, las ofertas de pago empiezan a publicarse. Déjalo sin marcar si quieres revisar el número antes.
        </span>
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pendiente} className="inline-flex h-10 items-center rounded-[8px] bg-sv2-accent px-4 text-[14px] font-semibold leading-5 text-white transition-colors hover:bg-sv2-accent-hover disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sv2-accent focus-visible:ring-offset-2">
          {pendiente ? 'Guardando…' : 'Dar de alta'}
        </button>
        {estado.error && <p className="text-[13px] leading-[18px] text-sv2-error" role="alert">{estado.error}</p>}
        {estado.success && <p className="text-[13px] leading-[18px] text-sv2-secondary" role="status">{estado.success}</p>}
      </div>
    </form>
  )
}

/** Enciende o apaga una cuenta ya existente. Nunca borra. */
export function BotonEstadoCuenta({ cuentaId, activa }: { cuentaId: string; activa: boolean }) {
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(cambiarEstadoCuentaAction, {})
  return (
    <form action={accion} className="flex flex-col gap-1">
      <input type="hidden" name="cuentaId" value={cuentaId} />
      <input type="hidden" name="activa" value={activa ? 'false' : 'true'} />
      <button type="submit" disabled={pendiente} className="inline-flex h-8 items-center justify-center rounded-[8px] bg-sv2-soft px-3 text-[13px] font-semibold leading-4 transition-colors hover:bg-sv2-soft-hover disabled:opacity-60">
        {pendiente ? '…' : activa ? 'Desactivar' : 'Activar'}
      </button>
      {estado.error && <span className="text-[12px] leading-4 text-sv2-error">{estado.error}</span>}
      {estado.success && <span className="text-[12px] leading-4 text-sv2-ink-variant">{estado.success}</span>}
    </form>
  )
}
