'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Plus, Search, Edit2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Cuenta {
  id: string
  codigo: string
  nombre: string
  naturaleza: string
  nivel: number
  es_movimiento: boolean
  saldo_natural: string | null
  activo: boolean
  clase: string | null
  codigo_ple: string | null
}

const COLOR_CLASE: Record<string, string> = {
  '1': 'bg-blue-100 text-blue-800 border-blue-200',
  '2': 'bg-cyan-100 text-cyan-800 border-cyan-200',
  '3': 'bg-teal-100 text-teal-800 border-teal-200',
  '4': 'bg-red-100 text-red-800 border-red-200',
  '5': 'bg-purple-100 text-purple-800 border-purple-200',
  '6': 'bg-amber-100 text-amber-800 border-amber-200',
  '7': 'bg-emerald-100 text-emerald-800 border-emerald-200',
  '8': 'bg-pink-100 text-pink-800 border-pink-200',
  '9': 'bg-gray-100 text-gray-800 border-gray-300',
}

const CLASE_NOMBRES: Record<string, string> = {
  '1': 'Activo Disponible y Exigible',
  '2': 'Activo Realizable',
  '3': 'Activo Inmovilizado',
  '4': 'Pasivo',
  '5': 'Patrimonio Neto',
  '6': 'Gastos por Naturaleza',
  '7': 'Ingresos',
  '8': 'Saldos Intermediarios',
  '9': 'Costos y Gastos por Función',
}

export default function CuentasContablesPage() {
  const router = useRouter()
  const supabase = createClient()
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [filtroClase, setFiltroClase] = useState<string>('todas')
  const [soloMovimiento, setSoloMovimiento] = useState(false)
  // Edición/creación
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    codigo: '', nombre: '', naturaleza: 'ACTIVO', nivel: 4,
    es_movimiento: true, saldo_natural: 'D' as 'D' | 'A',
  })
  const [saving, setSaving] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await (supabase as any)
      .from('cuentas_contables')
      .select('*')
      .eq('activo', true)
      .order('codigo')
    setCuentas((data ?? []) as Cuenta[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { cargar() }, [cargar])

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return cuentas.filter((c) => {
      if (filtroClase !== 'todas' && c.clase !== filtroClase) return false
      if (soloMovimiento && !c.es_movimiento) return false
      if (q.length > 0 && !c.codigo.includes(q) && !c.nombre.toLowerCase().includes(q)) return false
      return true
    })
  }, [cuentas, busqueda, filtroClase, soloMovimiento])

  const abrirNueva = () => {
    setEditingId(null)
    setForm({ codigo: '', nombre: '', naturaleza: 'ACTIVO', nivel: 4, es_movimiento: true, saldo_natural: 'D' })
    setOpen(true)
  }
  const abrirEditar = (c: Cuenta) => {
    setEditingId(c.id)
    setForm({
      codigo: c.codigo, nombre: c.nombre,
      naturaleza: c.naturaleza,
      nivel: c.nivel,
      es_movimiento: c.es_movimiento,
      saldo_natural: (c.saldo_natural as 'D' | 'A') ?? 'D',
    })
    setOpen(true)
  }

  const guardar = async () => {
    if (!form.codigo.trim() || !form.nombre.trim()) {
      toast.error('Código y nombre son obligatorios')
      return
    }
    setSaving(true)
    const payload = {
      codigo: form.codigo.trim(),
      nombre: form.nombre.trim().toUpperCase(),
      naturaleza: form.naturaleza,
      nivel: form.codigo.trim().length,
      es_movimiento: form.es_movimiento,
      saldo_natural: form.saldo_natural,
      clase: form.codigo.trim().substring(0, 1),
      activo: true,
    }
    const { error } = editingId
      ? await (supabase as any).from('cuentas_contables').update(payload).eq('id', editingId)
      : await (supabase as any).from('cuentas_contables').insert(payload)
    setSaving(false)
    if (error) {
      toast.error('Error al guardar', { description: error.message })
      return
    }
    toast.success(editingId ? 'Cuenta actualizada' : 'Cuenta creada')
    setOpen(false)
    cargar()
  }

  // Conteo por clase
  const porClase = useMemo(() => {
    const m = new Map<string, number>()
    cuentas.forEach((c) => {
      if (!c.clase) return
      m.set(c.clase, (m.get(c.clase) ?? 0) + 1)
    })
    return m
  }, [cuentas])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Plan de Cuentas</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            PCGE Modificado · {cuentas.length} cuentas · {cuentas.filter((c) => c.es_movimiento).length} de movimiento
          </p>
        </div>
        <Button onClick={abrirNueva} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <Plus className="w-4 h-4" />
          Nueva subcuenta
        </Button>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFiltroClase('todas')}
            className={`px-3 py-1 text-xs font-semibold rounded-full border ${
              filtroClase === 'todas' ? 'bg-black text-white border-black' : 'bg-white text-gray-600 border-gray-200'
            }`}
          >
            Todas ({cuentas.length})
          </button>
          {['1', '2', '3', '4', '5', '6', '7', '9'].map((cl) => {
            const count = porClase.get(cl) ?? 0
            if (count === 0) return null
            return (
              <button
                key={cl}
                onClick={() => setFiltroClase(cl)}
                className={`px-3 py-1 text-xs font-semibold rounded-full border ${
                  filtroClase === cl ? COLOR_CLASE[cl] : 'bg-white text-gray-600 border-gray-200'
                }`}
                title={CLASE_NOMBRES[cl]}
              >
                Clase {cl} ({count})
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por código o nombre..."
              className="pl-8 h-9 text-sm"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
            <input type="checkbox" checked={soloMovimiento} onChange={(e) => setSoloMovimiento(e.target.checked)}
              className="w-3.5 h-3.5 accent-blue-600" />
            Solo cuentas de movimiento
          </label>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : filtradas.length === 0 ? (
          <p className="text-center py-12 text-gray-400 text-sm">Sin cuentas que coincidan</p>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left p-2 font-semibold text-gray-600 w-20">Código</th>
                  <th className="text-left p-2 font-semibold text-gray-600 w-16">Clase</th>
                  <th className="text-left p-2 font-semibold text-gray-600">Nombre</th>
                  <th className="text-left p-2 font-semibold text-gray-600 w-24">Naturaleza</th>
                  <th className="text-center p-2 font-semibold text-gray-600 w-20">Saldo</th>
                  <th className="text-center p-2 font-semibold text-gray-600 w-24">Movimiento</th>
                  <th className="w-12"></th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((c) => (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                    <td className="p-2 font-mono text-xs font-semibold">{c.codigo}</td>
                    <td className="p-2">
                      {c.clase && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${COLOR_CLASE[c.clase] ?? ''}`}>
                          {c.clase}
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      <div style={{ paddingLeft: `${(c.nivel - 1) * 8}px` }}>
                        <span className={c.nivel <= 2 ? 'font-bold' : c.nivel <= 3 ? 'font-semibold' : 'font-normal'}>
                          {c.nombre}
                        </span>
                      </div>
                    </td>
                    <td className="p-2 text-[10px] text-gray-500">{c.naturaleza}</td>
                    <td className="p-2 text-center">
                      <span className={`inline-block w-6 h-5 rounded text-[10px] font-bold leading-5 ${
                        c.saldo_natural === 'D' ? 'bg-blue-100 text-blue-800' :
                        c.saldo_natural === 'A' ? 'bg-amber-100 text-amber-800' : ''
                      }`}>
                        {c.saldo_natural ?? '—'}
                      </span>
                    </td>
                    <td className="p-2 text-center">
                      {c.es_movimiento ? (
                        <span className="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded font-bold">✓ Sí</span>
                      ) : (
                        <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">Agrupadora</span>
                      )}
                    </td>
                    <td className="p-2 text-center">
                      <button onClick={() => abrirEditar(c)}
                        className="text-gray-500 hover:bg-gray-100 rounded p-1" title="Editar">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dialog crear/editar */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar cuenta' : 'Nueva subcuenta'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <Label className="text-xs font-semibold">Código *</Label>
              <Input value={form.codigo} onChange={(e) => setForm((p) => ({ ...p, codigo: e.target.value.replace(/\D/g, '') }))}
                className="mt-1 font-mono" maxLength={8} disabled={!!editingId}
                placeholder="ej: 10112" />
              <p className="text-[10px] text-gray-500 mt-0.5">El padre se determina automáticamente (ej: 10112 cuelga de 1011).</p>
            </div>
            <div>
              <Label className="text-xs font-semibold">Nombre *</Label>
              <Input value={form.nombre} onChange={(e) => setForm((p) => ({ ...p, nombre: e.target.value }))} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold">Naturaleza</Label>
                <select value={form.naturaleza} onChange={(e) => setForm((p) => ({ ...p, naturaleza: e.target.value }))}
                  className="mt-1 w-full h-9 px-2 text-sm border border-gray-300 rounded-md bg-white">
                  <option value="ACTIVO">ACTIVO</option>
                  <option value="PASIVO">PASIVO</option>
                  <option value="PATRIMONIO">PATRIMONIO</option>
                  <option value="INGRESO">INGRESO</option>
                  <option value="GASTO">GASTO</option>
                  <option value="COSTO">COSTO</option>
                  <option value="ORDEN">ORDEN</option>
                </select>
              </div>
              <div>
                <Label className="text-xs font-semibold">Saldo natural</Label>
                <select value={form.saldo_natural} onChange={(e) => setForm((p) => ({ ...p, saldo_natural: e.target.value as 'D' | 'A' }))}
                  className="mt-1 w-full h-9 px-2 text-sm border border-gray-300 rounded-md bg-white">
                  <option value="D">D - Débito</option>
                  <option value="A">A - Acreedor</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.es_movimiento}
                onChange={(e) => setForm((p) => ({ ...p, es_movimiento: e.target.checked }))}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-sm">Es cuenta de movimiento (admite asientos directos)</span>
            </label>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={guardar} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
