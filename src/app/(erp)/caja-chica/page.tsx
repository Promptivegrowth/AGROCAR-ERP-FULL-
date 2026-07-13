'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Loader2, Wallet, Plus, Minus, Lock, ArrowDownRight, RefreshCcw, Users, Calendar } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatCurrency, formatDate } from '@/lib/utils'
import { hoyLima } from '@/lib/fechas-pe'

interface Sesion {
  id: string
  numero: string
  fecha_apertura: string
  fecha_cierre: string | null
  fondo_inicial: number
  total_gastos: number
  total_reposiciones: number
  saldo_actual: number
  estado: 'abierta' | 'cerrada'
  arqueo_final: number | null
  arqueo_diferencia: number | null
}

interface Categoria {
  id: string
  codigo: string
  nombre: string
  cuenta_contable: string
  requiere_tercero: boolean
}

interface Movimiento {
  id: string
  tipo: 'gasto' | 'reposicion'
  fecha: string
  concepto: string
  monto: number
  categoria_id: string | null
  tercero_id: string | null
  numero_recibo: string | null
  notas: string | null
  categoria_nombre?: string
  tercero_nombre?: string
}

interface Tercero { id: string; nombres: string; apellidos: string | null; numero_doc: string }

export default function CajaChicaPage() {
  const supabase = createClient()
  const [sesion, setSesion] = useState<Sesion | null>(null)
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [terceros, setTerceros] = useState<Tercero[]>([])
  const [movimientos, setMovimientos] = useState<Movimiento[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Abrir sesión
  const [openAbrir, setOpenAbrir] = useState(false)
  const [fondoInicial, setFondoInicial] = useState('')
  const [notasAbrir, setNotasAbrir] = useState('')

  // Registrar movimiento
  const [openMov, setOpenMov] = useState(false)
  const [tipoMov, setTipoMov] = useState<'gasto' | 'reposicion'>('gasto')
  const [movForm, setMovForm] = useState({
    concepto: '', monto: '', categoria_id: '', tercero_id: '', numero_recibo: '', notas: '',
  })

  // Cerrar sesión (arqueo)
  const [openCerrar, setOpenCerrar] = useState(false)
  const [arqueo, setArqueo] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true)
    const [sesRes, catRes, terRes] = await Promise.all([
      (supabase as any).from('caja_chica_sesiones').select('*')
        .eq('estado', 'abierta').maybeSingle(),
      (supabase as any).from('caja_chica_categorias').select('*')
        .eq('activo', true).order('orden'),
      (supabase as any).from('terceros').select('id, nombres, apellidos, numero_doc')
        .eq('activo', true).order('nombres'),
    ])
    setSesion(sesRes.data as any)
    setCategorias((catRes.data ?? []) as Categoria[])
    setTerceros((terRes.data ?? []) as Tercero[])

    // Movimientos de sesión activa
    if (sesRes.data) {
      const { data: movs } = await (supabase as any)
        .from('caja_chica_movimientos')
        .select(`*, caja_chica_categorias(nombre), terceros(nombres, apellidos)`)
        .eq('sesion_id', (sesRes.data as any).id)
        .order('created_at', { ascending: false })
      setMovimientos(((movs ?? []) as any[]).map((m) => ({
        ...m,
        categoria_nombre: m.caja_chica_categorias?.nombre,
        tercero_nombre: m.terceros ? `${m.terceros.nombres} ${m.terceros.apellidos ?? ''}`.trim() : null,
      })))
    } else {
      setMovimientos([])
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => { cargar() }, [cargar])

  const abrirSesion = async () => {
    const fondo = parseFloat(fondoInicial)
    if (isNaN(fondo) || fondo < 0) { toast.error('Fondo inicial inválido'); return }
    setSaving(true)
    const { error } = await (supabase.rpc as any)('abrir_caja_chica', {
      p_fondo: fondo,
      p_notas: notasAbrir || null,
    })
    setSaving(false)
    if (error) { toast.error('Error', { description: error.message }); return }
    toast.success('Caja Chica abierta')
    setOpenAbrir(false)
    setFondoInicial(''); setNotasAbrir('')
    cargar()
  }

  const catActual = useMemo(() => categorias.find((c) => c.id === movForm.categoria_id), [categorias, movForm.categoria_id])

  const abrirMov = (t: 'gasto' | 'reposicion') => {
    setTipoMov(t)
    setMovForm({ concepto: '', monto: '', categoria_id: '', tercero_id: '', numero_recibo: '', notas: '' })
    setOpenMov(true)
  }

  const registrarMov = async () => {
    const monto = parseFloat(movForm.monto)
    if (isNaN(monto) || monto <= 0) { toast.error('Monto inválido'); return }
    if (!movForm.concepto.trim()) { toast.error('Concepto obligatorio'); return }
    if (tipoMov === 'gasto' && catActual?.requiere_tercero && !movForm.tercero_id) {
      toast.error('Esta categoría requiere seleccionar un tercero'); return
    }
    setSaving(true)
    const { error } = await (supabase.rpc as any)('registrar_movimiento_caja_chica', {
      p_tipo: tipoMov,
      p_concepto: movForm.concepto,
      p_monto: monto,
      p_categoria_id: movForm.categoria_id || null,
      p_tercero_id: movForm.tercero_id || null,
      p_numero_recibo: movForm.numero_recibo || null,
      p_notas: movForm.notas || null,
    })
    setSaving(false)
    if (error) { toast.error('Error', { description: error.message }); return }
    toast.success(tipoMov === 'gasto' ? 'Gasto registrado' : 'Reposición registrada')
    setOpenMov(false)
    cargar()
  }

  const cerrarSesion = async () => {
    if (!sesion) return
    const arq = parseFloat(arqueo)
    if (isNaN(arq) || arq < 0) { toast.error('Arqueo inválido'); return }
    setSaving(true)
    const { data, error } = await (supabase.rpc as any)('cerrar_caja_chica', {
      p_sesion_id: sesion.id,
      p_arqueo_efectivo: arq,
    })
    setSaving(false)
    if (error) { toast.error('Error', { description: error.message }); return }
    const cuadra = (data as any)?.cuadra
    const diff = Number((data as any)?.diferencia ?? 0)
    if (cuadra) toast.success('Sesión cerrada — arqueo cuadra ✓')
    else toast.warning('Sesión cerrada', { description: `Diferencia: ${formatCurrency(diff)}` })
    setOpenCerrar(false); setArqueo('')
    cargar()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Wallet className="w-6 h-6 text-emerald-600" />
            Caja Chica
          </h1>
          <p className="text-sm text-gray-500">Gestión del fondo fijo para gastos menores</p>
        </div>
        {sesion ? (
          <>
            <Button onClick={() => abrirMov('reposicion')} variant="outline" className="gap-1">
              <RefreshCcw className="w-4 h-4" /> Reposición
            </Button>
            <Button onClick={() => abrirMov('gasto')} className="bg-red-600 hover:bg-red-700 gap-1">
              <ArrowDownRight className="w-4 h-4" /> Registrar gasto
            </Button>
            <Button onClick={() => setOpenCerrar(true)} variant="outline" className="gap-1 border-amber-300 text-amber-700">
              <Lock className="w-4 h-4" /> Cerrar sesión
            </Button>
          </>
        ) : (
          <Button onClick={() => setOpenAbrir(true)} className="bg-emerald-600 hover:bg-emerald-700 gap-1">
            <Plus className="w-4 h-4" /> Abrir Caja Chica
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : !sesion ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <Wallet className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600 font-semibold">No hay sesión de Caja Chica abierta</p>
          <p className="text-sm text-gray-400 mt-1">
            Abre una nueva sesión indicando el fondo fijo inicial.
          </p>
          <Button onClick={() => setOpenAbrir(true)} className="mt-4 bg-emerald-600 hover:bg-emerald-700">
            Abrir Caja Chica
          </Button>
        </div>
      ) : (
        <>
          {/* Estado de la sesión */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <p className="text-[10px] text-gray-500 uppercase font-semibold">Sesión</p>
              <p className="text-sm font-bold font-mono">{sesion.numero}</p>
              <p className="text-[10px] text-gray-400 mt-0.5"><Calendar className="w-2.5 h-2.5 inline" /> {formatDate(sesion.fecha_apertura)}</p>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <p className="text-[10px] text-emerald-700 uppercase font-semibold">FONDO INICIAL</p>
              <p className="text-lg font-bold text-emerald-900">{formatCurrency(sesion.fondo_inicial)}</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-[10px] text-red-700 uppercase font-semibold">GASTOS</p>
              <p className="text-lg font-bold text-red-900">{formatCurrency(sesion.total_gastos)}</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-[10px] text-blue-700 uppercase font-semibold">REPOSICIONES</p>
              <p className="text-lg font-bold text-blue-900">{formatCurrency(sesion.total_reposiciones)}</p>
            </div>
            <div className="bg-[#FBE600] border-2 border-yellow-500 rounded-lg p-3">
              <p className="text-[10px] text-gray-900 uppercase font-semibold">SALDO ACTUAL</p>
              <p className="text-lg font-bold text-gray-900">{formatCurrency(sesion.saldo_actual)}</p>
            </div>
          </div>

          {/* Tabla de movimientos */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {movimientos.length === 0 ? (
              <p className="text-center py-12 text-gray-400 text-sm">Sin movimientos aún. Registra el primer gasto.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left p-2 font-semibold text-gray-600 w-24">Fecha</th>
                    <th className="text-left p-2 font-semibold text-gray-600 w-20">Tipo</th>
                    <th className="text-left p-2 font-semibold text-gray-600">Concepto</th>
                    <th className="text-left p-2 font-semibold text-gray-600 w-40">Categoría</th>
                    <th className="text-left p-2 font-semibold text-gray-600 w-40">Tercero</th>
                    <th className="text-left p-2 font-semibold text-gray-600 w-24">Recibo</th>
                    <th className="text-right p-2 font-semibold text-gray-600 w-28">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {movimientos.map((m) => (
                    <tr key={m.id} className="border-b border-gray-100">
                      <td className="p-2 font-mono text-xs">{formatDate(m.fecha)}</td>
                      <td className="p-2">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${m.tipo === 'gasto' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>
                          {m.tipo.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-2">
                        <p>{m.concepto}</p>
                        {m.notas && <p className="text-[10px] text-gray-500 italic">{m.notas}</p>}
                      </td>
                      <td className="p-2 text-xs text-gray-600">{m.categoria_nombre ?? '—'}</td>
                      <td className="p-2 text-xs text-gray-600">{m.tercero_nombre ?? '—'}</td>
                      <td className="p-2 text-xs font-mono">{m.numero_recibo ?? '—'}</td>
                      <td className={`p-2 text-right font-mono font-semibold ${m.tipo === 'gasto' ? 'text-red-700' : 'text-blue-700'}`}>
                        {m.tipo === 'gasto' ? '-' : '+'}{formatCurrency(m.monto)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Dialog abrir sesión */}
      <Dialog open={openAbrir} onOpenChange={setOpenAbrir}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Abrir Caja Chica</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <Label className="text-xs">Fondo inicial (S/) *</Label>
              <Input type="number" step="0.01" min="0" value={fondoInicial}
                onChange={(e) => setFondoInicial(e.target.value)} className="mt-1 font-mono" placeholder="0.00" />
              <p className="text-[10px] text-gray-500 mt-0.5">Monto en efectivo con que se abre el fondo fijo.</p>
            </div>
            <div>
              <Label className="text-xs">Notas (opcional)</Label>
              <Input value={notasAbrir} onChange={(e) => setNotasAbrir(e.target.value)} className="mt-1" />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setOpenAbrir(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={abrirSesion} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
                {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Abrir
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog registrar movimiento */}
      <Dialog open={openMov} onOpenChange={setOpenMov}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tipoMov === 'gasto' ? 'Registrar gasto' : 'Reposición de fondo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Concepto *</Label>
                <Input value={movForm.concepto} onChange={(e) => setMovForm((f) => ({ ...f, concepto: e.target.value }))}
                  className="mt-1" placeholder={tipoMov === 'gasto' ? 'Ej: Movilidad para reparto' : 'Ej: Transferencia BCP'} />
              </div>
              <div>
                <Label className="text-xs">Monto (S/) *</Label>
                <Input type="number" step="0.01" min="0" value={movForm.monto}
                  onChange={(e) => setMovForm((f) => ({ ...f, monto: e.target.value }))} className="mt-1 font-mono" />
              </div>
            </div>
            {tipoMov === 'gasto' && (
              <>
                <div>
                  <Label className="text-xs">Categoría</Label>
                  <select value={movForm.categoria_id} onChange={(e) => setMovForm((f) => ({ ...f, categoria_id: e.target.value }))}
                    className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                    <option value="">— Sin categoría (usa &ldquo;Otros&rdquo; 659) —</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>{c.nombre} ({c.cuenta_contable})</option>
                    ))}
                  </select>
                </div>
                {catActual?.requiere_tercero && (
                  <div>
                    <Label className="text-xs flex items-center gap-1"><Users className="w-3 h-3" /> Tercero * (requerido por la categoría)</Label>
                    <select value={movForm.tercero_id} onChange={(e) => setMovForm((f) => ({ ...f, tercero_id: e.target.value }))}
                      className="mt-1 w-full h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
                      <option value="">— Seleccionar —</option>
                      {terceros.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nombres} {t.apellidos ?? ''} · {t.numero_doc}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      Si no existe, créalo primero en <a href="/maestros/terceros" className="underline text-blue-700">Maestros → Terceros</a>
                    </p>
                  </div>
                )}
                <div>
                  <Label className="text-xs">N° recibo (opcional)</Label>
                  <Input value={movForm.numero_recibo} onChange={(e) => setMovForm((f) => ({ ...f, numero_recibo: e.target.value }))}
                    className="mt-1 font-mono" placeholder="Ej: RH-001-00001" />
                </div>
              </>
            )}
            <div>
              <Label className="text-xs">Notas (opcional)</Label>
              <Input value={movForm.notas} onChange={(e) => setMovForm((f) => ({ ...f, notas: e.target.value }))} className="mt-1" />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setOpenMov(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={registrarMov} disabled={saving}
                className={tipoMov === 'gasto' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}>
                {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Registrar {tipoMov === 'gasto' ? 'gasto' : 'reposición'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog cerrar (arqueo) */}
      <Dialog open={openCerrar} onOpenChange={setOpenCerrar}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Cerrar sesión — Arqueo</DialogTitle></DialogHeader>
          {sesion && (
            <div className="space-y-3 mt-2">
              <div className="bg-gray-50 p-3 rounded-md text-sm">
                <p>Saldo según sistema: <strong>{formatCurrency(sesion.saldo_actual)}</strong></p>
              </div>
              <div>
                <Label className="text-xs">Efectivo contado (S/) *</Label>
                <Input type="number" step="0.01" min="0" value={arqueo}
                  onChange={(e) => setArqueo(e.target.value)} className="mt-1 font-mono" />
                <p className="text-[10px] text-gray-500 mt-0.5">Efectivo real en caja al momento del cierre.</p>
              </div>
              {arqueo !== '' && !isNaN(parseFloat(arqueo)) && (
                <div className={`p-2 rounded text-xs ${Math.abs(parseFloat(arqueo) - sesion.saldo_actual) < 0.01 ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
                  Diferencia: {formatCurrency(parseFloat(arqueo) - sesion.saldo_actual)}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <Button variant="outline" onClick={() => setOpenCerrar(false)} disabled={saving}>Cancelar</Button>
                <Button onClick={cerrarSesion} disabled={saving} className="bg-amber-600 hover:bg-amber-700">
                  {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                  Confirmar cierre
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
