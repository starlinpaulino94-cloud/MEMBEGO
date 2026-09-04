'use client'

import { useActionState, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBanner } from '@/components/ui/status-banner'
import { Textarea } from '@/components/ui/textarea'
import {
  cambiarEtapaAction,
  convertirEnClienteAction,
  crearSeguimientoAction,
  guardarNotasAction,
  marcarSeguimientoHechoAction,
  type EstadoCrm,
} from '@/modules/crm/actions'
import { ETAPAS, ETIQUETA_ETAPA, TIPOS_SEGUIMIENTO } from '@/modules/crm/nucleo'

/**
 * Lo que el CRM hace en el navegador (Meta · Fase 6): cambiar la etapa,
 * convertir en cliente, guardar notas, registrar y cerrar seguimientos.
 * Cada acción termina en `router.refresh()`: las pantallas son de servidor.
 */

const INIT: EstadoCrm = {}
const SELECT = 'h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring'

function useRefresco(estado: EstadoCrm) {
  const router = useRouter()
  useEffect(() => {
    if (estado.hechoAt) router.refresh()
  }, [estado.hechoAt, router])
}

export function EtapaSelector({ prospectoId, etapa }: { prospectoId: string; etapa: string }) {
  const router = useRouter()
  const [pendiente, empezar] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <span className="inline-flex items-center gap-2">
      <select
        aria-label="Etapa"
        className={SELECT}
        value={etapa}
        disabled={pendiente}
        onChange={(e) => {
          const nueva = e.target.value
          empezar(async () => {
            const r = await cambiarEtapaAction(prospectoId, nueva)
            if (!r.ok) setError(r.error ?? 'No se pudo cambiar.')
            else {
              setError(null)
              router.refresh()
            }
          })
        }}
      >
        {ETAPAS.map((e) => (
          <option key={e} value={e}>
            {ETIQUETA_ETAPA[e]}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  )
}

export function ConvertirEnCliente({
  prospectoId,
  nombre,
  telefono,
}: {
  prospectoId: string
  nombre: string
  telefono: string | null
}) {
  const [estado, enviar, enviando] = useActionState(convertirEnClienteAction, INIT)
  useRefresco(estado)
  return (
    <form action={enviar} className="space-y-3 rounded-xl border border-border/60 p-4">
      <input type="hidden" name="prospectoId" value={prospectoId} />
      <h3 className="text-sm font-semibold">Convertir en cliente</h3>
      <p className="text-xs text-muted-foreground">
        Se crea su ficha en el directorio (o se enlaza a una que ya exista con el mismo teléfono o correo) y el
        prospecto queda cerrado.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <Input name="nombre" required defaultValue={nombre} placeholder="Nombre" aria-label="Nombre" />
        <Input name="telefono" defaultValue={telefono ?? ''} placeholder="Teléfono" aria-label="Teléfono" />
        <Input name="email" type="email" placeholder="Correo (opcional)" aria-label="Correo" />
      </div>
      {estado.error && (
        <StatusBanner variant="destructive" title="No se pudo convertir">
          {estado.error}
        </StatusBanner>
      )}
      {estado.success && (
        <StatusBanner variant="success" title="Listo">
          {estado.success}
        </StatusBanner>
      )}
      <Button type="submit" disabled={enviando}>
        {enviando ? 'Creando…' : 'Crear cliente'}
      </Button>
    </form>
  )
}

export function NotasProspecto({ prospectoId, notas }: { prospectoId: string; notas: string | null }) {
  const [estado, enviar, enviando] = useActionState(guardarNotasAction, INIT)
  useRefresco(estado)
  return (
    <form action={enviar} className="space-y-2">
      <input type="hidden" name="prospectoId" value={prospectoId} />
      <label className="block space-y-1">
        <span className="text-sm font-semibold">Notas</span>
        <Textarea name="notas" defaultValue={notas ?? ''} rows={4} maxLength={4000} placeholder="Qué busca, qué le ofreciste, qué acordaron…" />
      </label>
      {estado.error && <p className="text-xs text-destructive">{estado.error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" size="sm" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar notas'}
        </Button>
        {estado.success && <span className="text-xs text-muted-foreground">{estado.success}</span>}
      </div>
    </form>
  )
}

export function FormSeguimiento({
  prospectoId,
  prospectos,
}: {
  /** Fijo (ficha del prospecto) o a elegir (pantalla de seguimientos). */
  prospectoId?: string
  prospectos?: { id: string; etiqueta: string }[]
}) {
  const [estado, enviar, enviando] = useActionState(crearSeguimientoAction, INIT)
  useRefresco(estado)
  const sinProspectos = !prospectoId && (!prospectos || prospectos.length === 0)
  if (sinProspectos) return null
  return (
    <form key={estado.hechoAt ?? 0} action={enviar} className="space-y-3 rounded-xl border border-border/60 p-4">
      <h3 className="text-sm font-semibold">Nuevo seguimiento</h3>
      {prospectoId ? (
        <input type="hidden" name="prospectoId" value={prospectoId} />
      ) : (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Prospecto</span>
          <select name="prospectoId" required className={`${SELECT} w-full`} defaultValue="">
            <option value="" disabled>
              Elige un prospecto
            </option>
            {prospectos!.map((p) => (
              <option key={p.id} value={p.id}>
                {p.etiqueta}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Tipo</span>
          <select name="tipo" required className={`${SELECT} w-full`} defaultValue={TIPOS_SEGUIMIENTO[0]}>
            {TIPOS_SEGUIMIENTO.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Cuándo (opcional)</span>
          <Input name="programadoAt" type="datetime-local" />
        </label>
      </div>
      <Textarea name="nota" required rows={2} maxLength={2000} placeholder="Qué vas a hacer, o qué hiciste" aria-label="Nota" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="hecho" className="h-4 w-4" /> Ya está hecho
      </label>
      {estado.error && <p className="text-xs text-destructive">{estado.error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar seguimiento'}
        </Button>
        {estado.success && <span className="text-xs text-muted-foreground">{estado.success}</span>}
      </div>
    </form>
  )
}

export function MarcarHecho({ seguimientoId }: { seguimientoId: string }) {
  const router = useRouter()
  const [pendiente, empezar] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pendiente}
        onClick={() =>
          empezar(async () => {
            const r = await marcarSeguimientoHechoAction(seguimientoId)
            if (!r.ok) setError(r.error ?? 'No se pudo.')
            else router.refresh()
          })
        }
      >
        {pendiente ? '…' : 'Hecho'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  )
}
