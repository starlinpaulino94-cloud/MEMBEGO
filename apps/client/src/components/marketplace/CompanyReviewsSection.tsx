import React, { useState } from 'react'
import { Text, View, TouchableOpacity, Linking } from 'react-native'
import { Star, Flag } from 'lucide-react-native'
import { CompanyReviewForm } from './CompanyReviewForm'
import { ReportarResenaModal } from './ReportarResenaModal'
import { SectionHeader } from '../ui/SectionHeader'
import type { CompanyOwnReview, CompanyReviewsPublic } from '../../lib/api'

interface CompanyReviewsSectionProps {
  readonly companySlug: string
  readonly companyName: string
  readonly companyColor: string
  readonly reviews: CompanyReviewsPublic
  readonly canReview: boolean
  readonly ownReview: CompanyOwnReview | null
}

function fechaResena(fecha: string): string {
  return new Intl.DateTimeFormat('es-DO', {
    timeZone: 'America/Santo_Domingo',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(fecha))
}

export function CompanyReviewsSection({
  companySlug,
  companyName,
  companyColor,
  reviews,
  canReview,
  ownReview,
}: CompanyReviewsSectionProps) {
  const [selectedReview, setSelectedReview] = useState<{ id: string; clienteNombre: string; comment: string | null } | null>(null)
  const [reportedIds, setReportedIds] = useState<string[]>([])
  const [blockedAuthors, setBlockedAuthors] = useState<string[]>([])

  if (reviews.total === 0 && !canReview) return null

  const itemsVisibles = reviews.items.filter(
    (r) => !reportedIds.includes(r.id) && !blockedAuthors.includes(r.clienteNombre)
  )

  return (
    <View className="mt-8 px-4">
      <SectionHeader title="Reseñas" />
      {reviews.total > 0 ? (
        <>
          <View className="mt-3 flex-row items-center gap-4 rounded-xl border border-border bg-card p-4">
            <View className="items-center">
              <Text className="text-2xl font-inter-bold text-foreground">
                {reviews.promedio != null && Number.isFinite(reviews.promedio) ? reviews.promedio.toFixed(1) : '—'}
              </Text>
              <View className="mt-1 flex-row">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star key={star} size={13} color="#f59e0b" fill={star <= Math.round(reviews.promedio ?? 0) ? '#f59e0b' : 'transparent'} />
                ))}
              </View>
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-inter-semibold text-foreground">
                {reviews.total} reseña{reviews.total === 1 ? '' : 's'} de clientes
              </Text>
              <Text className="mt-0.5 text-xs text-muted-foreground">Opiniones reales de miembros de esta empresa.</Text>
            </View>
          </View>
          <View className="mt-3 gap-3">
            {itemsVisibles.map((review) => (
              <View key={review.id} className="rounded-xl border border-border bg-card p-4">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-3 flex-1 min-w-0 pr-2">
                    <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: `${companyColor}1A` }}>
                      <Text className="text-xs font-inter-bold" style={{ color: companyColor }}>
                        {review.clienteNombre.trim().slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-inter-semibold text-foreground" numberOfLines={1}>
                        {review.clienteNombre}
                      </Text>
                      <View className="mt-0.5 flex-row items-center gap-2">
                        <View className="flex-row">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star key={star} size={12} color="#f59e0b" fill={star <= review.rating ? '#f59e0b' : 'transparent'} />
                          ))}
                        </View>
                        <Text className="text-xs text-muted-foreground">{fechaResena(review.fecha)}</Text>
                      </View>
                    </View>
                  </View>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Reportar o bloquear reseña de ${review.clienteNombre}`}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    onPress={() => setSelectedReview(review)}
                    className="p-1 rounded-lg"
                  >
                    <Flag size={14} color="#9ca3af" />
                  </TouchableOpacity>
                </View>
                {review.comment ? <Text className="mt-2.5 text-sm leading-relaxed text-foreground/80">{review.comment}</Text> : null}
              </View>
            ))}
          </View>

          {/* Aviso normativo EULA/Términos para UGC */}
          <View className="mt-3.5 rounded-xl bg-surface-muted/40 p-3">
            <Text className="text-[11px] leading-4 text-muted-foreground">
              Las opiniones deben respetar nuestras{' '}
              <Text
                className="font-inter-semibold text-primary underline"
                onPress={() => void Linking.openURL('https://membego.com/terms')}
              >
                Normas de la Comunidad
              </Text>
              . El contenido ofensivo, spam o fraudulento será removido por el equipo de moderación.
            </Text>
          </View>
        </>
      ) : null}
      {canReview ? <CompanyReviewForm companySlug={companySlug} companyName={companyName} companyColor={companyColor} review={ownReview} /> : null}

      <ReportarResenaModal
        visible={!!selectedReview}
        resena={selectedReview}
        companySlug={companySlug}
        onClose={() => setSelectedReview(null)}
        onReportSuccess={(id) => setReportedIds((prev) => [...prev, id])}
        onBlockAuthor={(author) => setBlockedAuthors((prev) => [...prev, author])}
      />
    </View>
  )
}
