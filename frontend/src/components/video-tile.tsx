'use client';

import { useEffect, useRef } from 'react';

type VideoTileProps = {
  stream: MediaStream | null;
  muted: boolean;
  label: string;
  name: string; // its first letter is shown when there's no picture
  mirror?: boolean; // your own camera, shown like a mirror (as other call apps do)
  videoOff?: boolean; // camera switched off
};

// A <video> can't be told "play this stream" through a prop -- the stream
// has to be assigned to the element imperatively, so this wraps that in one
// small component instead of repeating a useEffect in the room page.
export function VideoTile({ stream, muted, label, name, mirror = false, videoOff = false }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  // Same reason for muted: React only reliably applies the `muted` prop on
  // first render, and here it changes mid-call (when someone switches
  // language or turns translated voice on/off), so set it directly too.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // No picture to show: still connecting, joined without a camera, or the
  // camera is off. The <video> stays on the page (just hidden) because it is
  // also what plays this person's audio.
  const noPicture = !stream || videoOff || stream.getVideoTracks().length === 0;

  return (
    <div className="relative min-h-40 overflow-hidden rounded-lg bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={`h-full w-full object-cover ${mirror ? '-scale-x-100' : ''} ${noPicture ? 'invisible' : ''}`}
      />
      {noPicture && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <span className="flex size-16 items-center justify-center rounded-full bg-brand-soft text-2xl font-semibold text-brand">
            {name.trim().charAt(0).toUpperCase() || '?'}
          </span>
          {!stream && <span className="text-xs text-muted">Connecting...</span>}
        </div>
      )}
      <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-page/75 px-2.5 py-0.5 text-xs">
        {label}
      </span>
    </div>
  );
}
