'use client';

import { useEffect, useRef } from 'react';

type VideoTileProps = {
  stream: MediaStream | null;
  muted: boolean;
  label: string;
  name: string; // its first letter is shown when there's no picture
  mirror?: boolean; // your own camera, shown like a mirror (as other call apps do)
  videoOff?: boolean; // camera switched off
  notice?: string; // shown over the tile, e.g. the connection couldn't be made
};

// A <video> can't be told "play this stream" through a prop -- the stream
// has to be assigned to the element imperatively, so this wraps that in one
// small component instead of repeating a useEffect in the room page.
//
// Sound plays through its own <audio> element, not the <video>: a <video>
// doesn't start playing until a picture arrives, so if someone's camera
// sends no frames (in use by another app, a phone quirk), their voice was
// silent too even though it was arriving. The <video> is always muted.
export function VideoTile({ stream, muted, label, name, mirror = false, videoOff = false, notice }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
    if (audioRef.current) audioRef.current.srcObject = stream;
  }, [stream]);

  // Same reason for muted: React only reliably applies the `muted` prop on
  // first render, and here it changes mid-call (when someone switches
  // language or turns translated voice on/off), so set it directly too.
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  // No picture to show: still connecting, joined without a camera, or the
  // camera is off.
  const noPicture = !stream || videoOff || stream.getVideoTracks().length === 0 || !!notice;

  return (
    <div className="relative min-h-40 overflow-hidden rounded-lg bg-black">
      <audio ref={audioRef} autoPlay muted={muted} />
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`h-full w-full object-cover ${mirror ? '-scale-x-100' : ''} ${noPicture ? 'invisible' : ''}`}
      />
      {noPicture && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <span className="flex size-16 items-center justify-center rounded-full bg-brand-soft text-2xl font-semibold text-brand">
            {name.trim().charAt(0).toUpperCase() || '?'}
          </span>
          {(notice || !stream) && (
            <span className="max-w-64 px-3 text-center text-xs text-muted">{notice ?? 'Connecting...'}</span>
          )}
        </div>
      )}
      <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-page/75 px-2.5 py-0.5 text-xs">
        {label}
      </span>
    </div>
  );
}
