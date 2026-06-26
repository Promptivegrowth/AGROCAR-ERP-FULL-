'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Save, Copy, Target } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'

interface Vendedor { id: string; nombre: string }
interface Familia { id: string; nombre: string }

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre']

export default function CuotasPage() {
  const router = useRouter()
  const supabase = createClient()
  const ahora = new Date()
  const [anio, setAnio] = useState(ahora.getFullYear())
  const [mes, setMes] = useState(ahora.getMonth() + 1)
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [familias, setFamilias] = useState<Familia[]>([])
  // Mapa "vendedorId:familiaId" → cuota_monto
  const [cuotas, setCuotas] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    const [{ data: vs }, { data: fs }, { data: cs }] = await Promise.all([
      (supabase as any).from('profiles').select('id, full_name, email')
        .eq('role', 'vendedor').eq('activo', true).order('full_name'),
      (supabase as any).from('familias').select('id, nombre').order('nombre'),
      (supabase as any).from('cuotas_vendedor_familia').select('*').eq('anio', anio).eq('mes', mes),
    ])
    setVendedores((vs ?? []).map((v: any) => ({ id: v.id, nombre: v.full_name || v.email })))
    setFamilias((fs ?? []) as Familia[])
    const m = new Map<string, number>()
    ;(cs ?? []).forEach((c: any) => { m.set(`${c.vendedor_id}:${c.familia_id}`, Number(c.cuota_monto)) })
    setCuotas(m)
    setDirty(false)
    setLoading(false)
  }, [supabase, anio, mes])

  useEffect(() => { cargar() }, [cargar])

  const setCuota = (vendedorId: string, familiaId: string, valor: string) => {
    const monto = parseFloat(valor) || 0
    setCuotas((prev) => {
      const next = new Map(prev)
      const key = `${vendedorId}:${familiaId}`
      if (monto === 0) next.delete(key); else next.set(key, monto)
      return next
    })
    setDirty(true)
  }

  // Totales por fila (vendedor) y columna (familia)
  const totales = useMemo(() => {
    const porVendedor = new Map<string, number>()
    const porFamilia = new Map<string, number>()
    let total = 0
    cuotas.forEach((monto, key) => {
      const [vid, fid] = key.split(':')
      porVendedor.set(vid, (porVendedor.get(vid) ?? 0) + monto)
      porFamilia.set(fid, (porFamilia.get(fid) ?? 0) + monto)
      total += monto
    })
    return { porVendedor, porFamilia, total }
  }, [cuotas])

  const guardar = async () => {
    setSaving(true)
    const payload: any[] = []
    vendedores.forEach((v) => familias.forEach((f) => {
      payload.push({
        vendedor_id: v.id,
        familia_id: f.id,
        cuota_monto: cuotas.get(`${v.id}:${f.id}`) ?? 0,
      })
    }))
    const { error } = await (supabase.rpc as any)('upsert_cuotas_mes', {
      p_anio: anio, p_mes: mes, p_cuotas: payload,
    })
    setSaving(false)
    if (error) { toast.error('Error al guardar', { description: error.message }); return }
    toast.success(`Cuotas guardadas para ${MESES[mes-1]} ${anio}`)
    setDirty(false)
  }

  const copiarAnterior = async () => {
    if (dirty && !confirm('Tienes cambios sin guardar. ¿Descartar y copiar del mes anterior?')) return
    const { data, error } = await (supabase.rpc as any)('copiar_cuotas_mes_anterior', {
      p_anio: anio, p_mes: mes,
    })
    if (error) { toast.error('Error', { description: error.message }); return }
    toast.success(`${data ?? 0} cuotas copiadas del mes anterior`)
    cargar()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Target className="w-6 h-6 text-blue-600" />
            Cuotas Mensuales por Vendedor × Familia
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Objetivo de venta mensual (subtotal sin IGV) por cada vendedor y familia
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-[10px] text-gray-500">Mes</Label>
          <select value={mes} onChange={(e) => setMes(parseInt(e.target.value))}
            className="block mt-1 h-9 px-2 text-sm border border-gray-300 rounded-md bg-white">
            {MESES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-[10px] text-gray-500">Año</Label>
          <Input type="number" value={anio} onChange={(e) => setAnio(parseInt(e.target.value) || ahora.getFullYear())}
            className="w-24 h-9 text-sm" min={2024} max={2100} />
        </div>
        <Button variant="outline" size="sm" onClick={copiarAnterior} disabled={loading || saving} className="gap-1 h-9">
          <Copy className="w-3.5 h-3.5" /> Copiar mes anterior
        </Button>
        <div className="flex-1" />
        {dirty && <span className="text-xs font-semibold text-amber-700">⚠ Cambios sin guardar</span>}
        <Button onClick={guardar} disabled={saving || !dirty} className="bg-blue-600 hover:bg-blue-700 gap-1">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Guardar
        </Button>
      </div>

      {/* Matriz */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : vendedores.length === 0 ? (
          <p className="text-center py-12 text-gray-400 text-sm">Sin vendedores activos</p>
        ) : familias.length === 0 ? (
          <p className="text-center py-12 text-gray-400 text-sm">Sin familias creadas</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left p-2 font-semibold text-gray-700 border-b border-r border-gray-200 sticky left-0 bg-gray-50 z-10 min-w-[180px]">
                    Vendedor ↓ / Familia →
                  </th>
                  {familias.map((f) => (
                    <th key={f.id} className="text-center p-2 font-semibold text-gray-700 border-b border-gray-200 min-w-[120px]">
                      {f.nombre}
                    </th>
                  ))}
                  <th className="text-right p-2 font-bold text-gray-700 border-b border-gray-200 bg-blue-50 min-w-[120px]">
                    TOTAL VEND.
                  </th>
                </tr>
              </thead>
              <tbody>
                {vendedores.map((v) => (
                  <tr key={v.id} className="border-b border-gray-100">
                    <td className="p-2 font-semibold sticky left-0 bg-white border-r border-gray-200 z-10">
                      {v.nombre}
                    </td>
                    {familias.map((f) => {
                      const valor = cuotas.get(`${v.id}:${f.id}`) ?? 0
                      return (
                        <td key={f.id} className="p-1">
                          <Input type="number" min="0" step="100"
                            value={valor || ''}
                            placeholder="0"
                            onChange={(e) => setCuota(v.id, f.id, e.target.value)}
                            className="h-8 text-xs text-right font-mono w-full" />
                        </td>
                      )
                    })}
                    <td className="p-2 text-right font-mono font-bold bg-blue-50">
                      {formatCurrency(totales.porVendedor.get(v.id) ?? 0)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-amber-50 border-t-2 border-amber-300 font-bold">
                  <td className="p-2 sticky left-0 bg-amber-50 border-r border-gray-200 z-10">TOTAL FAM.</td>
                  {familias.map((f) => (
                    <td key={f.id} className="p-2 text-right font-mono text-xs">
                      {formatCurrency(totales.porFamilia.get(f.id) ?? 0)}
                    </td>
                  ))}
                  <td className="p-2 text-right font-mono bg-amber-200">{formatCurrency(totales.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-xs text-gray-500">
        💡 Vacía o 0 = sin cuota. Después de guardar, mira el cumplimiento en{' '}
        <a href={`/reportes/cumplimiento-cuotas?anio=${anio}&mes=${mes}`} className="underline text-blue-700">
          Reportes → Cumplimiento de cuotas
        </a>.
      </div>
    </div>
  )
}
