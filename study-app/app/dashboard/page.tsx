"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { DashboardSkeleton } from "../components/LoadingSkeleton";

interface Session {
  id: string;
  status: string;
  current_checkpoint: number;
  total_checkpoints: number;
  updated_at: string;
  topic_id: string;
  topic_name: string;
  subject_name: string;
}

interface SessionRow {
  id: string;
  status: string;
  current_checkpoint: number;
  total_checkpoints: number;
  updated_at: string;
  topic_id: string;
  topics?: { name: string } | { name: string }[];
  subjects?: { name: string } | { name: string }[];
}

const quickLinks = [
  { title: "Tárgyak", desc: "Tantárgyak és témák", href: "/subjects", icon: "📚" },
  { title: "Tananyagok", desc: "Jegyzetek és PDF-ek", href: "/subjects", icon: "📄" },
  { title: "Beállítások", desc: "Profil és társ", href: "/settings", icon: "⚙️" },
];

export default function DashboardPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState({ topics: 0, quizzes: 0 });
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async (userId: string) => {
    const { data: s } = await supabase
      .from("chat_sessions")
      .select(`
        id, status, current_checkpoint, total_checkpoints, updated_at,
        topic_id,
        topics(name),
        subjects(name)
      `)
      .eq("user_id", userId)
      .eq("status", "in_progress")
      .order("updated_at", { ascending: false })
      .limit(5);

    if (s) {
      setSessions(
        (s as SessionRow[])
          .map((row) => ({
            id: row.id,
            status: row.status,
            current_checkpoint: row.current_checkpoint,
            total_checkpoints: row.total_checkpoints,
            updated_at: row.updated_at,
            topic_id: row.topic_id,
            topic_name: (Array.isArray(row.topics) ? row.topics[0]?.name : row.topics?.name) ?? "",
            subject_name: (Array.isArray(row.subjects) ? row.subjects[0]?.name : row.subjects?.name) ?? "",
          }))
          // Drop orphaned sessions (topic deleted → topic_id null): without a
          // topic the card link would point at /topics/null/learn.
          .filter((session) => session.topic_id && session.topic_name),
      );
    }

    const { count: tCount } = await supabase
      .from("topics")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    const { count: qCount } = await supabase
      .from("quiz_attempts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    setStats({
      topics: tCount ?? 0,
      quizzes: qCount ?? 0,
    });
  }, []);

  const initPage = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .single();

    if (!profile?.username) {
      router.push("/setup-profile");
      return;
    }

    setUsername(profile.username);
    await loadData(user.id);
    setLoading(false);
  }, [router, loadData]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    initPage();
  }, [initPage]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 24) return `${hours} órája`;
    const days = Math.floor(hours / 24);
    return `${days} napja`;
  };

  const statusLabels: Record<string, string> = {
    in_progress: "Folytatás",
    completed: "Kész",
    abandoned: "Félbehagyott",
  };

  const progressDots = (current: number, total: number) => {
    const dots = [];
    const max = Math.max(total, 1);
    for (let i = 0; i < max; i++) {
      dots.push(
        <span
          key={i}
          className={`inline-block h-2 w-2 rounded-full ${
            i < current ? "bg-accent" : i === current ? "bg-accent/70" : "bg-zinc-200 dark:bg-zinc-700"
          }`}
        />,
      );
    }
    return dots;
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-12">
      <header className="mb-12 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-accent">Cogni</span>mo
          </h1>
          {username && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Szia, {username}!
            </p>
          )}
        </div>
      </header>

      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold">📚 Folytasd a tanulást</h2>

        {sessions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
            <p className="mb-1 text-zinc-500 dark:text-zinc-400">
              Még nem tanultál semmit.
            </p>
            <p className="mb-4 text-xs text-zinc-400">
              Válassz egy tantárgyat, adj hozzá tananyagot, és kezdd el a tanulást!
            </p>
            <Link
              href="/subjects"
              className="inline-block cursor-pointer rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-600 hover:shadow-md active:scale-[0.98]"
            >
              Tárgyak kiválasztása →
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {sessions.map((session) => (
              <Link
                key={session.id}
                href={`/topics/${session.topic_id}/learn`}
                className="group rounded-2xl border border-zinc-200/60 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-md dark:border-zinc-800/60 dark:bg-zinc-900 dark:hover:border-accent/40"
              >
                <p className="text-xs text-zinc-400">{session.subject_name}</p>
                <h3 className="mt-0.5 font-semibold group-hover:text-accent transition-colors">
                  {session.topic_name}
                </h3>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {statusLabels[session.status] ?? session.status} · {session.current_checkpoint}/{session.total_checkpoints}
                </p>
                <div className="mt-3 flex items-center gap-1">
                  {progressDots(session.current_checkpoint, session.total_checkpoints)}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-zinc-400">{formatDate(session.updated_at)}</span>
                  <span className="text-sm font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
                    Folytasd →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mb-10">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Gyors navigáció
        </h3>
        <div className="flex flex-wrap gap-3">
          {quickLinks.map((link) => (
            <Link
              key={link.title}
              href={link.href}
              className="flex items-center gap-2 rounded-lg border border-zinc-200/60 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-md dark:border-zinc-800/60 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-accent/40"
            >
              <span>{link.icon}</span>
              <span>{link.title}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-auto flex items-center gap-6 border-t border-zinc-200/60 pt-6 text-sm text-zinc-500 dark:border-zinc-800/60">
        <span>Tanult témák: <strong className="text-accent">{stats.topics}</strong></span>
        <span>Kitöltött kvízek: <strong className="text-accent">{stats.quizzes}</strong></span>
      </section>
    </div>
  );
}
