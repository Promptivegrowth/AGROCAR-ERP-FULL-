'use client'

import { useEffect, useState, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Printer } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { EMPRESA, SLOGAN_FONT_STACK } from '@/lib/empresa'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre']

export default function BoletaPage({ params }: { params: Promise<{ planillaId: string; trabajadorId: string }> }) {
  const { planillaId, trabajadorId } = use(params)
  const router = useRouter()
  const supabase = createClient()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [{ data: pl }, { data: trab }, { data: dets }] = await Promise.all([
        (supabase as any).from('planillas').select('*').eq('id', planillaId).single(),
        (supabase as any).from('trabajadores').select('*').eq('id', trabajadorId).single(),
        (supabase as any).from('planilla_detalle')
          .select(`monto, conceptos_remunerativos(codigo, nombre, tipo, orden)`)
          .eq('planilla_id', planillaId).eq('trabajador_id', trabajadorId),
      ])
      if (cancelled) return
      setData({ planilla: pl, trabajador: trab, detalles: dets ?? [] })
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [planillaId, trabajadorId, supabase])

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  if (!data?.planilla || !data?.trabajador) return <p className="text-center py-16 text-gray-400">No encontrado</p>

  const { planilla, trabajador, detalles } = data
  const ingresos = detalles.filter((d: any) => d.conceptos_remunerativos?.tipo === 'ingreso')
    .sort((a: any, b: any) => a.conceptos_remunerativos.orden - b.conceptos_remunerativos.orden)
  const descuentos = detalles.filter((d: any) => d.conceptos_remunerativos?.tipo === 'descuento')
    .sort((a: any, b: any) => a.conceptos_remunerativos.orden - b.conceptos_remunerativos.orden)
  const aportes = detalles.filter((d: any) => d.conceptos_remunerativos?.tipo === 'aporte_empleador')
  const totIngresos = ingresos.reduce((a: number, d: any) => a + Number(d.monto), 0)
  const totDescuentos = descuentos.reduce((a: number, d: any) => a + Number(d.monto), 0)
  const neto = totIngresos - totDescuentos

  return (
    <div className="max-w-3xl mx-auto space-y-4 print:space-y-0">
      <style>{`@media print {
        @page { size: A4 portrait; margin: 15mm; }
        .no-print { display: none !important; }
        body { background: white !important; }
      }`}</style>

      <div className="flex items-center gap-3 no-print">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="flex-1 text-xl font-bold">Boleta de pago</h1>
        <button onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-black bg-[#FBE600] rounded-md hover:bg-[#E5D100]">
          <Printer className="w-3.5 h-3.5" /> Imprimir / PDF
        </button>
      </div>

      <div className="bg-white border border-gray-300 rounded-lg p-6 print:border-2 print:border-black print:rounded-none">
        {/* Encabezado */}
        <div className="text-center border-b-2 border-black pb-3">
          <p className="font-bold text-lg">{EMPRESA.razon_social}</p>
          <p style={{ fontFamily: SLOGAN_FONT_STACK, fontSize: 14 }}>{EMPRESA.slogan}</p>
          <p className="text-xs text-gray-600">RUC {EMPRESA.ruc} · {EMPRESA.direccion_comercial}</p>
          <p className="font-bold text-sm mt-2 uppercase">
            Boleta de pago de remuneraciones — {MESES[planilla.mes - 1]} {planilla.anio}
          </p>
          <p className="text-[10px] text-gray-500">D.S. 001-98-TR — el duplicado queda en poder del trabajador</p>
        </div>

        {/* Datos del trabajador */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 py-3 border-b border-gray-300 text-sm">
          <p><span className="text-gray-500 text-xs">Trabajador:</span> <strong>{trabajador.nombres} {trabajador.apellido_paterno} {trabajador.apellido_materno ?? ''}</strong></p>
          <p><span className="text-gray-500 text-xs">Documento:</span> <span className="font-mono">{trabajador.tipo_doc} {trabajador.numero_doc}</span></p>
          <p><span className="text-gray-500 text-xs">Cargo:</span> {trabajador.cargo ?? '—'}</p>
          <p><span className="text-gray-500 text-xs">Fecha ingreso:</span> {formatDate(trabajador.fecha_ingreso)}</p>
          <p><span className="text-gray-500 text-xs">Régimen pensionario:</span> {trabajador.regimen_pension === 'onp' ? 'ONP - D.L. 19990' : `AFP ${trabajador.afp_nombre ?? ''} - D.L. 25897`}</p>
          <p><span className="text-gray-500 text-xs">Sueldo básico:</span> <span className="font-mono">{formatCurrency(trabajador.sueldo_base)}</span></p>
        </div>

        {/* Cuerpo: 2 columnas */}
        <div className="grid grid-cols-2 gap-6 py-4">
          <div>
            <p className="text-xs font-bold text-emerald-800 uppercase border-b border-emerald-300 pb-1 mb-2">Ingresos</p>
            {ingresos.map((d: any, i: number) => (
              <div key={i} className="flex justify-between text-sm py-0.5">
                <span>{d.conceptos_remunerativos.nombre}</span>
                <span className="font-mono">{formatCurrency(d.monto)}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-bold border-t border-gray-300 mt-2 pt-1">
              <span>Total ingresos</span>
              <span className="font-mono">{formatCurrency(totIngresos)}</span>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-red-800 uppercase border-b border-red-300 pb-1 mb-2">Descuentos</p>
            {descuentos.length === 0 ? (
              <p className="text-xs text-gray-400 italic">Sin descuentos</p>
            ) : descuentos.map((d: any, i: number) => (
              <div key={i} className="flex justify-between text-sm py-0.5">
                <span>{d.conceptos_remunerativos.nombre}</span>
                <span className="font-mono">{formatCurrency(d.monto)}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-bold border-t border-gray-300 mt-2 pt-1">
              <span>Total descuentos</span>
              <span className="font-mono">{formatCurrency(totDescuentos)}</span>
            </div>
          </div>
        </div>

        {/* Neto */}
        <div className="bg-[#FBE600] border-2 border-yellow-500 rounded p-3 flex justify-between items-center font-bold">
          <span>NETO A PAGAR</span>
          <span className="font-mono text-xl">{formatCurrency(neto)}</span>
        </div>

        {/* Aportes del empleador */}
        {aportes.length > 0 && (
          <div className="mt-3 pt-2 border-t border-gray-200">
            <p className="text-[10px] text-gray-500 uppercase font-semibold mb-1">Aportes del empleador (no descuentan al trabajador)</p>
            {aportes.map((d: any, i: number) => (
              <div key={i} className="flex justify-between text-xs text-gray-600">
                <span>{d.conceptos_remunerativos.nombre}</span>
                <span className="font-mono">{formatCurrency(d.monto)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Firmas */}
        <div className="grid grid-cols-2 gap-12 mt-12 pt-4">
          <div className="text-center border-t border-black pt-1">
            <p className="text-xs">EMPLEADOR</p>
            <p className="text-[10px] text-gray-500">{EMPRESA.razon_social}</p>
          </div>
          <div className="text-center border-t border-black pt-1">
            <p className="text-xs">TRABAJADOR</p>
            <p className="text-[10px] text-gray-500">{trabajador.tipo_doc} {trabajador.numero_doc}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
