"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        setMessage(error.message);
      } else {
        setMessage("Ellenőrizd az emailed! Kattints a megerősítő linkre.");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setMessage(error.message);
      } else {
        window.location.href = "/dashboard";
      }
    }

    setLoading(false);
  };

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-zinc-950">
      {/* Glowing orbs */}
      <div className="pointer-events-none absolute -top-48 -left-48 h-[700px] w-[700px] rounded-full bg-violet-600/20 blur-[140px] animate-glow-pulse" />
      <div className="pointer-events-none absolute -bottom-48 -right-48 h-[500px] w-[500px] rounded-full bg-violet-500/10 blur-[100px] animate-glow-pulse" style={{ animationDelay: "2.5s" }} />

      {/* Floating decorations */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <svg className="absolute top-24 left-[15%] text-violet-500/15 animate-float" width="40" height="40" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1">
          <circle cx="24" cy="24" r="20" />
        </svg>
        <svg className="absolute top-1/2 right-[20%] text-violet-400/10 animate-float" style={{ animationDelay: "2s" }} width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M16 2 30 16 16 30 2 16 16 2z" />
        </svg>
        <svg className="absolute bottom-1/3 left-[20%] text-violet-600/10 animate-float" style={{ animationDelay: "4s" }} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 4v16m-8-8h16" />
        </svg>
        {/* Floating bubbles */}
        <div className="absolute top-[18%] right-[10%] h-3 w-3 rounded-full bg-violet-500/25 animate-float" style={{ animationDelay: "1s" }} />
        <div className="absolute bottom-[15%] right-[25%] h-2 w-2 rounded-full bg-violet-400/20 animate-float" style={{ animationDelay: "3s" }} />
        <div className="absolute top-[35%] left-[8%] h-4 w-4 rounded-full bg-violet-600/15 animate-float" style={{ animationDelay: "0.5s" }} />
        <div className="absolute bottom-[25%] right-[12%] h-2.5 w-2.5 rounded-full bg-violet-400/20 animate-float" style={{ animationDelay: "3.5s" }} />
        <div className="absolute top-[55%] left-[10%] h-1.5 w-1.5 rounded-full bg-violet-500/20 animate-float" style={{ animationDelay: "2.5s" }} />
        <div className="absolute top-[8%] right-[35%] h-5 w-5 rounded-full bg-violet-500/10 animate-float" style={{ animationDelay: "4s" }} />
        <div className="absolute top-[70%] right-[15%] h-2 w-2 rounded-full bg-violet-400/20 animate-float" style={{ animationDelay: "1.5s" }} />
        <div className="absolute bottom-[10%] left-[30%] h-3.5 w-3.5 rounded-full bg-violet-600/15 animate-float" style={{ animationDelay: "2s" }} />
        {/* Additional floating shapes */}
        <svg className="absolute top-[12%] right-[30%] text-violet-400/10 animate-float" style={{ animationDelay: "3s" }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
        <svg className="absolute bottom-[20%] left-[35%] text-violet-500/10 animate-float" style={{ animationDelay: "0.8s" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <polygon points="12 2 22 22 2 22 12 2" />
        </svg>
      </div>

      {/* Brand content — desktop only */}
      <div className="relative hidden w-1/2 flex-col p-16 text-white lg:flex">
          <div className="flex flex-1 flex-col justify-center">
          <div className="max-w-md">
            <h1 className="animate-fade-in-up text-5xl font-bold tracking-tight">
              <span className="bg-gradient-to-r from-violet-400 via-accent to-violet-300 bg-clip-text text-transparent">Cogni</span>
              <span className="text-white">mo</span>
            </h1>
            <div className="animate-fade-in-up mt-6 h-px w-16 bg-violet-400/40" style={{ animationDelay: "100ms" }} />
            <p className="animate-fade-in-up mt-6 text-xl leading-relaxed text-white/70" style={{ animationDelay: "200ms" }}>
              A mesterséges intelligencia segítségével tanulj gyorsabban. Tölts fel tananyagot, chatelj az AI-jal, generálj kvízeket, és kövesd nyomon a fejlődésed.
            </p>
          </div>
        </div>

        <div className="animate-fade-in-up flex items-center gap-2 text-sm text-white/25" style={{ animationDelay: "300ms" }}>
          <span className="h-px flex-1 bg-white/10" />
          Inverted Teacher módszer
        </div>
      </div>

      {/* Form panel */}
      <div className="relative flex flex-1 items-center justify-center px-4 sm:px-6 bg-transparent lg:bg-zinc-50 dark:bg-transparent lg:dark:bg-zinc-950">
        <div className="w-full max-w-lg">
          {/* Mobile brand */}
          <div className="mb-6 text-center lg:hidden">
            <h1 className="animate-fade-in-up text-4xl font-bold tracking-tight">
              <span className="bg-gradient-to-r from-violet-400 via-accent to-violet-300 bg-clip-text text-transparent">Cogni</span>
              <span className="text-white">mo</span>
            </h1>
          </div>

          {/* Card */}
          <div className="animate-fade-in-up rounded-2xl border border-zinc-200/60 bg-white p-8 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900" style={{ animationDelay: "250ms" }}>
            <h2 className="animate-fade-in-up text-2xl font-semibold tracking-tight" style={{ animationDelay: "350ms" }}>
              {mode === "login" ? "Üdvözlünk újra" : "Hozz létre fiókot"}
            </h2>
            <p className="animate-fade-in-up mt-1.5 text-base text-zinc-500 dark:text-zinc-400" style={{ animationDelay: "450ms" }}>
              {mode === "login" ? "Jelentkezz be a tanulás folytatásához" : "Regisztrálj, és kezdd el a tanulást"}
            </p>

            {/* Tab toggle with sliding indicator */}
            <div className="animate-fade-in-up relative mt-6 flex rounded-xl bg-zinc-100 dark:bg-zinc-800/60" style={{ animationDelay: "550ms" }}>
              <div
                className="absolute top-0.5 bottom-0.5 w-1/2 rounded-lg bg-white shadow-sm transition-all duration-300 ease-out dark:bg-zinc-700"
                style={{ left: mode === "login" ? "2px" : "calc(50% - 2px)" }}
              />
              <button
                onClick={() => { setMode("login"); setMessage(""); }}
                className="relative z-10 flex-1 cursor-pointer rounded-lg px-4 py-2.5 text-base font-medium text-zinc-500 transition-colors duration-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Belépés
              </button>
              <button
                onClick={() => { setMode("signup"); setMessage(""); }}
                className="relative z-10 flex-1 cursor-pointer rounded-lg px-4 py-2.5 text-base font-medium text-zinc-500 transition-colors duration-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Regisztráció
              </button>
            </div>

            <form onSubmit={handleSubmit} className="animate-fade-in-up mt-8 flex flex-col gap-5" style={{ animationDelay: "650ms" }}>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                    <path d="M3 4a2 2 0 00-2 2v1.161l8.441 4.221a1.25 1.25 0 001.118 0L19 7.162V6a2 2 0 00-2-2H3z" />
                    <path d="M19 8.839l-7.77 3.885a2.75 2.75 0 01-2.46 0L1 8.839V14a2 2 0 002 2h14a2 2 0 002-2V8.839z" />
                  </svg>
                </span>
                <input
                  type="email"
                  placeholder="Email"
                  aria-label="Email"
                  autoComplete="email"
                  required
                  className="w-full rounded-lg border border-zinc-200 py-3 pl-11 pr-4 text-base outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:ring-accent/30"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                    <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                  </svg>
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Jelszó"
                  aria-label="Jelszó"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                  className="w-full rounded-lg border border-zinc-200 py-3 pl-11 pr-11 text-base outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:ring-accent/30"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                  aria-label={showPassword ? "Jelszó elrejtése" : "Jelszó megjelenítése"}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                      <path fillRule="evenodd" d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.029 10.029 0 003.3-4.38 1.651 1.651 0 000-1.185A10.004 10.004 0 009.999 3a9.956 9.956 0 00-4.744 1.194L3.28 2.22zM7.752 6.69l1.092 1.092a2.5 2.5 0 013.374 3.373l1.091 1.092a4 4 0 00-5.557-5.557z" clipRule="evenodd" />
                      <path d="M10.748 13.93l2.523 2.523a9.987 9.987 0 01-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 010-1.186A10.007 10.007 0 012.839 6.02L6.07 9.252a4 4 0 004.678 4.678z" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                      <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                      <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3 text-base font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:translate-y-0 active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
              >
                {loading && <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                {loading
                  ? "Küldés..."
                  : mode === "login"
                    ? "Belépés"
                    : "Regisztráció"}
              </button>
            </form>

            {message && (
              <div className={`mt-5 flex items-start gap-2 rounded-lg border p-4 text-base ${
                mode === "signup" && !message.includes("Hiba") && !message.includes("error") && !message.includes("already")
                  ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300"
                  : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400"
              }`}>
                <span className="mt-0.5 shrink-0">
                  {mode === "signup" && !message.includes("Hiba") && !message.includes("error") && !message.includes("already") ? "✅" : "❌"}
                </span>
                <span>{message}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
