'use client'

/**
 * Formulario de SOLICITUD de alta (etapa concierge) — público, sin cuenta.
 *
 * El negocio llena todo lo necesario para que el superadmin cree su empresa:
 * datos, ubicación, horario, marca (con logo y portada ADJUNTOS), su
 * administrador, planes, promociones (cada una con su imagen en formato
 * Instagram, validada con el MISMO validador del panel) y cómo cobra.
 *
 * El texto se guarda en localStorage mientras escribe (los archivos no pueden
 * persistirse: se re-adjuntan si recarga). Al enviar, todo viaja en un solo
 * FormData: `datos` como JSON + los archivos aparte.
 */

import { useActionState, useEffect, useRef, useState } from 'react'
import { Loader2, Plus, X, CheckCircle2, ImagePlus } from 'lucide-react'
import {
  enviarSolicitudEmpresa,
  type EnviarSolicitudState,
} from '@/modules/solicitudes/actions'
import {
  TIPOS_NEGOCIO_SOLICITUD,
  IMG_MAX_BYTES,
  type SolicitudDatos,
} from '@/modules/solicitudes/nucleo'
import { validarDimensionesPromo, PROMO_IMG_DESCRIPCION } from '@/modules/promociones/formato-imagen'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'

const LS_KEY = 'membego-solicitud-v1'
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const TIPOS_IMG = 'image/jpeg,image/png,image/webp'

function datosIniciales(): SolicitudDatos {
  return {
    v: 1,
    negocio: { nombre: '', tipo: 'Car Wash', descripcion: '', telefono: '', correo: '' },
    ubicacion: { direccion: '', ciudad: '' },
    horario: DIAS.map((dia) => ({ dia, cerrado: false, desde: '08:00', hasta: '18:00' })),
    sucursales: [],
    // Sin color por defecto: si el negocio no elige, la empresa nace con el
    // azul de MembeGo (y el HEX no se escribe en la interfaz — deuda-diseño).
    marca: {},
    admin: { nombre: '', correo: '', telefono: '' },
    planes: [],
    promos: [],
    cobros: { efectivo: true, transferencia: false, tarjeta: false, usaCitas: false },
    extras: { ruleta: false, gift: false, referidos: false, sellos: false },
  }
}

const initState: EnviarSolicitudState = {}

/** Adjunto validado en el navegador, listo para el FormData. */
interface Adjunto {
  file: File
  nombre: string
}

function Seccion({
  n,
  titulo,
  children,
}: {
  n: string
  titulo: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <h2 className="flex items-center gap-3 text-h3 text-foreground">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          {n}
        </span>
        {titulo}
      </h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

function CampoImagen({
  etiqueta,
  ayuda,
  adjunto,
  onElegir,
  onQuitar,
  error,
}: {
  etiqueta: string
  ayuda: string
  adjunto: Adjunto | null
  onElegir: (f: File) => void
  onQuitar: () => void
  error?: string | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div>
      <Label>{etiqueta}</Label>
      <input
        ref={inputRef}
        type="file"
        accept={TIPOS_IMG}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onElegir(f)
          e.target.value = ''
        }}
      />
      {adjunto ? (
        <div className="mt-1.5 flex items-center justify-between gap-3 rounded-xl border border-border bg-muted px-3 py-2">
          <span className="truncate text-sm text-foreground">📎 {adjunto.nombre}</span>
          <button
            type="button"
            onClick={onQuitar}
            className="shrink-0 text-sm font-medium text-muted-foreground hover:text-destructive"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Quitar imagen</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-3 py-3 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary"
        >
          <ImagePlus className="h-4 w-4" /> Adjuntar imagen
        </button>
      )}
      <p className="mt-1 text-xs text-muted-foreground">{ayuda}</p>
      {error ? <p className="mt-1 text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  )
}

export function SolicitudEmpresaForm() {
  const [datos, setDatos] = useState<SolicitudDatos>(datosIniciales)
  const [logo, setLogo] = useState<Adjunto | null>(null)
  const [portada, setPortada] = useState<Adjunto | null>(null)
  const [promoImgs, setPromoImgs] = useState<Record<number, Adjunto>>({})
  const [imgErrores, setImgErrores] = useState<Record<string, string>>({})
  const [state, formAction, pending] = useActionState(enviarSolicitudEmpresa, initState)

  // Autosave del TEXTO (los File no sobreviven a un reload).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        const s = JSON.parse(raw)
        // Restaurar de localStorage DESPUÉS de hidratar es el patrón correcto:
        // en el initializer, el HTML del servidor (que no conoce el navegador)
        // no cuadraría con el del cliente.
        // eslint-disable-next-line react-hooks/set-state-in-effect -- ver arriba
        if (s && s.v === 1) setDatos(s)
      }
    } catch {
      /* almacenamiento no disponible (modo privado): sin autosave */
    }
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(datos))
    } catch {
      /* idem */
    }
  }, [datos])
  useEffect(() => {
    if (state.success) {
      try {
        localStorage.removeItem(LS_KEY)
      } catch {
        /* idem */
      }
    }
  }, [state.success])

  function set<K extends keyof SolicitudDatos>(seccion: K, valor: SolicitudDatos[K]) {
    setDatos((d) => ({ ...d, [seccion]: valor }))
  }

  async function elegirImagen(clave: string, file: File, esPromo: boolean, aplicar: (a: Adjunto) => void) {
    const errores = { ...imgErrores }
    delete errores[clave]
    if (!TIPOS_IMG.split(',').includes(file.type)) {
      errores[clave] = 'Debe ser JPG, PNG o WebP.'
      setImgErrores(errores)
      return
    }
    if (file.size > IMG_MAX_BYTES) {
      errores[clave] = 'La imagen pesa más de 5 MB. Redúcela e intenta de nuevo.'
      setImgErrores(errores)
      return
    }
    if (esPromo) {
      // El MISMO criterio del panel: si no pasa aquí, tampoco pasaría al
      // crear la promoción — mejor avisar ahora que rebotar después.
      try {
        const bmp = await createImageBitmap(file)
        const problema = validarDimensionesPromo(bmp.width, bmp.height)
        bmp.close()
        if (problema) {
          errores[clave] = problema
          setImgErrores(errores)
          return
        }
      } catch {
        /* navegador sin createImageBitmap: la revisión queda del lado del equipo */
      }
    }
    setImgErrores(errores)
    aplicar({ file, nombre: file.name })
  }

  if (state.success) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
        <h2 className="mt-4 text-h2 text-foreground">¡Solicitud enviada!</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Recibimos toda la información de <strong>{datos.negocio.nombre}</strong>. Nuestro
          equipo la revisará y te contactará por WhatsApp o correo para dejar tu negocio
          listo en MembeGo.
        </p>
      </div>
    )
  }

  return (
    <form
      action={(fd) => {
        fd.set('datos', JSON.stringify(datos))
        if (logo) fd.set('logo', logo.file)
        if (portada) fd.set('portada', portada.file)
        for (const [i, a] of Object.entries(promoImgs)) fd.set(`promo_${i}`, a.file)
        formAction(fd)
      }}
      className="space-y-5"
    >
      <Seccion n="1" titulo="Tu negocio">
        <div>
          <Label htmlFor="s-nombre">Nombre comercial *</Label>
          <Input
            id="s-nombre"
            value={datos.negocio.nombre}
            onChange={(e) => set('negocio', { ...datos.negocio, nombre: e.target.value })}
            placeholder="Ej.: Car Wash El Rápido"
            required
          />
        </div>
        <div>
          <Label>Tipo de negocio *</Label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {TIPOS_NEGOCIO_SOLICITUD.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set('negocio', { ...datos.negocio, tipo: t })}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                  datos.negocio.tipo === t
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-muted text-foreground hover:border-primary/50'
                }`}
                aria-pressed={datos.negocio.tipo === t}
              >
                {t}
              </button>
            ))}
          </div>
          {datos.negocio.tipo === 'Otro' ? (
            <Input
              className="mt-2"
              value={datos.negocio.tipoOtro ?? ''}
              onChange={(e) => set('negocio', { ...datos.negocio, tipoOtro: e.target.value })}
              placeholder="¿Qué tipo de negocio es?"
              aria-label="Tipo de negocio (otro)"
            />
          ) : null}
        </div>
        <div>
          <Label htmlFor="s-desc">Descríbelo en una o dos frases *</Label>
          <Textarea
            id="s-desc"
            value={datos.negocio.descripcion}
            onChange={(e) => set('negocio', { ...datos.negocio, descripcion: e.target.value })}
            placeholder="Este texto aparecerá en tu página pública."
            required
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="s-tel">Teléfono / WhatsApp *</Label>
            <Input
              id="s-tel"
              type="tel"
              value={datos.negocio.telefono}
              onChange={(e) => set('negocio', { ...datos.negocio, telefono: e.target.value })}
              placeholder="809-555-0000"
              required
            />
          </div>
          <div>
            <Label htmlFor="s-correo">Correo del negocio *</Label>
            <Input
              id="s-correo"
              type="email"
              value={datos.negocio.correo}
              onChange={(e) => set('negocio', { ...datos.negocio, correo: e.target.value })}
              placeholder="contacto@minegocio.com"
              required
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="s-rnc">RNC (si tienes)</Label>
            <Input
              id="s-rnc"
              value={datos.negocio.rnc ?? ''}
              onChange={(e) => set('negocio', { ...datos.negocio, rnc: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="s-ig">Instagram</Label>
            <Input
              id="s-ig"
              value={datos.negocio.instagram ?? ''}
              onChange={(e) => set('negocio', { ...datos.negocio, instagram: e.target.value })}
              placeholder="@minegocio"
            />
          </div>
        </div>
      </Seccion>

      <Seccion n="2" titulo="Ubicación y horario">
        <div>
          <Label htmlFor="s-dir">Dirección del local principal *</Label>
          <Input
            id="s-dir"
            value={datos.ubicacion.direccion}
            onChange={(e) => set('ubicacion', { ...datos.ubicacion, direccion: e.target.value })}
            required
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="s-ciudad">Ciudad *</Label>
            <Input
              id="s-ciudad"
              value={datos.ubicacion.ciudad}
              onChange={(e) => set('ubicacion', { ...datos.ubicacion, ciudad: e.target.value })}
              required
            />
          </div>
          <div>
            <Label htmlFor="s-maps">Enlace de Google Maps</Label>
            <Input
              id="s-maps"
              type="url"
              value={datos.ubicacion.maps ?? ''}
              onChange={(e) => set('ubicacion', { ...datos.ubicacion, maps: e.target.value })}
              placeholder="https://maps.app.goo.gl/…"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              En Google Maps: busca tu negocio → Compartir → pega el enlace. Con eso te
              ubicamos exacto en el mapa.
            </p>
          </div>
        </div>
        <div>
          <Label>Horario semanal</Label>
          <div className="mt-1.5 space-y-2">
            {datos.horario.map((h, i) => (
              <div key={h.dia} className="grid grid-cols-[44px_84px_1fr_1fr] items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{h.dia}</span>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={!h.cerrado}
                    onChange={(e) => {
                      const horario = [...datos.horario]
                      horario[i] = { ...h, cerrado: !e.target.checked }
                      set('horario', horario)
                    }}
                    className="h-4 w-4 accent-primary"
                  />
                  abierto
                </label>
                <Input
                  type="time"
                  value={h.desde}
                  disabled={h.cerrado}
                  aria-label={`Abre ${h.dia}`}
                  onChange={(e) => {
                    const horario = [...datos.horario]
                    horario[i] = { ...h, desde: e.target.value }
                    set('horario', horario)
                  }}
                />
                <Input
                  type="time"
                  value={h.hasta}
                  disabled={h.cerrado}
                  aria-label={`Cierra ${h.dia}`}
                  onChange={(e) => {
                    const horario = [...datos.horario]
                    horario[i] = { ...h, hasta: e.target.value }
                    set('horario', horario)
                  }}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-2 text-xs font-medium text-primary hover:underline"
            onClick={() => {
              const lun = datos.horario[0]
              set(
                'horario',
                datos.horario.map((h, i) => (i === 0 ? h : { ...h, cerrado: lun.cerrado, desde: lun.desde, hasta: lun.hasta }))
              )
            }}
          >
            Copiar el horario del lunes a toda la semana
          </button>
        </div>
        <div>
          <Label>¿Tienes más de un local?</Label>
          {datos.sucursales.map((s, i) => (
            <div key={i} className="mt-2 rounded-xl border border-dashed border-border bg-muted p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-primary">
                  Sucursal adicional {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => set('sucursales', datos.sucursales.filter((_, j) => j !== i))}
                  className="text-xs font-medium text-muted-foreground hover:text-destructive"
                >
                  Quitar
                </button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <Input
                  value={s.nombre ?? ''}
                  placeholder="Nombre"
                  aria-label={`Nombre de la sucursal ${i + 1}`}
                  onChange={(e) => {
                    const sucursales = [...datos.sucursales]
                    sucursales[i] = { ...s, nombre: e.target.value }
                    set('sucursales', sucursales)
                  }}
                />
                <Input
                  value={s.direccion ?? ''}
                  placeholder="Dirección"
                  aria-label={`Dirección de la sucursal ${i + 1}`}
                  onChange={(e) => {
                    const sucursales = [...datos.sucursales]
                    sucursales[i] = { ...s, direccion: e.target.value }
                    set('sucursales', sucursales)
                  }}
                />
                <Input
                  value={s.telefono ?? ''}
                  placeholder="Teléfono"
                  aria-label={`Teléfono de la sucursal ${i + 1}`}
                  onChange={(e) => {
                    const sucursales = [...datos.sucursales]
                    sucursales[i] = { ...s, telefono: e.target.value }
                    set('sucursales', sucursales)
                  }}
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => set('sucursales', [...datos.sucursales, {}])}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-primary px-3 py-2 text-sm font-semibold text-primary"
          >
            <Plus className="h-4 w-4" /> Agregar sucursal
          </button>
        </div>
      </Seccion>

      <Seccion n="3" titulo="Tu marca">
        <div className="flex items-center gap-3">
          <div>
            <Label htmlFor="s-color">Color principal (opcional)</Label>
            {/* Sin `value` fijo: si no lo tocan, no se afirma ningún color y
                la empresa nace con el azul de MembeGo. */}
            <input
              id="s-color"
              type="color"
              {...(datos.marca.color ? { value: datos.marca.color } : {})}
              onChange={(e) => set('marca', { color: e.target.value })}
              className="mt-1.5 block h-10 w-14 cursor-pointer rounded-lg border border-border bg-muted p-1"
            />
          </div>
          <span className="mt-6 text-sm text-muted-foreground">
            {datos.marca.color ?? 'Si no eliges, usamos el azul de MembeGo.'}
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoImagen
            etiqueta="Tu logo"
            ayuda="JPG, PNG o WebP · máx. 5 MB. Con fondo transparente si lo tienes."
            adjunto={logo}
            onElegir={(f) => elegirImagen('logo', f, false, setLogo)}
            onQuitar={() => setLogo(null)}
            error={imgErrores.logo}
          />
          <CampoImagen
            etiqueta="Foto de portada"
            ayuda="Una buena foto del negocio (horizontal). Máx. 5 MB."
            adjunto={portada}
            onElegir={(f) => elegirImagen('portada', f, false, setPortada)}
            onQuitar={() => setPortada(null)}
            error={imgErrores.portada}
          />
        </div>
      </Seccion>

      <Seccion n="4" titulo="Quién administrará el negocio">
        <p className="text-sm text-muted-foreground">
          Esta persona recibirá el acceso al panel: ventas, clientes, promociones.
        </p>
        <div>
          <Label htmlFor="s-adm-nombre">Nombre completo *</Label>
          <Input
            id="s-adm-nombre"
            value={datos.admin.nombre}
            onChange={(e) => set('admin', { ...datos.admin, nombre: e.target.value })}
            required
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="s-adm-correo">Correo (será su usuario) *</Label>
            <Input
              id="s-adm-correo"
              type="email"
              value={datos.admin.correo}
              onChange={(e) => set('admin', { ...datos.admin, correo: e.target.value })}
              required
            />
          </div>
          <div>
            <Label htmlFor="s-adm-tel">Teléfono / WhatsApp *</Label>
            <Input
              id="s-adm-tel"
              type="tel"
              value={datos.admin.telefono}
              onChange={(e) => set('admin', { ...datos.admin, telefono: e.target.value })}
              required
            />
          </div>
        </div>
      </Seccion>

      <Seccion n="5" titulo="Tus planes de membresía">
        <p className="text-sm text-muted-foreground">
          Tu ingreso fijo mensual: el cliente paga cada mes y recibe servicios incluidos.
          Ej.: «Plan Básico — 4 lavados al mes por RD$1,500». Puedes cambiarlo todo después.
        </p>
        {datos.planes.map((p, i) => (
          <div key={i} className="rounded-xl border border-dashed border-border bg-muted p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-primary">Plan {i + 1}</span>
              <button
                type="button"
                onClick={() => set('planes', datos.planes.filter((_, j) => j !== i))}
                className="text-xs font-medium text-muted-foreground hover:text-destructive"
              >
                Quitar
              </button>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Input
                value={p.nombre}
                placeholder="Nombre del plan"
                aria-label={`Nombre del plan ${i + 1}`}
                onChange={(e) => {
                  const planes = [...datos.planes]
                  planes[i] = { ...p, nombre: e.target.value }
                  set('planes', planes)
                }}
              />
              <Input
                value={p.precio}
                type="number"
                min="0"
                placeholder="Precio mensual (RD$)"
                aria-label={`Precio del plan ${i + 1}`}
                onChange={(e) => {
                  const planes = [...datos.planes]
                  planes[i] = { ...p, precio: e.target.value }
                  set('planes', planes)
                }}
              />
            </div>
            <Textarea
              className="mt-2"
              value={p.incluye}
              placeholder="¿Qué incluye al mes? Ej.: 4 lavados normales, 1 aspirado, 10% en otros servicios"
              aria-label={`Qué incluye el plan ${i + 1}`}
              onChange={(e) => {
                const planes = [...datos.planes]
                planes[i] = { ...p, incluye: e.target.value }
                set('planes', planes)
              }}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => set('planes', [...datos.planes, { nombre: '', precio: '', incluye: '' }])}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-primary px-3 py-2 text-sm font-semibold text-primary"
        >
          <Plus className="h-4 w-4" /> Agregar un plan
        </button>
      </Seccion>

      <Seccion n="6" titulo="Tu promoción de arranque">
        <p className="text-sm text-muted-foreground">
          Una oferta especial para atraer a los primeros clientes. Opcional, pero muy
          recomendada.
        </p>
        {datos.promos.map((p, i) => (
          <div key={i} className="rounded-xl border border-dashed border-border bg-muted p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-primary">Promoción {i + 1}</span>
              <button
                type="button"
                onClick={() => {
                  set('promos', datos.promos.filter((_, j) => j !== i))
                  setPromoImgs((m) => {
                    const nuevo: Record<number, Adjunto> = {}
                    for (const [k, a] of Object.entries(m)) {
                      const idx = Number(k)
                      if (idx === i) continue
                      nuevo[idx > i ? idx - 1 : idx] = a
                    }
                    return nuevo
                  })
                }}
                className="text-xs font-medium text-muted-foreground hover:text-destructive"
              >
                Quitar
              </button>
            </div>
            <div className="mt-2 space-y-2">
              <Input
                value={p.titulo}
                placeholder="Título — ej.: 2x1 en lavado full los martes"
                aria-label={`Título de la promoción ${i + 1}`}
                onChange={(e) => {
                  const promos = [...datos.promos]
                  promos[i] = { ...p, titulo: e.target.value }
                  set('promos', promos)
                }}
              />
              <Textarea
                value={p.oferta}
                placeholder="¿Qué ofrece exactamente? Qué recibe el cliente, precio normal vs. de oferta…"
                aria-label={`Oferta de la promoción ${i + 1}`}
                onChange={(e) => {
                  const promos = [...datos.promos]
                  promos[i] = { ...p, oferta: e.target.value }
                  set('promos', promos)
                }}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={p.vigencia ?? ''}
                  placeholder="Vigencia — ej.: todo septiembre"
                  aria-label={`Vigencia de la promoción ${i + 1}`}
                  onChange={(e) => {
                    const promos = [...datos.promos]
                    promos[i] = { ...p, vigencia: e.target.value }
                    set('promos', promos)
                  }}
                />
                <Input
                  value={p.condiciones ?? ''}
                  placeholder="Condiciones (opcional)"
                  aria-label={`Condiciones de la promoción ${i + 1}`}
                  onChange={(e) => {
                    const promos = [...datos.promos]
                    promos[i] = { ...p, condiciones: e.target.value }
                    set('promos', promos)
                  }}
                />
              </div>
              <CampoImagen
                etiqueta="Imagen de esta promoción"
                ayuda={PROMO_IMG_DESCRIPCION}
                adjunto={promoImgs[i] ?? null}
                onElegir={(f) => elegirImagen(`promo_${i}`, f, true, (a) => setPromoImgs((m) => ({ ...m, [i]: a })))}
                onQuitar={() =>
                  setPromoImgs((m) => {
                    const nuevo = { ...m }
                    delete nuevo[i]
                    return nuevo
                  })
                }
                error={imgErrores[`promo_${i}`]}
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => set('promos', [...datos.promos, { titulo: '', oferta: '' }])}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-primary px-3 py-2 text-sm font-semibold text-primary"
        >
          <Plus className="h-4 w-4" /> Agregar una promoción
        </button>
      </Seccion>

      <Seccion n="7" titulo="Cómo cobras">
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={datos.cobros.efectivo}
            onChange={(e) => set('cobros', { ...datos.cobros, efectivo: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span>
            Efectivo en el local
            <span className="block text-xs text-muted-foreground">Siempre disponible.</span>
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={datos.cobros.transferencia}
            onChange={(e) => set('cobros', { ...datos.cobros, transferencia: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span>
            Transferencia bancaria
            <span className="block text-xs text-muted-foreground">
              El cliente transfiere y sube su comprobante; tú lo apruebas.
            </span>
          </span>
        </label>
        {datos.cobros.transferencia ? (
          <div className="ml-6 grid gap-2 sm:grid-cols-2">
            <Input
              value={datos.cobros.banco ?? ''}
              placeholder="Banco"
              aria-label="Banco"
              onChange={(e) => set('cobros', { ...datos.cobros, banco: e.target.value })}
            />
            <Input
              value={datos.cobros.cuentaTipo ?? ''}
              placeholder="Tipo de cuenta (ahorros/corriente)"
              aria-label="Tipo de cuenta"
              onChange={(e) => set('cobros', { ...datos.cobros, cuentaTipo: e.target.value })}
            />
            <Input
              value={datos.cobros.cuentaNum ?? ''}
              placeholder="Número de cuenta"
              aria-label="Número de cuenta"
              onChange={(e) => set('cobros', { ...datos.cobros, cuentaNum: e.target.value })}
            />
            <Input
              value={datos.cobros.cuentaTitular ?? ''}
              placeholder="Titular de la cuenta"
              aria-label="Titular de la cuenta"
              onChange={(e) => set('cobros', { ...datos.cobros, cuentaTitular: e.target.value })}
            />
          </div>
        ) : null}
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={datos.cobros.tarjeta}
            onChange={(e) => set('cobros', { ...datos.cobros, tarjeta: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span>
            Tarjeta en línea (pasarela CardNET)
            <span className="block text-xs text-muted-foreground">Te contactaremos para configurarla.</span>
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={datos.cobros.usaCitas}
            onChange={(e) => set('cobros', { ...datos.cobros, usaCitas: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span>Quiero que mis clientes agenden citas desde la app</span>
        </label>
        {datos.negocio.tipo === 'Car Wash' ? (
          <div>
            <Label htmlFor="s-veh">Categorías de vehículos y precios</Label>
            <Textarea
              id="s-veh"
              value={datos.cobros.vehiculos ?? ''}
              onChange={(e) => set('cobros', { ...datos.cobros, vehiculos: e.target.value })}
              placeholder={'Carro — lavado normal RD$300, full RD$600\nYipeta — normal RD$400, full RD$800\nMotor — RD$150'}
            />
          </div>
        ) : null}
      </Seccion>

      <Seccion n="8" titulo="Extras que te interesan">
        {(
          [
            ['ruleta', '🎡 Ruleta de premios'],
            ['gift', '🎁 Gift cards y regalos'],
            ['referidos', '🤝 Invita y Gana (referidos)'],
            ['sellos', '✅ Tarjeta de sellos digital'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={datos.extras[k]}
              onChange={(e) => set('extras', { ...datos.extras, [k]: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            {label}
          </label>
        ))}
        <div>
          <Label htmlFor="s-coment">¿Algo más que debamos saber?</Label>
          <Textarea
            id="s-coment"
            value={datos.extras.comentarios ?? ''}
            onChange={(e) => set('extras', { ...datos.extras, comentarios: e.target.value })}
            placeholder="Dudas, pedidos especiales, cómo te gustaría arrancar…"
          />
        </div>
      </Seccion>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" size="lg" disabled={pending} className="w-full gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {pending ? 'Enviando tu solicitud…' : 'Enviar mi solicitud'}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Tus respuestas se guardan en este navegador mientras escribes. Las imágenes se
        adjuntan al enviar.
      </p>
    </form>
  )
}
