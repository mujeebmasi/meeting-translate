// Plays the English voice for each translated sentence, one sentence after
// another, starting as soon as the first pieces of audio arrive.
//
// Why pieces: Fish takes ~1.1s to generate a sentence's audio but sends the
// first part after ~0.35s. Waiting for the whole file wasted the difference,
// so the server forwards each piece the moment it arrives ("voice-chunk"),
// then "voice-end". MediaSource lets an <audio> element play an MP3 that's
// still arriving. Browsers without MP3 MediaSource support (older iPhones)
// get the old behaviour: play the whole file once it has all arrived.

const CAN_STREAM =
  typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg');

// If a sentence's audio stops arriving and its "voice-end" never comes,
// give up on it -- otherwise the queue (and the muted mic) would wait forever.
const STALL_MS = 5000;

interface Clip {
  chunks: Uint8Array[];
  type: string; // 'audio/mpeg' for the English voice, 'audio/wav' for a recording
  ended: boolean; // "voice-end" received: no more chunks coming
  feed?: () => void; // hands new chunks to whatever is playing this clip
}

function fromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export class VoicePlayer {
  private clips = new Map<string, Clip>();
  private queue: string[] = [];
  private playing = false;

  // Told when playback starts/stops, so the page can ignore the mic while
  // the speakers are playing (otherwise the voice is captured as "speech").
  constructor(private onPlayingChange: (playing: boolean) => void) {}

  chunk(id: string, base64: string): void {
    const clip = this.getOrQueue(id);
    clip.chunks.push(fromBase64(base64));
    clip.feed?.();
  }

  // A whole recording at once (the speaker's own voice, relayed by the
  // server). Queued with the English voice so nothing plays on top of it.
  whole(id: string, base64: string, type: string): void {
    const clip: Clip = { chunks: [fromBase64(base64)], type, ended: true };
    this.clips.set(id, clip);
    this.queue.push(id);
    this.playNext();
  }

  end(id: string): void {
    const clip = this.clips.get(id);
    if (!clip) return; // never got any audio for it (e.g. voice switched off)
    clip.ended = true;
    clip.feed?.();
  }

  private getOrQueue(id: string): Clip {
    let clip = this.clips.get(id);
    if (!clip) {
      clip = { chunks: [], type: 'audio/mpeg', ended: false };
      this.clips.set(id, clip);
      this.queue.push(id);
      this.playNext();
    }
    return clip;
  }

  private playNext(): void {
    if (this.playing) return;
    const id = this.queue.shift();
    if (!id) return;
    const clip = this.clips.get(id)!;
    this.playing = true;
    this.onPlayingChange(true);

    let finished = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(stallTimer);
      this.clips.delete(id);
      this.playing = false;
      this.onPlayingChange(false);
      this.playNext();
    };
    // Restarted on every new chunk; cleared for good once all audio is in.
    const watchForStall = () => {
      clearTimeout(stallTimer);
      if (!clip.ended) stallTimer = setTimeout(done, STALL_MS);
    };

    if (CAN_STREAM && clip.type === 'audio/mpeg') this.playWhileArriving(clip, done, watchForStall);
    else this.playWhenComplete(clip, done, watchForStall);
  }

  private playWhileArriving(clip: Clip, done: () => void, watchForStall: () => void): void {
    const source = new MediaSource();
    const url = URL.createObjectURL(source);
    const audio = new Audio(url);
    const finish = () => {
      URL.revokeObjectURL(url);
      done();
    };
    audio.onended = finish;
    audio.onerror = finish;

    source.addEventListener(
      'sourceopen',
      () => {
        const buffer = source.addSourceBuffer('audio/mpeg');
        let appended = 0;
        // A SourceBuffer takes one append at a time, so each finished append
        // ('updateend') triggers the next.
        clip.feed = () => {
          watchForStall();
          if (buffer.updating || source.readyState !== 'open') return;
          if (appended < clip.chunks.length) buffer.appendBuffer(clip.chunks[appended++] as BufferSource);
          else if (clip.ended) source.endOfStream();
        };
        buffer.addEventListener('updateend', () => clip.feed?.());
        clip.feed();
        audio.play().catch(finish);
      },
      { once: true },
    );
  }

  private playWhenComplete(clip: Clip, done: () => void, watchForStall: () => void): void {
    clip.feed = () => {
      watchForStall();
      if (!clip.ended) return;
      clip.feed = undefined;
      const url = URL.createObjectURL(new Blob(clip.chunks as BlobPart[], { type: clip.type }));
      const audio = new Audio(url);
      const finish = () => {
        URL.revokeObjectURL(url);
        done();
      };
      audio.onended = finish;
      audio.onerror = finish;
      audio.play().catch(finish);
    };
    clip.feed();
  }
}
