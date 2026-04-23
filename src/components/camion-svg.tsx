'use client'

type Props = {
  /** 'zona' = camión grande, 'auxiliar' = camioneta */
  tipo?: 'zona' | 'auxiliar'
  /** Porcentaje 0-100 para tintar el contenedor según carga */
  cargaPct?: number
  /** Color principal del camión */
  color?: string
  className?: string
}

/**
 * Ilustración simple de camión/camioneta en SVG.
 * El contenedor cambia de color según la carga:
 *  - verde (<60%), amarillo (60-85%), rojo (>85%)
 */
export default function CamionSVG({ tipo = 'zona', cargaPct = 0, color = '#1f2937', className }: Props) {
  const isGrande = tipo === 'zona'
  const cargaColor = cargaPct >= 85 ? '#ef4444' : cargaPct >= 60 ? '#f59e0b' : '#10b981'
  const cargaColorLight = cargaPct >= 85 ? '#fecaca' : cargaPct >= 60 ? '#fde68a' : '#a7f3d0'

  if (isGrande) {
    // Camión grande (zona) — cabina + contenedor largo
    return (
      <svg viewBox="0 0 200 90" xmlns="http://www.w3.org/2000/svg" className={className}>
        {/* Sombra */}
        <ellipse cx="100" cy="82" rx="90" ry="3" fill="#000" opacity="0.1" />

        {/* Contenedor (caja de carga) */}
        <rect x="8" y="18" width="118" height="52" rx="4" fill={cargaColorLight} stroke={cargaColor} strokeWidth="2" />
        {/* Puerta trasera */}
        <rect x="8" y="22" width="6" height="44" rx="1" fill={cargaColor} opacity="0.6" />
        {/* Líneas decorativas de la caja */}
        <line x1="20" y1="30" x2="120" y2="30" stroke={cargaColor} strokeWidth="1" opacity="0.3" />
        <line x1="20" y1="58" x2="120" y2="58" stroke={cargaColor} strokeWidth="1" opacity="0.3" />
        {/* Nivel de carga interno */}
        {cargaPct > 0 && (
          <rect
            x="11"
            y={18 + 52 * (1 - Math.min(cargaPct, 100) / 100)}
            width="112"
            height={52 * Math.min(cargaPct, 100) / 100}
            rx="3"
            fill={cargaColor}
            opacity="0.35"
          />
        )}

        {/* Cabina */}
        <path d="M126 30 L150 30 L160 44 L180 44 L180 70 L126 70 Z" fill={color} />
        {/* Ventana cabina */}
        <path d="M130 34 L148 34 L156 44 L130 44 Z" fill="#fef3c7" stroke={color} strokeWidth="0.5" />
        {/* Detalle cabina */}
        <rect x="162" y="48" width="16" height="4" rx="1" fill="#fbbf24" />

        {/* Ruedas */}
        <circle cx="34" cy="74" r="8" fill="#111" />
        <circle cx="34" cy="74" r="3" fill="#6b7280" />
        <circle cx="60" cy="74" r="8" fill="#111" />
        <circle cx="60" cy="74" r="3" fill="#6b7280" />
        <circle cx="100" cy="74" r="8" fill="#111" />
        <circle cx="100" cy="74" r="3" fill="#6b7280" />
        <circle cx="158" cy="74" r="8" fill="#111" />
        <circle cx="158" cy="74" r="3" fill="#6b7280" />
      </svg>
    )
  }

  // Camioneta auxiliar — más compacta
  return (
    <svg viewBox="0 0 160 90" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Sombra */}
      <ellipse cx="80" cy="82" rx="70" ry="3" fill="#000" opacity="0.1" />

      {/* Tolva trasera (contenedor abierto) */}
      <rect x="8" y="34" width="78" height="36" rx="3" fill={cargaColorLight} stroke={cargaColor} strokeWidth="2" />
      <line x1="8" y1="46" x2="86" y2="46" stroke={cargaColor} strokeWidth="1" opacity="0.3" />
      {cargaPct > 0 && (
        <rect
          x="10"
          y={34 + 36 * (1 - Math.min(cargaPct, 100) / 100)}
          width="74"
          height={36 * Math.min(cargaPct, 100) / 100}
          rx="2"
          fill={cargaColor}
          opacity="0.35"
        />
      )}

      {/* Cabina */}
      <path d="M86 34 L112 34 L124 48 L140 48 L140 70 L86 70 Z" fill={color} />
      {/* Ventana */}
      <path d="M90 38 L110 38 L120 48 L90 48 Z" fill="#fef3c7" stroke={color} strokeWidth="0.5" />
      {/* Faros */}
      <rect x="136" y="52" width="6" height="4" rx="1" fill="#fbbf24" />

      {/* Ruedas */}
      <circle cx="30" cy="74" r="7" fill="#111" />
      <circle cx="30" cy="74" r="2.5" fill="#6b7280" />
      <circle cx="70" cy="74" r="7" fill="#111" />
      <circle cx="70" cy="74" r="2.5" fill="#6b7280" />
      <circle cx="122" cy="74" r="7" fill="#111" />
      <circle cx="122" cy="74" r="2.5" fill="#6b7280" />
    </svg>
  )
}
