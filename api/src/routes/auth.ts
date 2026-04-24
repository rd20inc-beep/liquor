import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config, isDev } from '../config.js';
import { sql } from '../db.js';
import { badRequest, unauthorized } from '../errors.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../lib/jwt.js';

const LoginBody = z.object({
  phone: z.string().min(10).max(15),
  otp: z.string().length(6),
  device_id: z.string().min(1),
});

const RefreshBody = z.object({
  refresh_token: z.string().min(1),
});

export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', { config: { public: true } }, async (req, reply) => {
    const body = LoginBody.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const { phone, otp, device_id } = body.data;

    // OTP verification — in dev, accept the fixed OTP
    if (isDev()) {
      if (otp !== config.DEV_OTP) {
        throw unauthorized('Invalid OTP');
      }
    } else {
      // Production: verify against SMS provider / OTP store
      // TODO: implement real OTP verification in production
      throw badRequest('OTP verification not yet implemented for production');
    }

    // Find user by phone
    const users = await sql`
        SELECT u.id, u.name, u.phone, u.role, u.org_id, u.active
        FROM users u
        WHERE u.phone = ${phone}
        LIMIT 1
      `;

    if (users.length === 0) {
      throw unauthorized('No user found with this phone number');
    }

    const user = users[0]!;
    if (!user.active) {
      throw unauthorized('Account is deactivated');
    }

    // Issue tokens
    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken({ userId: user.id, role: user.role, orgId: user.org_id }),
      signRefreshToken({ userId: user.id, role: user.role, orgId: user.org_id }),
    ]);

    // Register / update device
    await sql`
        INSERT INTO user_devices (user_id, device_id, last_seen_at)
        VALUES (${user.id}, ${device_id}, now())
        ON CONFLICT (user_id, device_id) DO UPDATE SET last_seen_at = now()
      `;

    return reply.status(200).send({
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        org_id: user.org_id,
      },
    });
  });

  app.post('/auth/refresh', { config: { public: true } }, async (req, reply) => {
    const body = RefreshBody.safeParse(req.body);
    if (!body.success) throw badRequest('Missing refresh_token');

    const payload = await verifyToken(body.data.refresh_token).catch(() => {
      throw unauthorized('Invalid or expired refresh token');
    });

    if (payload.type !== 'refresh') {
      throw unauthorized('Not a refresh token');
    }

    // Verify user still active
    const users = await sql`
        SELECT id, role, org_id, active FROM users WHERE id = ${payload.sub}
      `;
    if (users.length === 0 || !users[0]!.active) {
      throw unauthorized('User not found or deactivated');
    }

    const user = users[0]!;
    const accessToken = await signAccessToken({
      userId: user.id,
      role: user.role,
      orgId: user.org_id,
    });

    return reply.status(200).send({ access_token: accessToken });
  });
}
