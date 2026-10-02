import React from 'react'
import { Image, Linking, Pressable, Text, View } from 'react-native'
import { Link } from 'expo-router'
import {
  Clock,
  Compass,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  Music2,
  Phone,
} from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import { SectionHeader } from '../ui/SectionHeader'
import { CompanyPublicationsSections } from './CompanyPublicationsSections'
import { CompanyReviewsSection } from './CompanyReviewsSection'
import { formatMoney } from '../../lib/format'
import type {
  CompanyExcursionPublic,
  CompanyOwnReview,
  CompanyPostsPublic,
  CompanyPublic,
  CompanyReviewsPublic,
} from '../../lib/api'

interface ProfileLink {
  readonly label: string
  readonly value: string
  readonly href: string
  readonly Icon: LucideIcon
}

interface CompanyProfileExtraSectionsProps {
  readonly company: CompanyPublic
  readonly posts: CompanyPostsPublic | null
  readonly resenas: CompanyReviewsPublic
  readonly puedeOpinar: boolean
  readonly miResena: CompanyOwnReview | null
  readonly excursiones: readonly CompanyExcursionPublic[]
}

function redSocialUrl(red: 'instagram' | 'facebook' | 'tiktok', perfil: string): string {
  if (perfil.startsWith('http://') || perfil.startsWith('https://')) return perfil
  const nombre = perfil.replace(/^@/, '')
  return red === 'tiktok'
    ? `https://www.tiktok.com/@${nombre}`
    : `https://www.${red}.com/${nombre}`
}

export function CompanyProfileExtraSections({
  company,
  posts,
  resenas,
  puedeOpinar,
  miResena,
  excursiones,
}: CompanyProfileExtraSectionsProps) {
  const ubicacion = [company.ciudad, company.provincia, company.pais]
    .filter((parte): parte is string => Boolean(parte))
    .join(', ')
  const horario = typeof company.horario === 'string' ? company.horario.trim() : ''
  const googleMapsUrl = company.googleMapsUrl
  const contacto: readonly ProfileLink[] = [
    ...(company.email
      ? [{ label: 'Correo electrónico', value: company.email, href: `mailto:${company.email}`, Icon: Mail }]
      : []),
    ...(company.telefono
      ? [{ label: 'Teléfono', value: company.telefono, href: `tel:${company.telefono}`, Icon: Phone }]
      : []),
    ...(company.whatsapp
      ? [{ label: 'WhatsApp', value: company.whatsapp, href: `https://wa.me/${company.whatsapp.replace(/\D/g, '')}`, Icon: Phone }]
      : []),
    ...(company.website
      ? [{ label: 'Sitio web', value: company.website, href: company.website, Icon: Globe }]
      : []),
    ...(company.instagram
      ? [{ label: 'Instagram', value: company.instagram, href: redSocialUrl('instagram', company.instagram), Icon: Globe }]
      : []),
    ...(company.facebook
      ? [{ label: 'Facebook', value: company.facebook, href: redSocialUrl('facebook', company.facebook), Icon: Globe }]
      : []),
    ...(company.tiktok
      ? [{ label: 'TikTok', value: company.tiktok, href: redSocialUrl('tiktok', company.tiktok), Icon: Music2 }]
      : []),
  ]

  return (
    <>
      <CompanyPublicationsSections companyName={company.name} posts={posts} />

      {excursiones.some((excursion) => !excursion.todasFechasPasadas) ? (
        <View className="mt-8 px-4">
          <SectionHeader title="Actividades" />
          <Text className="mt-1 text-sm text-muted-foreground">
            Experiencias, parques y tours disponibles.
          </Text>
          <View className="mt-3 gap-3">
            {excursiones.filter((excursion) => !excursion.todasFechasPasadas).map((excursion) => (
              <View key={excursion.id} className="overflow-hidden rounded-xl border border-border bg-card">
                {excursion.portadaUrl ? (
                  <Image source={{ uri: excursion.portadaUrl }} className="h-44 w-full" resizeMode="cover" />
                ) : (
                  <View className="h-32 items-center justify-center bg-muted">
                    <Compass size={32} color="#9ca3af" />
                  </View>
                )}
                <View className="p-4">
                  {excursion.categoria ? <Text className="text-xs font-inter-semibold text-primary">{excursion.categoria}</Text> : null}
                  <Text className="mt-1 text-base font-inter-bold text-foreground">{excursion.nombre}</Text>
                  <View className="mt-2 flex-row flex-wrap gap-x-4 gap-y-1">
                    {excursion.duracionMin ? (
                      <View className="flex-row items-center gap-1"><Clock size={13} color="#6b7280" /><Text className="text-xs text-muted-foreground">{excursion.duracionMin} min</Text></View>
                    ) : null}
                    {excursion.ubicacion ? (
                      <View className="flex-row items-center gap-1"><MapPin size={13} color="#6b7280" /><Text className="text-xs text-muted-foreground">{excursion.ubicacion}</Text></View>
                    ) : null}
                  </View>
                  {excursion.precioDesde != null ? (
                    <Text className="mt-2 text-sm font-inter-bold text-foreground">
                      Desde {formatMoney(excursion.precioDesde, { moneda: excursion.moneda })}
                    </Text>
                  ) : null}
                  {excursion.agotadaGlobal ? <Text className="mt-2 text-xs font-inter-semibold text-destructive">Agotada</Text> : null}
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {company.galleryImages.length > 0 ? (
        <View className="mt-8 px-4">
          <SectionHeader title="Galería" />
          <View className="mt-3 flex-row flex-wrap justify-between gap-y-3">
            {company.galleryImages.map((url, index) => (
              <Image
                key={`${url}-${index}`}
                source={{ uri: url }}
                className="aspect-square w-[48%] rounded-xl bg-muted"
                resizeMode="cover"
                accessibilityLabel={`${company.name} - ${index + 1}`}
              />
            ))}
          </View>
        </View>
      ) : null}

      <CompanyReviewsSection
        companySlug={company.slug}
        companyName={company.name}
        reviews={resenas}
        canReview={puedeOpinar}
        ownReview={miResena}
      />

      <View className="mt-8 px-4">
        <SectionHeader title="Información" />
        <View className="mt-3 gap-3">
          {horario ? (
            <View className="rounded-xl border border-border bg-card p-4">
              <View className="flex-row items-center gap-2"><Clock size={17} color="#0284c7" /><Text className="text-base font-inter-semibold text-foreground">Horario de atención</Text></View>
              <Text className="mt-2 text-sm leading-relaxed text-muted-foreground">{horario}</Text>
            </View>
          ) : null}
          {ubicacion ? (
            <View className="rounded-xl border border-border bg-card p-4">
              <View className="flex-row items-center gap-2"><MapPin size={17} color="#0284c7" /><Text className="text-base font-inter-semibold text-foreground">Ubicación</Text></View>
              <Text className="mt-2 text-sm text-muted-foreground">{ubicacion}</Text>
              {googleMapsUrl ? (
                <Pressable onPress={() => Linking.openURL(googleMapsUrl)} className="mt-3 flex-row items-center gap-2 self-start rounded-lg border border-border px-3 py-2" accessibilityRole="link">
                  <Text className="text-sm font-inter-semibold text-primary">Ver en Google Maps</Text><ExternalLink size={14} color="#0284c7" />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {contacto.length > 0 ? (
            <View className="rounded-xl border border-border bg-card p-4">
              <View className="flex-row items-center gap-2"><Phone size={17} color="#0284c7" /><Text className="text-base font-inter-semibold text-foreground">Contacto y redes</Text></View>
              <View className="mt-3 gap-3">
                {contacto.map(({ label, value, href, Icon }) => (
                  <Pressable key={label} onPress={() => Linking.openURL(href)} className="flex-row items-center gap-3" accessibilityRole="link" accessibilityLabel={label}>
                    <Icon size={17} color="#0284c7" />
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-inter-semibold text-foreground">{label}</Text>
                      <Text className="text-xs text-muted-foreground" numberOfLines={1}>{value}</Text>
                    </View>
                    <ExternalLink size={14} color="#9ca3af" />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </View>

      <View className="mx-4 mt-8 items-center rounded-2xl bg-primary px-5 py-6">
        <Text className="text-lg font-inter-bold text-white">¿Te gusta {company.name}?</Text>
        <Text className="mt-2 text-center text-sm leading-relaxed text-white/85">
          Síguela para recibir sus promociones y novedades, o descubre más empresas dentro de MembeGo.
        </Text>
        <Link href="/empresas" asChild>
          <Pressable className="mt-4 rounded-full bg-card px-5 py-2.5" accessibilityRole="link">
            <Text className="text-sm font-inter-semibold text-primary">Descubrir empresas</Text>
          </Pressable>
        </Link>
      </View>
    </>
  )
}
