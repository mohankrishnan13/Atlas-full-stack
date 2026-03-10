'use client'

import { Toaster as SonnerToaster } from 'sonner'

export function Sonner() {
  return (
    <SonnerToaster
      theme="dark"
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            'bg-slate-950/90 border border-slate-800 text-slate-100 shadow-xl backdrop-blur',
          title: 'text-slate-100',
          description: 'text-slate-300',
          actionButton: 'bg-slate-100 text-slate-900',
          cancelButton: 'bg-slate-800 text-slate-100',
        },
      }}
    />
  )
}
