import React, { useState } from 'react'
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import * as DocumentPicker from 'expo-document-picker'
import { FileCheck2, Upload } from 'lucide-react-native'
import { Button } from '../ui/Button'
import { api } from '../../lib/api'
import { supabase } from '../../lib/supabase'

interface CuentaTransferencia {
  id: string
  nombre: string
  titular: string | null
  numeroCuenta: string | null
  tipoCuenta: string | null
  instrucciones: string | null
}

interface Props {
  membershipId: string
  cuentas: readonly CuentaTransferencia[]
  color: string
}

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
}

export function ComprobanteMembresiaForm({ membershipId, cuentas, color }: Props) {
  const queryClient = useQueryClient()
  const [metodoPagoId, setMetodoPagoId] = useState(cuentas[0]?.id ?? '')
  const [fileName, setFileName] = useState('')
  const [uploading, setUploading] = useState(false)

  const handleSelectFile = async () => {
    const selection = await DocumentPicker.getDocumentAsync({
      type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
      copyToCacheDirectory: true,
      multiple: false,
    })
    if (selection.canceled) return

    const asset = selection.assets[0]
    if (!asset) return
    const extension = asset.name.split('.').pop()?.toLowerCase() ?? ''
    const contentType = asset.mimeType ?? MIME_BY_EXTENSION[extension]
    if (!MIME_BY_EXTENSION[extension] || !contentType || !Object.values(MIME_BY_EXTENSION).includes(contentType)) {
      Alert.alert('Formato no permitido', 'Adjunta una imagen JPG, PNG, WebP o un archivo PDF.')
      return
    }

    setUploading(true)
    try {
      const fileBody = asset.file ?? await fetch(asset.uri).then((response) => response.blob())
      if (!fileBody) throw new Error('No se pudo leer el archivo seleccionado.')
      const fileSize = asset.size ?? fileBody.size
      if (fileSize > MAX_FILE_BYTES) {
        Alert.alert('Archivo muy grande', 'El comprobante no puede superar 5 MB.')
        return
      }

      const signed = await api.prepararSubidaComprobante(membershipId, extension)
      const { error } = await supabase.storage
        .from('comprobantes')
        .uploadToSignedUrl(signed.subida.path, signed.subida.token, fileBody, { contentType })
      if (error) throw error

      await api.enviarComprobanteMembresia(membershipId, {
        path: signed.subida.path,
        metodoPagoId: metodoPagoId || undefined,
      })
      setFileName(asset.name)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cliente', 'membresia-pago', membershipId] }),
        queryClient.invalidateQueries({ queryKey: ['cliente', 'membresias'] }),
      ])
    } catch (error) {
      Alert.alert(
        'No se pudo enviar el comprobante',
        error instanceof Error ? error.message : 'Intenta de nuevo en unos minutos.',
      )
    } finally {
      setUploading(false)
    }
  }

  return (
    <View className="gap-3">
      {cuentas.length > 1 && (
        <View className="gap-2">
          <Text className="text-small font-inter-semibold text-foreground">Cuenta de transferencia</Text>
          {cuentas.map((cuenta) => {
            const selected = metodoPagoId === cuenta.id
            return (
              <Pressable
                key={cuenta.id}
                onPress={() => setMetodoPagoId(cuenta.id)}
                className="rounded-xl border p-3"
                style={{ borderColor: selected ? color : '#d5dce7', backgroundColor: selected ? `${color}0D` : '#ffffff' }}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
              >
                <Text className="text-small font-inter-semibold text-foreground">{cuenta.nombre}</Text>
                {!!cuenta.titular && <Text className="mt-0.5 text-caption text-muted-foreground">Titular: {cuenta.titular}</Text>}
                {!!cuenta.numeroCuenta && <Text className="mt-0.5 text-caption text-muted-foreground">{cuenta.numeroCuenta}{cuenta.tipoCuenta ? ` · ${cuenta.tipoCuenta}` : ''}</Text>}
                {!!cuenta.instrucciones && <Text className="mt-1 text-caption leading-4 text-muted-foreground">{cuenta.instrucciones}</Text>}
              </Pressable>
            )
          })}
        </View>
      )}
      {cuentas.length === 1 && (
        <View className="rounded-xl border border-border bg-background p-3">
          <Text className="text-small font-inter-semibold text-foreground">{cuentas[0].nombre}</Text>
          {!!cuentas[0].titular && <Text className="mt-0.5 text-caption text-muted-foreground">Titular: {cuentas[0].titular}</Text>}
          {!!cuentas[0].numeroCuenta && <Text className="mt-0.5 text-caption text-muted-foreground">{cuentas[0].numeroCuenta}{cuentas[0].tipoCuenta ? ` · ${cuentas[0].tipoCuenta}` : ''}</Text>}
          {!!cuentas[0].instrucciones && <Text className="mt-1 text-caption leading-4 text-muted-foreground">{cuentas[0].instrucciones}</Text>}
        </View>
      )}
      {fileName ? (
        <View className="flex-row items-center gap-2 rounded-xl bg-success/10 p-3">
          <FileCheck2 size={18} color="#00864d" />
          <Text className="flex-1 text-small font-inter-semibold text-success">{fileName} enviado</Text>
        </View>
      ) : (
        <Button onPress={handleSelectFile} disabled={uploading} style={{ backgroundColor: color }}>
          {uploading ? <ActivityIndicator size="small" color="#ffffff" /> : <Upload size={16} color="#ffffff" />}
          <Text className="ml-2 text-small font-inter-semibold text-white">
            {uploading ? 'Subiendo comprobante…' : 'Adjuntar comprobante'}
          </Text>
        </Button>
      )}
    </View>
  )
}
