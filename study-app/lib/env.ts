/**
 * Fail-fast environment accessor (server-side). Validates on first use so a
 * missing variable surfaces as a named error instead of an opaque crash
 * inside an SDK. Not used from client bundles — NEXT_PUBLIC_ values are
 * inlined at build time only when written as literal member expressions.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}" — set it in .env.local (see README).`,
    );
  }
  return value;
}
