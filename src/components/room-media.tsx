"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

type Signal =
  | {
      type: "offer";
      from: string;
      to: string;
      description: RTCSessionDescriptionInit;
      callStreamId?: string;
      movieStreamId?: string;
    }
  | {
      type: "answer";
      from: string;
      to: string;
      description: RTCSessionDescriptionInit;
      callStreamId?: string;
      movieStreamId?: string;
    }
  | { type: "ice"; from: string; to: string; candidate: RTCIceCandidateInit };

type RemotePeer = {
  id: string;
  stream: MediaStream;
};

type RoomMediaProps = {
  roomId: string;
  membershipStatus: string | null;
  movieVideoRef: RefObject<HTMLVideoElement | null>;
  movieSourceKey: string;
  onRemoteMovieStream: (stream: MediaStream) => void;
};

type CaptureVideoElement = HTMLVideoElement & {
  captureStream?: () => MediaStream;
};

function captureMovieStream(video: HTMLVideoElement | null) {
  return (video as CaptureVideoElement | null)?.captureStream?.() ?? null;
}

async function configureMovieSender(
  sender: RTCRtpSender,
  video: HTMLVideoElement | null,
) {
  const movieTrack = sender.track;
  if (!movieTrack || movieTrack.kind !== "video") return;

  movieTrack.contentHint = "detail";
  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) return;

  const width = video?.videoWidth ?? 0;
  const height = video?.videoHeight ?? 0;
  const pixels = width * height;
  const maxBitrate =
    pixels >= 3840 * 2160
      ? 12_000_000
      : pixels >= 2560 * 1440
        ? 9_000_000
        : pixels >= 1920 * 1080
          ? 6_000_000
          : pixels >= 1280 * 720
            ? 4_000_000
            : 2_500_000;

  parameters.encodings = parameters.encodings.map((encoding) => ({
    ...encoding,
    active: true,
    maxBitrate: Math.max(encoding.maxBitrate ?? 0, maxBitrate),
    scaleResolutionDownBy: 1,
  }));

  try {
    await sender.setParameters(parameters);
  } catch (error) {
    console.warn("Movie sender quality settings were not accepted", error);
  }
}

async function configureCallSender(sender: RTCRtpSender) {
  const track = sender.track;
  if (!track) return;
  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) return;
  parameters.encodings = parameters.encodings.map((encoding) => ({
    ...encoding,
    active: true,
    maxBitrate: track.kind === "audio" ? 96_000 : 1_200_000,
  }));
  try {
    await sender.setParameters(parameters);
  } catch (error) {
    console.warn("Call sender bandwidth settings were not accepted", error);
  }
}

function isSignal(payload: unknown): payload is Signal {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Partial<Signal>;
  return (
    (value.type === "offer" || value.type === "answer" || value.type === "ice") &&
    typeof value.from === "string" &&
    typeof value.to === "string"
  );
}

const rtcConfiguration: RTCConfiguration = {
  iceServers: [
    { urls: process.env.NEXT_PUBLIC_STUN_SERVER_URL ?? "stun:stun.l.google.com:19302" },
    ...(process.env.NEXT_PUBLIC_TURN_SERVER_URL &&
    process.env.NEXT_PUBLIC_TURN_USERNAME &&
    process.env.NEXT_PUBLIC_TURN_CREDENTIAL
      ? [{
          urls: process.env.NEXT_PUBLIC_TURN_SERVER_URL,
          username: process.env.NEXT_PUBLIC_TURN_USERNAME,
          credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
        }]
      : []),
  ],
};

export function RoomMedia({
  roomId,
  membershipStatus,
  movieVideoRef,
  movieSourceKey,
  onRemoteMovieStream,
}: RoomMediaProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const remoteStreamIdsRef = useRef(new Map<string, { call?: string; movie?: string }>());
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);
  const userIdRef = useRef("");
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [status, setStatus] = useState("Requesting camera and microphone...");
  const [error, setError] = useState("");
  const [mediaWarning, setMediaWarning] = useState("");

  function closePeer(peerId: string) {
    peersRef.current.get(peerId)?.close();
    peersRef.current.delete(peerId);
    pendingIceRef.current.delete(peerId);
    remoteStreamIdsRef.current.delete(peerId);
    setRemotePeers((current) => current.filter((peer) => peer.id !== peerId));
  }

  useEffect(() => {
    let mounted = true;
    let mediaStream: MediaStream | null = null;

    async function start() {
      if (!supabase || membershipStatus !== "approved") {
        if (membershipStatus !== "approved") {
          setError("Video chat is available after room approval.");
        }
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setMediaWarning("This browser does not support camera and microphone access.");
      }
      if (!supabase) {
        setError("Supabase is not configured.");
        return;
      }
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setError("Sign in again before joining video chat.");
        return;
      }
      userIdRef.current = data.user.id;
      if (navigator.mediaDevices?.getUserMedia) {
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (mediaError) {
          const details = describeMediaError(mediaError);
          console.warn("Room media camera/microphone initialization failed", details);
          setMediaWarning(`${details.message} Video sharing will continue without your camera or microphone.`);
          try {
            mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
          } catch (videoError) {
            console.warn("Room media camera fallback failed", describeMediaError(videoError));
            try {
              mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } catch (audioError) {
              console.warn("Room media microphone fallback failed", describeMediaError(audioError));
              mediaStream = new MediaStream();
            }
          }
        }
      }
      if (!mounted) {
        mediaStream?.getTracks().forEach((track) => track.stop());
        return;
      }
      localStreamRef.current = mediaStream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = mediaStream;
      }

      const channel = supabase.channel(`room-media:${roomId}`);
      channelRef.current = channel;
      channel
        .on("broadcast", { event: "signal" }, ({ payload }: { payload: unknown }) => {
          if (!isSignal(payload) || payload.to !== userIdRef.current) return;
          void handleSignal(payload).catch(() => {
            setError("Video connection negotiation failed. Try rejoining the room.");
          });
        })
        .on("presence", { event: "sync" }, () => {
          const ids = channel.presenceState<{ userId: string }>();
          const remoteIds = Object.values(ids).flat().map((entry) => entry.userId).filter((id) => id !== userIdRef.current);
          for (const remoteId of remoteIds) {
            if (!peersRef.current.has(remoteId) && userIdRef.current < remoteId) {
              void createPeer(remoteId, true);
            }
          }
          setStatus(remoteIds.length > 0 ? `${remoteIds.length + 1} people connected` : "Waiting for friends to join");
        })
        .on("presence", { event: "leave" }, ({ leftPresences }: { leftPresences: Array<{ userId: string }> }) => {
          leftPresences.forEach((presence) => closePeer(presence.userId));
        })
        .subscribe(async (subscriptionStatus, subscriptionError) => {
          if (subscriptionStatus === "CHANNEL_ERROR" || subscriptionStatus === "TIMED_OUT") {
            setError(`Video signaling could not connect (${subscriptionStatus.toLowerCase()}).`);
            if (subscriptionError) console.error("Room media channel error", subscriptionError);
            return;
          }
          if (subscriptionStatus === "SUBSCRIBED") {
            const presenceStatus = await channel.track({ userId: userIdRef.current });
            if (presenceStatus !== "ok") {
              setError("Video presence could not be registered.");
              console.error("Room media presence error", presenceStatus);
            }
          }
        });
    }

    async function handleSignal(signal: Signal) {
      let peer = peersRef.current.get(signal.from);
      if (!peer) {
        const createdPeer = await createPeer(signal.from, false);
        if (!createdPeer) return;
        peer = createdPeer;
      }
      if (!peer) return;
      if (signal.type === "offer") {
        remoteStreamIdsRef.current.set(signal.from, {
          call: signal.callStreamId,
          movie: signal.movieStreamId,
        });
        await peer.setRemoteDescription(signal.description);
        await addPendingIce(signal.from, peer);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        if (peer.localDescription) {
          await sendSignal({
            type: "answer",
            from: userIdRef.current,
            to: signal.from,
            description: peer.localDescription,
            callStreamId: localStreamRef.current?.id,
            movieStreamId: captureMovieStream(movieVideoRef.current)?.id,
          });
        }
      } else if (signal.type === "answer") {
        remoteStreamIdsRef.current.set(signal.from, {
          call: signal.callStreamId,
          movie: signal.movieStreamId,
        });
        await peer.setRemoteDescription(signal.description);
        await addPendingIce(signal.from, peer);
      } else {
        if (peer.remoteDescription) {
          await peer.addIceCandidate(signal.candidate);
        } else {
          const pending = pendingIceRef.current.get(signal.from) ?? [];
          pending.push(signal.candidate);
          pendingIceRef.current.set(signal.from, pending);
        }
      }
    }

    async function createPeer(peerId: string, shouldOffer: boolean) {
      if (!channelRef.current) return null;
      const peer = new RTCPeerConnection(rtcConfiguration);
      peersRef.current.set(peerId, peer);
      localStreamRef.current?.getTracks().forEach((track) => {
        const sender = peer.addTrack(track, localStreamRef.current as MediaStream);
        void configureCallSender(sender);
      });
      const movieStream = captureMovieStream(movieVideoRef.current);
      movieStream?.getTracks().forEach((track: MediaStreamTrack) => {
        const sender = peer.addTrack(track, movieStream);
        void configureMovieSender(sender, movieVideoRef.current);
      });
      peer.ontrack = (event) => {
        const stream = event.streams[0];
        if (stream) {
          const streamIds = remoteStreamIdsRef.current.get(peerId);
          const isMovieStream =
            stream.id === streamIds?.movie ||
            (!streamIds?.movie && event.track.kind === "video" && stream.getAudioTracks().length === 0);
          if (isMovieStream) {
            onRemoteMovieStream(stream);
          } else {
            setRemotePeers((current) => [...current.filter((item) => item.id !== peerId), { id: peerId, stream }]);
          }
        }
      };
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          void sendSignal({ type: "ice", from: userIdRef.current, to: peerId, candidate: event.candidate.toJSON() });
        }
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed" || peer.connectionState === "closed" || peer.connectionState === "disconnected") closePeer(peerId);
      };
      if (shouldOffer) {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        if (peer.localDescription) {
          await sendSignal({
            type: "offer",
            from: userIdRef.current,
            to: peerId,
            description: peer.localDescription,
            callStreamId: localStreamRef.current?.id,
            movieStreamId: captureMovieStream(movieVideoRef.current)?.id,
          });
        }
      }
      return peer;
    }

    async function sendSignal(signal: Signal) {
      const result = await channelRef.current?.send({ type: "broadcast", event: "signal", payload: signal });
      if (result && result !== "ok") {
        throw new Error(`Signal broadcast failed with status: ${result}`);
      }
    }

    async function addPendingIce(peerId: string, peer: RTCPeerConnection) {
      const pending = pendingIceRef.current.get(peerId) ?? [];
      pendingIceRef.current.delete(peerId);
      for (const candidate of pending) {
        await peer.addIceCandidate(candidate);
      }
    }

    void start();
    const peers = peersRef.current;
    return () => {
      mounted = false;
      mediaStream?.getTracks().forEach((track) => track.stop());
      peers.forEach((peer) => peer.close());
      peers.clear();
      if (channelRef.current) void supabase?.removeChannel(channelRef.current);
      setRemotePeers([]);
    };
  }, [membershipStatus, movieVideoRef, onRemoteMovieStream, roomId]);

  useEffect(() => {
    if (!movieSourceKey) return;
    const attachMovieStream = () => {
      const movieStream = captureMovieStream(movieVideoRef.current);
      if (!movieStream) {
        setError("This browser cannot share local video with room members. Use Chrome or Edge.");
        return;
      }
      for (const [peerId, peer] of peersRef.current) {
        const existingMovieTrack = peer.getSenders().some((sender) => {
          const senderTrack = sender.track;
          return Boolean(
            senderTrack &&
              movieStream.getTracks().some(
                (track: MediaStreamTrack) => track.kind === senderTrack.kind && track.id === senderTrack.id,
              ),
          );
        });
        if (existingMovieTrack) continue;
        movieStream.getTracks().forEach((track: MediaStreamTrack) => {
          const sender = peer.addTrack(track, movieStream);
          void configureMovieSender(sender, movieVideoRef.current);
        });
        void peer.createOffer()
          .then((offer) => peer.setLocalDescription(offer))
          .then(() => {
            if (peer.localDescription && userIdRef.current) {
              return channelRef.current?.send({
                type: "broadcast",
                event: "signal",
                payload: {
                  type: "offer",
                  from: userIdRef.current,
                  to: peerId,
                  description: peer.localDescription,
                  callStreamId: localStreamRef.current?.id,
                  movieStreamId: movieStream.id,
                },
              });
            }
          })
          .catch(() => setError("The movie stream could not be shared with the room."));
      }
    };
    const movieVideo = movieVideoRef.current;
    movieVideo?.addEventListener("loadedmetadata", attachMovieStream);
    attachMovieStream();
    const scheduledRetry = window.setTimeout(attachMovieStream, 500);
    return () => {
      movieVideo?.removeEventListener("loadedmetadata", attachMovieStream);
      window.clearTimeout(scheduledRetry);
    };
  }, [movieSourceKey, movieVideoRef]);

  function toggleTrack(kind: "audio" | "video") {
    const track = localStreamRef.current?.getTracks().find((item) => item.kind === kind);
    if (!track) return;
    track.enabled = !track.enabled;
    if (kind === "audio") setMicrophoneEnabled(track.enabled);
    else setCameraEnabled(track.enabled);
  }

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-[#101116] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Video call</h2>
          <p className="mt-1 text-xs text-zinc-500">{error || mediaWarning || status}</p>
        </div>
        <span className={`h-2 w-2 rounded-full ${error ? "bg-rose-400" : "bg-emerald-400"}`} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <video ref={localVideoRef} autoPlay muted playsInline className="hidden" aria-hidden="true" />
        {remotePeers.map((peer) => <RemoteVideo key={peer.id} stream={peer.stream} />)}
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={() => toggleTrack("audio")} className="rounded-lg bg-white/[0.07] px-3 py-2 text-xs text-zinc-300 hover:bg-white/10">{microphoneEnabled ? "Mute mic" : "Unmute mic"}</button>
        <button onClick={() => toggleTrack("video")} className="rounded-lg bg-white/[0.07] px-3 py-2 text-xs text-zinc-300 hover:bg-white/10">{cameraEnabled ? "Turn camera off" : "Turn camera on"}</button>
      </div>
    </div>
  );
}

function describeMediaError(error: unknown) {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
        return { name: error.name, message: "Camera or microphone permission was denied." };
      case "NotFoundError":
        return { name: error.name, message: "No camera or microphone was found." };
      case "NotReadableError":
        return { name: error.name, message: "The camera or microphone is already in use." };
      case "SecurityError":
        return { name: error.name, message: "Camera and microphone access is blocked by browser security settings." };
      case "TypeError":
        return { name: error.name, message: "Camera and microphone access is unavailable in this browser context." };
      default:
        return { name: error.name, message: `Media access failed (${error.name}).` };
    }
  }
  return { name: "UnknownError", message: "Camera and microphone could not be started." };
}

function RemoteVideo({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);
  return <video ref={videoRef} autoPlay playsInline className="aspect-video w-full rounded-xl bg-black object-cover" />;
}
