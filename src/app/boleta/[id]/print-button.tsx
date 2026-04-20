'use client'

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="text-xs text-gray-500 hover:text-gray-700 underline"
    >
      Imprimir / Guardar como PDF
    </button>
  )
}
