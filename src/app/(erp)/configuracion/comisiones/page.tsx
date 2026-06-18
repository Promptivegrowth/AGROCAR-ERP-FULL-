'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'
import { Loader2, Save, Plus, Trash2, Info, Percent, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useRouter } from 'next/navigation'

interface Familia { id: string; nombre: string }
interface Vendedor { id: string; full_name: string }
interface Regla {
  id: string
  vendedor_id: string | null
  familia_id: string | null
  porcentaje: number | null
  monto_fijo: number | null
  activo: boolean
  // joineadas
  vendedor_nombre?: string
  familia_nombre?: string
}

/**
 * Configuración de comisiones por familia de producto.
 *
 * Prioridad de aplicación al calcular:
 *  1. Regla específica para (vendedor, familia)
 *  2. Regla del vendedor sin familia (global personal)
 *  3. Regla por familia sin vendedor (default de familia)
 *  4. Regla global sin vendedor ni familia (último recurso)
 *
 * Esta página tiene 2 tabs:
 *  - Por familia (defaults): tasas que aplican a TODOS los vendedores
 *  - Por vendedor (overrides): tasas específicas para un vendedor
 */
export default function ConfigComisionesPage() {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [familias, setFamilias] = useState<Familia[]>([])
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [reglas, setReglas] = useState<Regla[]>([])

  // Form para nueva regla de override por vendedor
  const [newVendedorId, setNewVendedorId] = useState<string>('')
  const [newFamiliaId, setNewFamiliaId] = useState<string>('todas')
  const [newPorcentaje, setNewPorcentaje] = useState<string>('')

  const cargar = useCallback(async () => {
    setLoading(true)
    const [famRes, vendRes, regRes] = await Promise.all([
      (supabase as any).from('familias').select('id, nombre').eq('activo', true).order('nombre'),
      (supabase as any).from('profiles').select('id, full_name').eq('role', 'vendedor').eq('activo', true).order('full_name'),
      (supabase as any).from('comisiones_reglas')
        .select(`
          id, vendedor_id, familia_id, porcentaje, monto_fijo, activo,
          profiles:profiles!comisiones_reglas_vendedor_id_fkey(full_name),
          familias(nombre)
        `)
        .eq('activo', true),
    ])
    setFamilias((famRes.data ?? []) as Familia[])
    setVendedores((vendRes.data ?? []) as Vendedor[])
    const rs: Regla[] = (regRes.data ?? []).map((r: any) => ({
      id: r.id,
      vendedor_id: r.vendedor_id,
      familia_id: r.familia_id,
      porcentaje: r.porcentaje !== null ? Number(r.porcentaje) : null,
      monto_fijo: r.monto_fijo !== null ? Number(r.monto_fijo) : null,
      activo: r.activo,
      vendedor_nombre: r.profiles?.full_name ?? null,
      familia_nombre: r.familias?.nombre ?? null,
    }))
    setReglas(rs)
    setLoading(false)
  }, [supabase])

  useEffect(() => { cargar() }, [cargar])

  // Defaults por familia: una regla por cada familia (vendedor_id NULL)
  const reglasDefault = reglas.filter((r) => r.vendedor_id === null)
  const reglasOverride = reglas.filter((r) => r.vendedor_id !== null)

  // Mapa familia → regla default actual
  const defaultPorFamilia = new Map<string | null, Regla>()
  reglasDefault.forEach((r) => defaultPorFamilia.set(r.familia_id, r))

  async function guardarDefault(familiaId: string | null, porcentajeStr: string) {
    const porcentaje = parseFloat(porcentajeStr)
    if (isNaN(porcentaje) || porcentaje < 0 || porcentaje > 100) {
      toast.error('Porcentaje inválido', { description: 'Ingresa un número entre 0 y 100.' })
      return
    }
    setSaving(true)
    const existente = defaultPorFamilia.get(familiaId)
    if (existente) {
      // Update
      const { error } = await (supabase as any)
        .from('comisiones_reglas')
        .update({ porcentaje, monto_fijo: null })
        .eq('id', existente.id)
      if (error) {
        toast.error('No se pudo actualizar', { description: error.message })
        setSaving(false); return
      }
    } else {
      // Insert
      const { error } = await (supabase as any)
        .from('comisiones_reglas')
        .insert({ vendedor_id: null, familia_id: familiaId, porcentaje, monto_fijo: null, activo: true })
      if (error) {
        toast.error('No se pudo crear', { description: error.message })
        setSaving(false); return
      }
    }
    toast.success('Comisión guardada')
    setSaving(false)
    cargar()
  }

  async function eliminarRegla(reglaId: string) {
    if (!confirm('¿Eliminar esta regla de comisión?')) return
    const { error } = await (supabase as any)
      .from('comisiones_reglas')
      .delete()
      .eq('id', reglaId)
    if (error) {
      toast.error('No se pudo eliminar', { description: error.message })
      return
    }
    toast.success('Regla eliminada')
    cargar()
  }

  async function agregarOverride() {
    if (!newVendedorId) {
      toast.error('Selecciona un vendedor')
      return
    }
    const porcentaje = parseFloat(newPorcentaje)
    if (isNaN(porcentaje) || porcentaje < 0 || porcentaje > 100) {
      toast.error('Porcentaje inválido', { description: 'Entre 0 y 100' })
      return
    }
    const familiaId = newFamiliaId === 'todas' ? null : newFamiliaId
    setSaving(true)
    // Si ya existe override para (vendedor, familia), actualizamos
    const existente = reglasOverride.find((r) =>
      r.vendedor_id === newVendedorId && r.familia_id === familiaId,
    )
    if (existente) {
      const { error } = await (supabase as any)
        .from('comisiones_reglas')
        .update({ porcentaje, monto_fijo: null })
        .eq('id', existente.id)
      if (error) {
        toast.error('Error', { description: error.message })
        setSaving(false); return
      }
    } else {
      const { error } = await (supabase as any)
        .from('comisiones_reglas')
        .insert({ vendedor_id: newVendedorId, familia_id: familiaId, porcentaje, monto_fijo: null, activo: true })
      if (error) {
        toast.error('Error', { description: error.message })
        setSaving(false); return
      }
    }
    toast.success('Override guardado')
    setNewVendedorId('')
    setNewFamiliaId('todas')
    setNewPorcentaje('')
    setSaving(false)
    cargar()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Percent className="w-6 h-6 text-blue-600" />
            Comisiones por Familia
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Configura el porcentaje de comisión que se aplica a cada familia de productos
          </p>
        </div>
      </div>

      {/* Aviso explicando prioridad */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 flex gap-2">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">Cómo se aplica la comisión:</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Si el vendedor tiene una regla específica para esa familia → se usa esa</li>
            <li>Si no, se busca la regla global del vendedor (sin familia)</li>
            <li>Si no, se aplica el default de la familia (configurado abajo)</li>
            <li>Si no hay ninguna, esa venta NO genera comisión</li>
          </ol>
        </div>
      </div>

      <Tabs defaultValue="defaults">
        <TabsList>
          <TabsTrigger value="defaults">Por familia (defaults)</TabsTrigger>
          <TabsTrigger value="overrides">Por vendedor (overrides)</TabsTrigger>
        </TabsList>

        {/* DEFAULTS POR FAMILIA */}
        <TabsContent value="defaults" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Comisión default por familia</CardTitle>
              <p className="text-xs text-gray-500">
                Aplica a todos los vendedores que no tengan un override específico.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-y border-gray-200">
                  <tr>
                    <th className="text-left p-3 font-semibold text-gray-600">Familia</th>
                    <th className="text-right p-3 font-semibold text-gray-600 w-32">Porcentaje (%)</th>
                    <th className="text-center p-3 font-semibold text-gray-600 w-20">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  <FamiliaDefaultRow
                    familia={{ id: null, nombre: '🌐 Default global (cualquier familia)' }}
                    reglaActual={defaultPorFamilia.get(null) ?? null}
                    onSave={(p) => guardarDefault(null, p)}
                    onDelete={(id) => eliminarRegla(id)}
                    saving={saving}
                  />
                  {familias.map((f) => (
                    <FamiliaDefaultRow
                      key={f.id}
                      familia={f}
                      reglaActual={defaultPorFamilia.get(f.id) ?? null}
                      onSave={(p) => guardarDefault(f.id, p)}
                      onDelete={(id) => eliminarRegla(id)}
                      saving={saving}
                    />
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* OVERRIDES POR VENDEDOR */}
        <TabsContent value="overrides" className="mt-4 space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Agregar override</CardTitle>
              <p className="text-xs text-gray-500">
                Para un vendedor específico, sobreescribe el default. Útil para
                vendedores estrella o casos especiales.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                <div>
                  <Label className="text-xs">Vendedor *</Label>
                  <Select value={newVendedorId} onValueChange={setNewVendedorId}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                    <SelectContent>
                      {vendedores.map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Familia</Label>
                  <Select value={newFamiliaId} onValueChange={setNewFamiliaId}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">Todas (global del vendedor)</SelectItem>
                      {familias.map((f) => (
                        <SelectItem key={f.id} value={f.id}>{f.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Porcentaje (%)</Label>
                  <Input type="number" step="0.01" min="0" max="100"
                    value={newPorcentaje} onChange={(e) => setNewPorcentaje(e.target.value)}
                    placeholder="Ej: 5.5" className="h-9" />
                </div>
                <Button onClick={agregarOverride} disabled={saving || !newVendedorId || !newPorcentaje}
                  className="h-9 gap-1 bg-blue-600 hover:bg-blue-700">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Agregar
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Overrides actuales ({reglasOverride.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {reglasOverride.length === 0 ? (
                <p className="text-center py-6 text-gray-400 text-sm">
                  Sin overrides. Todos los vendedores usan los defaults por familia.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-y border-gray-200">
                    <tr>
                      <th className="text-left p-2 font-semibold text-gray-600">Vendedor</th>
                      <th className="text-left p-2 font-semibold text-gray-600">Familia</th>
                      <th className="text-right p-2 font-semibold text-gray-600 w-28">Porcentaje</th>
                      <th className="text-center p-2 font-semibold text-gray-600 w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {reglasOverride.map((r) => (
                      <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="p-2 font-medium">{r.vendedor_nombre ?? '—'}</td>
                        <td className="p-2 text-gray-700">{r.familia_nombre ?? '🌐 Todas las familias'}</td>
                        <td className="p-2 text-right font-mono font-semibold">{r.porcentaje?.toFixed(2)}%</td>
                        <td className="p-2 text-center">
                          <button onClick={() => eliminarRegla(r.id)}
                            className="text-red-600 hover:bg-red-50 rounded p-1" title="Eliminar override">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function FamiliaDefaultRow({
  familia, reglaActual, onSave, onDelete, saving,
}: {
  familia: { id: string | null; nombre: string }
  reglaActual: Regla | null
  onSave: (porcentaje: string) => void
  onDelete: (reglaId: string) => void
  saving: boolean
}) {
  const [editValue, setEditValue] = useState<string>(reglaActual?.porcentaje?.toString() ?? '')
  useEffect(() => {
    setEditValue(reglaActual?.porcentaje?.toString() ?? '')
  }, [reglaActual?.porcentaje])

  const sinCambio = editValue === (reglaActual?.porcentaje?.toString() ?? '')

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50/40">
      <td className="p-3">
        <p className="font-medium text-gray-900">{familia.nombre}</p>
      </td>
      <td className="p-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <Input
            type="number" step="0.01" min="0" max="100"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder="—"
            className="w-20 h-8 text-right font-mono text-sm"
          />
          <span className="text-xs text-gray-500">%</span>
        </div>
      </td>
      <td className="p-3 text-center">
        <div className="flex items-center justify-center gap-1">
          <button
            onClick={() => onSave(editValue)}
            disabled={saving || sinCambio || editValue === ''}
            className="text-blue-600 hover:bg-blue-50 disabled:text-gray-300 disabled:hover:bg-transparent rounded p-1"
            title={sinCambio ? 'Sin cambios' : 'Guardar'}
          >
            <Save className="w-3.5 h-3.5" />
          </button>
          {reglaActual && (
            <button
              onClick={() => onDelete(reglaActual.id)}
              className="text-red-600 hover:bg-red-50 rounded p-1"
              title="Eliminar regla"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
