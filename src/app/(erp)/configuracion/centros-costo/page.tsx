'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Plus, Edit2, MapPin } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface CentroCosto {
  id: string
  codigo: string
  nombre: string
  tipo: string
  padre_id: string | null
  descripcion: string | null
  activo: boolean
}

const TIPOS = ['administrativo', 'ventas', 'produccion', 'logistica', 'operativo', 'general'] as const
const COLOR_TIPO: Record<string, string> = {
  administrativo: 'bg-blue-100 text-blue-800',
  ventas: 'bg-emerald-100 text-emerald-800',
  produccion: 'bg-purple-100 text-purple-800',
  logistica: 'bg-amber-100 text-amber-800',
  operativo: 'bg-gray-100 text-gray-800',
  general: 'bg-gray-100 text-gray-600',
}

export default function CentrosCostoPage() {
  const router = useRouter()
  const supabase = createClient()
  const [ccs, setCcs] = useState<CentroCosto[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CentroCosto | null>(null)
  const [form, setForm] = useState({
    codigo: '', nombre: '', tipo: 'operativo' as (typeof TIPOS)[number],
    padre_id: '', descripcion: '',
  })
  const [saving, setSaving] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await (supabase as any).from('centros_costo').select('*').order('codigo')
    setCcs((data ?? []) as CentroCosto[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => {
    setEditing(null)
    setForm({ codigo: '', nombre: '', tipo: 'operativo', padre_id: '', descripcion: '' })
    setOpen(true)
  }
  const abrirEditar = (cc: CentroCosto) => {
    setEditing(cc)
    setForm({
      codigo: cc.codigo, nombre: cc.nombre, tipo: cc.tipo as any,
      padre_id: cc.padre_id ?? '', descripcion: cc.descripcion ?? '',
    })
    setOpen(true)
  }

  const guardar = async () => {
    if (!form.codigo.trim() || !form.nombre.trim()) {
      toast.error('Código y nombre son obligatorios'); return
    }
    setSaving(true)
    const payload = {
      codigo: form.codigo.trim().toUpperCase(),
      nombre: form.nombre.trim(),
      tipo: form.tipo,
      padre_id: form.padre_id || null,
      descripcion: form.descripcion.trim() || null,
    }
    const { error } = editing
      ? await (supabase as any).from('centros_costo').update(payload).eq('id', editing.id)
      : await (supabase as any).from('centros_costo').insert(payload)
    setSaving(false)
    if (error) {
      toast.error('Error al guardar', { description: error.message }); return
    }
    toast.success(editing ? 'Actualizado' : 'Creado')
    setOpen(false)
    cargar()
  }

  const toggleActivo = async (cc: CentroCosto) => {
    await (supabase as any).from('centros_costo').update({ activo: !cc.activo }).eq('id', cc.id)
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
            <MapPin className="w-6 h-6 text-indigo-600" />
            Centros de Costo
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Segmentación de ingresos y gastos por área de la empresa
          </p>
        </div>
        <Button onClick={abrirNuevo} className="bg-indigo-600 hover:bg-indigo-700 gap-2">
          <Plus className="w-4 h-4" />
          Nuevo centro
        </Button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-2 font-semibold text-gray-600 w-20">Código</th>
                <th className="text-left p-2 font-semibold text-gray-600">Nombre</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-32">Tipo</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-32">Padre</th>
                <th className="text-center p-2 font-semibold text-gray-600 w-24">Estado</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {ccs.map((cc) => {
                const padre = ccs.find((c) => c.id === cc.padre_id)
                return (
                  <tr key={cc.id} className={`border-b border-gray-100 hover:bg-gray-50/60 ${!cc.activo ? 'opacity-50' : ''}`}>
                    <td className="p-2 font-mono font-bold">{cc.codigo}</td>
                    <td className="p-2">
                      <p className="font-medium">{cc.nombre}</p>
                      {cc.descripcion && <p className="text-[10px] text-gray-500">{cc.descripcion}</p>}
                    </td>
                    <td className="p-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${COLOR_TIPO[cc.tipo]}`}>
                        {cc.tipo}
                      </span>
                    </td>
                    <td className="p-2 text-xs text-gray-500">{padre?.codigo ?? '—'}</td>
                    <td className="p-2 text-center">
                      <button onClick={() => toggleActivo(cc)}
                        className={`text-[10px] px-2 py-0.5 rounded font-bold ${cc.activo ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}`}>
                        {cc.activo ? 'Activo' : 'Inactivo'}
                      </button>
                    </td>
                    <td className="p-2 text-center">
                      <button onClick={() => abrirEditar(cc)} className="text-gray-500 hover:bg-gray-100 rounded p-1">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar centro de costo' : 'Nuevo centro de costo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Código *</Label>
                <Input value={form.codigo} onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value.toUpperCase() }))}
                  className="mt-1 font-mono" maxLength={10} disabled={!!editing} placeholder="ej: ADM" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Nombre *</Label>
                <Input value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Tipo</Label>
                <select value={form.tipo} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value as any }))}
                  className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white capitalize">
                  {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Padre (opcional)</Label>
                <select value={form.padre_id} onChange={(e) => setForm((f) => ({ ...f, padre_id: e.target.value }))}
                  className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                  <option value="">— Sin padre —</option>
                  {ccs.filter((c) => c.id !== editing?.id).map((c) => (
                    <option key={c.id} value={c.id}>{c.codigo} - {c.nombre}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Descripción</Label>
              <Input value={form.descripcion} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} className="mt-1" />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={guardar} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700">
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
