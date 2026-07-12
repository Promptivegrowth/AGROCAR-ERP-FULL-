'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Plus, Search, Edit2, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Tercero {
  id: string
  tipo_doc: 'DNI' | 'CE' | 'RUC' | 'PASAPORTE' | 'OTRO'
  numero_doc: string
  nombres: string
  apellidos: string | null
  telefono: string | null
  direccion: string | null
  ocupacion: string | null
  notas: string | null
  activo: boolean
  created_at: string
}

const TIPOS_DOC = ['DNI', 'CE', 'RUC', 'PASAPORTE', 'OTRO'] as const

export default function TercerosPage() {
  const router = useRouter()
  const supabase = createClient()
  const [terceros, setTerceros] = useState<Tercero[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Tercero | null>(null)
  const [form, setForm] = useState({
    tipo_doc: 'DNI' as (typeof TIPOS_DOC)[number],
    numero_doc: '',
    nombres: '',
    apellidos: '',
    telefono: '',
    direccion: '',
    ocupacion: '',
    notas: '',
  })
  const [saving, setSaving] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data } = await (supabase as any)
      .from('terceros')
      .select('*')
      .eq('activo', true)
      .order('nombres')
    setTerceros((data ?? []) as Tercero[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { cargar() }, [cargar])

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return terceros
    return terceros.filter((t) =>
      t.nombres.toLowerCase().includes(q) ||
      (t.apellidos ?? '').toLowerCase().includes(q) ||
      t.numero_doc.includes(q) ||
      (t.ocupacion ?? '').toLowerCase().includes(q))
  }, [terceros, busqueda])

  const abrirNuevo = () => {
    setEditing(null)
    setForm({ tipo_doc: 'DNI', numero_doc: '', nombres: '', apellidos: '', telefono: '', direccion: '', ocupacion: '', notas: '' })
    setOpen(true)
  }
  const abrirEditar = (t: Tercero) => {
    setEditing(t)
    setForm({
      tipo_doc: t.tipo_doc,
      numero_doc: t.numero_doc,
      nombres: t.nombres,
      apellidos: t.apellidos ?? '',
      telefono: t.telefono ?? '',
      direccion: t.direccion ?? '',
      ocupacion: t.ocupacion ?? '',
      notas: t.notas ?? '',
    })
    setOpen(true)
  }

  const guardar = async () => {
    if (!form.numero_doc.trim() || !form.nombres.trim()) {
      toast.error('Documento y nombres son obligatorios')
      return
    }
    setSaving(true)
    const payload = {
      tipo_doc: form.tipo_doc,
      numero_doc: form.numero_doc.trim(),
      nombres: form.nombres.trim().toUpperCase(),
      apellidos: form.apellidos.trim().toUpperCase() || null,
      telefono: form.telefono.trim() || null,
      direccion: form.direccion.trim() || null,
      ocupacion: form.ocupacion.trim() || null,
      notas: form.notas.trim() || null,
    }
    const { error } = editing
      ? await (supabase as any).from('terceros').update(payload).eq('id', editing.id)
      : await (supabase as any).from('terceros').insert(payload)
    setSaving(false)
    if (error) {
      toast.error('Error al guardar', { description: error.message })
      return
    }
    toast.success(editing ? 'Tercero actualizado' : 'Tercero creado')
    setOpen(false)
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
            <Users className="w-6 h-6 text-purple-600" />
            Terceros
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Personas naturales que no son clientes ni proveedores (estibadores, taxis, servicios ocasionales)
          </p>
        </div>
        <Button onClick={abrirNuevo} className="bg-purple-600 hover:bg-purple-700 gap-2">
          <Plus className="w-4 h-4" />
          Nuevo tercero
        </Button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, DNI u ocupación..."
            className="pl-9"
          />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : filtrados.length === 0 ? (
          <p className="text-center py-12 text-gray-400 text-sm">
            {busqueda ? 'Sin coincidencias' : 'Sin terceros registrados. Crea el primero.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-2 font-semibold text-gray-600 w-16">Tipo</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-32">Documento</th>
                <th className="text-left p-2 font-semibold text-gray-600">Nombres y apellidos</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-40">Ocupación</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-32">Teléfono</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((t) => (
                <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                  <td className="p-2 text-xs">
                    <span className="inline-block px-1.5 py-0.5 bg-purple-100 text-purple-800 rounded font-bold">
                      {t.tipo_doc}
                    </span>
                  </td>
                  <td className="p-2 font-mono text-xs">{t.numero_doc}</td>
                  <td className="p-2">
                    <div className="font-medium">{t.nombres} {t.apellidos ?? ''}</div>
                  </td>
                  <td className="p-2 text-xs text-gray-600">{t.ocupacion ?? '—'}</td>
                  <td className="p-2 text-xs font-mono">{t.telefono ?? '—'}</td>
                  <td className="p-2 text-center">
                    <button onClick={() => abrirEditar(t)} className="text-gray-500 hover:bg-gray-100 rounded p-1" title="Editar">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar tercero' : 'Nuevo tercero'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Tipo documento *</Label>
                <select value={form.tipo_doc}
                  onChange={(e) => setForm((f) => ({ ...f, tipo_doc: e.target.value as any }))}
                  className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                  {TIPOS_DOC.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Número *</Label>
                <Input value={form.numero_doc} onChange={(e) => setForm((f) => ({ ...f, numero_doc: e.target.value }))} className="mt-1 font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Nombres *</Label>
                <Input value={form.nombres} onChange={(e) => setForm((f) => ({ ...f, nombres: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Apellidos</Label>
                <Input value={form.apellidos} onChange={(e) => setForm((f) => ({ ...f, apellidos: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Teléfono</Label>
                <Input value={form.telefono} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} className="mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-xs">Ocupación / servicio</Label>
                <Input value={form.ocupacion} onChange={(e) => setForm((f) => ({ ...f, ocupacion: e.target.value }))} className="mt-1" placeholder="Ej: estibador, taxista..." />
              </div>
            </div>
            <div>
              <Label className="text-xs">Dirección</Label>
              <Input value={form.direccion} onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Notas</Label>
              <Input value={form.notas} onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} className="mt-1" />
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
