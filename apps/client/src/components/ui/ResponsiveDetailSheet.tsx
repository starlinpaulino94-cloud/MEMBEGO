import { Stack, useIsFocused, useRouter } from 'expo-router'
import { createContext, useContext, type ReactNode } from 'react'
import { Platform, useWindowDimensions } from 'react-native'
import { Sheet } from './Sheet'

type StandaloneBackgroundClass = 'bg-background' | 'bg-vibe-fondo'

const ResponsiveDetailSheetContext = createContext(false)

export function useResponsiveDetailSheetBackgroundClass(
  standaloneBackgroundClass: StandaloneBackgroundClass,
): 'bg-surface-card' | StandaloneBackgroundClass {
  return useContext(ResponsiveDetailSheetContext)
    ? 'bg-surface-card'
    : standaloneBackgroundClass
}

export function useIsResponsiveDetailSheet(): boolean {
  return useContext(ResponsiveDetailSheetContext)
}

interface ResponsiveDetailSheetProps {
  readonly children: ReactNode
  readonly footer?: ReactNode
}

export function ResponsiveDetailSheet({ children, footer }: ResponsiveDetailSheetProps) {
  const router = useRouter()
  const isFocused = useIsFocused()
  const { width } = useWindowDimensions()
  const showAsSheet = width >= 768 && router.canGoBack()

  return (
    <ResponsiveDetailSheetContext.Provider value={showAsSheet}>
      <>
        <Stack.Screen
          options={{
            presentation: showAsSheet ? 'transparentModal' : 'card',
            animation: showAsSheet && Platform.OS === 'web' ? 'none' : undefined,
            contentStyle: showAsSheet ? { backgroundColor: 'transparent' } : undefined,
          }}
        />
        {showAsSheet ? (
          <Sheet
            visible={isFocused}
            onClose={() => router.back()}
            contentClassName="min-h-0 flex-1 p-0"
            footer={footer}
            contentStyle={{
              width: '95%',
              maxWidth: 680,
              height: '90%',
              alignSelf: 'center',
              overflow: 'hidden',
            }}
          >
            {children}
          </Sheet>
        ) : children}
      </>
    </ResponsiveDetailSheetContext.Provider>
  )
}
