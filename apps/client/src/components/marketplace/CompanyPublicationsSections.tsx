import React from 'react'
import { Text, View } from 'react-native'
import { BadgeCheck, CalendarDays, Newspaper } from 'lucide-react-native'
import { SectionHeader } from '../ui/SectionHeader'
import type { CompanyPostsPublic } from '../../lib/api'

interface CompanyPublicationsSectionsProps {
  readonly companyName: string
  readonly companyColor: string
  readonly posts: CompanyPostsPublic | null
}

function fechaLocal(fecha: string, opciones: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('es-DO', {
    timeZone: 'America/Santo_Domingo',
    ...opciones,
  }).format(new Date(fecha))
}

export function CompanyPublicationsSections({ companyName, companyColor, posts }: CompanyPublicationsSectionsProps) {
  return (
    <>
      {posts && posts.beneficios.length > 0 ? (
        <View className="mt-8 px-4">
          <SectionHeader title="Beneficios para miembros" />
          <Text className="mt-1 text-sm text-muted-foreground">
            Ventajas permanentes por ser miembro de {companyName}.
          </Text>
          <View className="mt-3 gap-3">
            {posts.beneficios.map((beneficio) => (
              <View key={beneficio.id} className="rounded-xl border border-success/20 bg-success/10 p-4">
                <View className="flex-row items-center gap-1.5">
                  <BadgeCheck size={15} color="#22c55e" />
                  <Text className="text-xs font-inter-semibold text-success">Beneficio</Text>
                </View>
                <Text className="mt-2 text-base font-inter-bold text-foreground">{beneficio.titulo}</Text>
                <Text className="mt-1 text-sm leading-relaxed text-muted-foreground">{beneficio.contenido}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {posts && posts.eventos.length > 0 ? (
        <View className="mt-8 px-4">
          <SectionHeader title="Próximos eventos" />
          <View className="mt-3 gap-3">
            {posts.eventos.map((evento) => (
              <View key={evento.id} className="flex-row gap-3 rounded-xl border border-border bg-card p-4">
                <View className="h-14 w-14 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${companyColor}1A` }}>
                  <CalendarDays size={20} color={companyColor} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-base font-inter-bold text-foreground">{evento.titulo}</Text>
                  <Text className="mt-1 text-sm leading-relaxed text-muted-foreground">{evento.contenido}</Text>
                  {evento.fechaEvento ? (
                    <Text className="mt-2 text-xs font-inter-medium" style={{ color: companyColor }}>
                      {fechaLocal(evento.fechaEvento, { dateStyle: 'medium', timeStyle: 'short' })}
                    </Text>
                  ) : null}
                  {evento.lugar ? <Text className="mt-1 text-xs text-muted-foreground">{evento.lugar}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {posts && posts.noticias.length > 0 ? (
        <View className="mt-8 px-4">
          <SectionHeader title="Noticias" />
          <View className="mt-3 gap-3">
            {posts.noticias.map((noticia) => (
              <View key={noticia.id} className="rounded-xl border border-border bg-card p-4">
                <View className="flex-row items-center gap-2">
                  <Newspaper size={15} color="#6b7280" />
                  <Text className="text-xs text-muted-foreground">
                    {fechaLocal(noticia.publicadaEn, { dateStyle: 'long' })}
                  </Text>
                </View>
                <Text className="mt-2 text-base font-inter-bold text-foreground">{noticia.titulo}</Text>
                <Text className="mt-1 text-sm leading-relaxed text-muted-foreground">{noticia.contenido}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </>
  )
}
