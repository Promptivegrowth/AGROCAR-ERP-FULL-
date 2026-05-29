import Image from 'next/image'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatCurrency } from '@/lib/utils'
import { notFound } from 'next/navigation'
import PrintButton from './print-button'
import { getSaldoCliente } from '@/lib/cliente-saldo'

export const dynamic = 'force-dynamic'

/**
 * Boleta pública accesible por link. Se usa para enviar al WhatsApp del cliente.
 * Muestra el detalle del pago con el logo de AGROCAR.
 */
export default async function BoletaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: cobro } = await supabase
    .from('cobros')
    .select(`
      id, total, efectivo, yape, plin, transferencia, fecha, notas, voucher_url, created_at,
      clientes(id, razon_social, ruc, dni, direccion, telefono),
      profiles!cobros_cobrador_id_fkey(full_name)
    `)
    .eq('id', id)
    .single()

  if (!cobro) notFound()

  const cliente: any = (cobro as any).clientes
  const cobrador: any = (cobro as any).profiles

  // Saldo del cliente: saldo ANTES de este cobro y saldo DESPUÉS
  const pagoActual = Number(cobro.total ?? 0)
  let saldoAntes = 0
  let saldoDespues = 0
  let muestraSaldo = false
  if (cliente?.id) {
    const saldoSinEste = await getSaldoCliente(supabase, cliente.id, { excluirCobroId: cobro.id })
    saldoAntes = saldoSinEste.saldo
    saldoDespues = Math.max(0, saldoAntes - pagoActual)
    muestraSaldo = saldoSinEste.facturado > 0
  }
  const fecha = new Date(cobro.fecha ?? cobro.created_at).toLocaleDateString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima',
  })
  const hora = new Date(cobro.created_at).toLocaleTimeString('es-PE', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima',
  })

  const metodos = [
    { label: 'Efectivo', monto: Number(cobro.efectivo ?? 0) },
    { label: 'Yape', monto: Number(cobro.yape ?? 0) },
    { label: 'Plin', monto: Number(cobro.plin ?? 0) },
    { label: 'Transferencia', monto: Number(cobro.transferencia ?? 0) },
  ].filter((m) => m.monto > 0)

  const codigo = `R-${cobro.id.slice(0, 8).toUpperCase()}`

  return (
    <div className="min-h-dvh bg-gray-100 py-6 px-4 print:bg-white print:py-0">
      <div className="max-w-md mx-auto bg-white rounded-2xl shadow-lg overflow-hidden print:shadow-none print:rounded-none">
        {/* Header negro con logo AGROCAR */}
        <div className="bg-black text-white px-6 pt-6 pb-5 border-b-4 border-[#FBE600]">
          <div className="flex items-center justify-between">
            <Image
              src="/logo-agrocar.png"
              alt="AGROCAR"
              width={140}
              height={40}
              priority
              className="object-contain bg-white rounded p-1"
            />
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">Recibo</p>
              <p className="font-mono font-bold text-lg">{codigo}</p>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3">AGROCAR S.R.L. · RUC 20519883296</p>
          <p className="text-xs text-gray-400">Tacna, Perú</p>
        </div>

        {/* Info cabecera */}
        <div className="px-6 py-4 border-b border-gray-100 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400">Fecha</p>
            <p className="font-medium text-gray-800">{fecha}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-gray-400">Hora</p>
            <p className="font-medium text-gray-800">{hora}</p>
          </div>
          <div className="col-span-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-400">Cliente</p>
            <p className="font-semibold text-gray-900">{cliente?.razon_social ?? '—'}</p>
            {(cliente?.ruc || cliente?.dni) && (
              <p className="text-xs text-gray-500 font-mono">
                {cliente.ruc ? `RUC ${cliente.ruc}` : `DNI ${cliente.dni}`}
              </p>
            )}
          </div>
          {cliente?.direccion && (
            <div className="col-span-2">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">Dirección</p>
              <p className="text-xs text-gray-700">{cliente.direccion}</p>
            </div>
          )}
        </div>

        {/* Detalle de pago */}
        <div className="px-6 py-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Detalle del Pago
          </p>
          <div className="space-y-2">
            {metodos.map((m) => (
              <div key={m.label} className="flex justify-between items-center py-1">
                <span className="text-sm text-gray-700">{m.label}</span>
                <span className="font-mono text-sm text-gray-900">{formatCurrency(m.monto)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t-2 border-black flex justify-between items-center">
            <span className="text-base font-bold text-gray-900 uppercase">Total</span>
            <span className="font-mono text-2xl font-bold text-black">
              {formatCurrency(Number(cobro.total ?? 0))}
            </span>
          </div>
          <div className="mt-3 bg-[#FBE600] rounded-lg px-3 py-2 text-center">
            <p className="text-xs font-semibold text-black">PAGO RECIBIDO CONFORME</p>
          </div>
        </div>

        {/* Estado de cuenta */}
        {muestraSaldo && (
          <div className="px-6 py-5 border-t border-gray-100 bg-gray-50/30">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Estado de Cuenta
            </p>
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-700">Saldo anterior</span>
                <span className="font-mono text-gray-900">{formatCurrency(saldoAntes)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-700">Pago aplicado</span>
                <span className="font-mono text-green-700">− {formatCurrency(pagoActual)}</span>
              </div>
              {saldoDespues > 0 ? (
                <div className="mt-3 pt-3 border-t-2 border-red-300 bg-red-50 -mx-6 px-6 py-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-red-900 uppercase">Saldo Pendiente</span>
                    <span className="font-mono text-xl font-bold text-red-700">
                      {formatCurrency(saldoDespues)}
                    </span>
                  </div>
                  <p className="text-[11px] text-red-700 mt-1">
                    Le quedan {formatCurrency(saldoDespues)} por cancelar de pedidos anteriores.
                  </p>
                </div>
              ) : (
                <div className="mt-3 pt-3 border-t-2 border-green-300 bg-green-50 -mx-6 px-6 py-3 text-center">
                  <p className="text-sm font-bold text-green-800 uppercase">✅ Cuenta Saldada</p>
                  <p className="text-[11px] text-green-700 mt-1">
                    No tiene saldo pendiente. ¡Gracias por su pago!
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Voucher (si existe) */}
        {cobro.voucher_url && (
          <div className="px-6 py-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Comprobante del pago
            </p>
            <div className="bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cobro.voucher_url}
                alt="Voucher"
                className="block mx-auto max-h-80 w-auto max-w-full object-contain"
              />
            </div>
          </div>
        )}

        {/* Observaciones */}
        {cobro.notas && (
          <div className="px-6 py-3 border-t border-gray-100">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Observaciones</p>
            <p className="text-xs text-gray-700 italic">{cobro.notas}</p>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 text-center text-xs text-gray-500 border-t border-gray-100">
          {cobrador?.full_name && (
            <p className="mb-1">
              Recibido por: <span className="font-medium text-gray-700">{cobrador.full_name}</span>
            </p>
          )}
          <p className="mt-2 text-[10px] text-gray-400">
            Documento interno no tributario · Generado electrónicamente
          </p>
        </div>
      </div>

      {/* Botón imprimir oculto en print */}
      <div className="max-w-md mx-auto mt-4 text-center print:hidden">
        <PrintButton />
      </div>
    </div>
  )
}
