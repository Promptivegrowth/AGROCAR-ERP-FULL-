'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Plus, Boxes, Zap, Edit2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'

interface ActivoFijo {
  id: string
  codigo: string
  descripcion: string
  marca: string | null
  modelo: string | null
  fecha_adquisicion: string
  valor_adquisicion: number
  vida_util_anios: number
  porcentaje_depreciacion: number | null
  depreciacion_acumulada: number
  cuenta_activo: string
  cuenta_gasto: string
  estado: string
  centro_costo_id: string | null
}

interface CentroCosto { id: string; codigo: string; nombre: string }

// Porcentajes SUNAT de referencia (art. 22 Reglamento LIR)
const PCT_SUNAT = [
  { pct: 5, label: '5% — Edificios y construcciones' },
  { pct: 10, label: '10% — Muebles, enseres, maquinaria general' },
  { pct: 20, label: '20% — Vehículos de transporte' },
  { pct: 25, label: '25% — Equipos de cómputo' },
  { pct: 10, label: '10% — Otros bienes' },
]

const CUENTAS_ACTIVO = [
  { codigo: '334', nombre: 'Unidades de transporte' },
  { codigo: '335', nombre: 'Muebles y enseres' },
  { codigo: '3361', nombre: 'Equipos de cómputo' },
]

export default function ActivosFijosPage() {
  const router = useRouter()
  const supabase = createClient()
  const [activos, setActivos] = useState<ActivoFijo[]>([])
  const [centros, setCentros] = useState<CentroCosto[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [depreciando, setDepreciando] = useState(false)

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ActivoFijo | null>(null)
  const [form, setForm] = useState({
    codigo: '', descripcion: '', marca: '', modelo: '',
    fecha_adquisicion: hoyLima(), valor_adquisicion: '',
    porcentaje_depreciacion: '10', cuenta_activo: '335',
    centro_costo_id: '', notas: '',
  })

  const ahora = new Date()
  const [depAnio, setDepAnio] = useState(ahora.getFullYear())
  const [depMes, setDepMes] = useState(ahora.getMonth() + 1)

  const cargar = useCallback(async () => {
    setLoading(true)
    const [{ data: afs }, { data: ccs }] = await Promise.all([
      (supabase as any).from('activos_fijos').select('*').order('codigo'),
      (supabase as any).from('centros_costo').select('id, codigo, nombre').eq('activo', true).order('codigo'),
    ])
    setActivos((afs ?? []) as ActivoFijo[])
    setCentros((ccs ?? []) as CentroCosto[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => {
    setEditing(null)
    const nextNum = activos.length + 1
    setForm({
      codigo: `AF-${String(nextNum).padStart(3, '0')}`, descripcion: '', marca: '', modelo: '',
      fecha_adquisicion: hoyLima(), valor_adquisicion: '',
      porcentaje_depreciacion: '10', cuenta_activo: '335',
      centro_costo_id: '', notas: '',
    })
    setOpen(true)
  }

  const abrirEditar = (af: ActivoFijo) => {
    setEditing(af)
    setForm({
      codigo: af.codigo, descripcion: af.descripcion, marca: af.marca ?? '', modelo: af.modelo ?? '',
      fecha_adquisicion: af.fecha_adquisicion, valor_adquisicion: af.valor_adquisicion.toString(),
      porcentaje_depreciacion: af.porcentaje_depreciacion?.toString() ?? '10',
      cuenta_activo: af.cuenta_activo, centro_costo_id: af.centro_costo_id ?? '', notas: '',
    })
    setOpen(true)
  }

  const guardar = async () => {
    if (!form.codigo.trim() || !form.descripcion.trim()) { toast.error('Código y descripción obligatorios'); return }
    const valor = parseFloat(form.valor_adquisicion)
    if (isNaN(valor) || valor <= 0) { toast.error('Valor de adquisición inválido'); return }
    const pct = parseFloat(form.porcentaje_depreciacion)
    if (isNaN(pct) || pct <= 0 || pct > 100) { toast.error('% depreciación inválido'); return }

    setSaving(true)
    const payload = {
      codigo: form.codigo.trim().toUpperCase(),
      descripcion: form.descripcion.trim(),
      marca: form.marca.trim() || null,
      modelo: form.modelo.trim() || null,
      fecha_adquisicion: form.fecha_adquisicion,
      valor_adquisicion: valor,
      porcentaje_depreciacion: pct,
      vida_util_anios: Math.max(1, Math.round(100 / pct)),
      cuenta_activo: form.cuenta_activo,
      centro_costo_id: form.centro_costo_id || null,
    }
    const { error } = editing
      ? await (supabase as any).from('activos_fijos').update(payload).eq('id', editing.id)
      : await (supabase as any).from('activos_fijos').insert(payload)
    setSaving(false)
    if (error) { toast.error('Error', { description: error.message }); return }
    toast.success(editing ? 'Activo actualizado' : 'Activo registrado')
    setOpen(false)
    cargar()
  }

  const depreciar = async () => {
    if (!confirm(`¿Generar la depreciación de ${depMes}/${depAnio}? Se crea UN asiento consolidado en borrador con todos los activos pendientes.`)) return
    setDepreciando(true)
    const { data, error } = await (supabase.rpc as any)('generar_depreciacion_mensual', {
      p_anio: depAnio, p_mes: depMes,
    })
    setDepreciando(false)
    if (error) { toast.error('Error', { description: error.message }); return }
    if (!data?.activos_depreciados) {
      toast.info(data?.mensaje ?? 'Sin activos pendientes')
      return
    }
    toast.success(`Depreciación generada: ${data.activos_depreciados} activos · ${formatCurrency(data.total)}`, {
      description: `Asiento ${data.numero_asiento} en borrador. Revísalo en el Libro Diario.`,
    })
    cargar()
  }

  const totalValor = activos.reduce((a, af) => a + Number(af.valor_adquisicion), 0)
  const totalDep = activos.reduce((a, af) => a + Number(af.depreciacion_acumulada), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Boxes className="w-6 h-6 text-amber-600" />
            Activos Fijos
          </h1>
          <p className="text-sm text-gray-500">Registro PLE 7.1 · depreciación línea recta con % SUNAT</p>
        </div>
        <div className="flex items-center gap-1">
          <select value={depMes} onChange={(e) => setDepMes(parseInt(e.target.value))}
            className="h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
            {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
          </select>
          <select value={depAnio} onChange={(e) => setDepAnio(parseInt(e.target.value))}
            className="h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
            {[depAnio + 1, depAnio, depAnio - 1].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <Button variant="outline" onClick={depreciar} disabled={depreciando} className="gap-1 border-amber-300 text-amber-700">
            {depreciando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Depreciar mes
          </Button>
        </div>
        <Button onClick={abrirNuevo} className="bg-amber-600 hover:bg-amber-700 gap-1">
          <Plus className="w-4 h-4" /> Nuevo activo
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <p className="text-[10px] text-gray-500 uppercase font-semibold">Activos registrados</p>
          <p className="text-xl font-bold">{activos.length}</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-[10px] text-blue-700 uppercase font-semibold">Valor de adquisición</p>
          <p className="text-xl font-bold font-mono text-blue-900">{formatCurrency(totalValor)}</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-[10px] text-amber-700 uppercase font-semibold">Depreciación acumulada</p>
          <p className="text-xl font-bold font-mono text-amber-900">{formatCurrency(totalDep)}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : activos.length === 0 ? (
          <div className="text-center py-12">
            <Boxes className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Sin activos registrados.</p>
            <p className="text-gray-400 text-xs mt-1">Registra vehículos, equipos, muebles para depreciar mensualmente.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-2 font-semibold text-gray-600 w-20">Código</th>
                <th className="text-left p-2 font-semibold text-gray-600">Descripción</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-24">Adquirido</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-28">Valor</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-16">% Dep.</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-28">Dep. acum.</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-28">Valor neto</th>
                <th className="text-center p-2 font-semibold text-gray-600 w-24">Estado</th>
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody>
              {activos.map((af) => {
                const neto = Number(af.valor_adquisicion) - Number(af.depreciacion_acumulada)
                return (
                  <tr key={af.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                    <td className="p-2 font-mono font-bold text-xs">{af.codigo}</td>
                    <td className="p-2">
                      <p className="font-medium">{af.descripcion}</p>
                      {(af.marca || af.modelo) && <p className="text-[10px] text-gray-500">{af.marca} {af.modelo}</p>}
                    </td>
                    <td className="p-2 font-mono text-xs">{formatDate(af.fecha_adquisicion)}</td>
                    <td className="p-2 text-right font-mono">{formatCurrency(af.valor_adquisicion)}</td>
                    <td className="p-2 text-right font-mono text-xs">{af.porcentaje_depreciacion}%</td>
                    <td className="p-2 text-right font-mono text-amber-700">{formatCurrency(af.depreciacion_acumulada)}</td>
                    <td className="p-2 text-right font-mono font-semibold">{formatCurrency(neto)}</td>
                    <td className="p-2 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        af.estado === 'activo' ? 'bg-green-100 text-green-800' :
                        af.estado === 'depreciado' ? 'bg-gray-200 text-gray-700' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {af.estado.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-2 text-center">
                      <button onClick={() => abrirEditar(af)} className="text-gray-500 hover:bg-gray-100 rounded p-1">
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
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Editar activo' : 'Nuevo activo fijo'}</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Código *</Label>
                <Input value={form.codigo} onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))}
                  className="mt-1 font-mono" disabled={!!editing} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Descripción *</Label>
                <Input value={form.descripcion} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
                  className="mt-1" placeholder="Ej: Camioneta de reparto Hyundai H100" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Marca</Label>
                <Input value={form.marca} onChange={(e) => setForm((f) => ({ ...f, marca: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Modelo</Label>
                <Input value={form.modelo} onChange={(e) => setForm((f) => ({ ...f, modelo: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Fecha adquisición *</Label>
                <Input type="date" value={form.fecha_adquisicion}
                  onChange={(e) => setForm((f) => ({ ...f, fecha_adquisicion: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Valor adquisición (S/) *</Label>
                <Input type="number" step="0.01" min="0" value={form.valor_adquisicion}
                  onChange={(e) => setForm((f) => ({ ...f, valor_adquisicion: e.target.value }))} className="mt-1 font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">% Depreciación anual (SUNAT) *</Label>
                <select value={form.porcentaje_depreciacion}
                  onChange={(e) => setForm((f) => ({ ...f, porcentaje_depreciacion: e.target.value }))}
                  className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                  {PCT_SUNAT.map((p, i) => <option key={i} value={p.pct}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Cuenta de activo</Label>
                <select value={form.cuenta_activo}
                  onChange={(e) => setForm((f) => ({ ...f, cuenta_activo: e.target.value }))}
                  className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                  {CUENTAS_ACTIVO.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} - {c.nombre}</option>)}
                </select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Centro de costo</Label>
              <select value={form.centro_costo_id}
                onChange={(e) => setForm((f) => ({ ...f, centro_costo_id: e.target.value }))}
                className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                <option value="">— Sin CC —</option>
                {centros.map((c) => <option key={c.id} value={c.id}>{c.codigo} - {c.nombre}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={guardar} disabled={saving} className="bg-amber-600 hover:bg-amber-700">
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
