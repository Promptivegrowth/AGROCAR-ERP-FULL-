import { createClient } from '@/lib/supabase/server'
import LotesClient from './lotes-client'

export const dynamic = 'force-dynamic'

export default async function LotesPage() {
  const supabase = await createClient()

  const [{ data: lotes }, { data: productos }] = await Promise.all([
    supabase
      .from('lotes')
      .select(`
        id, numero_lote, fecha_vencimiento, cantidad_inicial, cantidad_actual, activo, created_at,
        productos(id, codigo, nombre, descripcion, tiene_lote, tiene_vencimiento,
          unidades_medida(simbolo),
          stock(costo_promedio)
        )
      `)
      .order('fecha_vencimiento', { ascending: true, nullsFirst: false }),
    supabase
      .from('productos')
      .select('id, nombre')
      .eq('activo', true)
      .order('nombre'),
  ])

  return (
    <LotesClient
      initialLotes={(lotes ?? []) as any[]}
      productos={(productos ?? []) as any[]}
    />
  )
}
