import React from 'react'
import { Text, View } from 'react-native'
import { Star } from 'lucide-react-native'
import { CompanyReviewForm } from './CompanyReviewForm'
import { SectionHeader } from '../ui/SectionHeader'
import type { CompanyOwnReview, CompanyReviewsPublic } from '../../lib/api'

interface CompanyReviewsSectionProps {
  readonly companySlug: string
  readonly companyName: string
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
  reviews,
  canReview,
  ownReview,
}: CompanyReviewsSectionProps) {
  if (reviews.total === 0 && !canReview) return null

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
            {reviews.items.map((review) => (
              <View key={review.id} className="rounded-xl border border-border bg-card p-4">
                <View className="flex-row items-center gap-3">
                  <View className="h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                    <Text className="text-xs font-inter-bold text-primary">
                      {review.clienteNombre.trim().slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-inter-semibold text-foreground">{review.clienteNombre}</Text>
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
                {review.comment ? <Text className="mt-2.5 text-sm leading-relaxed text-foreground/80">{review.comment}</Text> : null}
              </View>
            ))}
          </View>
        </>
      ) : null}
      {canReview ? <CompanyReviewForm companySlug={companySlug} companyName={companyName} review={ownReview} /> : null}
    </View>
  )
}
