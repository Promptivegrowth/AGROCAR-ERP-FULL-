import { NextResponse } from 'next/server'
import { getDepartamentos } from '@/lib/ubigeo'

export const dynamic = 'force-static'

export async function GET() {
  return NextResponse.json(getDepartamentos(), {
    headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable' },
  })
}
