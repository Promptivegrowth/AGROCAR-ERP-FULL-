'use client'

import { Printer } from 'lucide-react'

export default function CierreActions() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100]"
    >
      <Printer className="w-3.5 h-3.5" />
      Imprimir / PDF
    </button>
  )
}
