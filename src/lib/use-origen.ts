'use client'

import { useEffect, useState } from 'react'

/**
 * La dirección del sitio (https://agrocar-erp-full.vercel.app), leída en el
 * navegador.
 *
 * Los enlaces de WhatsApp se armaban con
 *   typeof window !== 'undefined' ? window.location.origin : ''
 * durante el render. La página se arma primero en el servidor —donde no hay
 * window— y React no corrige los atributos al hidratar: el mensaje salía con
 * "/reporte-publico/…" sin dominio y el cliente no podía abrirlo (Daniel,
 * 01/10). Con esto el valor llega recién en el navegador; mientras tanto es
 * vacío y quien lo usa no arma el enlace.
 */
export function useOrigen(): string {
  const [origen, setOrigen] = useState('')
  useEffect(() => { setOrigen(window.location.origin) }, [])
  return origen
}
