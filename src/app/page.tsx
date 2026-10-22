"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";

type Message = {
  id: number;
  name: string;
  text: string;
  time: string;
  self?: boolean;
};

type Room = {
  id: string;
  name: string;
  room_code: string;
  status: "active" | "ended";
  created_at: string;
};

const initialMessages: Message[] = [
  { id: 1, name: "Maya", text: "Ready when you are 🍿", time: "8:41 PM" },
  { id: 2, name: "You", text: "Starting in a minute!", time: "8:42 PM", self: true },
];

const participants = [
  { name: "You", initials: "HV", tone: "from-violet-500 to-indigo-500", status: "Host" },
  { name: "Maya", initials: "M", tone: "from-orange-400 to-rose-500", status: "Watching" },
  { name: "Alex", initials: "A", tone: "from-cyan-400 to-blue-500", status: "Watching" },
];

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-5 w-5 items-center justify-center">{children}</span>;
}

export default function Home() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"chat" | "people">("chat");
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [source, setSource] = useState("Pick a movie");
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [toast, setToast] = useState("");
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [createError, setCreateError] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomsError, setRoomsError] = useState("");
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null);

  const progress = useMemo(() => (playing ? 38 : 28), [playing]);

  useEffect(() => {
    let active = true;

    async function loadRooms() {
      if (!supabase) {
        setRoomsLoading(false);
        return;
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        if (active) setRoomsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("rooms")
        .select("id, name, room_code, status, created_at")
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(6);

      if (!active) return;
      if (error) {
        setRoomsError(error.message);
      } else {
        setRooms((data ?? []) as Room[]);
      }
      setRoomsLoading(false);
    }

    void loadRooms();
    return () => {
      active = false;
    };
  }, []);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }

  function sendMessage() {
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => [
      ...current,
      { id: Date.now(), name: "You", text, time: "now", self: true },
    ]);
    setDraft("");
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      notify("Please choose a video file.");
      return;
    }
    setSource(file.name);
    setShowSourceMenu(false);
    notify("Local video selected. WebRTC streaming connects once the room is live.");
  }

  async function createRoom() {
    const name = roomName.trim();
    if (!name) return;
    if (!supabase) {
      setCreateError("Supabase is not configured. Add the values to .env.local.");
      return;
    }

    setCreatingRoom(true);
    setCreateError("");
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setCreatingRoom(false);
      setCreateError("You are not signed in. Sign in first, then create the room.");
      return;
    }

    const roomCode = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
    const { data, error } = await supabase
      .from("rooms")
      .insert({ name, host_id: userData.user.id, room_code: roomCode })
      .select("id")
      .single();

    if (error || !data) {
      setCreatingRoom(false);
      setCreateError(
        error?.message ??
          "The room was not created. Confirm that the Supabase migration has been run.",
      );
      return;
    }
    setShowCreate(false);
    setRoomName("");
    router.push(`/room/${data.id}`);
  }

  async function joinRoom() {
    const code = roomCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code) || !supabase) {
      setJoinError("Enter the six-character room code.");
      return;
    }
    setJoiningRoom(true);
    setJoinError("");
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setJoinError("Sign in first to request access.");
      setJoiningRoom(false);
      return;
    }
    const { data: room, error: roomError } = await supabase
      .rpc("lookup_active_room_by_code", { target_room_code: code })
      .maybeSingle();
    const roomRecord = room as { id: string } | null;
    if (roomError) {
      setJoinError(
        roomError.code === "42883"
          ? "Room lookup is not installed. Apply the Supabase migrations, then try again."
          : `Room lookup failed: ${roomError.message}`,
      );
      setJoiningRoom(false);
      return;
    }
    if (!roomRecord) {
      setJoinError("No active room was found with that code. Check the six-character code and try again.");
      setJoiningRoom(false);
      return;
    }
    const { error } = await supabase.from("room_members").insert({
      room_id: roomRecord.id,
      user_id: userData.user.id,
      role: "member",
      status: "pending",
    });
    if (error && error.code !== "23505") {
      setJoinError(error.message);
      setJoiningRoom(false);
      return;
    }
    if (error?.code === "23505") {
      setJoinError("You already have a membership request for this room.");
      setJoiningRoom(false);
      return;
    }
    setShowJoin(false);
    setRoomCode("");
    setJoiningRoom(false);
    router.push(`/room/${roomRecord.id}`);
  }

  async function deleteRoom(room: Room) {
    if (!supabase || !window.confirm(`Delete "${room.name}"? This removes its chat, members, and playback state.`)) return;
    setDeletingRoomId(room.id);
    const { error } = await supabase.from("rooms").delete().eq("id", room.id);
    setDeletingRoomId(null);
    if (error) {
      setRoomsError(error.message);
      return;
    }
    setRooms((current) => current.filter((item) => item.id !== room.id));
    notify("Room deleted.");
  }

  return (
    <main className="min-h-screen bg-[#08090c] text-white">
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#08090c]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-500 shadow-lg shadow-violet-500/20">
              <span className="text-lg">✦</span>
            </div>
            <span className="text-lg font-semibold tracking-tight">movietogether</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => notify("Invite link copied!")} className="hidden rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-300 transition hover:border-white/20 hover:bg-white/5 sm:block">
              Share room
            </button>
            <Link href="/login" className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1.5 pl-1.5 pr-3 text-sm text-zinc-200 transition hover:bg-white/[0.08]">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-violet-400 to-blue-500 text-[11px] font-bold">HV</span>
              <span className="hidden sm:inline">Harshvardhan</span>
              <span className="text-zinc-500">⌄</span>
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-6 px-5 py-7 sm:px-8 lg:grid-cols-[minmax(0,1fr)_350px]">
        <section>
          <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="mb-2 text-sm text-zinc-500">Friday, October 21, 2026</p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Good evening, Harshvardhan <span className="inline-block">👋</span></h1>
              <p className="mt-2 text-zinc-400">Make some memories, one movie at a time.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowJoin(true)} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-zinc-300 transition hover:bg-white/5">Join with code</button>
              <button onClick={() => setShowCreate(true)} className="flex w-fit items-center gap-2 rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold shadow-lg shadow-violet-500/20 transition hover:bg-violet-400"><span className="text-lg leading-none">+</span> Create a room</button>
            </div>
          </div>

          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            {[
              ["Active room", "Movie night", "● Live now", "text-emerald-400"],
              ["Friends watching", "2 friends", "Join them →", "text-violet-300"],
              ["Your watch time", "12h 48m", "This month", "text-zinc-500"],
            ].map(([label, value, foot, color]) => (
              <div key={label} className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-5">
                <div className="mb-4 flex items-center justify-between text-xs text-zinc-500"><span>{label}</span><span className="text-base">⋯</span></div>
                <div className="text-xl font-semibold">{value}</div>
                <div className={`mt-2 text-xs ${color}`}>{foot}</div>
              </div>
            ))}
          </div>

          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your rooms</h2>
            <span className="text-sm text-zinc-500">{rooms.length} active</span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {roomsLoading && <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-6 text-sm text-zinc-500">Loading your rooms...</div>}
            {roomsError && <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-6 text-sm text-rose-200">{roomsError}</div>}
            {!roomsLoading && !roomsError && rooms.map((room) => (
              <div key={room.id} className="group overflow-hidden rounded-2xl border border-violet-400/30 bg-[#17131f] shadow-xl shadow-violet-950/20">
                <div className="relative h-44 overflow-hidden bg-[radial-gradient(circle_at_70%_20%,#7c3aed55,transparent_35%),linear-gradient(135deg,#20143a,#09090d)]">
                  <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "linear-gradient(120deg, transparent 35%, #f59e0b33 36%, transparent 37%), linear-gradient(30deg, transparent 50%, #ec489933 51%, transparent 52%)" }} />
                  <div className="absolute left-5 top-5 flex items-center gap-2 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> LIVE NOW</div>
                  <div className="absolute bottom-5 left-5"><p className="mb-1 text-xs text-violet-200">Room {room.room_code}</p><h3 className="text-xl font-semibold">{room.name}</h3></div>
                  <div className="absolute bottom-5 right-5 flex -space-x-2">{participants.slice(0, 1).map((person) => <span key={person.name} className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#17131f] bg-gradient-to-br ${person.tone} text-[10px] font-bold`}>{person.initials}</span>)}</div>
                </div>
                <div className="flex items-center justify-between gap-3 p-4"><div><p className="text-sm font-medium">Active room</p><p className="mt-1 text-xs text-zinc-500">Created {new Date(room.created_at).toLocaleDateString()}</p></div><div className="flex shrink-0 gap-2"><button onClick={() => void deleteRoom(room)} disabled={deletingRoomId === room.id} className="rounded-lg px-2.5 py-2 text-xs text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-50">{deletingRoomId === room.id ? "Deleting..." : "Delete"}</button><button onClick={() => router.push(`/room/${room.id}`)} className="rounded-lg bg-white/10 px-3 py-2 text-xs font-medium transition hover:bg-white/15">Open room</button></div></div>
              </div>
            ))}
            {!roomsLoading && !roomsError && rooms.length === 0 && <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-6 text-sm text-zinc-500">No active rooms yet. Create one to start watching.</div>}
            <button onClick={() => setShowCreate(true)} className="flex min-h-[250px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] text-zinc-500 transition hover:border-violet-400/50 hover:bg-violet-500/[0.04] hover:text-violet-300">
              <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-2xl font-light">+</span><span className="text-sm font-medium">Create a new room</span><span className="mt-1 text-xs">Invite friends and start watching</span>
            </button>
          </div>

          <div className="mt-8 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
            <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">Watch together</h2><span className="rounded-full bg-violet-400/10 px-2.5 py-1 text-[11px] text-violet-300">HOW IT WORKS</span></div>
            <div className="grid gap-5 sm:grid-cols-3">
              {[["01", "Create a room", "Set up a private space for your movie night."], ["02", "Invite your people", "Share a link with friends wherever they are."], ["03", "Press play", "Chat, call, and watch in perfect sync."]].map(([number, title, text]) => <div key={number} className="flex gap-3"><span className="text-sm font-semibold text-violet-400">{number}</span><div><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 text-xs leading-5 text-zinc-500">{text}</p></div></div>)}
            </div>
          </div>
        </section>

        <aside className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#101116]">
          <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4"><div><p className="text-xs text-emerald-400">● LIVE ROOM</p><h2 className="mt-1 font-semibold">Movie night</h2></div><button onClick={() => notify("Room invite copied!")} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/5">↗ Invite</button></div>
          <div className="border-b border-white/[0.07] p-4">
            <div className="relative aspect-video overflow-hidden rounded-xl bg-[radial-gradient(circle_at_60%_20%,#6d28d955,transparent_35%),linear-gradient(135deg,#26183d,#09090d)]">
              <div className="absolute inset-0 flex items-center justify-center"><button onClick={() => setPlaying(!playing)} className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-2xl backdrop-blur transition hover:scale-105 hover:bg-white/25">{playing ? "Ⅱ" : "▶"}</button></div>
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent px-3 pb-3 pt-8"><div className="mb-2 h-1 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-violet-400 transition-all" style={{ width: `${progress}%` }} /></div><div className="flex items-center justify-between text-[10px] text-zinc-300"><span>{playing ? "00:32:18" : "00:24:05"} / 01:57:22</span><span>🎬 Movie preview</span></div></div>
            </div>
            <div className="mt-3 flex items-center justify-between"><div><p className="text-sm font-medium">{source === "Pick a movie" ? "Pick something to watch" : source}</p><p className="mt-1 text-xs text-zinc-500">Host controls playback</p></div><div className="relative"><button onClick={() => setShowSourceMenu(!showSourceMenu)} className="rounded-lg bg-violet-500/15 px-3 py-2 text-xs font-medium text-violet-300 hover:bg-violet-500/25">Change source</button>{showSourceMenu && <div className="absolute right-0 top-11 z-10 w-52 rounded-xl border border-white/10 bg-[#1b1b22] p-1.5 shadow-2xl"><label className="block cursor-pointer rounded-lg px-3 py-2.5 text-xs text-zinc-300 hover:bg-white/10">Upload local video<input className="hidden" type="file" accept="video/*" onChange={chooseFile} /></label><button onClick={() => { setSource("YouTube video"); setShowSourceMenu(false); notify("Paste a permitted YouTube URL in the full room."); }} className="block w-full rounded-lg px-3 py-2.5 text-left text-xs text-zinc-300 hover:bg-white/10">Use YouTube</button><button onClick={() => { setSource("Official provider link"); setShowSourceMenu(false); notify("Only official provider embeds are supported."); }} className="block w-full rounded-lg px-3 py-2.5 text-left text-xs text-zinc-300 hover:bg-white/10">Official provider link</button></div>}</div></div>
          </div>
          <div className="grid grid-cols-2 gap-2 border-b border-white/[0.07] p-4"><button onClick={() => setMuted(!muted)} className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs ${muted ? "bg-rose-500/15 text-rose-300" : "bg-white/[0.06] text-zinc-300"} hover:bg-white/10`}><Icon>{muted ? "🔇" : "🎙"}</Icon>{muted ? "Unmute" : "Mute"}</button><button onClick={() => setCameraOn(!cameraOn)} className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs ${cameraOn ? "bg-white/[0.06] text-zinc-300" : "bg-rose-500/15 text-rose-300"} hover:bg-white/10`}><Icon>{cameraOn ? "▣" : "▧"}</Icon>{cameraOn ? "Camera" : "Camera off"}</button></div>
          <div className="flex border-b border-white/[0.07]"><button onClick={() => setActiveTab("chat")} className={`flex-1 py-3 text-xs font-medium ${activeTab === "chat" ? "border-b-2 border-violet-400 text-white" : "text-zinc-500"}`}>Chat <span className="ml-1 rounded-full bg-white/10 px-1.5 py-0.5">2</span></button><button onClick={() => setActiveTab("people")} className={`flex-1 py-3 text-xs font-medium ${activeTab === "people" ? "border-b-2 border-violet-400 text-white" : "text-zinc-500"}`}>People <span className="ml-1 rounded-full bg-white/10 px-1.5 py-0.5">3</span></button></div>
          {activeTab === "chat" ? <><div className="flex max-h-64 min-h-48 flex-col gap-4 overflow-y-auto p-4">{messages.map((message) => <div key={message.id} className={`flex gap-2 ${message.self ? "flex-row-reverse" : ""}`}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${message.self ? "bg-gradient-to-br from-violet-400 to-blue-500" : "bg-orange-400"}`}>{message.self ? "HV" : message.name[0]}</span><div className={message.self ? "text-right" : ""}><div className="mb-1 flex items-center gap-2 text-[10px] text-zinc-500"><span>{message.name}</span><span>{message.time}</span></div><p className={`inline-block rounded-xl px-3 py-2 text-xs ${message.self ? "rounded-tr-sm bg-violet-500/20 text-violet-100" : "rounded-tl-sm bg-white/[0.07] text-zinc-300"}`}>{message.text}</p></div></div>)}</div><div className="border-t border-white/[0.07] p-3"><div className="flex items-center gap-2 rounded-lg bg-white/[0.05] px-3 py-2"><input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && sendMessage()} placeholder="Message the room..." className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-zinc-600" /><button onClick={sendMessage} className="text-violet-300 hover:text-white">↑</button></div></div></> : <div className="space-y-2 p-4">{participants.map((person) => <div key={person.name} className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-3"><span className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br ${person.tone} text-[10px] font-bold`}>{person.initials}</span><div className="flex-1"><p className="text-xs font-medium">{person.name}</p><p className="text-[10px] text-zinc-500">{person.status}</p></div><span className="text-xs text-emerald-400">●</span></div>)}</div>}
        </aside>
      </div>

      {toast && <div className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-xl border border-violet-400/30 bg-[#1b1628] px-4 py-3 text-sm text-violet-100 shadow-2xl">{toast}</div>}
      {showJoin && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm"><div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#15151b] p-6 shadow-2xl"><div className="mb-6 flex items-start justify-between"><div><p className="text-xs uppercase tracking-widest text-violet-300">Join a watch room</p><h2 className="mt-2 text-2xl font-semibold">Enter the room code</h2></div><button onClick={() => setShowJoin(false)} className="text-xl text-zinc-500 hover:text-white">×</button></div><label className="text-xs text-zinc-400">Six-character code<input autoFocus value={roomCode} onChange={(event) => { setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)); setJoinError(""); }} onKeyDown={(event) => event.key === "Enter" && void joinRoom()} placeholder="ABC123" className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-lg tracking-[0.3em] outline-none transition focus:border-violet-400" /></label><p className="mt-4 text-xs leading-5 text-zinc-500">Your request will wait for the host&apos;s approval before you can chat or watch.</p>{joinError && <p className="mt-4 rounded-xl bg-rose-500/10 px-3 py-2.5 text-xs leading-5 text-rose-200">{joinError}</p>}<div className="mt-6 flex justify-end gap-3"><button onClick={() => setShowJoin(false)} className="rounded-lg px-4 py-2.5 text-sm text-zinc-400 hover:text-white">Cancel</button><button onClick={() => void joinRoom()} disabled={roomCode.length !== 6 || joiningRoom} className="rounded-lg bg-violet-500 px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">{joiningRoom ? "Joining..." : "Request to join"}</button></div></div></div>}
      {showCreate && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm"><div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#15151b] p-6 shadow-2xl"><div className="mb-6 flex items-start justify-between"><div><p className="text-xs uppercase tracking-widest text-violet-300">New watch room</p><h2 className="mt-2 text-2xl font-semibold">Set the scene</h2></div><button onClick={() => setShowCreate(false)} className="text-xl text-zinc-500 hover:text-white">×</button></div><label className="text-xs text-zinc-400">Room name<input autoFocus value={roomName} onChange={(event) => { setRoomName(event.target.value); setCreateError(""); }} onKeyDown={(event) => event.key === "Enter" && void createRoom()} placeholder="Friday movie night" className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm outline-none transition focus:border-violet-400" /></label><div className="mt-4 rounded-xl bg-violet-500/[0.08] p-3 text-xs leading-5 text-violet-200">Your room will be private. Friends can join through an invite link, and you can approve who enters.</div>{createError && <p className="mt-4 rounded-xl bg-rose-500/10 px-3 py-2.5 text-xs leading-5 text-rose-200">{createError}</p>}<div className="mt-6 flex justify-end gap-3"><button onClick={() => setShowCreate(false)} className="rounded-lg px-4 py-2.5 text-sm text-zinc-400 hover:text-white">Cancel</button><button onClick={() => void createRoom()} disabled={!roomName.trim() || creatingRoom} className="rounded-lg bg-violet-500 px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">{creatingRoom ? "Creating..." : "Create room"}</button></div></div></div>}
    </main>
  );
}
