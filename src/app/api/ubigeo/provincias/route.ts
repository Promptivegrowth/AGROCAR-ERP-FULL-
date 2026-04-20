import { NextResponse } from 'next/server'
import { getProvincias } from '@/lib/ubigeo'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const dep = (searchParams.get('dep') ?? '').trim()
  if (!/^\d{2}$/.test(dep)) {
    return NextResponse.json({ error: 'Parámetro dep inválido (2 dígitos).' }, { status: 400 })
  }
  return NextResponse.json(getProvincias(dep), {
    headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable' },
  })
}
