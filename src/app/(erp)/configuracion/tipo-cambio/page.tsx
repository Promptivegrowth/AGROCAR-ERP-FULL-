'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, DollarSign, Pencil, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'

interface TC {
  id: string
  fecha: string
  compra: number
  venta: number
  fuente: string
  motivo_edicion: string | null
  editado_at: string | null
}

interface CentroCosto { id: string; codigo: string; nombre: string }
interface Proveedor { id: string; razon_social: string }

export default function TipoCambioPage() {
  const router = useRouter()
  const supabase = createClient()
  const [tcs, setTcs] = useState<TC[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)

  // Editar TC
  const [openEdit, setOpenEdit] = useState(false)
  const [editForm, setEditForm] = useState({ fecha: hoyLima(), compra: '', venta: '', motivo: '' })

  // Diferencia de cambio
  const [openDif, setOpenDif] = useState(false)
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [centros, setCentros] = useState<CentroCosto[]>([])
  const [difForm, setDifForm] = useState({
    fecha: hoyLima(), glosa: '', monto: '', tipo: 'perdida' as 'perdida' | 'ganancia',
    cuenta_contrapartida: '4212', proveedor_id: '', centro_costo_id: '', notas: '',
  })

  const cargar = useCallback(async () => {
    setLoading(true)
    const [{ data: tc }, { data: prov }, { data: cc }] = await Promise.all([
      (supabase as any).from('tipo_cambio').select('*').order('fecha', { ascending: false }).limit(60),
      (supabase as any).from('proveedores').select('id, razon_social').eq('activo', true).order('razon_social'),
      (supabase as any).from('centros_costo').select('id, codigo, nombre').eq('activo', true).order('codigo'),
    ])
    setTcs((tc ?? []) as TC[])
    setProveedores((prov ?? []) as Proveedor[])
    setCentros((cc ?? []) as CentroCosto[])
    setLoading(false)
  }, [supabase])

  useEffect(() => { cargar() }, [cargar])

  const refrescarSunat = async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/tipo-cambio?refresh=1')
      const data = await res.json()
      if (res.ok) {
        toast.success('Tipo de cambio actualizado', {
          description: `Compra ${data.compra} · Venta ${data.venta} · ${data.fuente}`,
        })
        cargar()
      } else {
        toast.error('No se pudo consultar SUNAT')
      }
    } catch {
      toast.error('Error al consultar')
    }
    setRefreshing(false)
  }

  const abrirEditar = (tc?: TC) => {
    setEditForm({
      fecha: tc?.fecha ?? hoyLima(),
      compra: tc?.compra?.toString() ?? '',
      venta: tc?.venta?.toString() ?? '',
      motivo: '',
    })
    setOpenEdit(true)
  }

  const guardarEdicion = async () => {
    const compra = parseFloat(editForm.compra)
    const venta = parseFloat(editForm.venta)
    if (isNaN(compra) || compra <= 0 || isNaN(venta) || venta <= 0) {
      toast.error('Valores de TC inválidos'); return
    }
    if (editForm.motivo.trim().length < 5) {
      toast.error('Motivo requerido (mín 5 caracteres)', { description: 'Ej: TC aduanas importación Chile' }); return
    }
    setSaving(true)
    const { error } = await (supabase.rpc as any)('editar_tipo_cambio', {
      p_fecha: editForm.fecha,
      p_compra: compra,
      p_venta: venta,
      p_motivo: editForm.motivo,
    })
    setSaving(false)
    if (error) { toast.error('Error', { description: error.message }); return }
    toast.success('Tipo de cambio guardado (fuente: MANUAL)')
    setOpenEdit(false)
    cargar()
  }

  const registrarDiferencia = async () => {
    const monto = parseFloat(difForm.monto)
    if (isNaN(monto) || monto <= 0) { toast.error('Monto inválido'); return }
    if (!difForm.glosa.trim()) { toast.error('Glosa requerida'); return }
    setSaving(true)
    const { error } = await (supabase.rpc as any)('generar_asiento_diferencia_cambio', {
      p_fecha: difForm.fecha,
      p_glosa: difForm.glosa,
      p_monto_diferencia: difForm.tipo === 'perdida' ? monto : -monto,
      p_cuenta_contrapartida: difForm.cuenta_contrapartida,
      p_proveedor_id: difForm.proveedor_id || null,
      p_centro_costo_id: difForm.centro_costo_id || null,
      p_notas: difForm.notas || null,
    })
    setSaving(false)
    if (error) { toast.error('Error', { description: error.message }); return }
    toast.success('Asiento de diferencia de cambio creado (borrador)', {
      description: 'Revísalo en el Libro Diario y asiéntalo.',
    })
    setOpenDif(false)
    setDifForm({ fecha: hoyLima(), glosa: '', monto: '', tipo: 'perdida', cuenta_contrapartida: '4212', proveedor_id: '', centro_costo_id: '', notas: '' })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-green-600" />
            Tipo de Cambio
          </h1>
          <p className="text-sm text-gray-500">
            Automático desde SUNAT · editable para casos especiales (aduanas, importaciones)
          </p>
        </div>
        <Button variant="outline" onClick={refrescarSunat} disabled={refreshing} className="gap-1">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Consultar SUNAT hoy
        </Button>
        <Button variant="outline" onClick={() => setOpenDif(true)} className="gap-1 border-purple-300 text-purple-700">
          <TrendingDown className="w-4 h-4" />
          Asiento dif. cambio
        </Button>
        <Button onClick={() => abrirEditar()} className="bg-green-600 hover:bg-green-700 gap-1">
          <Pencil className="w-4 h-4" />
          Editar TC de una fecha
        </Button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
        <strong>💡 Caso importaciones:</strong> cuando aduanas usa un TC distinto al de SUNAT
        (típico en las DUAs), edita el TC de esa fecha con el valor de la DUA para que la
        contabilización cuadre. Cada edición queda auditada con motivo.
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left p-2 font-semibold text-gray-600 w-28">Fecha</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-24">Compra</th>
                <th className="text-right p-2 font-semibold text-gray-600 w-24">Venta</th>
                <th className="text-left p-2 font-semibold text-gray-600 w-40">Fuente</th>
                <th className="text-left p-2 font-semibold text-gray-600">Motivo edición</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {tcs.map((tc) => (
                <tr key={tc.id} className={`border-b border-gray-100 ${tc.fuente === 'MANUAL' ? 'bg-amber-50/40' : ''}`}>
                  <td className="p-2 font-mono text-xs">{formatDate(tc.fecha)}</td>
                  <td className="p-2 text-right font-mono">{Number(tc.compra).toFixed(3)}</td>
                  <td className="p-2 text-right font-mono">{Number(tc.venta).toFixed(3)}</td>
                  <td className="p-2 text-xs">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      tc.fuente === 'MANUAL' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
                    }`}>
                      {tc.fuente}
                    </span>
                  </td>
                  <td className="p-2 text-xs text-gray-500 italic">{tc.motivo_edicion ?? '—'}</td>
                  <td className="p-2 text-center">
                    <button onClick={() => abrirEditar(tc)} className="text-gray-500 hover:bg-gray-100 rounded p-1" title="Editar">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {tcs.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400 text-sm">Sin registros. Consulta SUNAT o edita manualmente.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialog editar TC */}
      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Editar tipo de cambio</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <Label className="text-xs">Fecha *</Label>
              <Input type="date" value={editForm.fecha} onChange={(e) => setEditForm((f) => ({ ...f, fecha: e.target.value }))} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Compra *</Label>
                <Input type="number" step="0.001" min="0" value={editForm.compra}
                  onChange={(e) => setEditForm((f) => ({ ...f, compra: e.target.value }))} className="mt-1 font-mono" placeholder="3.750" />
              </div>
              <div>
                <Label className="text-xs">Venta *</Label>
                <Input type="number" step="0.001" min="0" value={editForm.venta}
                  onChange={(e) => setEditForm((f) => ({ ...f, venta: e.target.value }))} className="mt-1 font-mono" placeholder="3.760" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Motivo de la edición * (queda auditado)</Label>
              <Input value={editForm.motivo} onChange={(e) => setEditForm((f) => ({ ...f, motivo: e.target.value }))}
                className="mt-1" placeholder="Ej: TC aduanas DUA 123-2026 importación Chile" />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setOpenEdit(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={guardarEdicion} disabled={saving} className="bg-green-600 hover:bg-green-700">
                {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog diferencia de cambio */}
      <Dialog open={openDif} onOpenChange={setOpenDif}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Asiento por diferencia de cambio</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Fecha *</Label>
                <Input type="date" value={difForm.fecha} onChange={(e) => setDifForm((f) => ({ ...f, fecha: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Tipo *</Label>
                <div className="flex gap-1 mt-1">
                  <button type="button" onClick={() => setDifForm((f) => ({ ...f, tipo: 'perdida' }))}
                    className={`flex-1 h-9 text-xs font-semibold rounded-md flex items-center justify-center gap-1 ${
                      difForm.tipo === 'perdida' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'
                    }`}>
                    <TrendingDown className="w-3 h-3" /> Pérdida (6761)
                  </button>
                  <button type="button" onClick={() => setDifForm((f) => ({ ...f, tipo: 'ganancia' }))}
                    className={`flex-1 h-9 text-xs font-semibold rounded-md flex items-center justify-center gap-1 ${
                      difForm.tipo === 'ganancia' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600'
                    }`}>
                    <TrendingUp className="w-3 h-3" /> Ganancia (7761)
                  </button>
                </div>
              </div>
            </div>
            <div>
              <Label className="text-xs">Glosa *</Label>
              <Input value={difForm.glosa} onChange={(e) => setDifForm((f) => ({ ...f, glosa: e.target.value }))}
                className="mt-1" placeholder="Ej: Dif. cambio pago factura IMP-001 Cerdeña Chile" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Monto de la diferencia (S/) *</Label>
                <Input type="number" step="0.01" min="0" value={difForm.monto}
                  onChange={(e) => setDifForm((f) => ({ ...f, monto: e.target.value }))} className="mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-xs">Cuenta contrapartida *</Label>
                <select value={difForm.cuenta_contrapartida}
                  onChange={(e) => setDifForm((f) => ({ ...f, cuenta_contrapartida: e.target.value }))}
                  className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                  <option value="4212">4212 - Cuentas por pagar (proveedor)</option>
                  <option value="1041">1041 - Bancos</option>
                  <option value="1212">1212 - Cuentas por cobrar (cliente)</option>
                  <option value="1011">1011 - Caja MN</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Proveedor (si aplica)</Label>
                <select value={difForm.proveedor_id} onChange={(e) => setDifForm((f) => ({ ...f, proveedor_id: e.target.value }))}
                  className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                  <option value="">— Ninguno —</option>
                  {proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Centro de costo</Label>
                <select value={difForm.centro_costo_id} onChange={(e) => setDifForm((f) => ({ ...f, centro_costo_id: e.target.value }))}
                  className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                  <option value="">— Sin CC —</option>
                  {centros.map((c) => <option key={c.id} value={c.id}>{c.codigo} - {c.nombre}</option>)}
                </select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Notas</Label>
              <Input value={difForm.notas} onChange={(e) => setDifForm((f) => ({ ...f, notas: e.target.value }))} className="mt-1" />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setOpenDif(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={registrarDiferencia} disabled={saving} className="bg-purple-600 hover:bg-purple-700">
                {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Crear asiento
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
