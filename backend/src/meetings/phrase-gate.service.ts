import { Injectable } from '@nestjs/common';

// Starting early, without changing where sentences end.
//
// A sentence ends after 0.5s of silence. Waiting all of that before doing
// anything wasted 0.3s, so the browser now sends the audio after just 0.2s of
// silence, marked "tentative", and the server starts on it straight away
// (speech-to-text, translation). Then one of two things happens:
// - the silence reaches 0.5s: the browser sends "confirm", and the caption
//   (often already translated by then) goes out;
// - the speaker carries on: the browser sends "cancel", the work is thrown
//   away, and the whole longer sentence is sent later as usual.
// Nothing reaches anyone's screen until it's confirmed, so a speaker who
// pauses mid-sentence never sees half a sentence flash up and disappear.
//
// Confirm/cancel arrive over the WebSocket while the audio arrives over HTTP,
// so either can come first -- whichever shows up creates the entry.

interface Phrase {
  confirmed: boolean;
  cancelled: boolean;
  abort: AbortController; // stops a translation that's already running
  onDecided: (() => void)[];
}

// Entries are normally removed when their request finishes; this catches
// any that never got one, or never got a decision.
const FORGET_AFTER_MS = 60_000;

@Injectable()
export class PhraseGate {
  private phrases = new Map<string, Phrase>();

  private get(key: string): Phrase {
    let phrase = this.phrases.get(key);
    if (!phrase) {
      phrase = {
        confirmed: false,
        cancelled: false,
        abort: new AbortController(),
        onDecided: [],
      };
      this.phrases.set(key, phrase);
      // Never decided (e.g. the speaker's tab closed mid-sentence): treat it
      // as cancelled so a request waiting on it doesn't hang forever.
      const created = phrase;
      setTimeout(() => {
        if (this.phrases.get(key) !== created) return; // already done with
        this.cancel(key);
        this.phrases.delete(key);
      }, FORGET_AFTER_MS).unref();
    }
    return phrase;
  }

  confirm(key: string): void {
    const phrase = this.get(key);
    if (phrase.cancelled) return;
    phrase.confirmed = true;
    phrase.onDecided.splice(0).forEach((wake) => wake());
  }

  cancel(key: string): void {
    const phrase = this.get(key);
    if (phrase.confirmed) return;
    phrase.cancelled = true;
    phrase.abort.abort();
    phrase.onDecided.splice(0).forEach((wake) => wake());
  }

  // Read-only checks: these don't create an entry for an unknown key.
  isConfirmed(key: string): boolean {
    return this.phrases.get(key)?.confirmed ?? false;
  }

  isCancelled(key: string): boolean {
    return this.phrases.get(key)?.cancelled ?? false;
  }

  signal(key: string): AbortSignal {
    return this.get(key).abort.signal;
  }

  // Resolves true once confirmed, false if cancelled.
  decided(key: string): Promise<boolean> {
    const phrase = this.get(key);
    if (phrase.confirmed || phrase.cancelled)
      return Promise.resolve(phrase.confirmed);
    return new Promise((resolve) =>
      phrase.onDecided.push(() => resolve(phrase.confirmed)),
    );
  }

  forget(key: string): void {
    this.phrases.delete(key);
  }
}
