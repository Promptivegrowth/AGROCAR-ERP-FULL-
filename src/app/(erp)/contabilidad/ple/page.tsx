'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Download, BookOpen, FileText, Boxes } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import { EMPRESA } from '@/lib/empresa'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre']

// Nomenclatura oficial PLE:
// LE + RUC(11) + AAAAMM + 00 + COD_LIBRO(6) + 00 + 1 + I(1=con info) + 1 + 1 + .txt
function nombreArchivoPle(ruc: string, anio: number, mes: number, codLibro: string, conInfo: boolean) {
  const periodo = `${anio}${String(mes).padStart(2, '0')}00`
  return `LE${ruc}${periodo}${codLibro}001${conInfo ? '1' : '0'}11.txt`
}

const LIBROS = [
  {
    key: 'diario',
    codigo: '050100',
    titulo: 'Libro Diario (5.1)',
    descripcion: 'Todos los asientos asentados del mes con anexos y cuentas PLE.',
    rpc: 'ple_libro_diario',
    icon: BookOpen,
    color: 'bg-emerald-600',
    campos: (f: any) => [
      f.periodo, f.cuo, f.correlativo_linea, f.codigo_ple, '', '',
      f.moneda, f.tipo_doc_anexo, f.num_doc_anexo, '', '', '',
      f.fecha_contable, f.fecha_vencimiento, f.fecha_operacion,
      f.glosa, f.glosa_referencial,
      Number(f.debe).toFixed(2), Number(f.haber).toFixed(2),
      f.dato_estructurado, f.estado_ple,
    ],
  },
  {
    key: 'mayor',
    codigo: '060100',
    titulo: 'Libro Mayor (6.1)',
    descripcion: 'Movimientos por cuenta ordenados por código contable.',
    rpc: 'ple_libro_mayor',
    icon: FileText,
    color: 'bg-purple-600',
    campos: (f: any) => [
      f.periodo, f.cuo, f.correlativo_linea, f.fecha_operacion,
      f.cuenta, f.denominacion_cuenta, f.glosa,
      Number(f.debe).toFixed(2), Number(f.haber).toFixed(2),
      f.estado_ple,
    ],
  },
]

export default function PlePage() {
  const router = useRouter()
  const supabase = createClient()
  const ahora = new Date()
  const [anio, setAnio] = useState(ahora.getFullYear())
  const [mes, setMes] = useState(ahora.getMonth() + 1)
  const [loading, setLoading] = useState<string | null>(null)
  const [preview, setPreview] = useState<Record<string, any>>({})

  const generar = async (libro: (typeof LIBROS)[number]) => {
    setLoading(libro.key)
    const { data, error } = await (supabase.rpc as any)(libro.rpc, { p_anio: anio, p_mes: mes })
    setLoading(null)
    if (error) { toast.error('Error', { description: error.message }); return }
    setPreview((p) => ({ ...p, [libro.key]: data }))
    const filas = (data?.filas ?? []) as any[]
    if (filas.length === 0) {
      toast.warning('Sin asientos ASENTADOS en el período', {
        description: 'Los borradores no van al PLE. Asienta los asientos primero en el Libro Diario.',
      })
      return
    }
    // Generar TXT
    const lineas = filas.map((f) => libro.campos(f).join('|'))
    const nombre = nombreArchivoPle(EMPRESA.ruc, anio, mes, libro.codigo, true)
    const blob = new Blob([lineas.join('\r\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nombre
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`${libro.titulo} exportado`, { description: nombre })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-emerald-700" />
            PLE — Programa de Libros Electrónicos
          </h1>
          <p className="text-sm text-gray-500">
            Genera los TXT con nomenclatura oficial SUNAT para subir al PLE
          </p>
        </div>
        <select value={mes} onChange={(e) => setMes(parseInt(e.target.value))}
          className="h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
          {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <select value={anio} onChange={(e) => setAnio(parseInt(e.target.value))}
          className="h-9 px-2 text-sm border border-gray-200 rounded-md bg-white">
          {[anio + 1, anio, anio - 1].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
        <strong>ℹ️ Solo asientos ASENTADOS van al PLE.</strong> Los borradores quedan fuera.
        El archivo se genera con la nomenclatura oficial: LE + RUC + período + código de libro.
        Para el Registro de Ventas y Compras usa el <Link href="/contabilidad/sire" className="underline font-semibold">módulo SIRE</Link>.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {LIBROS.map((libro) => {
          const prev = preview[libro.key]
          return (
            <div key={libro.key} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className={`w-10 h-10 rounded-lg ${libro.color} flex items-center justify-center mb-3`}>
                <libro.icon className="w-5 h-5 text-white" />
              </div>
              <h3 className="font-bold text-gray-900">{libro.titulo}</h3>
              <p className="text-xs text-gray-500 mt-1">{libro.descripcion}</p>
              <p className="text-[10px] text-gray-400 font-mono mt-2">
                {nombreArchivoPle(EMPRESA.ruc, anio, mes, libro.codigo, true)}
              </p>
              {prev && (
                <div className="mt-2 text-xs bg-gray-50 rounded p-2">
                  <p>{prev.cantidad} líneas · Debe {formatCurrency(prev.total_debe)} · Haber {formatCurrency(prev.total_haber)}</p>
                </div>
              )}
              <Button onClick={() => generar(libro)} disabled={loading === libro.key}
                className="mt-3 w-full bg-emerald-700 hover:bg-emerald-800 gap-1">
                {loading === libro.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Generar y descargar TXT
              </Button>
            </div>
          )
        })}

        {/* Card activos fijos */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-amber-600 flex items-center justify-center mb-3">
            <Boxes className="w-5 h-5 text-white" />
          </div>
          <h3 className="font-bold text-gray-900">Registro de Activos Fijos (7.1)</h3>
          <p className="text-xs text-gray-500 mt-1">
            Gestión de activos con depreciación mensual automática. El TXT 7.1 se genera desde el módulo.
          </p>
          <Link href="/contabilidad/activos-fijos">
            <Button className="mt-3 w-full bg-amber-600 hover:bg-amber-700 gap-1">
              Ir al módulo de Activos Fijos →
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
