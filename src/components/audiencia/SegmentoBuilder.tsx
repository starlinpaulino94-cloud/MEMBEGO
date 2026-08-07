'use client'

import { useActionState, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2, X, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import {
  CAMPOS_SEGMENTACION,
  VALORES_MEMBRESIA,
  ETIQUETA_MEMBRESIA,
  etiquetaOperador,
  campoDef,
  type CampoDefinicion,
} from '@/modules/geo/segmentacion/campos'
import {
  crearSegmentoAction,
  actualizarSegmentoAction,
  estimarAudienciaAction,
  type ActionState,
} from '@/modules/geo/segmentacion/actions'
import type { Estimacion } from '@/modules/geo/segmentacion/estimador'

/**
 * CONSTRUCTOR VISUAL DE SEGMENTOS (docs/GEOLOCALIZACION.md §10.1).
 * Filas de condición en lenguaje natural + grupos AND/OR/NOT + vista previa
 * en vivo con el AudienceEstimator. Los valores salen de catálogos reales que
 * la página (server) le pasa por props.
 */

export interface CondicionUI {
  campo: string
  operador: string
  valor: unknown
}

export interface GrupoUI {
  operador: string
  condiciones: CondicionUI[]
  grupos: GrupoUI[]
}

export interface RaizUI {
  operador: string
  condiciones: CondicionUI[]
  grupos: GrupoUI[]
}

interface Opciones {
  ciudades: { id: string; label: string }[]
  sectores: { id: string; label: string }[]
  tiposVehiculo: { id: string; label: string }[]
  sucursales: { id: string; label: string; radioServicioKm: number }[]
}

interface Props {
  segmentoId?: string
  initial?: RaizUI
  initialNombre?: string
  initialDescripcion?: string
  opciones: Opciones
}

const estadoInicial: RaizUI = { operador: 'AND', condiciones: [], grupos: [] }

export function operadorPorDefecto(def: CampoDefinicion): string {
  return def.operadores.includes('in') ? 'in' : def.operadores[0]
}

export function valorPorDefecto(def: CampoDefinicion): unknown {
  switch (def.tipo) {
    case 'bool':
      return true
    case 'radio':
      return { sucursalId: '', km: 3 }
    case 'numero':
      return 30
    case 'fecha':
      return ''
    case 'mes':
      return 1
    default:
      return ''
  }
}

export default function SegmentoBuilder({
  segmentoId,
  initial,
  initialNombre,
  initialDescripcion,
  opciones,
}: Props) {
  const router = useRouter()
  const action = segmentoId ? actualizarSegmentoAction : crearSegmentoAction
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {})
  const [raiz, setRaiz] = useState<RaizUI>(initial ?? estadoInicial)
  const [nombre, setNombre] = useState(initialNombre ?? '')
  const [descripcion, setDescripcion] = useState(initialDescripcion ?? '')
  const [preview, setPreview] = useState<{ error?: string; estimacion?: Estimacion } | null>(null)
  const [estimando, setEstimando] = useState(false)

  function onFormAction(formData: FormData) {
    formData.set('nombre', nombre)
    formData.set('descripcion', descripcion)
    formData.set('raiz', JSON.stringify(raiz))
    formAction(formData)
  }

  async function estimar() {
    setEstimando(true)
    setPreview(null)
    const fd = new FormData()
    fd.set('raiz', JSON.stringify(raiz))
    const res = await estimarAudienciaAction({}, fd)
    setEstimando(false)
    if (res.error) {
      setPreview({ error: res.error })
      return
    }
    setPreview({ estimacion: res.estimacion })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <form action={onFormAction} className="space-y-6">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div>
                <Label htmlFor="nombre">Nombre del segmento</Label>
                <Input
                  id="nombre"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej. Clientes de Punta Cana"
                  maxLength={80}
                />
              </div>
              <div>
                <Label htmlFor="descripcion">Descripción (opcional)</Label>
                <Textarea
                  id="descripcion"
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Para qué se usa este segmento"
                  rows={2}
                  maxLength={300}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold">Condiciones</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Clientes que cumplan: se combinan con el operador de la raíz.
              </p>

              <GrupoEditor
                nivel={0}
                grupo={raiz}
                esRaiz
                opciones={opciones}
                onChange={setRaiz}
                onQuitarCampo={() => {}}
              />

              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setRaiz({
                    ...raiz,
                    condiciones: [
                      ...raiz.condiciones,
                      { campo: 'cliente.cityId', operador: 'eq', valor: '' },
                    ],
                  })
                }
              >
                <Plus className="h-4 w-4" /> Agregar condición
              </Button>

              {state.error && (
                <p className="text-sm font-medium text-destructive">{state.error}</p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => router.back()}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={pending || !nombre.trim()}>
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {segmentoId ? 'Guardar cambios' : 'Crear segmento'}
                </Button>
              </div>
            </CardContent>
          </Card>
          {segmentoId ? <input type="hidden" name="segmentoId" value={segmentoId} /> : null}
        </form>
      </div>

      {/* Vista previa en vivo */}
      <Card className="h-fit lg:sticky lg:top-4">
        <CardContent className="space-y-4 p-5">
          <h2 className="font-semibold">Audiencia estimada</h2>
          <p className="text-xs text-muted-foreground">
            Solo agregados, nunca datos personales. El consentimiento de marketing geo es
            obligatorio.
          </p>
          <Button type="button" variant="secondary" onClick={estimar} disabled={estimando}>
            {estimando && <Loader2 className="h-4 w-4 animate-spin" />}
            Estimar audiencia
          </Button>
          {preview?.error && (
            <p className="text-sm font-medium text-destructive">{preview.error}</p>
          )}
          {preview?.estimacion && (
            <PreviewPanel estimacion={preview.estimacion} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function PreviewPanel({ estimacion }: { estimacion: Estimacion }) {
  const fmt = (n: number) => new Intl.NumberFormat('es-DO').format(n)
  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/40 p-3">
        <div className="text-2xl font-bold tabular-nums">{fmt(estimacion.totalElegibles)}</div>
        <div className="text-xs text-muted-foreground">clientes elegibles</div>
      </div>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Sin consentimiento</dt>
          <dd className="tabular-nums">{fmt(estimacion.sinConsentimiento)}</dd>
        </div>
      </dl>
      {estimacion.porCiudad.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Por ciudad</div>
          <div className="space-y-1">
            {estimacion.porCiudad.map((c) => (
              <div key={c.cityId} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{c.cityId}</span>
                <span className="tabular-nums">{fmt(c.count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {estimacion.advertencias.length > 0 && (
        <ul className="space-y-1 text-xs">
          {estimacion.advertencias.map((a, i) => (
            <li
              key={i}
              className={`rounded bg-muted/40 p-2 ${
                estimacion.bajoUmbral ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {a}
            </li>
          ))}
        </ul>
      )}
      {estimacion.bajoUmbral && (
        <p className="rounded bg-destructive/10 p-2 text-xs font-medium text-destructive">
          Bajo el umbral mínimo: las campañas con esta audiencia quedarán bloqueadas.
        </p>
      )}
    </div>
  )
}

interface GrupoProps {
  nivel: number
  grupo: GrupoUI
  esRaiz: boolean
  opciones: Opciones
  onChange: (g: GrupoUI) => void
  onQuitarCampo: () => void
}

function GrupoEditor({ nivel, grupo, esRaiz, opciones, onChange, onQuitarCampo }: GrupoProps) {
  const etiquetaOperadorGrupo = (op: string) =>
    op === 'AND' ? 'Y (todas)' : op === 'OR' ? 'O (al menos una)' : 'NO (ninguna)'

  return (
    <div
      className={`space-y-3 rounded-md border p-3 ${
        esRaiz ? 'border-border bg-background' : 'border-dashed bg-muted/30'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        {!esRaiz ? (
          <span className="text-xs font-medium text-muted-foreground">Grupo</span>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">Combinar condiciones</span>
        )}
        <div className="flex items-center gap-2">
          <select
            className="rounded border bg-background px-2 py-1 text-sm"
            value={grupo.operador}
            onChange={(e) => onChange({ ...grupo, operador: e.target.value as GrupoUI['operador'] })}
          >
            <option value="AND">{etiquetaOperadorGrupo('AND')}</option>
            <option value="OR">{etiquetaOperadorGrupo('OR')}</option>
            <option value="NOT">{etiquetaOperadorGrupo('NOT')}</option>
          </select>
          {!esRaiz && (
            <Button type="button" variant="ghost" size="icon" onClick={onQuitarCampo}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {grupo.condiciones.map((cond, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <FilaCondicion
            cond={cond}
            opciones={opciones}
            onChange={(c) => {
              const condiciones = [...grupo.condiciones]
              condiciones[i] = c
              onChange({ ...grupo, condiciones })
            }}
            onQuitar={() => {
              const condiciones = grupo.condiciones.filter((_, j) => j !== i)
              onChange({ ...grupo, condiciones })
            }}
          />
        </div>
      ))}

      {grupo.grupos.map((sub, i) => (
        <GrupoEditor
          key={i}
          nivel={nivel + 1}
          grupo={sub}
          esRaiz={false}
          opciones={opciones}
          onChange={(g) => {
            const grupos = [...grupo.grupos]
            grupos[i] = g
            onChange({ ...grupo, grupos })
          }}
          onQuitarCampo={() => {
            onChange({ ...grupo, grupos: grupo.grupos.filter((_, j) => j !== i) })
          }}
        />
      ))}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange({
              ...grupo,
              condiciones: [
                ...grupo.condiciones,
                { campo: 'cliente.cityId', operador: 'eq', valor: '' },
              ],
            })
          }
        >
          <Plus className="h-3 w-3" /> Condición
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange({
              ...grupo,
              grupos: [...grupo.grupos, { operador: 'OR', condiciones: [], grupos: [] }],
            })
          }
        >
          <Layers className="h-3 w-3" /> Grupo
        </Button>
      </div>
    </div>
  )
}

interface FilaProps {
  cond: CondicionUI
  opciones: Opciones
  onChange: (c: CondicionUI) => void
  onQuitar: () => void
}

function FilaCondicion({ cond, opciones, onChange, onQuitar }: FilaProps) {
  const def = campoDef(cond.campo)
  if (!def) return null

  function cambiarCampo(campo: string) {
    const nuevo = campoDef(campo)!
    onChange({ campo, operador: operadorPorDefecto(nuevo), valor: valorPorDefecto(nuevo) })
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-md border bg-background p-2">
      <select
        className="rounded border bg-background px-2 py-1 text-sm"
        value={cond.campo}
        onChange={(e) => cambiarCampo(e.target.value)}
      >
        {CAMPOS_SEGMENTACION.map((c) => (
          <option key={c.campo} value={c.campo}>
            {c.etiqueta}
          </option>
        ))}
      </select>
      <select
        className="rounded border bg-background px-2 py-1 text-sm"
        value={cond.operador}
        onChange={(e) => {
          const op = e.target.value
          if (op === 'in' || op === 'not_in') {
            const v = Array.isArray(cond.valor) ? cond.valor : cond.valor ? [cond.valor as string] : []
            onChange({ ...cond, operador: op, valor: v })
          } else if (op === 'es_true' || op === 'es_falso') {
            onChange({ ...cond, operador: op, valor: op === 'es_true' })
          } else {
            const v = Array.isArray(cond.valor) ? cond.valor[0] ?? '' : cond.valor
            onChange({ ...cond, operador: op, valor: v })
          }
        }}
      >
        {def.operadores.map((op) => (
          <option key={op} value={op}>
            {etiquetaOperador(op)}
          </option>
        ))}
      </select>

      <ValorControl
        def={def}
        cond={cond}
        opciones={opciones}
        onChange={(valor) => onChange({ ...cond, valor })}
      />

      <Button type="button" variant="ghost" size="icon" onClick={onQuitar}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  )
}

interface ValorProps {
  def: CampoDefinicion
  cond: CondicionUI
  opciones: Opciones
  onChange: (valor: unknown) => void
}

function ValorControl({ def, cond, opciones, onChange }: ValorProps) {
  const multi = cond.operador === 'in' || cond.operador === 'not_in'

  switch (def.tipo) {
    case 'bool':
      return (
        <select
          className="rounded border bg-background px-2 py-1 text-sm"
          value={String(cond.valor ?? true)}
          onChange={(e) => onChange(e.target.value === 'true')}
        >
          <option value="true">Sí</option>
          <option value="false">No</option>
        </select>
      )
    case 'numero':
      return (
        <input
          type="number"
          min={0}
          className="w-24 rounded border bg-background px-2 py-1 text-sm"
          value={String(cond.valor ?? 30)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      )
    case 'fecha':
      return (
        <input
          type="date"
          className="rounded border bg-background px-2 py-1 text-sm"
          value={String(cond.valor ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'mes':
      return (
        <select
          className="rounded border bg-background px-2 py-1 text-sm"
          value={Number(cond.valor ?? 1)}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {new Date(0, m - 1, 1).toLocaleString('es-DO', { month: 'long' })}
            </option>
          ))}
        </select>
      )
    case 'radio': {
      const v = (cond.valor ?? { sucursalId: '', km: 3 }) as { sucursalId: string; km: number }
      return (
        <div className="flex items-center gap-2">
          <select
            className="rounded border bg-background px-2 py-1 text-sm"
            value={v.sucursalId}
            onChange={(e) => onChange({ ...v, sucursalId: e.target.value })}
          >
            <option value="">Sucursal…</option>
            {opciones.sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            max={200}
            className="w-20 rounded border bg-background px-2 py-1 text-sm"
            value={v.km}
            onChange={(e) => onChange({ ...v, km: Number(e.target.value) })}
          />
          <span className="text-sm text-muted-foreground">km</span>
        </div>
      )
    }
    case 'texto': {
      const opcionesMembresia = VALORES_MEMBRESIA.map((m) => ({
        id: m,
        label: ETIQUETA_MEMBRESIA[m],
      }))
      return <SelectorOpciones multi={multi} opciones={opcionesMembresia} valor={cond.valor} onChange={onChange} />
    }
    default: {
      let opcionesItems: { id: string; label: string }[] = []
      if (def.catalogo?.tipo === 'city') opcionesItems = opciones.ciudades
      else if (def.catalogo?.tipo === 'sector') opcionesItems = opciones.sectores
      else if (def.catalogo?.tipo === 'tipoVehiculo') opcionesItems = opciones.tiposVehiculo
      return <SelectorOpciones multi={multi} opciones={opcionesItems} valor={cond.valor} onChange={onChange} />
    }
  }
}

function SelectorOpciones({
  multi,
  opciones,
  valor,
  onChange,
}: {
  multi: boolean
  opciones: { id: string; label: string }[]
  valor: unknown
  onChange: (valor: unknown) => void
}) {
  const actual = multi ? (Array.isArray(valor) ? (valor as string[]) : []) : String(valor ?? '')

  if (multi) {
    const toggle = (id: string) => {
      const set = new Set(actual)
      if (set.has(id)) set.delete(id)
      else set.add(id)
      onChange([...set])
    }
    return (
      <div className="max-h-24 w-full max-w-xs space-y-1 overflow-y-auto rounded border bg-background p-2">
        {opciones.length === 0 && <p className="text-xs text-muted-foreground">Sin opciones</p>}
        {opciones.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={actual.includes(o.id)}
              onChange={() => toggle(o.id)}
            />
            <span className="truncate">{o.label}</span>
          </label>
        ))}
      </div>
    )
  }

  return (
    <select
      className="max-w-xs rounded border bg-background px-2 py-1 text-sm"
      value={actual}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Seleccionar…</option>
      {opciones.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
