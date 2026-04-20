import { NextResponse } from 'next/server'
import { getDistritos } from '@/lib/ubigeo'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const dep = (searchParams.get('dep') ?? '').trim()
  const prov = (searchParams.get('prov') ?? '').trim()
  if (!/^\d{2}$/.test(dep) || !/^\d{2}$/.test(prov)) {
    return NextResponse.json({ error: 'Parámetros dep y prov inválidos.' }, { status: 400 })
  }
  return NextResponse.json(getDistritos(dep, prov), {
    headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable' },
  })
}
