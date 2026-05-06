'use client'

import { DIAS, ATAJOS_DIAS, type DiaSemana } from '@/lib/dias-visita'

type Props = {
  value: string[]
  onChange: (next: string[]) => void
}

/** Selector de días con 7 checkboxes + atajos rápidos. */
export default function DiasVisitaSelector({ value, onChange }: Props) {
  const set = new Set(value)
  const toggle = (k: DiaSemana) => {
    const next = new Set(set)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    onChange(Array.from(next))
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 flex-wrap">
        {DIAS.map((d) => {
          const activo = set.has(d.key)
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => toggle(d.key)}
              title={d.label}
              className={`
                w-9 h-9 rounded-lg font-bold text-sm transition-colors
                ${activo
                  ? 'bg-yellow-400 text-gray-900 shadow-sm'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}
              `}
            >
              {d.short}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-gray-400">Atajos:</span>
        {Object.entries(ATAJOS_DIAS).map(([nombre, dias]) => (
          <button
            key={nombre}
            type="button"
            onClick={() => onChange([...dias])}
            className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 hover:bg-blue-100"
          >
            {nombre}
          </button>
        ))}
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="px-2 py-0.5 rounded text-gray-500 hover:bg-gray-50"
          >
            Limpiar
          </button>
        )}
      </div>
    </div>
  )
}
