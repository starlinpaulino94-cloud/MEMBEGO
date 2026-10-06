import React, { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Star } from 'lucide-react-native'
import { api, type CompanyOwnReview } from '../../lib/api'
import { Button } from '../ui/Button'
import { brandDisplayForeground } from '../../lib/brand-color'
import { colors } from '../../theme/tokens'

interface CompanyReviewFormProps {
  readonly companySlug: string
  readonly companyName: string
  readonly companyColor: string
  readonly review: CompanyOwnReview | null
}

const STARS = [1, 2, 3, 4, 5] as const

function CompanyReviewFormFields({ companySlug, companyName, companyColor, review }: CompanyReviewFormProps) {
  const queryClient = useQueryClient()
  const [rating, setRating] = useState(review?.rating ?? 0)
  const [comment, setComment] = useState(review?.comment ?? '')
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: (body: CompanyOwnReview) => api.guardarResenaEmpresa(companySlug, body),
    onSuccess: async () => {
      setSuccessMessage('¡Gracias! Tu reseña quedó guardada.')
      await queryClient.invalidateQueries({ queryKey: ['cliente', 'empresa', companySlug] })
    },
  })

  const errorMessage = mutation.error instanceof Error ? mutation.error.message : null
  const cambiarCalificacion = (value: number) => {
    setRating(value)
    setSuccessMessage(null)
    mutation.reset()
  }

  return (
    <View className="mt-3 rounded-xl border border-border bg-card p-4">
      <Text className="text-sm font-inter-semibold text-foreground">
        {review ? 'Actualiza tu reseña' : `¿Cómo ha sido tu experiencia en ${companyName}?`}
      </Text>
      <View className="mt-2 flex-row items-center" accessibilityRole="radiogroup" accessibilityLabel="Calificación de 1 a 5 estrellas">
        {STARS.map((value) => {
          const selected = value <= rating
          return (
            <Pressable
              key={value}
              onPress={() => cambiarCalificacion(value)}
              className="h-11 w-11 items-center justify-center rounded-xl"
              accessibilityRole="radio"
              accessibilityLabel={`${value} estrella${value === 1 ? '' : 's'}`}
              accessibilityState={{ checked: rating === value }}
            >
              <Star size={25} color={selected ? '#f59e0b' : '#9ca3af'} fill={selected ? '#f59e0b' : 'transparent'} />
            </Pressable>
          )
        })}
      </View>
      <TextInput
        value={comment}
        onChangeText={(value) => {
          setComment(value)
          setSuccessMessage(null)
          mutation.reset()
        }}
        maxLength={600}
        multiline
        textAlignVertical="top"
        placeholder="Cuéntanos qué te gustó (opcional)…"
        accessibilityLabel="Comentario de la reseña"
        className="mt-2 min-h-24 rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground"
      />
      {errorMessage ? <Text className="mt-2 text-sm text-destructive">{errorMessage}</Text> : null}
      {successMessage ? <Text className="mt-2 text-sm font-inter-medium text-success">{successMessage}</Text> : null}
      <Button
        onPress={() => mutation.mutate({ rating, comment })}
        disabled={rating === 0 || mutation.isPending}
        loading={mutation.isPending}
        className="mt-3 w-full"
        style={{ backgroundColor: companyColor }}
      >
        <Text className="text-sm font-inter-semibold" style={{ color: brandDisplayForeground(companyColor, colors.primary.DEFAULT) }}>
          {review ? 'Guardar cambios' : 'Publicar reseña'}
        </Text>
      </Button>
    </View>
  )
}

export function CompanyReviewForm(props: CompanyReviewFormProps) {
  const reviewKey = props.review ? `${props.review.rating}-${props.review.comment ?? ''}-${props.companySlug}` : `new-${props.companySlug}`

  return <CompanyReviewFormFields key={reviewKey} {...props} />
}
