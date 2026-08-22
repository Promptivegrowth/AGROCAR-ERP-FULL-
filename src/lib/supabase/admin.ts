import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Cliente Supabase con service_role — bypasa RLS.
 * USAR SOLO en rutas controladas del servidor (API routes, server components
 * con acceso público controlado como la boleta pública).
 * NUNCA exponer al cliente.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    /**
     * Sin cache.
     *
     * Next guarda las respuestas de las lecturas y las vuelve a servir sin
     * preguntar a la base. Para datos que cambian a cada segundo eso devuelve
     * cosas viejas: la cola de impresion se veia vacia aunque el ticket ya
     * estuviera esperando, porque la primera consulta —cuando no habia nada—
     * quedo guardada. Con service_role siempre queremos el dato real.
     */
    global: {
      fetch: (entrada: any, opciones: any = {}) =>
        fetch(entrada, { ...opciones, cache: 'no-store' }),
    },
  })
}
