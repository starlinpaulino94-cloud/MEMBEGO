import { Pressable, Text, View } from 'react-native'
import { ArrowLeft } from 'lucide-react-native'

interface BackHeaderProps {
  readonly title: string
  readonly leftInset: number
  readonly onBack?: () => void
}

export function BackHeader({ title, leftInset, onBack }: BackHeaderProps) {
  return (
    <View
      className="flex-row items-center gap-2 border-b border-border"
      style={{
        paddingLeft: leftInset + 16,
        paddingRight: 16,
        paddingTop: 12,
        paddingBottom: 12,
      }}
    >
      {onBack ? (
        <Pressable
          onPress={onBack}
          className="rounded-lg p-2 active:bg-muted"
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <ArrowLeft size={20} color="#111827" />
        </Pressable>
      ) : null}
      <Text className="text-lg font-inter-bold text-foreground">{title}</Text>
    </View>
  )
}
