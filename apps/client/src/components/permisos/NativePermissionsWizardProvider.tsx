import React, { createContext, useContext } from 'react'

interface WizardContextValue {
  readonly openWizard: () => void
}

interface ProviderProps {
  readonly children: React.ReactNode
}

const PermissionWizardContext = createContext<WizardContextValue>({ openWizard: () => undefined })

export function useNativePermissionsWizard(): WizardContextValue {
  return useContext(PermissionWizardContext)
}

export function NativePermissionsWizardProvider({ children }: ProviderProps) {
  return (
    <PermissionWizardContext.Provider value={{ openWizard: () => undefined }}>
      {children}
    </PermissionWizardContext.Provider>
  )
}
