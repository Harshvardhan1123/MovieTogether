"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { RoomMedia } from "@/components/room-media";

type Room = { id: string; name: string; room_code: string; status: string };
type Message = { id: number; body: string; created_at: string; profile?: { display_name: string } };
type Membership = { user_id: string; role: string; status: string; profile?: { display_name: string } };

function RoomContent() {
  const params = useParams<{ id: string }>();
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [membershipStatus, setMembershipStatus] = useState<string | null>(null);
  const [membershipRole, setMembershipRole] = useState<string | null>(null);
  const [pendingMembers, setPendingMembers] = useState<Membership[]>([]);
  const [membershipAction, setMembershipAction] = useState("");
  const [sourceType, setSourceType] = useState<"local_file" | "official_link">("local_file");
  const [sourceId, setSourceId] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [playbackUpdatedAt, setPlaybackUpdatedAt] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState("");
  const [remoteMovieStream, setRemoteMovieStream] = useState<MediaStream | null>(null);
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteMovieVideoRef = useRef<HTMLVideoElement>(null);
  const lastPlaybackSyncRef = useRef(0);
  const panelTimerRef = useRef<number | null>(null);
  const [panelCompact, setPanelCompact] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadRoom() {
      if (!supabase || !params.id) return;
      const { data, error: roomError } = await supabase
        .from("rooms")
        .select("id, name, room_code, status")
        .eq("id", params.id)
        .single();
      if (!active) return;
      if (roomError || !data) {
        setError(roomError?.message ?? "Room not found or you are not a member.");
        setLoading(false);
        return;
      }

      setRoom(data);
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        const { data: membership } = await supabase
          .from("room_members")
          .select("status, role")
          .eq("room_id", params.id)
          .eq("user_id", userData.user.id)
          .maybeSingle();
        setMembershipStatus(membership?.status ?? null);
        setMembershipRole(membership?.role ?? null);
        if (membership?.role === "host") {
          const { data: pending } = await supabase
            .from("room_members")
            .select("user_id, role, status, profiles(display_name)")
            .eq("room_id", params.id)
            .eq("status", "pending");
          setPendingMembers((pending ?? []) as unknown as Membership[]);
        }
      }
      const { data: chat } = await supabase
        .from("chat_messages")
        .select("id, body, created_at, profiles(display_name)")
        .eq("room_id", params.id)
        .order("created_at", { ascending: true })
        .limit(100);
      if (active) {
        setMessages((chat ?? []) as unknown as Message[]);
        setLoading(false);
      }
      const { data: playback } = await supabase
        .from("playback_state")
        .select("source_type, source_id, is_playing, position_seconds, updated_at")
        .eq("room_id", params.id)
        .maybeSingle();
      if (active && playback) {
        setSourceType(playback.source_type);
        setSourceId(playback.source_id);
        setIsPlaying(playback.is_playing);
        setPositionSeconds(Number(playback.position_seconds));
        setPlaybackUpdatedAt(playback.updated_at);
      }

    }
    void loadRoom();
    return () => {
      active = false;
    };
  }, [params.id]);

  useEffect(() => {
    if (panelTimerRef.current !== null) {
      window.clearTimeout(panelTimerRef.current);
    }
    panelTimerRef.current = window.setTimeout(() => setPanelCompact(true), 3500);
    return () => {
      if (panelTimerRef.current !== null) {
        window.clearTimeout(panelTimerRef.current);
      }
    };
  }, [sidePanelOpen]);

  function toggleSidePanel() {
    setSidePanelOpen((open) => !open);
    setPanelCompact(false);
  }

  useEffect(() => {
    if (remoteMovieVideoRef.current) {
      remoteMovieVideoRef.current.srcObject = remoteMovieStream;
    }
  }, [remoteMovieStream]);

  useEffect(() => {
    const video = remoteMovieVideoRef.current;
    if (!video || !remoteMovieStream || membershipRole === "host") return;
    const elapsedWhilePlaying = isPlaying && playbackUpdatedAt
      ? Math.max(0, (Date.now() - Date.parse(playbackUpdatedAt)) / 1000)
      : 0;
    const targetPosition = positionSeconds + elapsedWhilePlaying;
    if (Math.abs(video.currentTime - targetPosition) > 0.75) {
      video.currentTime = targetPosition;
    }
    if (isPlaying) {
      void video.play().catch(() => setError("Click the shared video to allow playback in this browser."));
    } else {
      video.pause();
    }
  }, [isPlaying, membershipRole, playbackUpdatedAt, positionSeconds, remoteMovieStream]);

  useEffect(() => {
    if (!supabase || !params.id) return;
    const channel = supabase
      .channel(`room:${params.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `room_id=eq.${params.id}` }, (payload) => {
        setMessages((current) => [...current, payload.new as Message]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${params.id}` }, (payload) => {
        const changed = payload.new as Membership;
        if (changed.user_id === undefined) return;
        if (changed.status === "pending") {
          setPendingMembers((current) => current.some((member) => member.user_id === changed.user_id) ? current : [...current, changed]);
        } else {
          setPendingMembers((current) => current.filter((member) => member.user_id !== changed.user_id));
          setMembershipStatus((current) => current === "pending" && changed.status !== "pending" ? changed.status : current);
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "playback_state", filter: `room_id=eq.${params.id}` }, (payload) => {
        const playback = payload.new as { source_type: "local_file" | "official_link"; source_id: string; is_playing: boolean; position_seconds: number; updated_at: string };
        setSourceType(playback.source_type);
        setSourceId(playback.source_id);
        setIsPlaying(playback.is_playing);
        setPositionSeconds(Number(playback.position_seconds));
        setPlaybackUpdatedAt(playback.updated_at);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [params.id]);

  async function sendMessage() {
    const body = draft.trim();
    if (!body || !supabase || !params.id) return;
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      setError("Sign in again before sending a message.");
      return;
    }

    const { error: sendError } = await supabase.from("chat_messages").insert({
      room_id: params.id,
      user_id: data.user.id,
      body,
    });
    if (sendError) setError(sendError.message);
    else setDraft("");
  }

  async function updateMembership(userId: string, status: "approved" | "rejected") {
    if (!supabase || !params.id) return;
    setMembershipAction(userId);
    const { error: updateError } = await supabase
      .from("room_members")
      .update({ status })
      .eq("room_id", params.id)
      .eq("user_id", userId);
    setMembershipAction("");
    if (updateError) setError(updateError.message);
    else setPendingMembers((current) => current.filter((member) => member.user_id !== userId));
  }

  async function savePlayback(next: { is_playing?: boolean; position_seconds?: number; source_type?: "local_file" | "official_link"; source_id?: string }) {
    if (!supabase || !params.id || membershipRole !== "host") return;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { error: playbackError } = await supabase.from("playback_state").upsert({
      room_id: params.id,
      source_type: next.source_type ?? sourceType,
      source_id: next.source_id ?? sourceId,
      is_playing: next.is_playing ?? isPlaying,
      position_seconds: next.position_seconds ?? positionSeconds,
      updated_by: userData.user.id,
      version: Date.now(),
    });
    if (playbackError) setError(playbackError.message);
  }

  function chooseRoomFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("video/")) {
      setError("Choose a supported video file.");
      return;
    }
    const url = URL.createObjectURL(file);
    setMediaUrl(url);
    setSourceId(file.name);
    setSourceType("local_file");
    setIsPlaying(false);
    setPositionSeconds(0);
    void savePlayback({ source_type: "local_file", source_id: file.name, is_playing: false, position_seconds: 0 });
  }

  function togglePlayback() {
    if (membershipRole !== "host") return;
    const nextPlaying = !isPlaying;
    setIsPlaying(nextPlaying);
    void savePlayback({ is_playing: nextPlaying });
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-[#08090c] text-sm text-zinc-400">Loading room...</main>;
  if (error || !room) return <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#08090c] px-5 text-center text-white"><p className="text-sm text-rose-300">{error || "Room unavailable."}</p><Link href="/" className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold">Back to dashboard</Link></main>;
  if (membershipStatus === "pending") return <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#08090c] px-5 text-center text-white"><p className="text-xs uppercase tracking-[0.2em] text-violet-300">Request sent</p><h1 className="text-3xl font-semibold">Waiting for approval</h1><p className="max-w-md text-sm leading-6 text-zinc-400">The host of <strong className="text-zinc-200">{room.name}</strong> needs to approve you before you can join the watch party.</p><Link href="/" className="mt-2 rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold">Back to dashboard</Link></main>;
  if (membershipStatus === "rejected" || membershipStatus === "removed") return <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#08090c] px-5 text-center text-white"><h1 className="text-2xl font-semibold">Access unavailable</h1><p className="text-sm text-zinc-400">The host did not approve this join request.</p><Link href="/" className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold">Back to dashboard</Link></main>;

  return (
    <main className="min-h-screen bg-[#08090c] text-white">
      <header className="border-b border-white/[0.07] px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between">
          <Link href="/" className="font-semibold tracking-tight">✦ movietogether</Link>
          <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">Room {room.room_code}</span>
        </div>
      </header>
      <div className={`mx-auto max-w-[1600px] px-3 py-5 transition-[padding] duration-300 sm:px-6 sm:py-8 ${sidePanelOpen ? "lg:pr-[440px]" : ""}`}>
        <section>
          <p className="text-xs uppercase tracking-[0.2em] text-violet-300">Private watch room</p>
          <h1 className="mt-2 text-3xl font-semibold">{room.name}</h1>
          {membershipRole === "host" && pendingMembers.length > 0 && (
            <div className="mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Join requests</h2>
                <span className="rounded-full bg-amber-400/15 px-2 py-1 text-[10px] text-amber-200">{pendingMembers.length} waiting</span>
              </div>
              <div className="space-y-2">
                {pendingMembers.map((member) => (
                  <div key={member.user_id} className="flex items-center gap-3 rounded-xl bg-black/20 p-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500 text-[10px] font-bold">
                      {(member.profile?.display_name ?? "U").slice(0, 1).toUpperCase()}
                    </div>
                    <p className="flex-1 text-xs text-zinc-200">{member.profile?.display_name ?? "MovieTogether user"}</p>
                    <button disabled={membershipAction === member.user_id} onClick={() => void updateMembership(member.user_id, "rejected")} className="rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-white">Reject</button>
                    <button disabled={membershipAction === member.user_id} onClick={() => void updateMembership(member.user_id, "approved")} className="rounded-lg bg-emerald-500/20 px-2.5 py-1.5 text-[11px] text-emerald-200 hover:bg-emerald-500/30">Approve</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="relative mt-6 flex min-h-[60vh] w-full items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_60%_20%,#6d28d955,transparent_35%),linear-gradient(135deg,#26183d,#09090d)] sm:min-h-[70vh] lg:min-h-[calc(100vh-190px)]">
            {membershipRole !== "host" && remoteMovieStream ? <video ref={remoteMovieVideoRef} className="h-full w-full object-contain" controls onTimeUpdate={(event) => setPositionSeconds(event.currentTarget.currentTime)} /> : mediaUrl ? <video ref={videoRef} src={mediaUrl} className="h-full w-full object-contain" controls={membershipRole === "host"} onTimeUpdate={(event) => { const nextPosition = event.currentTarget.currentTime; setPositionSeconds(nextPosition); if (membershipRole === "host" && isPlaying && Math.abs(nextPosition - lastPlaybackSyncRef.current) >= 1) { lastPlaybackSyncRef.current = nextPosition; void savePlayback({ position_seconds: nextPosition }); } }} onSeeked={(event) => { if (membershipRole === "host") { const nextPosition = event.currentTarget.currentTime; setPositionSeconds(nextPosition); lastPlaybackSyncRef.current = nextPosition; void savePlayback({ position_seconds: nextPosition }); } }} onPlay={() => { if (membershipRole === "host") { setIsPlaying(true); void savePlayback({ is_playing: true, position_seconds: videoRef.current?.currentTime ?? positionSeconds }); } }} onPause={() => { if (membershipRole === "host") { setIsPlaying(false); void savePlayback({ is_playing: false, position_seconds: videoRef.current?.currentTime ?? positionSeconds }); } }} /> : <div className="text-center"><div className="text-5xl">▶</div><p className="mt-3 text-sm text-zinc-400">{sourceId || "Choose an authorized movie source to begin"}</p><p className="mt-2 text-xs text-zinc-600">Official embeds and content you have permission to share only</p></div>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {membershipRole === "host" && <label className="cursor-pointer rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold hover:bg-violet-400">Choose local video<input className="hidden" type="file" accept="video/*" onChange={chooseRoomFile} /></label>}
            {mediaUrl && membershipRole === "host" && <button onClick={togglePlayback} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/10">{isPlaying ? "Pause everyone" : "Play everyone"}</button>}
            <span className="text-xs text-zinc-600">{membershipRole === "host" ? "You control playback" : "Playback is controlled by the host"}</span>
          </div>
        </section>
      </div>
      <button
        onClick={toggleSidePanel}
        onMouseEnter={() => setPanelCompact(false)}
        className={`fixed right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-xl border border-white/10 bg-violet-500 font-semibold shadow-xl shadow-black/30 transition-all hover:bg-violet-400 ${panelCompact ? "px-2 py-3 text-lg" : "px-3 py-4 text-xs"} ${sidePanelOpen ? "lg:right-[420px]" : ""}`}
        aria-label={sidePanelOpen ? "Hide video calls and chat" : "Show video calls and chat"}
      >
        {panelCompact ? (sidePanelOpen ? "›" : "‹") : sidePanelOpen ? "Hide panel" : "Show panel"}
      </button>
      <aside
        onMouseEnter={() => setPanelCompact(false)}
        className={`fixed right-0 top-[73px] z-30 flex h-[calc(100vh-73px)] w-[min(420px,calc(100vw-18px))] flex-col border-l border-white/10 bg-[#101116] shadow-2xl shadow-black/50 transition-transform duration-300 ${sidePanelOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
          <div><p className="text-xs text-emerald-400">● ROOM PANEL</p><h2 className="mt-1 font-semibold">Video calls & chat</h2></div>
          <button onClick={toggleSidePanel} className="rounded-lg px-2 py-1 text-lg text-zinc-500 hover:bg-white/10 hover:text-white" aria-label="Hide room panel">×</button>
        </div>
        <div className="overflow-y-auto p-4">
          <RoomMedia
            roomId={params.id}
            membershipStatus={membershipStatus}
            movieVideoRef={videoRef}
            movieSourceKey={mediaUrl}
            onRemoteMovieStream={setRemoteMovieStream}
          />
          <div className="mt-4 flex min-h-[280px] flex-col rounded-2xl border border-white/[0.08] bg-[#15161c]">
            <div className="border-b border-white/[0.07] px-5 py-4"><h2 className="font-semibold">Room chat</h2><p className="mt-1 text-xs text-zinc-500">Messages sync for approved members</p></div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">{messages.length === 0 ? <p className="text-center text-xs text-zinc-600">No messages yet. Say hello.</p> : messages.map((message) => <div key={message.id} className="rounded-xl bg-white/[0.05] px-3 py-2"><p className="text-xs text-zinc-300">{message.body}</p><p className="mt-1 text-[10px] text-zinc-600">{message.profile?.display_name ?? "Room member"}</p></div>)}</div>
            <div className="border-t border-white/[0.07] p-3"><div className="flex gap-2"><input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void sendMessage()} placeholder="Message the room..." className="min-w-0 flex-1 rounded-lg bg-white/[0.06] px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-violet-400" /><button onClick={() => void sendMessage()} className="rounded-lg bg-violet-500 px-3 text-xs font-semibold">Send</button></div></div>
          </div>
        </div>
      </aside>
    </main>
  );
}

export default function RoomPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-[#08090c] text-sm text-zinc-400">Loading room...</main>}>
      <RoomContent />
    </Suspense>
  );
}
