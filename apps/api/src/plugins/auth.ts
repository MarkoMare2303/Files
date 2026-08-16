import { AppError, ErrorCode } from '@swissov/shared';
import type { UserRole } from '@swissov/types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import type { AppContext } from '../context.js';
import type { ProfileRow } from '../services/profiles.service.js';

/**
 * Authentifizierung (§22/§42).
 *
 * Die App meldet sich bei Supabase Auth an (Apple, Google, E-Mail) und schickt
 * das dort ausgestellte JWT als `Authorization: Bearer`. Diese API prüft die
 * Signatur selbst — sie vertraut niemals Angaben aus dem Client-Body.
 *
 * Unterstützt werden beide Supabase-Varianten:
 *   • HS256 mit gemeinsamem Secret (`SUPABASE_JWT_SECRET`)
 *   • asymmetrische Signaturen über JWKS (`SUPABASE_URL`)
 */

export interface AuthenticatedUser {
  id: string;
  email: string | undefined;
  role: UserRole;
  profile: ProfileRow;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** `null` im Gastmodus. */
    user: AuthenticatedUser | null;
    /** Pseudonymisierte IP für Rate Limiting und Missbrauchserkennung. */
    ipHash: string | null;
  }
  interface FastifyInstance {
    ctx: AppContext;
    /** Erzwingt ein gültiges Token; wirft sonst 401. */
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Erzwingt Moderator- oder Adminrolle. */
    requireModerator: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Erzwingt Adminrolle. */
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export class TokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet> | null;
  private readonly secret: Uint8Array | null;

  constructor(options: { supabaseUrl: string | undefined; jwtSecret: string | undefined }) {
    this.secret = options.jwtSecret ? new TextEncoder().encode(options.jwtSecret) : null;
    this.jwks = options.supabaseUrl
      ? createRemoteJWKSet(new URL(`${options.supabaseUrl}/auth/v1/.well-known/jwks.json`), {
          cooldownDuration: 30_000,
          cacheMaxAge: 10 * 60_000,
        })
      : null;
  }

  get isConfigured(): boolean {
    return this.secret !== null || this.jwks !== null;
  }

  async verify(token: string): Promise<JWTPayload> {
    if (!this.isConfigured) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, {
        message:
          'Token-Verifikation ist nicht konfiguriert. SUPABASE_JWT_SECRET oder SUPABASE_URL setzen (siehe .env.example).',
      });
    }

    let algorithm: string | undefined;
    try {
      algorithm = decodeProtectedHeader(token).alg;
    } catch {
      throw new AppError(ErrorCode.UNAUTHENTICATED, { message: 'Token ist nicht lesbar' });
    }

    try {
      if (algorithm === 'HS256' && this.secret) {
        const { payload } = await jwtVerify(token, this.secret, { algorithms: ['HS256'] });
        return payload;
      }
      if (this.jwks) {
        const { payload } = await jwtVerify(token, this.jwks, {
          algorithms: ['RS256', 'ES256', 'EdDSA'],
        });
        return payload;
      }
      throw new AppError(ErrorCode.UNAUTHENTICATED, {
        message: `Signaturverfahren ${algorithm ?? 'unbekannt'} kann nicht geprüft werden`,
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(ErrorCode.UNAUTHENTICATED, {
        message: `Token ungültig: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}

export interface AuthPluginOptions {
  context: AppContext;
  /** Ermöglicht Integrationstests ohne echtes Supabase-Projekt. */
  verifier?: TokenVerifier;
}

export default fp<AuthPluginOptions>(async (fastify, options) => {
  const ctx = options.context;
  const verifier =
    options.verifier ??
    new TokenVerifier({ supabaseUrl: ctx.env.SUPABASE_URL, jwtSecret: ctx.env.SUPABASE_JWT_SECRET });

  fastify.decorateRequest('user', null);
  fastify.decorateRequest('ipHash', null);

  // Token wird bei jeder Anfrage geprüft, aber nur erzwungen, wo nötig —
  // dadurch funktioniert der Gastmodus (§22) ohne Sonderpfade.
  fastify.addHook('onRequest', async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;

    const token = header.slice(7).trim();
    if (token.length === 0) return;

    try {
      const payload = await verifier.verify(token);
      const userId = typeof payload.sub === 'string' ? payload.sub : null;
      if (!userId) return;

      const email = typeof payload.email === 'string' ? payload.email : undefined;
      const profile = await ctx.profiles.ensure(userId, email);
      if (profile.deleted_at) return; // Gelöschte Konten gelten als nicht angemeldet.

      request.user = { id: userId, email, role: profile.role, profile };
      // Bewusst ohne await: die Aktualisierung darf die Antwort nicht bremsen.
      void ctx.profiles.touch(userId).catch(() => undefined);
    } catch (error) {
      // Ungültige Tokens führen nicht sofort zu 401 — nur geschützte Routen
      // lehnen ab. Das hält den Gastmodus auch bei abgelaufenem Token nutzbar.
      request.log.debug({ err: error }, 'Token konnte nicht verifiziert werden');
    }
  });

  fastify.decorate('requireAuth', async (request: FastifyRequest) => {
    if (!request.user) throw new AppError(ErrorCode.UNAUTHENTICATED);
  });

  fastify.decorate('requireModerator', async (request: FastifyRequest) => {
    if (!request.user) throw new AppError(ErrorCode.UNAUTHENTICATED);
    if (request.user.role !== 'MODERATOR' && request.user.role !== 'ADMIN') {
      throw new AppError(ErrorCode.FORBIDDEN);
    }
  });

  fastify.decorate('requireAdmin', async (request: FastifyRequest) => {
    if (!request.user) throw new AppError(ErrorCode.UNAUTHENTICATED);
    if (request.user.role !== 'ADMIN') throw new AppError(ErrorCode.FORBIDDEN);
  });
});
