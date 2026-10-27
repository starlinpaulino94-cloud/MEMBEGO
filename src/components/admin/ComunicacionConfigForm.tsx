'use client'

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Loader2, ExternalLink, RotateCcw, Send, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  guardarComunicacionConfig,
  enviarCorreoPrueba,
  type ActionState,
} from '@/modules/soporte/actions'
import {
  MENSAJE_DEFAULT,
  DIAS_SEMANA,
  buildWaLink,
  formatNumeroPreview,
  parseDias,
} from '@/lib/soporte'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface Existing {
  codigoPais: string
  numero: string
  mensajePlantilla: string
  activo: boolean
  correoSoporte: string | null
  horaInicio: string | null
  horaCierre: string | null
  diasLaborales: string | null
}

const init: ActionState = {}
const VARIABLES = ['{cliente}', '{empresa}', '{membresia}', '{fecha}']

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="bg-success hover:bg-success/90">
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      Guardar configuración
    </Button>
  )
}

export function ComunicacionConfigForm({
  companyId,
  existing,
}: {
  companyId: string | null
  existing?: Existing
}) {
  const [state, formAction] = useActionState(guardarComunicacionConfig, init)

  const [codigoPais, setCodigoPais] = useState(existing?.codigoPais ?? '+1')
  const [numero, setNumero] = useState(existing?.numero ?? '')
  const [mensaje, setMensaje] = useState(existing?.mensajePlantilla ?? MENSAJE_DEFAULT)
  const [activo, setActivo] = useState(existing?.activo ?? true)
  const [correo, setCorreo] = useState(existing?.correoSoporte ?? '')
  const [dias, setDias] = useState<number[]>(parseDias(existing?.diasLaborales))

  useEffect(() => {
    if (state.success) toast.success('Configuración de Comunicación y Soporte guardada.')
    if (state.error) toast.error(state.error)
  }, [state.success, state.error])

  const preview = formatNumeroPreview(codigoPais, numero)
  const waLink = buildWaLink(codigoPais, numero, mensaje)

  function toggleDia(v: number) {
    setDias((prev) =>
      prev.includes(v) ? prev.filter((d) => d !== v) : [...prev, v].sort((a, b) => a - b)
    )
  }

  function insertarVariable(variable: string) {
    setMensaje((m) => `${m}${m.endsWith(' ') || m === '' ? '' : ' '}${variable}`)
  }

  return (
    <form action={formAction} className="space-y-6">
      {companyId && <input type="hidden" name="companyId" value={companyId} />}
      <input type="hidden" name="activo" value={String(activo)} />
      <input type="hidden" name="diasLaborales" value={dias.join(',')} />

      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {/* SECCIÓN 1: Datos de contacto */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos de contacto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[8rem_1fr]">
            <div className="space-y-2">
              <Label htmlFor="codigoPais">Código de país *</Label>
              <Input
                id="codigoPais"
                name="codigoPais"
                value={codigoPais}
                onChange={(e) => setCodigoPais(e.target.value)}
                inputMode="tel"
                placeholder="+52"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="numero">Número *</Label>
              <Input
                id="numero"
                name="numero"
                value={numero}
                onChange={(e) => setNumero(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                placeholder="5512345678"
                required
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/50 px-4 py-3">
            <span className="text-sm text-muted-foreground">Vista previa:</span>
            <span className="font-mono text-sm font-medium text-foreground">{preview}</span>
            <a href={waLink} target="_blank" rel="noopener noreferrer" className="ml-auto">
              <Button type="button" variant="outline" size="sm">
                <ExternalLink className="mr-2 h-4 w-4" /> Verificar enlace
              </Button>
            </a>
          </div>
        </CardContent>
      </Card>

      {/* SECCIÓN 2: Mensaje predeterminado */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mensaje predeterminado</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {VARIABLES.map((v) => (
              <Badge
                key={v}
                variant="secondary"
                className="cursor-pointer hover:bg-secondary/80"
                onClick={() => insertarVariable(v)}
              >
                {v}
              </Badge>
            ))}
          </div>
          <Textarea
            name="mensajePlantilla"
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            rows={3}
            placeholder={MENSAJE_DEFAULT}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMensaje(MENSAJE_DEFAULT)}
          >
            <RotateCcw className="mr-2 h-4 w-4" /> Restablecer mensaje
          </Button>
        </CardContent>
      </Card>

      {/* SECCIÓN 3: Botón de WhatsApp */}
      <Card>
        <CardContent className="flex items-center gap-3 pt-6">
          <Switch id="activo" checked={activo} onCheckedChange={setActivo} />
          <div>
            <Label htmlFor="activo" className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-success" />
              Mostrar botón de WhatsApp en la aplicación
            </Label>
            <p className="text-xs text-muted-foreground">
              Si está activo, los clientes verán “Contactar por WhatsApp” en el Centro de Ayuda.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* SECCIÓN 4: Correo de soporte */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Correo de soporte</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="correoSoporte">Correo electrónico de soporte</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="correoSoporte"
                name="correoSoporte"
                type="email"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                placeholder="soporte@empresa.com"
                className="max-w-sm"
              />
              <TestEmailButton correo={correo} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SECCIÓN 5: Horario de atención */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Horario de atención</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="horaInicio">Hora de inicio</Label>
              <Input
                id="horaInicio"
                name="horaInicio"
                type="time"
                defaultValue={existing?.horaInicio ?? '09:00'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="horaCierre">Hora de cierre</Label>
              <Input
                id="horaCierre"
                name="horaCierre"
                type="time"
                defaultValue={existing?.horaCierre ?? '18:00'}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Días laborales</Label>
            <div className="flex flex-wrap gap-2">
              {DIAS_SEMANA.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDia(d.value)}
                  className={`h-9 w-12 rounded-lg border text-sm font-medium transition ${
                    dias.includes(d.value)
                      ? 'border-success/40 bg-success/10 text-success'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  )
}

/** Botón "Enviar correo de prueba" — usa una server action independiente. */
function TestEmailButton({ correo }: { correo: string }) {
  const [state, action] = useActionState(enviarCorreoPrueba, init)
  useEffect(() => {
    if (state.success && state.message) toast.success(state.message)
    if (state.error) toast.error(state.error)
  }, [state.success, state.error, state.message])

  return (
    <form action={action}>
      <input type="hidden" name="correoSoporte" value={correo} />
      <TestEmailInner />
    </form>
  )
}

function TestEmailInner() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
      Enviar correo de prueba
    </Button>
  )
}
