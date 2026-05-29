import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Obtiene los IDs de zona asignadas a un usuario (vendedor).
 *
 * Primero busca en profile_zonas (modelo multi-zona).
 * Si está vacío, hace fallback al campo legacy profiles.zona_id (single-zona).
 */
export async function getZonasAsignadasIds(
  supabase: SupabaseClient<any>,
  userId: string,
): Promise<string[]> {
  const { data: pz } = await (supabase as any)
    .from('profile_zonas')
    .select('zona_id')
    .eq('profile_id', userId)
  const ids = (pz ?? []).map((p: any) => p.zona_id).filter(Boolean) as string[]
  if (ids.length > 0) return ids

  const { data: prof } = await supabase
    .from('profiles')
    .select('zona_id')
    .eq('id', userId)
    .single()
  const single = (prof as any)?.zona_id
  return single ? [single] : []
}

/**
 * Filtro de visibilidad de clientes para un usuario PWA.
 *
 * - Repartidor: ve TODOS los clientes activos (no filtra).
 * - Vendedor: ve los clientes de sus zonas asignadas. Si no tiene zonas
 *   asignadas, fallback al filtro legacy clientes.vendedor_id = user.id.
 * - Otros roles: por defecto ven todos (decisión del caller).
 */
export async function getClientesIdsVisiblesParaPwa(
  supabase: SupabaseClient<any>,
  userId: string,
  role: string | null | undefined,
): Promise<{ filtrar: boolean; zonasAsignadas: string[]; usarFallbackVendedor: boolean }> {
  if (role === 'repartidor') {
    return { filtrar: false, zonasAsignadas: [], usarFallbackVendedor: false }
  }
  if (role === 'vendedor') {
    const zonas = await getZonasAsignadasIds(supabase, userId)
    if (zonas.length > 0) {
      return { filtrar: true, zonasAsignadas: zonas, usarFallbackVendedor: false }
    }
    // sin zonas asignadas → fallback al legado por vendedor_id directo
    return { filtrar: true, zonasAsignadas: [], usarFallbackVendedor: true }
  }
  // Otros roles: no filtrar (los administrativos no usan PWA normalmente)
  return { filtrar: false, zonasAsignadas: [], usarFallbackVendedor: false }
}
