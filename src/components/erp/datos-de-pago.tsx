import { EMPRESA_PAGO } from '@/lib/empresa'

/**
 * Los datos para pagar a AGROCAR, en los impresos: estado de cuenta y
 * comprobantes. Sin estado ni hooks: sirve en páginas de servidor.
 *
 *   variante "caja"   → recuadro para A4 (estado de cuenta, factura A4)
 *   variante "ticket" → renglones compactos para el ticket de 80 mm
 */
export default function DatosDePago({ variante = 'caja' }: { variante?: 'caja' | 'ticket' | 'a4' }) {
  if (variante === 'a4') {
    return (
      <div data-datos-pago style={{ marginTop: 8, fontSize: 9.5, lineHeight: 1.35, color: '#111' }}>
        <div style={{ fontWeight: 700 }}>Cuentas para su pago</div>
        <div>{EMPRESA_PAGO.banco} {EMPRESA_PAGO.tipo_cuenta}: <strong>{EMPRESA_PAGO.cuenta}</strong></div>
        <div>CCI: <strong>{EMPRESA_PAGO.cci}</strong> · Yape: <strong>{EMPRESA_PAGO.yape}</strong></div>
        <div>Titular: {EMPRESA_PAGO.titular}</div>
      </div>
    )
  }
  if (variante === 'ticket') {
    return (
      <div data-datos-pago style={{ fontSize: 9, lineHeight: 1.3, marginTop: 4, textAlign: 'center' }}>
        <div style={{ fontWeight: 700 }}>CUENTAS PARA SU PAGO</div>
        <div>{EMPRESA_PAGO.banco} Cta. Cte. S/ {EMPRESA_PAGO.cuenta}</div>
        <div>CCI {EMPRESA_PAGO.cci}</div>
        <div>Yape {EMPRESA_PAGO.yape} · {EMPRESA_PAGO.titular}</div>
      </div>
    )
  }
  return (
    <div data-datos-pago className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-[11px] text-gray-800 print:bg-white">
      <p className="font-bold uppercase tracking-wide text-gray-900">Cuentas para su pago</p>
      <div className="mt-1 grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-0.5">
        <p><span className="text-gray-500">{EMPRESA_PAGO.banco} · {EMPRESA_PAGO.tipo_cuenta}:</span> <span className="font-mono font-semibold whitespace-nowrap">{EMPRESA_PAGO.cuenta}</span></p>
        <p><span className="text-gray-500">CCI:</span> <span className="font-mono font-semibold whitespace-nowrap">{EMPRESA_PAGO.cci}</span></p>
        <p><span className="text-gray-500">Yape:</span> <span className="font-mono font-semibold whitespace-nowrap">{EMPRESA_PAGO.yape}</span></p>
      </div>
      <p className="mt-0.5 text-gray-500">Titular: {EMPRESA_PAGO.titular}</p>
    </div>
  )
}
