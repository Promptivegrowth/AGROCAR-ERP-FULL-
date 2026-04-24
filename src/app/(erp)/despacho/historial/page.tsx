import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Truck, ArrowLeft, Package } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import HistorialClient from './historial-client'

export const dynamic = 'force-dynamic'

async function getData() {
  const supabase = await createClient()
  // Vista flota en vivo (incluye todos los despachos con métricas)
  const { data: despachos } = await (supabase as any)
    .from('v_flota_en_vivo')
    .select('*')
    .order('fecha_despacho', { ascending: false })
    .limit(80)
  return { despachos: despachos ?? [] }
}

export default async function HistorialDespachosPage() {
  const { despachos } = await getData()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/despacho" className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-1">
            <ArrowLeft className="w-3 h-3" /> Volver a Despacho
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Truck className="w-6 h-6" /> Despachos & Flota
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Vehículos en ruta y historial de consolidaciones</p>
        </div>
      </div>

      {despachos.length === 0 ? (
        <Card className="border-gray-200 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Package className="w-10 h-10 mb-3 text-gray-300" />
            <p className="text-sm">Aún no hay despachos consolidados</p>
          </CardContent>
        </Card>
      ) : (
        <HistorialClient despachosIniciales={despachos} />
      )}
    </div>
  )
}
