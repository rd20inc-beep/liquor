import { type JWTPayload, SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';

const secret = new TextEncoder().encode(config.JWT_SECRET);
const ISSUER = 'liquor-os';

export interface TokenPayload extends JWTPayload {
  sub: string; // user id
  role: string;
  org_id: string;
}

function parseTTL(ttl: string): string {
  // jose accepts strings like '15m', '30d' directly
  return ttl;
}

export async function signAccessToken(payload: {
  userId: string;
  role: string;
  orgId: string;
}): Promise<string> {
  return new SignJWT({ role: payload.role, org_id: payload.orgId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(parseTTL(config.ACCESS_TOKEN_TTL))
    .sign(secret);
}

export async function signRefreshToken(payload: {
  userId: string;
  role: string;
  orgId: string;
}): Promise<string> {
  return new SignJWT({ role: payload.role, org_id: payload.orgId, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(parseTTL(config.REFRESH_TOKEN_TTL))
    .sign(secret);
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, secret, { issuer: ISSUER });
  return payload as TokenPayload;
}
