import { NextRequest, NextResponse } from 'next/server';

/**
 * 허용된 VPN 공인 IP 대역 (CIDR)
 * PC: 58.87.60.0/24, 58.87.61.0/24, 58.87.63.0/24
 */
const ALLOWED_CIDRS = [
  '58.87.60.0/24',
  '58.87.61.0/24',
  '58.87.63.0/24',
];

function ipToNumber(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isIpInCidr(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipToNumber(ip) & mask) === (ipToNumber(network) & mask);
}

function isAllowedIp(ip: string): boolean {
  return ALLOWED_CIDRS.some((cidr) => isIpInCidr(ip, cidr));
}

export function middleware(request: NextRequest) {
  // 개발 환경에서는 IP 제한 미적용
  if (process.env.NODE_ENV === 'development') {
    return NextResponse.next();
  }

  // IP 제한 비활성화 옵션 (환경변수로 제어)
  if (process.env.DISABLE_IP_RESTRICTION === 'true') {
    return NextResponse.next();
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '';

  // API 배치 호출은 허용 (GitHub Actions 등)
  if (request.nextUrl.pathname.startsWith('/api/batch')) {
    return NextResponse.next();
  }

  if (!ip || !isAllowedIp(ip)) {
    return new NextResponse('Access Denied', { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * 정적 파일(_next/static, favicon 등)과 API 배치 경로를 제외한 모든 경로에 적용
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
