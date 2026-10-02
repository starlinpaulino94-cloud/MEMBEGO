import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Image, Linking, Modal, useWindowDimensions } from 'react-native'
import { Link, useLocalSearchParams, useRouter } from 'expo-router'
import { ArrowLeft, ArrowRight, Car, Check, ChevronDown, Search, X } from 'lucide-react-native'
import { z } from 'zod'
import { Button } from '../../../src/components/ui/Button'
import { Card } from '../../../src/components/ui/Card'
import { colors } from '../../../src/theme/tokens'
import { fetchBff } from '../../../src/lib/api'
import { universalStorage } from '../../../src/lib/storage'

const configSchema = z.object({
  companyName: z.string(),
  colorPrimario: z.string().nullable(),
  requiresVehicle: z.boolean(),
  vehicleTypes: z.array(z.object({ id: z.string(), nombre: z.string(), descripcion: z.string().nullable(), iconoUrl: z.string().nullable() })),
  brandSuggestions: z.array(z.string()),
  frequentColors: z.array(z.string()),
  canalOptions: z.array(z.object({ value: z.string(), label: z.string() })),
})
const draftSchema = z.object({
  stepIndex: z.number().int().nonnegative(), nombre: z.string(), email: z.string(), telefono: z.string(),
  region: z.string(), ciudad: z.string(), sector: z.string(), tipoVehiculoId: z.string(), marca: z.string(),
  modelo: z.string(), anio: z.string(), color: z.string(), placa: z.string(),
  countryId: z.string().optional(), countryName: z.string().optional(), regionLabel: z.string().optional(), regionId: z.string().optional(), cityId: z.string().optional(), sectorId: z.string().optional(), geoLat: z.string().optional(), geoLng: z.string().optional(),
})

type Config = z.infer<typeof configSchema>
type GeoOption = { id: string; name: string; latitud?: number | null; longitud?: number | null; isoCode?: string; regionLabel?: string }
type Step = 'nombre' | 'email' | 'password' | 'telefono' | 'ubicacion' | 'vehCategoria' | 'vehMarca' | 'vehModelo' | 'vehAnio' | 'vehColor' | 'vehPlaca' | 'confirmar'
type SignupResult = { success: boolean; pendingVerification: boolean }

const TITLES: Record<Step, string> = {
  nombre: '¿Cómo te llamas?', email: '¿Cuál es tu correo?', password: 'Crea tu contraseña',
  telefono: '¿Cuál es tu teléfono?', ubicacion: '¿Dónde vives?', vehCategoria: '¿Qué tipo de vehículo tienes?',
  vehMarca: '¿Qué marca es?', vehModelo: '¿Qué modelo?', vehAnio: '¿De qué año?',
  vehColor: '¿De qué color?', vehPlaca: 'La placa de tu vehículo', confirmar: 'Revisa y confirma',
}

export default function RegistroPage() {
  const router = useRouter()
  const params = useLocalSearchParams<{ companySlug?: string; ref?: string; campanaId?: string; gl?: string; e?: string; v?: string; next?: string }>()
  const companySlug = typeof params.companySlug === 'string' ? params.companySlug : ''
  const refCode = typeof params.ref === 'string' ? params.ref : ''
  const nextRaw = typeof params.next === 'string' ? params.next : ''
  const nextSeguro = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : ''
  const returnTo = nextSeguro || (refCode && companySlug
    ? `/bienvenida-ref/${encodeURIComponent(companySlug)}`
    : companySlug && (params.e || params.v)
      ? `/empresas/${encodeURIComponent(companySlug)}`
      : '/(tabs)/inicio')
  const [config, setConfig] = useState<Config | null>(null)
  const [configError, setConfigError] = useState('')
  const [stepIndex, setStepIndex] = useState(0)
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [telefono, setTelefono] = useState('')
  const [region, setRegion] = useState('')
  const [regionLabel, setRegionLabel] = useState('Provincia')
  const [ciudad, setCiudad] = useState('')
  const [sector, setSector] = useState('')
  const [countryId, setCountryId] = useState('')
  const [countryName, setCountryName] = useState('')
  const [regionId, setRegionId] = useState('')
  const [cityId, setCityId] = useState('')
  const [sectorId, setSectorId] = useState('')
  const [geoLat, setGeoLat] = useState('')
  const [geoLng, setGeoLng] = useState('')
  const [geoOptions, setGeoOptions] = useState<GeoOption[]>([])
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoError, setGeoError] = useState('')
  const [guardarUbicacion, setGuardarUbicacion] = useState(false)
  const [marketingGeo, setMarketingGeo] = useState(false)
  const [tipoVehiculoId, setTipoVehiculoId] = useState('')
  const [marca, setMarca] = useState('')
  const [modelo, setModelo] = useState('')
  const [anio, setAnio] = useState('')
  const [color, setColor] = useState('')
  const [placa, setPlaca] = useState('')
  const [terms, setTerms] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [canalDeclarado, setCanalDeclarado] = useState('')
  const [seguirEmpresa, setSeguirEmpresa] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [draftReady, setDraftReady] = useState(false)
  const draftKey = `mg-reg-v2:${companySlug || 'general'}`

  useEffect(() => {
    let active = true
    void universalStorage.getItem(draftKey).then((raw) => {
      if (!active) return
      if (raw) {
        try {
          const parsed = draftSchema.safeParse(JSON.parse(raw))
          if (parsed.success) {
            const draft = parsed.data
            setStepIndex(draft.stepIndex)
            setNombre(draft.nombre)
            setEmail(draft.email)
            setTelefono(draft.telefono)
            setRegion(draft.region)
            setRegionLabel(draft.regionLabel ?? 'Provincia')
            setCiudad(draft.ciudad)
            setSector(draft.sector)
            setCountryId(draft.countryId ?? '')
            setCountryName(draft.countryName ?? '')
            setRegionId(draft.regionId ?? '')
            setCityId(draft.cityId ?? '')
            setSectorId(draft.sectorId ?? '')
            setGeoLat(draft.geoLat ?? '')
            setGeoLng(draft.geoLng ?? '')
            setTipoVehiculoId(draft.tipoVehiculoId)
            setMarca(draft.marca)
            setModelo(draft.modelo)
            setAnio(draft.anio)
            setColor(draft.color)
            setPlaca(draft.placa)
          }
        } catch {
          void universalStorage.removeItem(draftKey)
        }
      }
      setDraftReady(true)
    }).catch(() => setDraftReady(true))
    return () => { active = false }
  }, [draftKey])

  useEffect(() => {
    if (!draftReady) return
    const draft = { stepIndex, nombre, email, telefono, region, regionLabel, ciudad, sector, tipoVehiculoId, marca, modelo, anio, color, placa, countryId, countryName, regionId, cityId, sectorId, geoLat, geoLng }
    void universalStorage.setItem(draftKey, JSON.stringify(draft))
  }, [draftReady, draftKey, stepIndex, nombre, email, telefono, region, regionLabel, ciudad, sector, tipoVehiculoId, marca, modelo, anio, color, placa, countryId, countryName, regionId, cityId, sectorId, geoLat, geoLng])

  useEffect(() => {
    if (stepIndex !== 4) return
    const geoStep = !countryId ? 'country' : !regionId ? 'region' : !cityId ? 'city' : !sectorId ? 'sector' : ''
    if (!geoStep) {
      setGeoError('')
      setTimeout(() => { setGeoOptions([]) }, 0)
      return
    }
    const parentId = geoStep === 'region' ? countryId : geoStep === 'city' ? regionId : geoStep === 'sector' ? cityId : ''
    let active = true
    setGeoLoading(true)
    setGeoError('')
    void fetchBff<unknown>(`/api/v1/auth/registro/geo?step=${geoStep}${parentId ? `&parentId=${encodeURIComponent(parentId)}` : ''}`)
      .then((value) => {
        const optionSchema = z.object({ id: z.string(), name: z.string(), latitud: z.number().nullable().optional(), longitud: z.number().nullable().optional(), isoCode: z.string().optional(), regionLabel: z.string().optional() })
        const parsed = z.object({ options: z.array(optionSchema) }).safeParse(value)
        if (!parsed.success) throw new Error('No se pudo cargar la ubicación.')
        if (active) setGeoOptions(parsed.data.options)
      })
      .catch((cause: unknown) => { if (active) setGeoError(cause instanceof Error ? cause.message : 'No se pudo cargar la ubicación.') })
      .finally(() => { if (active) setGeoLoading(false) })
    return () => { active = false }
  }, [stepIndex, countryId, regionId, cityId, sectorId])

  useEffect(() => {
    let active = true
    const query = companySlug ? `?companySlug=${encodeURIComponent(companySlug)}` : ''
    void fetchBff<unknown>(`/api/v1/auth/registro/config${query}`)
      .then((value) => {
        const parsed = configSchema.safeParse(value)
        if (!parsed.success) throw new Error('No pudimos cargar el registro de esta empresa.')
        if (active) setConfig(parsed.data)
      })
      .catch((cause: unknown) => {
        if (active) setConfigError(cause instanceof Error ? cause.message : 'No pudimos cargar el registro de esta empresa.')
      })
    return () => { active = false }
  }, [companySlug])

  const steps = useMemo<Step[]>(() => [
    'nombre', 'email', 'password', 'telefono', 'ubicacion',
    ...(config?.requiresVehicle ? ['vehCategoria', 'vehMarca', 'vehModelo', 'vehAnio', 'vehColor', 'vehPlaca'] as Step[] : []),
    'confirmar',
  ], [config?.requiresVehicle])
  const step = steps[stepIndex] ?? 'nombre'
  const selectedType = config?.vehicleTypes.find((item) => item.id === tipoVehiculoId)
  const progress = Math.round(((stepIndex + 1) / steps.length) * 100)
  const hello = stepIndex === 1 && nombre.trim() ? `Encantado, ${nombre.trim().split(/\s+/)[0]}.` : ''

  function validate(): string {
    if (step === 'nombre' && !nombre.trim()) return 'Escribe tu nombre.'
    if (step === 'email' && !/^\S+@\S+\.\S+$/.test(email.trim())) return 'Escribe un correo válido.'
    if (step === 'password' && password.length < 6) return 'La contraseña debe tener al menos 6 caracteres.'
    if (step === 'telefono' && (telefono.match(/\d/g)?.length ?? 0) < 7) return 'Escribe un teléfono válido.'
    if (step === 'vehCategoria' && config?.vehicleTypes.length && !tipoVehiculoId) return 'Elige la categoría de tu vehículo.'
    if (step === 'vehMarca' && !marca.trim()) return 'Indica la marca de tu vehículo.'
    if (step === 'vehModelo' && !modelo.trim()) return 'Indica el modelo de tu vehículo.'
    if (step === 'vehAnio' && (!/^\d{4}$/.test(anio) || Number(anio) < 1950 || Number(anio) > new Date().getFullYear() + 1)) return 'Escribe un año válido.'
    if (step === 'vehColor' && !color.trim()) return 'Indica el color de tu vehículo.'
    if (step === 'vehPlaca' && !placa.trim()) return 'Escribe la placa de tu vehículo.'
    return ''
  }

  function next() {
    const issue = validate()
    if (issue) { setError(issue); return }
    setError('')
    setStepIndex((value) => Math.min(value + 1, steps.length - 1))
  }

  function back() {
    setError('')
    setStepIndex((value) => Math.max(value - 1, 0))
  }

  async function submit() {
    if (!terms) { setError('Debes aceptar los términos y la política de privacidad.'); return }
    if (!refCode && !canalDeclarado) { setError('Selecciona cómo conociste MembeGo.'); return }
    setLoading(true)
    setError('')
    try {
      const result = await fetchBff<SignupResult>('/api/v1/auth/registro', {
        method: 'POST',
        body: JSON.stringify({
          nombre, email, password, telefono, terminos: true, marketingConsent: marketing,
          companySlug, refCode, campanaId: params.campanaId ?? '', glCode: params.gl ?? '',
          enlaceSlug: params.e ?? '', vendedorCode: params.v ?? '', canalDeclarado,
          mobileReturnTo: returnTo,
          tipoVehiculoId, marca, modelo, anio, color, placa, pais: 'DO', flujoV2: config?.requiresVehicle ? '1' : '',
          geoCountryId: countryId, geoRegionId: regionId, geoRegionName: region,
          geoCityId: cityId, geoCityName: ciudad, geoSectorId: sectorId, geoSectorName: sector, geoLat, geoLng,
          geoSource: sectorId ? 'MANUAL' : '', geoConsentHome: guardarUbicacion ? 'on' : 'off',
          geoConsentMarketing: marketingGeo ? 'on' : 'off', seguirEmpresa,
        }),
      })
      await universalStorage.removeItem(draftKey)
      router.replace(result.pendingVerification
        ? `/(auth)/registro/verificado?returnTo=${encodeURIComponent(returnTo)}`
        : `/(auth)/login?registro=ok&redirect=${encodeURIComponent(returnTo)}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo completar el registro.')
    } finally {
      setLoading(false)
    }
  }

  if (companySlug && !config && !configError) {
    return <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.retail.blue} /></View>
  }

  if (companySlug && configError) {
    return (
      <Card className="w-full border border-border bg-card p-6">
        <Text accessibilityRole="alert" className="text-small text-danger">{configError}</Text>
        <Link href={`/(auth)/registro/${encodeURIComponent(companySlug)}`} className="mt-4 text-small" style={{ color: colors.retail.blue }}>
          Intentar de nuevo
        </Link>
      </Card>
    )
  }

  const companyName = config?.companyName ?? 'MembeGo'
  const accent = config?.colorPrimario ?? colors.retail.blue

  return (
    <View className="w-full">
        <View className="mb-2 flex-row justify-between">
          <Text className="text-caption text-muted-foreground">Paso {stepIndex + 1} de {steps.length}</Text>
          <Text className="text-caption text-muted-foreground">{progress}%</Text>
        </View>
        <View className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted">
          <View style={{ width: `${progress}%`, backgroundColor: accent }} className="h-full rounded-full" />
        </View>
        <Card className="w-full border border-border bg-card p-6">
          {configError ? <Text accessibilityRole="alert" className="mb-3 text-small text-danger">{configError}</Text> : null}
          {hello ? <Text className="mb-1 text-small" style={{ color: accent }}>{hello}</Text> : null}
          <Text className="text-2xl font-inter-semibold text-foreground">{TITLES[step]}</Text>
          {step === 'email' ? <Text className="mt-1 text-small text-muted-foreground">Será tu usuario para entrar.</Text> : null}

          {step === 'password' ? <Text className="mt-1 text-small text-muted-foreground">Mínimo 6 caracteres.</Text> : null}
          {step === 'ubicacion' ? <Text className="mt-1 text-small text-muted-foreground">Es opcional: úsala para encontrar negocios y ofertas cerca de ti.</Text> : null}
          {step === 'telefono' ? <Text className="mt-1 text-small text-muted-foreground">Lo usamos para confirmar tus citas y beneficios.</Text> : null}
          {error ? <Text accessibilityRole="alert" className="mt-4 text-small text-danger">{error}</Text> : null}

          {step === 'nombre' ? <Field label="Nombre y apellido" value={nombre} onChangeText={setNombre} autoComplete="name" autoCapitalize="words" /> : null}
          {step === 'email' ? <Field label="tucorreo@ejemplo.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" /> : null}
          {step === 'password' ? <Field label="Mínimo 6 caracteres" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" /> : null}
          {step === 'telefono' ? <Field label="809-555-0000" value={telefono} onChangeText={setTelefono} keyboardType="phone-pad" autoComplete="tel" /> : null}
          {step === 'ubicacion' ? (
            <View className="mt-5 gap-3">
              <Text className="text-small text-muted-foreground">Elige tu país, provincia, ciudad y sector. Puedes omitir tu ubicación.</Text>
              <Text className="text-caption text-muted-foreground">{!countryId ? 'País' : !regionId ? regionLabel : !cityId ? 'Municipio o ciudad' : !sectorId ? 'Sector' : 'Ubicación elegida'}</Text>
              {geoLoading ? <ActivityIndicator color={accent} /> : !sectorId ? <GeoSelect
                accessibilityLabel={`Seleccionar ${!countryId ? 'país' : !regionId ? regionLabel.toLowerCase() : !cityId ? 'municipio o ciudad' : 'sector'}`}
                placeholder={`Selecciona ${!countryId ? 'tu país' : !regionId ? `tu ${regionLabel.toLowerCase()}` : !cityId ? 'tu municipio o ciudad' : 'tu sector'}`}
                value={!countryId ? countryName : ''}
                options={geoOptions}
                accent={accent}
                onSelect={(option) => {
                  if (!countryId) { setCountryId(option.id); setCountryName(option.name); setRegionLabel(option.regionLabel ?? 'Provincia'); setRegion(''); setRegionId(''); setCityId(''); setSectorId(''); setCiudad(''); setSector(''); setGeoLat(''); setGeoLng('') }
                  else if (!regionId) { setRegionId(option.id); setRegion(option.name); setCityId(''); setSectorId(''); setCiudad(''); setSector(''); setGeoLat(''); setGeoLng('') }
                  else if (!cityId) { setCityId(option.id); setCiudad(option.name); setSectorId(''); setSector(''); setGeoLat(''); setGeoLng('') }
                  else { setSectorId(option.id); setSector(option.name); setGeoLat(option.latitud == null ? '' : String(option.latitud)); setGeoLng(option.longitud == null ? '' : String(option.longitud)) }
                }}
              /> : null}
              {geoError ? <Text accessibilityRole="alert" className="text-caption text-danger">{geoError}</Text> : null}
              {countryId ? <Text className="text-caption text-muted-foreground">{[sector, ciudad, region, countryName].filter(Boolean).join(' · ')}</Text> : null}
              {countryId ? <Pressable onPress={() => { if (sectorId) { setSectorId(''); setSector(''); setGeoLat(''); setGeoLng('') } else if (cityId) { setCityId(''); setCiudad('') } else if (regionId) { setRegionId(''); setRegion('') } else { setCountryId(''); setCountryName('') } }}><Text className="text-caption" style={{ color: accent }}>Cambiar selección anterior</Text></Pressable> : null}
              {(region || ciudad || sector) ? <CheckRow label="Guardar esta ubicación para personalizar mi experiencia" value={guardarUbicacion} onChange={setGuardarUbicacion} /> : null}
              {(region || ciudad || sector) ? <CheckRow label="Usar mi zona para enviarme ofertas (opcional)" value={marketingGeo} onChange={setMarketingGeo} /> : null}
            </View>
          ) : null}
          {step === 'vehCategoria' ? (
            <View className="mt-5 flex-row flex-wrap justify-between gap-2">
              {config?.vehicleTypes.map((type) => {
                const active = type.id === tipoVehiculoId
                return (
                  <Pressable key={type.id} onPress={() => { setTipoVehiculoId(type.id); setError(''); setStepIndex((value) => Math.min(value + 1, steps.length - 1)) }} className="w-[48%] rounded-xl border border-border p-4">
                    {type.iconoUrl ? <Image source={{ uri: type.iconoUrl }} resizeMode="contain" className="mb-2 h-8 w-8" /> : <Car size={20} color={active ? accent : colors.surface.mutedForeground} />}
                    <Text className="font-inter-semibold text-foreground">{type.nombre}</Text>{type.descripcion ? <Text className="text-small text-muted-foreground">{type.descripcion}</Text> : null}
                    {active ? <Check size={18} color={accent} /> : null}
                  </Pressable>
                )
              })}
            </View>
          ) : null}
          {step === 'vehMarca' ? <View><Field label="Busca o escribe la marca" value={marca} onChangeText={setMarca} autoCapitalize="words" /><View className="mt-3 flex-row flex-wrap gap-2">{config?.brandSuggestions.map((item) => <Pressable key={item} onPress={() => setMarca(item)} className="rounded-full border border-border px-3 py-2"><Text className="text-small text-foreground">{item}</Text></Pressable>)}</View></View> : null}
          {step === 'vehModelo' ? <Field label={marca ? `Modelo de tu ${marca}` : 'Modelo'} value={modelo} onChangeText={setModelo} autoCapitalize="words" /> : null}
          {step === 'vehAnio' ? <Field label={String(new Date().getFullYear())} value={anio} onChangeText={setAnio} keyboardType="numeric" /> : null}
          {step === 'vehColor' ? <View><Field label="Color del vehículo" value={color} onChangeText={setColor} autoCapitalize="words" /><View className="mt-3 flex-row flex-wrap gap-2">{config?.frequentColors.map((item) => <Pressable key={item} onPress={() => setColor(item)} className="rounded-full border border-border px-3 py-2"><Text className="text-small text-foreground">{item}</Text></Pressable>)}</View></View> : null}
          {step === 'vehPlaca' ? <View><Field label="A123456" value={placa} onChangeText={setPlaca} autoCapitalize="characters" />{placa.trim() && placa.toUpperCase().replace(/[^A-Z0-9]/g, '') !== placa.trim().toUpperCase() ? <Text className="mt-2 text-caption text-muted-foreground">Se guardará como {placa.toUpperCase().replace(/[^A-Z0-9]/g, '')}.</Text> : null}</View> : null}

          {step === 'confirmar' ? (
            <View className="mt-5 gap-4">
              <Text className="text-small text-muted-foreground">Ya casi, {nombre.trim().split(/\s+/)[0]}. {companySlug ? `Tu cuenta en ${companyName}.` : 'Tu cuenta MembeGo.'}</Text>
              <View className="gap-2 rounded-xl border border-border bg-muted p-4">
                <Summary label="Nombre" value={nombre} /><Summary label="Correo" value={email} /><Summary label="Teléfono" value={telefono} />
                {[region, ciudad, sector].filter(Boolean).length ? <Summary label="Ubicación" value={[sector, ciudad, region].filter(Boolean).join(', ')} /> : null}
                {config?.requiresVehicle ? <><Summary label="Vehículo" value={`${marca} ${modelo} ${anio}`} /><Summary label="Categoría" value={selectedType?.nombre ?? '—'} /><Summary label="Color" value={color} /><Summary label="Placa" value={placa.toUpperCase().replace(/[^A-Z0-9]/g, '')} /></> : null}
              </View>
              {!refCode ? <View className="gap-2"><Text className="text-small font-inter-medium text-foreground">¿Cómo nos conociste? *</Text><View className="flex-row flex-wrap gap-2">{config?.canalOptions.map((option) => <Pressable key={option.value} onPress={() => setCanalDeclarado(option.value)} className="rounded-full border px-3 py-2" style={{ borderColor: canalDeclarado === option.value ? accent : colors.surface.border, backgroundColor: canalDeclarado === option.value ? `${accent}20` : colors.surface.background }}><Text className="text-small text-foreground">{option.label}</Text></Pressable>)}</View></View> : null}
              {companySlug ? <CheckRow label={`Seguir a ${companyName} para recibir promociones y novedades`} value={seguirEmpresa} onChange={setSeguirEmpresa} /> : null}
              <Pressable onPress={() => setTerms(!terms)} accessibilityRole="checkbox" accessibilityState={{ checked: terms }} className="flex-row items-start gap-2"><CheckboxMark value={terms} /><Text className="flex-1 text-small text-muted-foreground">Acepto los <Text onPress={() => void Linking.openURL('https://membego.com/terms')} className="underline" style={{ color: accent }}>términos</Text> y la <Text onPress={() => void Linking.openURL('https://membego.com/privacy')} className="underline" style={{ color: accent }}>política de privacidad</Text>.</Text></Pressable>
              <CheckRow label="Quiero recibir novedades y ofertas de MembeGo por correo (opcional)" value={marketing} onChange={setMarketing} />
            </View>
          ) : null}

          <View className="mt-6 flex-row items-center gap-3">
            {stepIndex > 0 ? <Button variant="outline" onPress={back} icon={<ArrowLeft size={16} color={colors.surface.foreground} />}>Atrás</Button> : null}
            {step === 'confirmar' ? (
              <Button onPress={submit} loading={loading} disabled={!terms || (!refCode && !canalDeclarado)} className="ml-auto" style={{ backgroundColor: accent }}>
                Crear mi cuenta
              </Button>
            ) : step !== 'vehCategoria' ? (
              <Button onPress={next} className="ml-auto" style={{ backgroundColor: accent }}>
                <View className="flex-row items-center gap-2">
                  <Text className="text-sm font-inter-semibold text-white">Continuar</Text>
                  <ArrowRight size={16} color="white" />
                </View>
              </Button>
            ) : null}
          </View>
          {stepIndex === 0 ? <View className="mt-5 items-center"><Link href="/(auth)/login" className="text-small" style={{ color: accent }}>¿Ya tienes cuenta? Inicia sesión</Link></View> : null}
        </Card>
    </View>
  )
}

function Field(props: { label: string; value: string; onChangeText: (value: string) => void; autoCapitalize?: 'none' | 'words' | 'characters' | 'sentences'; keyboardType?: 'email-address' | 'phone-pad' | 'numeric'; secureTextEntry?: boolean; autoComplete?: 'name' | 'email' | 'new-password' | 'tel' }) {
  const { label, ...inputProps } = props
  return <TextInput className="mt-5 h-12 rounded-xl border border-input bg-background px-4 text-small text-foreground" accessibilityLabel={label} placeholder={label} placeholderTextColor={colors.surface.mutedForeground} autoCapitalize={props.autoCapitalize ?? 'none'} autoCorrect={false} {...inputProps} />
}

function GeoSelect({ accessibilityLabel, placeholder, value, options, accent, onSelect }: {
  accessibilityLabel: string
  placeholder: string
  value: string
  options: GeoOption[]
  accent: string
  onSelect: (option: GeoOption) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0 })
  const anchorRef = React.useRef<View>(null)
  const { height: windowHeight } = useWindowDimensions()
  const normalizedQuery = normalizeSearch(query)
  const filteredOptions = normalizedQuery
    ? options.filter((option) => normalizeSearch(option.name).includes(normalizedQuery))
    : options

  function toggleMenu() {
    if (open) {
      setOpen(false)
      setQuery('')
      return
    }
    anchorRef.current?.measureInWindow((left, top, width, height) => {
      const menuHeight = 48 + Math.min(192, options.length * 46)
      const spaceBelow = windowHeight - top - height
      const topPosition = spaceBelow < menuHeight + 12 && top > menuHeight + 12
        ? top - menuHeight - 4
        : top + height + 4
      setMenuPosition({ top: topPosition, left, width })
      setOpen(true)
    })
  }

  return (
    <View ref={anchorRef} collapsable={false}>
      <Pressable onPress={toggleMenu} disabled={options.length === 0} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ expanded: open, disabled: options.length === 0 }} className="h-12 flex-row items-center justify-between rounded-xl border border-input bg-background px-4">
        <Text className={value ? 'text-small text-foreground' : 'text-small text-muted-foreground'}>{value || placeholder}</Text>
        <ChevronDown size={18} color={accent} style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={toggleMenu}>
        <View className="flex-1">
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar opciones de ubicación" onPress={toggleMenu} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          <View style={{ position: 'absolute', top: menuPosition.top, left: menuPosition.left, width: menuPosition.width, zIndex: 50, elevation: 14 }} className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
        <View className="relative border-b border-border/60">
          <Search size={17} color={colors.surface.mutedForeground} style={{ position: 'absolute', left: 14, top: 13, zIndex: 1 }} />
          <TextInput value={query} onChangeText={setQuery} placeholder={`Buscar ${accessibilityLabel.replace(/^Seleccionar\s+/i, '').toLowerCase()}…`} placeholderTextColor={colors.surface.mutedForeground} accessibilityLabel={`Buscar ${accessibilityLabel.replace(/^Seleccionar\s+/i, '').toLowerCase()}`} autoCapitalize="none" autoCorrect={false} className="h-11 rounded-full pl-11 pr-10 text-small text-foreground" />
          {query.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Limpiar búsqueda de ubicación" onPress={() => setQuery('')} className="absolute right-3 top-3"><X size={16} color={colors.surface.mutedForeground} /></Pressable> : null}
        </View>
        {filteredOptions.length > 0 ? <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" className="max-h-48">{filteredOptions.map((option) => <Pressable key={option.id} onPress={() => { onSelect(option); setOpen(false); setQuery('') }} className="flex-row items-center border-b border-border/50 px-4 py-3"><Text className="text-small text-foreground">{option.name}</Text></Pressable>)}</ScrollView> : <Text className="px-4 py-3 text-small text-muted-foreground">No encontramos coincidencias.</Text>}
          </View>
        </View>
      </Modal>
      {options.length === 0 ? <Text className="mt-2 text-caption text-muted-foreground">No hay opciones disponibles para esta ubicación.</Text> : null}
    </View>
  )
}

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase()
}

function CheckRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <Pressable onPress={() => onChange(!value)} accessibilityRole="checkbox" accessibilityState={{ checked: value }} className="flex-row items-start gap-2"><CheckboxMark value={value} /><Text className="flex-1 text-small text-muted-foreground">{label}</Text></Pressable>
}

function CheckboxMark({ value }: { value: boolean }) {
  return <View className="mt-0.5 h-4 w-4 items-center justify-center rounded border" style={{ borderColor: value ? colors.retail.blue : colors.surface.border, backgroundColor: value ? colors.retail.blue : 'transparent' }}>{value ? <Check size={12} color="white" strokeWidth={3} /> : null}</View>
}

function Summary({ label, value }: { label: string; value: string }) {
  return <View className="flex-row justify-between gap-3"><Text className="text-small text-muted-foreground">{label}</Text><Text className="flex-1 text-right text-small font-inter-medium text-foreground">{value || '—'}</Text></View>
}
