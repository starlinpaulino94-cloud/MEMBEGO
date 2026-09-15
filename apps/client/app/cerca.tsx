/**
 * Ruta base para /cerca — expo-router requiere un archivo sin sufijo de plataforma.
 * Selecciona la implementación correcta según la plataforma en runtime.
 */
import { Platform } from 'react-native'
import CercaWeb from './cerca.web'
import CercaNative from './cerca.native'

export default Platform.OS === 'web' ? CercaWeb : CercaNative
