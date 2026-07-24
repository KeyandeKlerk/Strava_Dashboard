// Module-level singleton AudioContext for the rest timer's completion beep.
//
// iOS Safari (and other browsers) only allow audio to actually play from an
// AudioContext that was created/resumed synchronously inside a user-gesture
// event handler — code that runs later (e.g. a setInterval callback firing
// once the countdown reaches zero, seconds after the tap) can't unlock one
// from scratch. So the unlock has to happen up front, synchronously, in the
// "Log set" button's submit handler (see SetEntryForm.tsx), and the beep
// itself is played later by reusing that same already-unlocked context.
//
// Both functions swallow all errors. The beep is a secondary cue only — the
// visual countdown in RestTimer.tsx must stand on its own as a complete
// feature regardless of whether Web Audio works on a given device.

let audioContext: AudioContext | null = null;

function getAudioContextCtor(): (new () => AudioContext) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

// Call synchronously — no `await` before it — from the same user-gesture
// handler that will eventually trigger the timer. Safe to call on every
// "Log set" tap: the first call creates the context, later calls just
// resume it if the browser had suspended it, which is what keeps it unlocked
// for the whole session.
export function unlockRestTimerAudio(): void {
  try {
    if (!audioContext) {
      const Ctor = getAudioContextCtor();
      if (!Ctor) return;
      audioContext = new Ctor();
    }
    if (audioContext.state === "suspended") {
      void audioContext.resume();
    }
  } catch {
    // Never let unlock failure block the surrounding submit handler.
  }
}

// Plays a short beep using the already-unlocked context. Silently no-ops if
// unlockRestTimerAudio() was never successfully called (e.g. Web Audio
// unsupported) — never throws into the caller.
export function playRestTimerBeep(): void {
  try {
    if (!audioContext) return;
    const ctx = audioContext;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.3);
  } catch {
    // Secondary cue only — see file header.
  }
}
