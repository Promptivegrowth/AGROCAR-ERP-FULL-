'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Search, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Corregir o anular un cobro mal ingresado.
 *
 * - Corregir: cuánto (efectivo / Yape / Plin / transferencia, el total es la
 *   suma), el N° de operación y, si se cargó a otro, el cliente. Sigue aplicado
 *   a los mismos comprobantes mientras alcance (RPC corregir_cobro).
 * - Anular: para el cobro que no debía existir (duplicado, cliente que no
 *   pagó). Se guarda entero en cobros_anulados y los comprobantes vuelven a
 *   quedar con ese saldo (RPC anular_cobro).
 *
 * Siempre con motivo, y nunca sobre un cobro de una caja ya cerrada: eso lo
 * frena la base. Daniel, 01/10 (medio de pago) y 05/10 (monto y anulación).
 */
export interface CobroACorregir {
  id: string
  numero?: string | null
  fecha?: string | null
  cliente_id?: string | null
  cliente_nombre: string
  cobrador_nombre: string
  efectivo: number
  yape: number
  plin: number
  transferencia: number
  total: number
}

const CAMPOS = [
  { clave: 'efectivo', label: 'Efectivo' },
  { clave: 'yape', label: 'Yape' },
  { clave: 'plin', label: 'Plin' },
  { clave: 'transferencia', label: 'Transferencia' },
] as const
type Clave = typeof CAMPOS[number]['clave']
type Aplicacion = { comprobante: string | null; monto: number }
type ClienteOpcion = { id: string; razon_social: string; doc: string }

export default function CorregirPagoDialog({ cobro, onClose, onListo }: {
  cobro: CobroACorregir | null
  onClose: () => void
  onListo: () => void
}) {
  const supabase = createClient()
  const [montos, setMontos] = useState<Record<Clave, string>>({ efectivo: '', yape: '', plin: '', transferencia: '' })
  const [operacion, setOperacion] = useState('')
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [aplicaciones, setAplicaciones] = useState<Aplicacion[] | null>(null)
  const [cliente, setCliente] = useState<ClienteOpcion | null>(null)
  const [buscandoCliente, setBuscandoCliente] = useState(false)
  const [textoCliente, setTextoCliente] = useState('')
  const [opciones, setOpciones] = useState<ClienteOpcion[]>([])
  const [anulando, setAnulando] = useState(false)
  const [confirmaAnular, setConfirmaAnular] = useState(false)

  useEffect(() => {
    if (!cobro) return
    setMontos({
      efectivo: String(cobro.efectivo), yape: String(cobro.yape),
      plin: String(cobro.plin), transferencia: String(cobro.transferencia),
    })
    setOperacion(''); setMotivo(''); setCliente(null); setBuscandoCliente(false)
    setTextoCliente(''); setOpciones([]); setAnulando(false); setConfirmaAnular(false)
    setAplicaciones(null)
    ;(async () => {
      const { data } = await (supabase as any).from('cobros_aplicaciones')
        .select('monto_aplicado, es_a_cuenta, comprobantes(serie, numero)').eq('cobro_id', cobro.id).order('id')
      setAplicaciones(((data ?? []) as any[]).map((a) => ({
        comprobante: a.es_a_cuenta || !a.comprobantes ? null : `${a.comprobantes.serie}-${a.comprobantes.numero}`,
        monto: Number(a.monto_aplicado),
      })))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cobro])

  // Buscar cliente por nombre, RUC o DNI.
  useEffect(() => {
    const q = textoCliente.trim()
    if (!buscandoCliente || q.length < 3) { setOpciones([]); return }
    const t = setTimeout(async () => {
      const esc = q.replace(/[%,()]/g, ' ')
      const { data } = await (supabase as any).from('clientes').select('id, razon_social, ruc, dni')
        .or(`razon_social.ilike.%${esc}%,ruc.ilike.%${esc}%,dni.ilike.%${esc}%`).order('razon_social').limit(8)
      setOpciones(((data ?? []) as any[]).map((c) => ({ id: c.id, razon_social: c.razon_social, doc: c.ruc || c.dni || '' })))
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textoCliente, buscandoCliente])

  if (!cobro) return null
  const n = (v: string) => Number.parseFloat(v || '0') || 0
  const total = Math.round(CAMPOS.reduce((a, c) => a + n(montos[c.clave]), 0) * 100) / 100
  const cambiaTotal = Math.abs(total - cobro.total) > 0.005
  const digital = n(montos.yape) + n(montos.plin) + n(montos.transferencia) > 0
  const algunCambio = cambiaTotal || !!cliente || !!operacion.trim()
    || CAMPOS.some((c) => Math.abs(n(montos[c.clave]) - Number(cobro[c.clave])) > 0.005)

  /** Todo a un solo medio, por el mismo total: el caso común ("era Yape, no efectivo"). */
  const todoA = (clave: Clave) => setMontos({
    efectivo: '0', yape: '0', plin: '0', transferencia: '0', [clave]: String(total || cobro.total),
  } as Record<Clave, string>)

  const guardar = async () => {
    if (total <= 0) { toast.error('El total tiene que ser mayor a cero. Si el cobro no debía existir, anúlalo.'); return }
    if (!motivo.trim()) { toast.error('Indica el motivo de la corrección'); return }
    setGuardando(true)
    const { error } = await (supabase.rpc as any)('corregir_cobro', {
      p_cobro_id: cobro.id,
      p_cliente_id: cliente?.id ?? null,
      p_efectivo: n(montos.efectivo),
      p_yape: n(montos.yape),
      p_plin: n(montos.plin),
      p_transferencia: n(montos.transferencia),
      p_nro_operacion: operacion.trim() || null,
      p_motivo: motivo.trim(),
    })
    setGuardando(false)
    if (error) { toast.error('No se pudo corregir', { description: error.message, duration: 10000 }); return }
    toast.success('Cobro corregido', {
      description: cambiaTotal
        ? `Total ${formatCurrency(cobro.total)} → ${formatCurrency(total)}. Los saldos de los comprobantes ya están actualizados.`
        : 'Quedó registrado quién lo corrigió y por qué.',
    })
    onListo(); onClose()
  }

  const anular = async () => {
    if (!motivo.trim()) { toast.error('Indica el motivo de la anulación'); return }
    setGuardando(true)
    const { error } = await (supabase.rpc as any)('anular_cobro', { p_cobro_id: cobro.id, p_motivo: motivo.trim() })
    setGuardando(false)
    if (error) { toast.error('No se pudo anular', { description: error.message, duration: 10000 }); return }
    toast.success(`Cobro ${cobro.numero ?? ''} anulado`, {
      description: `Los comprobantes vuelven a quedar con ${formatCurrency(cobro.total)} pendiente. Quedó respaldado quién lo anuló y por qué.`,
    })
    onListo(); onClose()
  }

  return (
    <Dialog open={!!cobro} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{anulando ? 'Anular cobro' : 'Corregir cobro'} {cobro.numero ? <span className="font-mono text-sm text-gray-500">{cobro.numero}</span> : null}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm" data-dialogo-cobro>
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="font-semibold">{cobro.cliente_nombre}</p>
            <p className="text-xs text-gray-500">
              Cobró {cobro.cobrador_nombre}{cobro.fecha ? ` · ${formatDate(cobro.fecha)}` : ''} · Total {formatCurrency(cobro.total)}
            </p>
            {aplicaciones && aplicaciones.length > 0 && (
              <p className="mt-1 text-[11px] text-gray-600">
                Aplicado a: {aplicaciones.map((a) => `${a.comprobante ?? 'a cuenta'} ${formatCurrency(a.monto)}`).join(' · ')}
              </p>
            )}
          </div>

          {!anulando ? (
            <>
              {/* Cliente */}
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Cliente</Label>
                  {!buscandoCliente && (
                    <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => setBuscandoCliente(true)}>
                      ¿Se cargó a otro cliente? Cambiar
                    </button>
                  )}
                </div>
                {cliente ? (
                  <p className="mt-1 rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs">
                    Pasa a: <b>{cliente.razon_social}</b> {cliente.doc && `· ${cliente.doc}`}
                    <button type="button" className="ml-2 text-blue-700 hover:underline" onClick={() => setCliente(null)}>quitar</button>
                  </p>
                ) : buscandoCliente ? (
                  <div className="mt-1">
                    <div className="relative">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                      <Input autoFocus value={textoCliente} onChange={(e) => setTextoCliente(e.target.value)}
                        placeholder="Nombre, RUC o DNI del cliente correcto" className="h-9 pl-8" data-buscar-cliente />
                    </div>
                    {opciones.length > 0 && (
                      <div className="mt-1 max-h-44 overflow-y-auto rounded border border-gray-200">
                        {opciones.map((o) => (
                          <button key={o.id} type="button" disabled={o.id === cobro.cliente_id}
                            onClick={() => { setCliente(o); setBuscandoCliente(false) }}
                            className="block w-full px-2 py-1.5 text-left text-xs hover:bg-gray-50 disabled:opacity-40">
                            {o.razon_social} <span className="text-gray-500">{o.doc}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              {/* Montos */}
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs text-gray-500 self-center">Todo en:</span>
                {CAMPOS.map((c) => (
                  <Button key={c.clave} type="button" size="sm" variant="outline" className="h-7 px-2 text-xs"
                    onClick={() => todoA(c.clave)} disabled={guardando}>
                    {c.label}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {CAMPOS.map((c) => (
                  <div key={c.clave}>
                    <Label className="text-xs">{c.label}</Label>
                    <Input type="number" step="0.01" min="0" value={montos[c.clave]} disabled={guardando}
                      onChange={(e) => setMontos((m) => ({ ...m, [c.clave]: e.target.value }))}
                      className="h-9 text-right font-mono" data-monto={c.clave} />
                  </div>
                ))}
              </div>
              <p className={`text-xs font-semibold ${cambiaTotal ? 'text-amber-700' : 'text-emerald-700'}`} data-total-nuevo>
                Total {formatCurrency(total)}
                {cambiaTotal ? ` (antes ${formatCurrency(cobro.total)}) — se recalculan los saldos de los comprobantes` : ' — igual al registrado'}
              </p>

              {digital && (
                <div>
                  <Label className="text-xs">N° de operación (Yape / Plin / transferencia)</Label>
                  <Input value={operacion} onChange={(e) => setOperacion(e.target.value)} disabled={guardando}
                    placeholder="Opcional, pero ayuda a cuadrar con el banco" className="h-9" />
                </div>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900 space-y-2" data-zona-anular>
              <p>
                El cobro se elimina de la caja, de los reportes y del saldo del cliente: los comprobantes a los que estaba
                aplicado vuelven a deber <b>{formatCurrency(cobro.total)}</b>. Queda guardada una copia con quién lo anuló y por qué.
              </p>
              <p>Úsalo para un cobro duplicado o uno que no se hizo. Si solo está mal el monto, el medio o el cliente, mejor corrígelo.</p>
              <label className="flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={confirmaAnular} onChange={(e) => setConfirmaAnular(e.target.checked)} data-confirma-anular />
                Confirmo que este cobro no debía existir
              </label>
            </div>
          )}

          <div>
            <Label className="text-xs">Motivo *</Label>
            <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={guardando} data-motivo
              placeholder={anulando ? 'Ej.: el repartidor lo registró dos veces' : 'Ej.: cobró S/ 150 y se registró S/ 1500'}
              className="h-9" />
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            {anulando ? (
              <Button variant="ghost" size="sm" onClick={() => setAnulando(false)} disabled={guardando}>← Volver a corregir</Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setAnulando(true)} disabled={guardando}
                className="text-red-700 hover:bg-red-50 gap-1" data-ir-a-anular>
                <Trash2 className="w-3.5 h-3.5" /> Anular cobro
              </Button>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} disabled={guardando}>Cancelar</Button>
              {anulando ? (
                <Button onClick={anular} disabled={guardando || !confirmaAnular || !motivo.trim()}
                  className="bg-red-600 hover:bg-red-700 text-white font-semibold gap-1" data-anular>
                  {guardando && <Loader2 className="w-4 h-4 animate-spin" />} Anular cobro
                </Button>
              ) : (
                <Button onClick={guardar} disabled={guardando || !algunCambio || total <= 0 || !motivo.trim()}
                  className="bg-[#FBE600] hover:bg-[#E5D100] text-black font-semibold gap-1" data-guardar>
                  {guardando && <Loader2 className="w-4 h-4 animate-spin" />} Guardar corrección
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Encontrar un cobro que no está en la lista del día: de días anteriores sin
 * liquidar, buscándolo por N° de recibo o por cliente. Los de una caja cerrada
 * aparecen pero no se pueden tocar (la base lo frena y lo explica).
 */
export function BuscarCobro({ onElegir }: { onElegir: (c: CobroACorregir) => void }) {
  const supabase = createClient()
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<(CobroACorregir & { cerrado: boolean })[]>([])
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    const q = texto.trim()
    if (!abierto || q.length < 3) { setResultados([]); return }
    const t = setTimeout(async () => {
      setCargando(true)
      const esc = q.replace(/[%,()]/g, ' ')
      const desde = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)
      const sel = `id, numero, fecha, cliente_id, efectivo, yape, plin, transferencia, total, cliente_externo_nombre,
        clientes(razon_social), profiles!cobros_cobrador_id_fkey(full_name), caja_movimientos(caja_sesiones(estado))`
      const [porNumero, porCliente] = await Promise.all([
        (supabase as any).from('cobros').select(sel).ilike('numero', `%${esc}%`).gte('fecha', desde).order('created_at', { ascending: false }).limit(10),
        (supabase as any).from('cobros').select(sel.replace('clientes(razon_social)', 'clientes!inner(razon_social)'))
          .ilike('clientes.razon_social', `%${esc}%`).gte('fecha', desde).order('created_at', { ascending: false }).limit(10),
      ])
      const vistos = new Set<string>()
      const filas = [...(porNumero.data ?? []), ...(porCliente.data ?? [])].filter((c: any) => !vistos.has(c.id) && vistos.add(c.id))
      setResultados(filas.map((c: any) => ({
        id: c.id, numero: c.numero, fecha: c.fecha, cliente_id: c.cliente_id,
        cliente_nombre: c.clientes?.razon_social ?? c.cliente_externo_nombre ?? '—',
        cobrador_nombre: c.profiles?.full_name ?? '—',
        efectivo: Number(c.efectivo), yape: Number(c.yape), plin: Number(c.plin), transferencia: Number(c.transferencia),
        total: Number(c.total),
        cerrado: (c.caja_movimientos ?? []).some((m: any) => m.caja_sesiones && m.caja_sesiones.estado !== 'abierta'),
      })))
      setCargando(false)
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, abierto])

  return (
    <>
      <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setAbierto(true)} data-buscar-cobro>
        <Search className="w-3.5 h-3.5" /> Corregir un cobro de otro día
      </Button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Buscar cobro</DialogTitle></DialogHeader>
          <Input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder="N° de recibo (R-202610-000123) o nombre del cliente" className="h-9" />
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
            {cargando && <p className="py-3 text-xs text-gray-500">Buscando…</p>}
            {!cargando && texto.trim().length >= 3 && resultados.length === 0 && (
              <p className="py-3 text-xs text-gray-500">No hay cobros de los últimos 60 días con ese número o cliente.</p>
            )}
            {resultados.map((r) => (
              <button key={r.id} type="button" disabled={r.cerrado}
                onClick={() => { setAbierto(false); setTexto(''); onElegir(r) }}
                className="flex w-full items-center justify-between gap-2 py-2 text-left text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
                <span>
                  <span className="font-mono">{r.numero}</span> · {formatDate(r.fecha ?? '')} · <b>{r.cliente_nombre}</b>
                  <span className="block text-gray-500">{r.cobrador_nombre}{r.cerrado ? ' · en caja cerrada, no se modifica' : ''}</span>
                </span>
                <span className="font-semibold">{formatCurrency(r.total)}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
