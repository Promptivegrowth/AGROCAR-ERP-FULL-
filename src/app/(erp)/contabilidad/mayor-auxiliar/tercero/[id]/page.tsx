import MayorAuxiliarView from '@/components/contabilidad/MayorAuxiliarView'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <MayorAuxiliarView tipo="tercero" id={id} rpcName="mayor_auxiliar_tercero" />
}
