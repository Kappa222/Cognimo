"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { supabase } from "../../lib/supabase";

const AVATARS = [
  { value: "/avatars/user-female.svg" },
  { value: "/avatars/user-male.svg" },
];

export default function SetupProfilePage() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState<string>(AVATARS[0].value);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) window.location.href = "/login";
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    const { data: defaultChar } = await supabase
      .from("characters")
      .select("id")
      .eq("is_default", true)
      .single();

    const { error } = await supabase
      .from("profiles")
      .update({
        username,
        avatar_url: selectedAvatar,
        preferred_character_id: defaultChar?.id,
      })
      .eq("id", userId);

    if (error) {
      setMessage("Hiba: " + error.message);
    } else {
      window.location.href = "/dashboard";
    }

    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-black">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200/60 bg-white p-8 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
        <h1 className="mb-2 text-2xl font-bold">Üdvözlünk!</h1>
        <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
          Válassz felhasználónevet és avatart.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            placeholder="Felhasználónév"
            aria-label="Felhasználónév"
            required
            className="rounded-lg border border-zinc-200 px-4 py-2.5 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:ring-accent/30"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />

          <div>
            <p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Válassz avatart:
            </p>
            <div className="grid grid-cols-2 gap-3">
              {AVATARS.map((avatar) => (
                <button
                  key={avatar.value}
                  type="button"
                  onClick={() => setSelectedAvatar(avatar.value)}
                  aria-label={avatar.value.includes("female") ? "Női avatar" : "Férfi avatar"}
                  aria-pressed={selectedAvatar === avatar.value}
                  className={`rounded-2xl border-2 p-6 transition-all duration-200 flex items-center justify-center ${
                    selectedAvatar === avatar.value
                      ? "border-accent bg-violet-50 dark:bg-violet-950/30"
                      : "border-zinc-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md dark:border-zinc-700 dark:hover:border-zinc-600"
                  }`}
                >
                  <Image src={avatar.value} alt="" width={80} height={80} className="h-20 w-20" />
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !selectedAvatar}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition-all hover:bg-violet-700 hover:shadow-md disabled:opacity-50 dark:hover:bg-violet-600"
          >
            {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
            {loading ? "Mentés..." : "Kezdjük!"}
          </button>
        </form>

        {message && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{message}</p>
        )}
      </div>
    </div>
  );
}
