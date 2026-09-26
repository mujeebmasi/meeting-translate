'use client';

import { useEffect, useRef } from 'react';

// A <video> can't be told "play this stream" through a prop -- the stream
// has to be assigned to the element imperatively, so this wraps that in one
// small component instead of repeating a useEffect in the room page.
export function VideoTile({ stream, muted, label }: { stream: MediaStream | null; muted: boolean; label: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div className="relative min-h-40 overflow-hidden rounded-lg bg-black">
      <video ref={videoRef} autoPlay playsInline muted={muted} className="h-full w-full object-cover" />
      <span className="absolute bottom-2 left-2 rounded-full bg-page/75 px-2.5 py-0.5 text-xs">{label}</span>
    </div>
  );
}
