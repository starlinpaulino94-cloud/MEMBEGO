import type { CardnetCaptureSession } from '../../../lib/api'
import type { CardnetCaptureConfig } from './security'

export type CardnetCaptureFailure =
  | 'session_invalid'
  | 'script_load_failed'
  | 'widget_unavailable'
  | 'provider_message_rejected'
  | 'navigation_rejected'

export interface CardnetCaptureSurfaceProps {
  readonly session: CardnetCaptureSession
  readonly config: CardnetCaptureConfig
  readonly disabled?: boolean
  readonly onToken: (token: string) => void
  readonly onError: (reason: CardnetCaptureFailure) => void
}
