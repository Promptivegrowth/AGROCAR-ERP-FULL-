import MayorAuxiliarView from '@/components/contabilidad/MayorAuxiliarView'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <MayorAuxiliarView tipo="cliente" id={id} rpcName="mayor_auxiliar_cliente" />
}
