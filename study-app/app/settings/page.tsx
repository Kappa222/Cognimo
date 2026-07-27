"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "../../lib/supabase";
import ConfirmModal from "../components/ConfirmModal";

const AVATARS = [
  { value: "/avatars/user-female.svg" },
  { value: "/avatars/user-male.svg" },
];

export default function SettingsPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState<string>(AVATARS[0].value);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const loadData = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("username, avatar_url")
      .eq("id", userId)
      .single();

    if (profile) {
      setUsername(profile.username ?? "");
      if (profile.avatar_url) setSelectedAvatar(profile.avatar_url);
    }
  }, []);

  const initPage = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    await loadData();
    setPageLoading(false);
  }, [router, loadData]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    initPage();
  }, [initPage]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSaved(false);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    const { error } = await supabase
      .from("profiles")
      .update({
        username,
        avatar_url: selectedAvatar,
      })
      .eq("id", userId);

    if (!error) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }

    setLoading(false);
  };

  const handleLogout = async () => {
    setShowLogout(false);
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Hiba történt");
      }
      await supabase.auth.signOut();
      window.location.href = "/";
    } catch (err) {
      setDeleteError((err as Error).message);
      setDeleting(false);
    }
  };

  if (pageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-accent" />
          <p className="text-sm text-zinc-500">Betöltés...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-accent"
      >
        ← Vissza a dashboardra
      </Link>
      <h1 className="mb-8 text-2xl font-bold tracking-tight">Beállítások</h1>

      <form onSubmit={handleSave} className="flex flex-col gap-8">
        <section className="rounded-2xl border border-zinc-200/60 bg-white p-8 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold">Profil</h2>
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Felhasználónév
              </label>
              <input
                type="text"
                required
                className="w-full rounded-lg border border-zinc-200 px-4 py-2.5 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-zinc-700 dark:bg-zinc-800"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200/60 bg-white p-8 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold">Avatar</h2>
          <div className="grid grid-cols-2 gap-3">
            {AVATARS.map((avatar) => (
              <button
                key={avatar.value}
                type="button"
                onClick={() => setSelectedAvatar(avatar.value)}
                className={`rounded-2xl border-2 p-6 transition-all duration-200 flex items-center justify-center ${
                  selectedAvatar === avatar.value
                    ? "border-accent bg-violet-50 dark:bg-violet-950/30"
                    : "border-zinc-200 hover:border-zinc-300 hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-700 dark:hover:border-zinc-600"
                }`}
              >
                <Image src={avatar.value} alt="" width={80} height={80} className="h-20 w-20" />
              </button>
            ))}
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="cursor-pointer rounded-lg bg-accent px-6 py-2 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? "Mentés..." : "Mentés"}
          </button>
          {saved && (
            <span className="text-sm text-green-600">Elmentve!</span>
          )}
          <button
            type="button"
            onClick={() => setShowLogout(true)}
            className="ml-auto cursor-pointer rounded-lg px-4 py-2 text-sm text-zinc-500 transition-all duration-200 hover:-translate-y-0.5 hover:bg-red-50 hover:text-red-600 hover:shadow-sm active:scale-[0.98] dark:hover:bg-red-950/50 dark:hover:text-red-400"
          >
            Kijelentkezés
          </button>
        </div>
      </form>

      <ConfirmModal
        open={showLogout}
        title="Kijelentkezés"
        message="Biztosan ki szeretnél jelentkezni?"
        confirmLabel="Kijelentkezés"
        cancelLabel="Mégse"
        variant="danger"
        onConfirm={handleLogout}
        onCancel={() => setShowLogout(false)}
      />

      <div className="mt-12 border-t border-zinc-200 pt-8 dark:border-zinc-800">
        <h2 className="mb-2 text-lg font-semibold text-red-600 dark:text-red-400">Veszélyes műveletek</h2>
        <p className="mb-4 text-sm text-zinc-500">
          Ezek a műveletek nem vonhatók vissza.
        </p>
        <button
          onClick={() => setShowDeleteAccount(true)}
          className="cursor-pointer rounded-lg border border-red-200 bg-red-50 px-5 py-2 text-sm font-medium text-red-600 transition-all duration-200 hover:-translate-y-0.5 hover:bg-red-100 hover:shadow-sm active:scale-[0.98] dark:border-red-900 dark:bg-red-950/50 dark:text-red-400 dark:hover:bg-red-950"
        >
          Fiók törlése
        </button>
        {deleteError && (
          <p className="mt-2 text-sm text-red-500">{deleteError}</p>
        )}
      </div>

      <ConfirmModal
        open={showDeleteAccount}
        title="Fiók törlése"
        message="Biztosan véglegesen törlöd a fiókodat? Az összes tananyagod, témád, üzeneted és előrehaladásod elvész. Ez a művelet nem vonható vissza."
        confirmLabel={deleting ? "Törlés..." : "Fiók törlése"}
        cancelLabel="Mégse"
        variant="danger"
        onConfirm={handleDeleteAccount}
        onCancel={() => { setShowDeleteAccount(false); setDeleteError(""); }}
        disabled={deleting}
      />
    </div>
  );
}
