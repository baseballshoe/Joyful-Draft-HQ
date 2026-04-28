// server/middleware/admin-auth.ts
// ─────────────────────────────────────────────────────────────────────
// Admin gating middleware for the v1.1b dashboard routes.
//
// HOW IT WORKS TODAY (v1.1a):
//   - Reads ADMIN_USER_IDS env var (comma-separated list of user IDs)
//   - Compares against the request's authenticated user ID
//   - Returns 404 (not 401) on failure — hides the existence of admin
//     routes from non-admins, which is good defence-in-depth
//
// HOW TO UPGRADE WHEN PROPER USERS TABLE EXISTS (Phase 2 multi-user):
//   - Add `is_admin` boolean column to your users table
//   - Replace the body of `isAdminUser()` below with a DB lookup
//   - Keep the env var fallback as a backstop for emergency access
//
// USER ID RESOLUTION:
//   The middleware looks for the user ID in this order:
//     1. req.user.id (Replit Auth, if you wire that up)
//     2. req.session.userId (express-session)
//     3. req.userId (custom middleware, if any)
//   Adjust below if your auth flow uses a different shape.
//
// SETUP:
//   In Replit Secrets, add:
//     ADMIN_USER_IDS=1
//   (Or whatever your user ID is. For now this is just you.)
//
//   Multiple admins later:
//     ADMIN_USER_IDS=1,42,1337
// ─────────────────────────────────────────────────────────────────────
import type { Request, Response, NextFunction } from 'express';

interface AuthedRequest extends Request {
  user?:    { id?: number | string; isAdmin?: boolean };
  userId?:  number | string;
  session?: any;
}

/**
 * Read the configured admin user IDs from env. Returns a Set of
 * normalized string IDs for easy comparison.
 */
function getAdminIdSet(): Set<string> {
  const raw = process.env.ADMIN_USER_IDS ?? '';
  return new Set(
    raw.split(',')
       .map(s => s.trim())
       .filter(Boolean)
  );
}

/**
 * Pull the authenticated user ID from the request, regardless of
 * which auth pattern is in use. Returns undefined if no user is found.
 */
function resolveUserId(req: AuthedRequest): string | undefined {
  // 1. req.user.id (most common — Replit Auth, Passport, etc.)
  const fromUser = req.user?.id;
  if (fromUser !== undefined && fromUser !== null) return String(fromUser);

  // 2. req.session.userId (express-session)
  const fromSession = req.session?.userId;
  if (fromSession !== undefined && fromSession !== null) return String(fromSession);

  // 3. req.userId (custom)
  if (req.userId !== undefined && req.userId !== null) return String(req.userId);

  return undefined;
}

/**
 * Check if a given user ID is an admin.
 *
 * v1.1a: env var only.
 * Phase 2: replace with DB lookup like:
 *
 *   const [u] = await db.select({ isAdmin: users.isAdmin })
 *                       .from(users).where(eq(users.id, parseInt(userId)));
 *   if (u?.isAdmin) return true;
 *
 * Then leave the env-var check below as a backstop.
 */
export async function isAdminUser(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;

  // ── Future: DB lookup goes here ──
  // const [u] = await db.select(...).from(users).where(eq(users.id, ...));
  // if (u?.isAdmin) return true;

  // ── Env-var fallback (always active) ──
  const adminIds = getAdminIdSet();
  return adminIds.has(userId);
}

/**
 * Express middleware. Returns 404 if the caller isn't admin (instead
 * of 401, to hide route existence). Attaches req.user.isAdmin = true
 * on success so downstream handlers can verify.
 */
export async function requireAdmin(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = resolveUserId(req);
    const ok = await isAdminUser(userId);

    if (!ok) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    if (!req.user) req.user = {};
    req.user.id = userId;
    req.user.isAdmin = true;
    next();
  } catch (err) {
    console.error('[admin-auth] Error checking admin status:', err);
    res.status(500).json({ error: 'Internal error' });
  }
}

/**
 * Helper for non-middleware contexts (e.g. checking inside a route
 * that's already mounted without requireAdmin).
 */
export async function isRequestAdmin(req: AuthedRequest): Promise<boolean> {
  const userId = resolveUserId(req);
  return isAdminUser(userId);
}
