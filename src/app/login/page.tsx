"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    if (!supabase) {
      setStatus("Add Supabase values to .env.local to enable authentication.");
      return;
    }

    setLoading(true);
    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { data: { display_name: displayName.trim() } },
          });
    setLoading(false);

    if (result.error) {
      setStatus(result.error.message);
      return;
    }
    if (mode === "login") {
      router.push("/");
      router.refresh();
    } else {
      setStatus("Account created. Check your email if confirmation is enabled.");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#08090c] px-5 py-10 text-white">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex items-center gap-3 text-lg font-semibold tracking-tight">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-500">✦</span>
          movietogether
        </Link>
        <div className="rounded-2xl border border-white/[0.08] bg-[#101116] p-6 shadow-2xl shadow-violet-950/20 sm:p-8">
          <div className="mb-7">
            <p className="text-xs uppercase tracking-[0.2em] text-violet-300">
              {mode === "login" ? "Welcome back" : "Join the watch party"}
            </p>
            <h1 className="mt-2 text-3xl font-semibold">
              {mode === "login" ? "Sign in to your room" : "Create your account"}
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Keep your rooms private and your movie nights together.
            </p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <label className="block text-xs text-zinc-400">
                Display name
                <input
                  required
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
                  placeholder="How friends will see you"
                />
              </label>
            )}
            <label className="block text-xs text-zinc-400">
              Email
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
                placeholder="you@example.com"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Password
              <input
                required
                minLength={8}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white outline-none focus:border-violet-400"
                placeholder="At least 8 characters"
              />
            </label>
            {status && (
              <p className="rounded-xl bg-violet-500/10 px-3 py-2.5 text-xs leading-5 text-violet-200">
                {status}
              </p>
            )}
            <button
              disabled={loading}
              className="w-full rounded-xl bg-violet-500 py-3 text-sm font-semibold transition hover:bg-violet-400 disabled:cursor-wait disabled:opacity-60"
            >
              {loading ? "Working..." : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>
          <div className="mt-6 text-center text-sm text-zinc-500">
            {mode === "login" ? "New to MovieTogether? " : "Already have an account? "}
            <button
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setStatus("");
              }}
              className="text-violet-300 hover:text-white"
            >
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </div>
        </div>
        <p className="mt-6 text-center text-xs leading-5 text-zinc-600">
          Only share movies you are authorized to watch and share. Provider DRM and restrictions are never bypassed.
        </p>
      </div>
    </main>
  );
}
