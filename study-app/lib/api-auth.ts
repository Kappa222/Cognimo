import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./supabase-server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type AuthedRequest =
  | { ok: true; supabase: ServerClient; user: User }
  | { ok: false; response: NextResponse };

/**
 * Shared auth preamble for API routes: cookie-bound server client + verified
 * user, or a uniform 401. Usage:
 *
 *   const auth = await requireUser();
 *   if (!auth.ok) return auth.response;
 *   const { supabase, user } = auth;
 */
export async function requireUser(): Promise<AuthedRequest> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true, supabase, user };
}
