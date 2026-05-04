import { useState, useRef, useCallback } from "react";
import { Volume2, Loader2, Pause, AlertCircle } from "lucide-react";

const audioCache = new Map<string, string>();
const supportsMediaSource =
  typeof MediaSource !== "undefined" &&
  MediaSource.isTypeSupported("audio/mpeg");

interface TtsButtonProps {
  text: string;
}

export function TtsButton({ text }: TtsButtonProps) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">(
    "idle",
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleClick = useCallback(async () => {
    if (state === "playing") {
      audioRef.current?.pause();
      setState("idle");
      return;
    }

    if (state === "loading") return;

    const cacheKey = text.slice(0, 200);
    const cachedUrl = audioCache.get(cacheKey);

    if (cachedUrl) {
      const audio = new Audio(cachedUrl);
      audioRef.current = audio;
      audio.onended = () => setState("idle");
      audio.onpause = () => {
        if (!audio.ended) setState("idle");
      };
      audio.play();
      setState("playing");
      return;
    }

    setState("loading");

    try {
      const resp = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!resp.ok || !resp.body) {
        const err = resp.body ? await resp.text() : `HTTP ${resp.status}`;
        console.error("[tts]", err);
        setState("error");
        setTimeout(() => setState("idle"), 3000);
        return;
      }

      if (supportsMediaSource) {
        // Streaming playback via MediaSource: audio starts as soon as first bytes arrive
        const mediaSource = new MediaSource();
        const audio = new Audio();
        audio.src = URL.createObjectURL(mediaSource);
        audioRef.current = audio;

        await new Promise<void>((resolve, reject) => {
          mediaSource.addEventListener(
            "sourceopen",
            async () => {
              const sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
              const reader = resp.body!.getReader();
              let started = false;

              const pump = async () => {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) {
                    if (mediaSource.readyState === "open") {
                      mediaSource.endOfStream();
                    }
                    // Cache the full blob for replay
                    const cacheResp = await fetch(audio.src);
                    const blob = await cacheResp.blob();
                    const blobUrl = URL.createObjectURL(blob);
                    audioCache.set(cacheKey, blobUrl);
                    resolve();
                    return;
                  }
                  // Wait for sourceBuffer to be ready
                  if (sourceBuffer.updating) {
                    await new Promise<void>((r) =>
                      sourceBuffer.addEventListener("updateend", () => r(), {
                        once: true,
                      }),
                    );
                  }
                  sourceBuffer.appendBuffer(value);
                  await new Promise<void>((r) =>
                    sourceBuffer.addEventListener("updateend", () => r(), {
                      once: true,
                    }),
                  );
                  if (!started) {
                    started = true;
                    audio.play();
                    setState("playing");
                  }
                }
              };
              pump().catch(reject);
            },
            { once: true },
          );
        });

        audio.onended = () => setState("idle");
        audio.onpause = () => {
          if (!audio.ended) setState("idle");
        };
      } else {
        // Fallback: buffer entire response then play
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        audioCache.set(cacheKey, blobUrl);
        const audio = new Audio(blobUrl);
        audioRef.current = audio;
        audio.onended = () => setState("idle");
        audio.onpause = () => {
          if (!audio.ended) setState("idle");
        };
        audio.play();
        setState("playing");
      }
    } catch (e) {
      console.error("[tts]", e);
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }, [text, state]);

  const Icon =
    state === "loading"
      ? Loader2
      : state === "playing"
        ? Pause
        : state === "error"
          ? AlertCircle
          : Volume2;

  return (
    <button
      onClick={handleClick}
      disabled={state === "loading"}
      className={`inline-flex items-center justify-center w-8 h-8 sm:w-6 sm:h-6 rounded-md transition-colors cursor-pointer disabled:cursor-wait ${state === "error" ? "text-destructive" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
      title={
        state === "playing"
          ? "Pause"
          : state === "error"
            ? "TTS failed"
            : "Read aloud"
      }
    >
      <Icon
        size={14}
        className={`sm:w-3.5 sm:h-3.5 w-5 h-5 ${state === "loading" ? "animate-spin" : ""}`}
      />
    </button>
  );
}
