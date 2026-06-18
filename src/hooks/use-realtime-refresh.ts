'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Hook que escucha cambios en una o varias tablas de Supabase y dispara
 * un callback (típicamente una recarga de datos) cuando hay actividad.
 *
 * Usa Supabase Realtime (postgres_changes). Suscribirse a varias tablas a
 * la vez es barato porque comparte la misma conexión WebSocket.
 *
 * Ejemplo:
 *   useRealtimeRefresh(['cobros', 'caja_movimientos'], () => recargar())
 *
 * Notas operativas:
 * - Debounce 600ms para evitar refrescos seguidos cuando llegan 5 eventos
 *   simultáneos (por ejemplo al insertar cobro + aplicación + movimiento).
 * - Cleanup en unmount.
 * - Solo se suscribe en el cliente (no en SSR).
 */
export function useRealtimeRefresh(
  tables: string[],
  callback: () => void | Promise<void>,
  options?: { event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*'; debounceMs?: number },
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (typeof window === 'undefined') return
    const supabase = createClient()
    const event = options?.event ?? '*'
    const debounceMs = options?.debounceMs ?? 600

    let pending: ReturnType<typeof setTimeout> | null = null
    const triggerRefresh = () => {
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => {
        callbackRef.current()
      }, debounceMs)
    }

    const channel = supabase.channel(`realtime-${tables.join('-')}-${Math.random().toString(36).slice(2, 8)}`)
    tables.forEach((table) => {
      channel.on(
        'postgres_changes' as any,
        { event, schema: 'public', table },
        () => triggerRefresh(),
      )
    })
    channel.subscribe()

    return () => {
      if (pending) clearTimeout(pending)
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(','), options?.event, options?.debounceMs])
}
