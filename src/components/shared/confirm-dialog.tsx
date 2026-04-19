'use client'

import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'destructive' | 'warning' | 'default'
  onConfirm: () => Promise<void> | void
}

const variantConfig = {
  destructive: {
    iconColor: 'text-red-600',
    iconBg: 'bg-red-100',
    buttonClass: 'bg-red-600 hover:bg-red-700 text-white',
  },
  warning: {
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-100',
    buttonClass: 'bg-amber-600 hover:bg-amber-700 text-white',
  },
  default: {
    iconColor: 'text-black',
    iconBg: 'bg-yellow-100',
    buttonClass: 'bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold',
  },
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'destructive',
  onConfirm,
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false)
  const config = variantConfig[variant]

  async function handleConfirm() {
    setLoading(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-start gap-4">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${config.iconBg}`}>
              <AlertTriangle className={`w-5 h-5 ${config.iconColor}`} />
            </div>
            <div>
              <DialogTitle className="text-base">{title}</DialogTitle>
              <p className="text-sm text-gray-500 mt-1 leading-relaxed">{description}</p>
            </div>
          </div>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-2 mt-2">
          <DialogClose asChild>
            <Button variant="outline" disabled={loading}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button
            onClick={handleConfirm}
            disabled={loading}
            className={config.buttonClass}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Procesando...
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ConfirmDialog
