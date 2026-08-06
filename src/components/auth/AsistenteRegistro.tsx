'use client'

import { useActionState, useEffect, useMemo, useRef, useState, startTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ArrowRight, Car, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import {
  registrarCliente,
  registrarCuentaGeneral,
  type RegistroState,
} from '@/modules/registro/actions'
import { validarAnio, validarPlaca, normalizarPlaca } from '@/modules/onboarding/vehiculo'
import { buscarMarcas, COLORES_FRECUENTES } from '@/modules/onboarding/marcas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ComoNosConociste } from '@/components/adquisicion/ComoNosConociste'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { landingUrlFor } from '@/lib/site'
import { isGoogleAuthEnabled } from '@/lib/auth/googleAuth'

/**
 * ASISTENTE DE REGISTRO (Onboarding v2 · Fase 4).
 *
 * Una pregunta por pantalla, mobile-first: perfil → (vehículo, si el negocio
 * lo exige) → confirmación. Los pasos NO se deciden aquí: el servidor resolvió
 * la categoría del negocio y pasó `requiereVehiculo` — y volverá a validarlo
 * todo al enviar, porque el navegador no es de fiar.
 *
 * El avance se guarda en sessionStorage (SIN la contraseña) para retomar tras
 * un refresco o un abandono. El formulario clásico sigue existiendo detrás de
 * la bandera de emergencia NEXT_PUBLIC_REGISTRO_V2=0.
 */

export interface TipoVehiculoOpcion {
  id: string
  nombre: string
  descripcion: string | null
  iconoUrl: string | null
}

type PasoId =
  | 'nombre'
  | 'email'
  | 'password'
  | 'telefono'
  | 'vehCategoria'
  | 'vehMarca'
  | 'vehModelo'
  | 'vehAnio'
  | 'vehColor'
  | 'vehPlaca'
  | 'confirmar'

interface Datos {
  nombre: string
  email: string
  telefono: string
  tipoVehiculoId: string
  marca: string
  modelo: string
  anio: string
  color: string
  placa: string
}

const DATOS_VACIOS: Datos = {
  nombre: '',
  email: '',
  telefono: '',
  tipoVehiculoId: '',
  marca: '',
  modelo: '',
  anio: '',
  color: '',
  placa: '',
}

const TITULOS: Record<PasoId, { titulo: string; ayuda?: string }> = {
  nombre: { titulo: '¿Cómo te llamas?' },
  email: { titulo: '¿Cuál es tu correo?', ayuda: 'Será tu usuario para entrar.' },
  password: { titulo: 'Crea tu contraseña', ayuda: 'Mínimo 6 caracteres.' },
  telefono: {
    titulo: '¿Cuál es tu teléfono?',
    ayuda: 'Lo usamos para confirmar tus citas y beneficios.',
  },
  vehCategoria: { titulo: '¿Qué tipo de vehículo tienes?' },
  vehMarca: { titulo: '¿Qué marca es?' },
  vehModelo: { titulo: '¿Qué modelo?' },
  vehAnio: { titulo: '¿De qué año?' },
  vehColor: { titulo: '¿De qué color?' },
  vehPlaca: {
    titulo: 'La placa de tu vehículo',
    ayuda: 'Con ella identificamos tu vehículo al llegar.',
  },
  confirmar: { titulo: 'Revisa y confirma' },
}

const initial: RegistroState = {}

export function AsistenteRegistro({
  modo,
  companySlug = '',
  companyName = 'MembeGo',
  colorPrimario = null,
  requiereVehiculo = false,
  tiposVehiculo = [],
}: {
  modo: 'empresa' | 'general'
  companySlug?: string
  companyName?: string
  colorPrimario?: string | null
  requiereVehiculo?: boolean
  tiposVehiculo?: TipoVehiculoOpcion[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const refCode = searchParams.get('ref') ?? ''
  const glCode = searchParams.get('gl') ?? ''
  const nextRaw = searchParams.get('next') ?? ''
  const nextSeguro = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : null
  const destino = nextSeguro ?? '/cliente/celebracion'

  const accion = modo === 'empresa' ? registrarCliente : registrarCuentaGeneral
  const [state, dispatch, pending] = useActionState(accion, initial)

  const pasos = useMemo<PasoId[]>(
    () => [
      'nombre',
      'email',
      'password',
      'telefono',
      ...(requiereVehiculo
        ? (['vehCategoria', 'vehMarca', 'vehModelo', 'vehAnio', 'vehColor', 'vehPlaca'] as PasoId[])
        : []),
      'confirmar',
    ],
    [requiereVehiculo]
  )

  const [idx, setIdx] = useState(0)
  const [datos, setDatos] = useState<Datos>(DATOS_VACIOS)
  // La contraseña vive SOLO en memoria: jamás se persiste en el borrador.
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [redirecting, setRedirecting] = useState(false)
  const handledRef = useRef(false)
  const credsRef = useRef<{ email: string; password: string } | null>(null)

  const paso = pasos[idx]
  const claveBorrador = `mg-reg-v2:${modo}:${companySlug || 'general'}`

  // ── Borrador: retomar donde se quedó (sin contraseña) ─────────────────────
  // La restauración va en un efecto A PROPÓSITO: leer sessionStorage en el
  // inicializador de useState rompería la hidratación (el servidor renderiza
  // vacío y el cliente no). Es una sincronización única tras montar.
  useEffect(() => {
    try {
      const crudo = sessionStorage.getItem(claveBorrador)
      if (!crudo) return
      const borrador = JSON.parse(crudo) as { datos?: Partial<Datos> }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (borrador.datos) setDatos((d) => ({ ...d, ...borrador.datos }))
    } catch {
      // Borrador corrupto: se empieza de cero, sin romper nada.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem(claveBorrador, JSON.stringify({ datos }))
    } catch {
      // Sin sessionStorage (modo privado estricto): el asistente funciona igual.
    }
  }, [datos, claveBorrador])

  // ── Éxito / verificación: el MISMO comportamiento probado del form clásico ─
  useEffect(() => {
    if (handledRef.current) return
    if (state.pendingVerification) {
      handledRef.current = true
      try {
        sessionStorage.removeItem(claveBorrador)
      } catch {}
      toast.success('Te enviamos un enlace de confirmación a tu correo. Ábrelo para activar tu cuenta.')
      router.replace(`/login?verifica=1&redirect=${encodeURIComponent(destino)}`)
      return
    }
    if (state.success) {
      handledRef.current = true
      try {
        sessionStorage.removeItem(claveBorrador)
      } catch {}
      const creds = credsRef.current
      const loginConDestino = `/login?redirect=${encodeURIComponent(destino)}`
      if (!creds) {
        router.replace(loginConDestino)
        return
      }
      setRedirecting(true)
      const supabase = createClient()
      supabase.auth
        .signInWithPassword({ email: creds.email, password: creds.password })
        .then(({ error }) => {
          if (error) {
            toast.success('Cuenta creada. Inicia sesión para continuar.')
            router.replace(loginConDestino)
            return
          }
          toast.success('¡Bienvenido! Tu cuenta está lista.')
          router.replace(destino)
          router.refresh()
        })
        .catch(() => router.replace(loginConDestino))
    }
  }, [state.success, state.pendingVerification, router, destino, claveBorrador])

  // ── Validación por paso (el servidor re-valida todo al final) ─────────────
  function validarPaso(p: PasoId): string | null {
    switch (p) {
      case 'nombre':
        return datos.nombre.trim() ? null : 'Escribe tu nombre.'
      case 'email':
        return /^\S+@\S+\.\S+$/.test(datos.email.trim())
          ? null
          : 'Escribe un correo válido, por ejemplo maria@correo.com.'
      case 'password':
        return password.length >= 6 ? null : 'La contraseña debe tener al menos 6 caracteres.'
      case 'telefono':
        return (datos.telefono.match(/\d/g)?.length ?? 0) >= 7
          ? null
          : 'Escribe un teléfono válido, por ejemplo 809-555-0000.'
      case 'vehCategoria':
        // Sin categorías configuradas no se puede exigir una (la página ya
        // omite los pasos de vehículo en ese caso; esto es defensa extra).
        return tiposVehiculo.length === 0 || datos.tipoVehiculoId
          ? null
          : 'Elige la categoría de tu vehículo.'
      case 'vehMarca':
        return datos.marca.trim() ? null : 'Indica la marca (o escríbela si no aparece).'
      case 'vehModelo':
        return datos.modelo.trim() ? null : 'Indica el modelo de tu vehículo.'
      case 'vehAnio': {
        const r = validarAnio(datos.anio)
        return r.ok ? null : r.error!
      }
      case 'vehColor':
        return datos.color.trim() ? null : 'Indica el color de tu vehículo.'
      case 'vehPlaca': {
        const r = validarPlaca(datos.placa)
        return r.ok ? null : r.error!
      }
      case 'confirmar':
        return null
    }
  }

  function avanzar(e?: React.FormEvent) {
    e?.preventDefault()
    const problema = validarPaso(paso)
    if (problema) {
      setError(problema)
      return
    }
    setError(null)
    setIdx((i) => Math.min(i + 1, pasos.length - 1))
  }

  function retroceder() {
    setError(null)
    setIdx((i) => Math.max(i - 1, 0))
  }

  // ── Envío final (previene dobles envíos con pending/redirecting) ──────────
  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending || redirecting) return
    const form = new FormData(e.currentTarget) // términos, marketing, seguir, canal
    form.set('companySlug', companySlug)
    form.set('nombre', datos.nombre)
    form.set('email', datos.email)
    form.set('password', password)
    form.set('telefono', datos.telefono)
    if (refCode) form.set('refCode', refCode)
    if (glCode) form.set('glCode', glCode)
    if (requiereVehiculo) {
      form.set('flujoV2', '1')
      form.set('tipoVehiculoId', datos.tipoVehiculoId)
      form.set('marca', datos.marca)
      form.set('modelo', datos.modelo)
      form.set('anio', datos.anio)
      form.set('color', datos.color)
      form.set('placa', datos.placa)
      form.set('pais', 'DO')
    } else {
      form.set('flujoV2', '1')
    }
    credsRef.current = { email: datos.email.trim().toLowerCase(), password }
    startTransition(() => dispatch(form))
  }

  const pct = Math.round(((idx + 1) / pasos.length) * 100)
  const t = TITULOS[paso]
  const tipoElegido = tiposVehiculo.find((tv) => tv.id === datos.tipoVehiculoId)
  const sugerenciasMarca = buscarMarcas(datos.marca)
  const estiloPrimario = colorPrimario ? { backgroundColor: colorPrimario } : undefined

  const campo = (
    id: keyof Datos,
    props: React.ComponentProps<typeof Input> = {}
  ) => (
    <Input
      id={id}
      value={datos[id]}
      onChange={(e) => {
        setError(null)
        setDatos((d) => ({ ...d, [id]: e.target.value }))
      }}
      autoFocus
      aria-invalid={!!error}
      className="h-12 bg-white/10 text-lg text-white placeholder:text-white/40"
      {...props}
    />
  )

  return (
    <div className="space-y-4">
      {/* Progreso */}
      <div aria-label={`Paso ${idx + 1} de ${pasos.length}`} className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-white/60">
          <span>
            Paso {idx + 1} de {pasos.length}
          </span>
          <span>{pct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${pct}%`, ...(colorPrimario ? { backgroundColor: colorPrimario } : {}) }}
          />
        </div>
      </div>

      <Card className="border-white/10 bg-white/5 text-white">
        <CardContent className="pt-6">
          {/* Cada paso es un form: Enter avanza (teclado y móvil). */}
          {paso !== 'confirmar' ? (
            <form onSubmit={avanzar} className="space-y-5" key={paso}>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">{t.titulo}</h1>
                {t.ayuda && <p className="mt-1 text-sm text-white/60">{t.ayuda}</p>}
              </div>

              {error && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {paso === 'nombre' && (
                <div className="space-y-2">
                  <Label htmlFor="nombre" className="sr-only">Nombre completo</Label>
                  {campo('nombre', { placeholder: 'Nombre y apellido', autoComplete: 'name' })}
                </div>
              )}

              {paso === 'email' && (
                <div className="space-y-2">
                  <Label htmlFor="email" className="sr-only">Correo electrónico</Label>
                  {campo('email', {
                    type: 'email',
                    placeholder: 'tucorreo@ejemplo.com',
                    autoComplete: 'email',
                    inputMode: 'email',
                  })}
                </div>
              )}

              {paso === 'password' && (
                <div className="space-y-2">
                  <Label htmlFor="password" className="sr-only">Contraseña</Label>
                  <PasswordInput
                    id="password"
                    value={password}
                    onChange={(e) => {
                      setError(null)
                      setPassword(e.target.value)
                    }}
                    autoFocus
                    minLength={6}
                    autoComplete="new-password"
                    aria-invalid={!!error}
                    className="h-12 bg-white/10 text-lg text-white"
                  />
                </div>
              )}

              {paso === 'telefono' && (
                <div className="space-y-2">
                  <Label htmlFor="telefono" className="sr-only">Teléfono</Label>
                  {campo('telefono', {
                    type: 'tel',
                    placeholder: '809-555-0000',
                    autoComplete: 'tel',
                    inputMode: 'tel',
                  })}
                </div>
              )}

              {paso === 'vehCategoria' && (
                <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Categoría del vehículo">
                  {tiposVehiculo.map((tv) => {
                    const activo = datos.tipoVehiculoId === tv.id
                    return (
                      <button
                        key={tv.id}
                        type="button"
                        role="radio"
                        aria-checked={activo}
                        onClick={() => {
                          setError(null)
                          setDatos((d) => ({ ...d, tipoVehiculoId: tv.id }))
                        }}
                        className={`rounded-xl border p-4 text-left transition ${
                          activo
                            ? 'border-primary bg-primary/15 ring-2 ring-primary'
                            : 'border-white/15 bg-white/5 hover:bg-white/10'
                        }`}
                      >
                        {tv.iconoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={tv.iconoUrl} alt="" className="mb-2 h-8 w-8 object-contain" />
                        ) : (
                          <Car className="mb-2 h-6 w-6 text-white/70" aria-hidden />
                        )}
                        <p className="font-semibold">{tv.nombre}</p>
                        {tv.descripcion && (
                          <p className="mt-0.5 text-xs text-white/60">{tv.descripcion}</p>
                        )}
                        {activo && <Check className="mt-1 h-4 w-4 text-primary" aria-hidden />}
                      </button>
                    )
                  })}
                  {tiposVehiculo.length === 0 && (
                    <p className="col-span-2 text-sm text-white/60">
                      Este negocio aún no tiene categorías configuradas. Continúa: podrás
                      completar tu vehículo más adelante.
                    </p>
                  )}
                </div>
              )}

              {paso === 'vehMarca' && (
                <div className="space-y-3">
                  <Label htmlFor="marca" className="sr-only">Marca</Label>
                  {campo('marca', { placeholder: 'Busca o escribe la marca' })}
                  <div className="flex flex-wrap gap-2" aria-label="Marcas sugeridas">
                    {sugerenciasMarca.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setError(null)
                          setDatos((d) => ({ ...d, marca: m }))
                        }}
                        className={`rounded-full border px-3 py-1.5 text-sm transition ${
                          datos.marca === m
                            ? 'border-primary bg-primary/20'
                            : 'border-white/15 bg-white/5 hover:bg-white/10'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-white/50">
                    ¿No aparece? Escríbela tal cual — vale cualquier marca.
                  </p>
                </div>
              )}

              {paso === 'vehModelo' && (
                <div className="space-y-2">
                  <Label htmlFor="modelo" className="sr-only">Modelo</Label>
                  {campo('modelo', { placeholder: datos.marca ? `Modelo de tu ${datos.marca}` : 'Modelo' })}
                </div>
              )}

              {paso === 'vehAnio' && (
                <div className="space-y-2">
                  <Label htmlFor="anio" className="sr-only">Año</Label>
                  {campo('anio', {
                    type: 'number',
                    placeholder: String(new Date().getFullYear()),
                    inputMode: 'numeric',
                  })}
                </div>
              )}

              {paso === 'vehColor' && (
                <div className="space-y-3">
                  <Label htmlFor="color" className="sr-only">Color</Label>
                  {campo('color', { placeholder: 'Color del vehículo' })}
                  <div className="flex flex-wrap gap-2" aria-label="Colores frecuentes">
                    {COLORES_FRECUENTES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          setError(null)
                          setDatos((d) => ({ ...d, color: c }))
                        }}
                        className={`rounded-full border px-3 py-1.5 text-sm transition ${
                          datos.color === c
                            ? 'border-primary bg-primary/20'
                            : 'border-white/15 bg-white/5 hover:bg-white/10'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {paso === 'vehPlaca' && (
                <div className="space-y-2">
                  <Label htmlFor="placa" className="sr-only">Placa</Label>
                  {campo('placa', { placeholder: 'A123456', autoComplete: 'off' })}
                  {datos.placa.trim() && normalizarPlaca(datos.placa) !== datos.placa.trim() && (
                    <p className="text-xs text-white/50">
                      Se guardará como <span className="font-mono">{normalizarPlaca(datos.placa)}</span>.
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3">
                {idx > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={retroceder}
                    className="text-white/70 hover:text-white"
                  >
                    <ArrowLeft className="mr-1.5 h-4 w-4" /> Atrás
                  </Button>
                )}
                <Button type="submit" className="ml-auto h-11 px-6" style={estiloPrimario}>
                  Continuar <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              </div>

              {idx === 0 && (
                <>
                  {isGoogleAuthEnabled() && (
                    <div className="space-y-3 pt-2">
                      <div className="flex items-center gap-3 text-xs text-white/50">
                        <span className="h-px flex-1 bg-white/10" /> o <span className="h-px flex-1 bg-white/10" />
                      </div>
                      <GoogleSignInButton
                        companySlug={modo === 'empresa' ? companySlug : null}
                        refCode={refCode || null}
                      />
                    </div>
                  )}
                  <p className="pt-1 text-center text-sm text-white/60">
                    ¿Ya tienes cuenta?{' '}
                    <a href="/login" className="text-primary hover:underline">Inicia sesión</a>
                  </p>
                </>
              )}
            </form>
          ) : (
            /* ── Confirmación: resumen + consentimientos + envío ───────────── */
            <form onSubmit={enviar} className="space-y-5">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">{t.titulo}</h1>
                <p className="mt-1 text-sm text-white/60">
                  {modo === 'empresa' ? `Tu cuenta en ${companyName}.` : 'Tu cuenta MembeGo.'}
                </p>
              </div>

              {(error || state.error) && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{error ?? state.error}</AlertDescription>
                </Alert>
              )}

              <dl className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
                <Resumen etiqueta="Nombre" valor={datos.nombre} />
                <Resumen etiqueta="Correo" valor={datos.email} />
                <Resumen etiqueta="Teléfono" valor={datos.telefono} />
                {requiereVehiculo && (
                  <>
                    <Resumen etiqueta="Vehículo" valor={`${datos.marca} ${datos.modelo} ${datos.anio}`} />
                    <Resumen etiqueta="Categoría" valor={tipoElegido?.nombre ?? '—'} />
                    <Resumen etiqueta="Color" valor={datos.color} />
                    <Resumen etiqueta="Placa" valor={normalizarPlaca(datos.placa)} />
                  </>
                )}
              </dl>

              <ComoNosConociste selectClassName="border-white/20 bg-white/10 text-white" />

              {modo === 'empresa' && (
                <label className="flex items-start gap-2 text-sm text-white/70">
                  <input type="hidden" name="seguirEmpresa" value="off" />
                  <input
                    type="checkbox"
                    name="seguirEmpresa"
                    value="on"
                    defaultChecked
                    className="mt-0.5 h-4 w-4 rounded border-white/30 bg-white/10"
                  />
                  <span>Seguir a {companyName} para recibir sus promociones y novedades.</span>
                </label>
              )}

              <label className="flex items-start gap-2 text-sm text-white/70">
                <input
                  type="checkbox"
                  name="terminos"
                  value="on"
                  required
                  className="mt-0.5 h-4 w-4 rounded border-white/30 bg-white/10"
                />
                <span>
                  Acepto los{' '}
                  <a href={landingUrlFor('/terms')} target="_blank" className="text-primary hover:underline">
                    términos y condiciones
                  </a>{' '}
                  y la{' '}
                  <a href={landingUrlFor('/privacy')} target="_blank" className="text-primary hover:underline">
                    política de privacidad
                  </a>
                  .
                </span>
              </label>

              <label className="flex items-start gap-2 text-sm text-white/70">
                <input type="hidden" name="marketingConsent" value="off" />
                <input
                  type="checkbox"
                  name="marketingConsent"
                  value="on"
                  className="mt-0.5 h-4 w-4 rounded border-white/30 bg-white/10"
                />
                <span>Quiero recibir novedades y ofertas de MembeGo por correo (opcional).</span>
              </label>

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={retroceder}
                  disabled={pending || redirecting}
                  className="text-white/70 hover:text-white"
                >
                  <ArrowLeft className="mr-1.5 h-4 w-4" /> Atrás
                </Button>
                <Button
                  type="submit"
                  disabled={pending || redirecting}
                  className="ml-auto h-11 px-6"
                  style={estiloPrimario}
                >
                  {(pending || redirecting) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {redirecting ? 'Entrando…' : 'Crear mi cuenta'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Resumen({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-white/50">{etiqueta}</dt>
      <dd className="text-right font-medium">{valor || '—'}</dd>
    </div>
  )
}
