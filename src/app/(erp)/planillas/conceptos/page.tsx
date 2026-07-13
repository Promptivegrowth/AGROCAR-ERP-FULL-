'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Plus, Settings2, Edit2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Concepto {
  id: string
  codigo: string
  nombre: string
  tipo: 'ingreso' | 'descuento' | 'aporte_empleador'
  metodo: string
  porcentaje: number | null
  afecta_essalud: boolean
  afecta_pension: boolean
  afecta_renta5ta: boolean
  afecta_cts: boolean
  afecta_grati: boolean
  cuenta_contable: string | null
  cuenta_contrapartida: string | null
  activo: boolean
  es_sistema: boolean
}

const TIPO_BADGE: Record<string, string> = {
  ingreso: 'bg-emerald-100 text-emerald-800',
  descuento: 'bg-red-100 text-red-800',
  aporte_empleador: 'bg-blue-100 text-blue-800',
}

export default function ConceptosPage() {
  const router = useRouter()
  const supabase = createClient()
  const [conceptos, setConceptos] = useState<Concepto[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Concepto | null>(null)
  const [form, setForm] = useState({
    codigo: '', nombre: '', tipo: 'ingreso' as Concepto['tipo'],
    cuenta_contable: '', cuenta_contrapartida: '',
    afecta_essalud: true, afecta_pension: true, afecta_renta5ta: true,
    afecta_cts: true, afecta_grati: true,
  })

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await (supabase as any).from('conceptos_remunerativos').select('*').order('orden')
    setConceptos((data ?? []) as Concepto[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => {
    setEditing(null)
    setForm({ codigo: '', nombre: '', tipo: 'ingreso', cuenta_contable: '6211', cuenta_contrapartida: '411',
      afecta_essalud: true, afecta_pension: true, afecta_renta5ta: true, afecta_cts: true, afecta_grati: true })
    setOpen(true)
  }

  const abrirEditar = (c: Concepto) => {
    setEditing(c)
    setForm({
      codigo: c.codigo, nombre: c.nombre, tipo: c.tipo,
      cuenta_contable: c.cuenta_contable ?? '', cuenta_contrapartida: c.cuenta_contrapartida ?? '',
      afecta_essalud: c.afecta_essalud, afecta_pension: c.afecta_pension,
      afecta_renta5ta: c.afecta_renta5ta, afecta_cts: c.afecta_cts, afecta_grati: c.afecta_grati,
    })
    setOpen(true)
  }

  const guardar = async () => {
    if (!form.codigo.trim() || !form.nombre.trim()) { toast.error('Código y nombre obligatorios'); return }
    setSaving(true)
    const payload = {
      codigo: form.codigo.trim().toUpperCase().replace(/\s+/g, '_'),
      nombre: form.nombre.trim(),
      tipo: form.tipo,
      metodo: 'manual',
      cuenta_contable: form.cuenta_contable.trim() || null,
      cuenta_contrapartida: form.cuenta_contrapartida.trim() || null,
      afecta_essalud: form.afecta_essalud,
      afecta_pension: form.afecta_pension,
      afecta_renta5ta: form.afecta_renta5ta,
      afecta_cts: form.afecta_cts,
      afecta_grati: form.afecta_grati,
    }
    const { error } = editing
      ? await (supabase as any).from('conceptos_remunerativos').update(payload).eq('id', editing.id)
      : await (supabase as any).from('conceptos_remunerativos').insert({ ...payload, orden: 500 })
    setSaving(false)
    if (error) { toast.error('Error', { description: error.message }); return }
    toast.success(editing ? 'Concepto actualizado' : 'Concepto creado')
    setOpen(false)
    cargar()
  }

  const Check = ({ v }: { v: boolean }) => (
    <span className={v ? 'text-emerald-600 font-bold' : 'text-gray-300'}>{v ? '✓' : '·'}</span>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Settings2 className="w-6 h-6 text-purple-600" />
            Conceptos Remunerativos
          </h1>
          <p className="text-sm text-gray-500">
            Cada concepto define su cuenta contable y sobre qué bases tributa
          </p>
        </div>
        <Button onClick={abrirNuevo} className="bg-purple-600 hover:bg-purple-700 gap-1">
          <Plus className="w-4 h-4" /> Nuevo concepto
        </Button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left p-2 font-semibold text-gray-600 w-28">Código</th>
                  <th className="text-left p-2 font-semibold text-gray-600">Nombre</th>
                  <th className="text-center p-2 font-semibold text-gray-600 w-24">Tipo</th>
                  <th className="text-center p-2 font-semibold text-gray-600 w-16">% </th>
                  <th className="text-center p-2 font-semibold text-gray-600 w-20">Cta. gasto</th>
                  <th className="text-center p-2 font-semibold text-gray-600 w-20">Cta. contra</th>
                  <th className="text-center p-2 font-semibold text-gray-600 w-14" title="Afecta EsSalud">EsS</th>
                  <th className="text-center p-2 font-semibold text-gray-600 w-14" title="Afecta ONP/AFP">Pen</th>
                  <th className="text-center p-2 font-semibold text-gray-600 w-14" title="Afecta Renta 5ta">R5</th>
                  <th className="text-center p-2 font-semibold text-gray-600 w-14" title="Afecta CTS">CTS</th>
                  <th className="text-center p-2 font-semibold text-gray-600 w-14" title="Afecta gratificación">Grat</th>
                  <th className="w-12"></th>
                </tr>
              </thead>
              <tbody>
                {conceptos.map((c) => (
                  <tr key={c.id} className={`border-b border-gray-100 ${!c.activo ? 'opacity-40' : ''}`}>
                    <td className="p-2 font-mono font-bold">{c.codigo}</td>
                    <td className="p-2">{c.nombre} {c.es_sistema && <span className="text-[9px] text-gray-400">(sistema)</span>}</td>
                    <td className="p-2 text-center">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${TIPO_BADGE[c.tipo]}`}>
                        {c.tipo === 'aporte_empleador' ? 'APORTE' : c.tipo.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-2 text-center font-mono">{c.porcentaje ?? ''}</td>
                    <td className="p-2 text-center font-mono">{c.cuenta_contable ?? '—'}</td>
                    <td className="p-2 text-center font-mono">{c.cuenta_contrapartida ?? '—'}</td>
                    <td className="p-2 text-center"><Check v={c.afecta_essalud} /></td>
                    <td className="p-2 text-center"><Check v={c.afecta_pension} /></td>
                    <td className="p-2 text-center"><Check v={c.afecta_renta5ta} /></td>
                    <td className="p-2 text-center"><Check v={c.afecta_cts} /></td>
                    <td className="p-2 text-center"><Check v={c.afecta_grati} /></td>
                    <td className="p-2 text-center">
                      <button onClick={() => abrirEditar(c)} className="text-gray-500 hover:bg-gray-100 rounded p-1">
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Editar concepto' : 'Nuevo concepto'}</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Código *</Label>
                <Input value={form.codigo} onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))}
                  className="mt-1 font-mono" disabled={!!editing && editing.es_sistema} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Nombre *</Label>
                <Input value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Tipo</Label>
                <select value={form.tipo} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value as any }))}
                  disabled={!!editing && editing.es_sistema}
                  className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                  <option value="ingreso">Ingreso</option>
                  <option value="descuento">Descuento</option>
                  <option value="aporte_empleador">Aporte empleador</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Cuenta gasto (PCGE)</Label>
                <Input value={form.cuenta_contable} onChange={(e) => setForm((f) => ({ ...f, cuenta_contable: e.target.value }))}
                  className="mt-1 font-mono" placeholder="6211" />
              </div>
              <div>
                <Label className="text-xs">Cuenta contrapartida</Label>
                <Input value={form.cuenta_contrapartida} onChange={(e) => setForm((f) => ({ ...f, cuenta_contrapartida: e.target.value }))}
                  className="mt-1 font-mono" placeholder="411" />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Afectaciones (sobre qué bases computa)</Label>
              <div className="grid grid-cols-5 gap-2">
                {([
                  ['afecta_essalud', 'EsSalud'],
                  ['afecta_pension', 'ONP/AFP'],
                  ['afecta_renta5ta', 'Renta 5ta'],
                  ['afecta_cts', 'CTS'],
                  ['afecta_grati', 'Gratif.'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-1 text-xs cursor-pointer">
                    <input type="checkbox" checked={(form as any)[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
                      className="w-3.5 h-3.5 accent-purple-600" />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={guardar} disabled={saving} className="bg-purple-600 hover:bg-purple-700">
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
