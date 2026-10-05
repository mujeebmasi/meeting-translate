'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { api, errorMessage, WS_URL } from '@/lib/api';
import { Segmenter } from '@/lib/segmenter';
import { TARGET_LANG, type Caption, type Languages, type PublicPeer, type VoiceChunk } from '@/lib/types';
import { VoicePlayer } from '@/lib/voice-player';
import { Button, Card, ErrorText, Label } from '@/components/ui';
import { VideoTile } from '@/components/video-tile';

// Free public STUN server: lets two browsers find their public addresses.
// Some strict networks also need a TURN relay, which this prototype does not have.
const RTC_CONFIG: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// Where the voice detector loads its model and runtime from. Pinned to the
// installed package versions so they always match the code that uses them.
const VAD_ASSET_URL = 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.31/dist/';
const ONNX_RUNTIME_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';

interface RemotePeer extends PublicPeer {
  // null until either we call them or their offer arrives -- see
  // upsertPeerInfo/setPeerConnection below for why those are two separate steps.
  pc: RTCPeerConnection | null;
  stream: MediaStream | null;
}

export default function MeetingRoom() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();

  // --- lobby ---
  const [languages, setLanguages] = useState<Languages>({});
  const [meetingTitle, setMeetingTitle] = useState('');
  const [notFound, setNotFound] = useState(false);
  // Lazy initializers (not an effect) so a returning visitor's saved name/
  // language show up on the very first render, with no flash of empty
  // fields. (An effect that read localStorage and called setState here
  // would trip Next 16's react-hooks/set-state-in-effect rule.)
  const [name, setName] = useState(() => (typeof window === 'undefined' ? '' : localStorage.getItem('meet-translate:name') || ''));
  const [lang, setLang] = useState(() => (typeof window === 'undefined' ? 'en' : localStorage.getItem('meet-translate:lang') || 'en'));
  const [lobbyError, setLobbyError] = useState('');
  const [joining, setJoining] = useState(false);

  // --- room ---
  const [joined, setJoined] = useState(false);
  const [mySocketId, setMySocketId] = useState('');
  const [myParticipantId, setMyParticipantId] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [status, setStatus] = useState('');
  const [mockMode, setMockMode] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  // On by default: hearing a translated voice instead of the original is
  // the point of a translated call, not an extra someone has to turn on.
  // The checkbox stays so someone can switch back to the original voice.
  const [readAloud, setReadAloud] = useState(true);

  const socketRef = useRef<Socket | null>(null);
  const playingVoiceRef = useRef(false); // true while a translated voice plays
  // Created on first use (browser-only APIs inside), then kept for the call.
  const voicePlayerRef = useRef<VoicePlayer | null>(null);
  function voicePlayer(): VoicePlayer {
    voicePlayerRef.current ??= new VoicePlayer((playing) => (playingVoiceRef.current = playing));
    return voicePlayerRef.current;
  }
  // Saved outside React state so callbacks registered once (when the socket
  // connects) always see the latest value, instead of the value from
  // whichever render happened to be active when the listener was attached.
  const langRef = useRef('en');
  const readAloudRef = useRef(true);
  useEffect(() => {
    readAloudRef.current = readAloud;
  }, [readAloud]);

  // Load the language list and check the meeting exists, before showing the lobby form.
  useEffect(() => {
    api.getLanguages().then(setLanguages);
    api
      .getMeeting(code)
      .then((meeting) => setMeetingTitle(meeting.title))
      .catch(() => setNotFound(true));
  }, [code]);

  useEffect(() => {
    localStorage.setItem('meet-translate:name', name);
  }, [name]);

  async function join(e: FormEvent) {
    e.preventDefault();
    setLobbyError('');
    setJoining(true);
    localStorage.setItem('meet-translate:lang', lang);
    langRef.current = lang;

    let stream: MediaStream;
    try {
      // echoCancellation stops the mic picking up other people's voices from
      // our speakers, which would otherwise get translated back into the meeting.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: true,
      });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true }); // no camera
      } catch {
        setLobbyError(
          'Your microphone is blocked. Click the lock icon next to the address bar, allow the microphone, then try again.',
        );
        setJoining(false);
        return;
      }
    }

    setLocalStream(stream);
    connectSocket(stream);
  }

  function connectSocket(stream: MediaStream) {
    const socket = io(WS_URL, { path: '/ws' });
    socketRef.current = socket;

    socket.on('connect', () => socket.emit('join', { code, name, lang }));

    socket.on('welcome', (msg: { you: string; participantId: number; title: string; peers: PublicPeer[]; mock: boolean }) => {
      setMySocketId(msg.you);
      setMyParticipantId(msg.participantId);
      setMeetingTitle(msg.title);
      setMockMode(msg.mock);
      setJoined(true);
      setJoining(false);
      // The newcomer phones everyone already here. Only one side ever makes
      // the offer, which avoids both sides calling each other at once.
      msg.peers.forEach((p) => callPeer(p, stream));
      startTranslationCapture(stream);
    });

    socket.on('peer-joined', (msg: { peer: PublicPeer }) => {
      upsertPeerInfo(msg.peer); // they will call us; we just wait
    });

    socket.on('peer-updated', (msg: { peer: PublicPeer }) => {
      setPeers((prev) => prev.map((p) => (p.socketId === msg.peer.socketId ? { ...p, lang: msg.peer.lang } : p)));
    });

    socket.on('peer-left', (msg: { socketId: string }) => {
      setPeers((prev) => {
        const peer = prev.find((p) => p.socketId === msg.socketId);
        peer?.pc?.close();
        return prev.filter((p) => p.socketId !== msg.socketId);
      });
    });

    socket.on('signal', async (msg: { from: string; data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }) => {
      await handleSignal(msg.from, msg.data, stream);
    });

    // The same caption arrives several times as its English streams in, so
    // update it in place by id rather than adding a new line each time.
    socket.on('caption', (caption: Caption) => {
      setCaptions((prev) => {
        const i = prev.findIndex((c) => c.id === caption.id);
        if (i === -1) return [...prev, caption];
        const next = [...prev];
        next[i] = caption;
        return next;
      });
    });

    // Arrives a moment after the caption, only if I'm listening in English.
    // Pieces of the English voice, sent the moment Fish produces them, so
    // playback starts before the whole sentence's audio exists.
    socket.on('voice-chunk', (voice: VoiceChunk) => {
      if (readAloudRef.current && voice.from !== socketRef.current?.id) voicePlayer().chunk(voice.id, voice.audio);
    });
    socket.on('voice-end', (voice: { id: string }) => voicePlayer().end(voice.id));

    socket.on('full', () => setLobbyError('This meeting is full.'));

    socket.on('connect_error', () => {
      setLobbyError('Could not reach the server.');
      setJoining(false);
    });
  }

  // ---------- WebRTC ----------

  function createConnection(peerId: string, stream: MediaStream): RTCPeerConnection {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    for (const track of stream.getTracks()) pc.addTrack(track, stream);

    pc.onicecandidate = (event) => {
      if (event.candidate) socketRef.current?.emit('signal', { to: peerId, data: { candidate: event.candidate } });
    };
    pc.ontrack = (event) => {
      setPeers((prev) => prev.map((p) => (p.socketId === peerId ? { ...p, stream: event.streams[0] } : p)));
    };
    return pc;
  }

  // Two separate updates on purpose: who someone is (name/lang, known as soon
  // as they join) and their live connection (known only once we've called
  // them or their offer has arrived) don't always become known at the same
  // time, and neither update should be allowed to overwrite the other with
  // stale/placeholder data -- see the "peer-joined" vs. offer race this guards
  // against in handleSignal below.
  function upsertPeerInfo(info: PublicPeer) {
    setPeers((prev) => {
      if (prev.some((p) => p.socketId === info.socketId)) {
        return prev.map((p) => (p.socketId === info.socketId ? { ...p, ...info } : p));
      }
      return [...prev, { ...info, pc: null, stream: null }];
    });
  }

  function setPeerConnection(socketId: string, pc: RTCPeerConnection) {
    setPeers((prev) => {
      if (prev.some((p) => p.socketId === socketId)) {
        return prev.map((p) => (p.socketId === socketId ? { ...p, pc } : p));
      }
      // Shouldn't normally happen (info always arrives first), but stay safe.
      return [...prev, { socketId, participantId: 0, name: 'Guest', lang: 'en', pc, stream: null }];
    });
  }

  async function callPeer(info: PublicPeer, stream: MediaStream) {
    upsertPeerInfo(info);
    const pc = createConnection(info.socketId, stream);
    setPeerConnection(info.socketId, pc);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current?.emit('signal', { to: info.socketId, data: { description: pc.localDescription } });
  }

  async function handleSignal(
    fromId: string,
    data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit },
    stream: MediaStream,
  ) {
    const existingPc = peersRefLookup(fromId)?.pc;

    if (data.description) {
      if (data.description.type === 'offer') {
        const pc = createConnection(fromId, stream);
        setPeerConnection(fromId, pc);
        await pc.setRemoteDescription(data.description);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socketRef.current?.emit('signal', { to: fromId, data: { description: pc.localDescription } });
      } else if (existingPc) {
        await existingPc.setRemoteDescription(data.description);
      }
    } else if (data.candidate && existingPc) {
      await existingPc.addIceCandidate(data.candidate);
    }
  }

  // peers state can lag one render behind a fast sequence of signal messages,
  // so reads go through a ref kept in sync by the same setPeers calls above.
  const peersRef = useRef<RemotePeer[]>([]);
  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);
  function peersRefLookup(socketId: string) {
    return peersRef.current.find((p) => p.socketId === socketId);
  }

  // ---------- live translation ----------

  // Silero VAD (via @ricky0123/vad-web) runs a small neural network on every
  // 32ms of mic audio in the browser and says how likely it is to be speech.
  // It replaces a plain loudness check, which let clicks, background noise and
  // the translated voice from the speakers through as "speech".
  async function startTranslationCapture(stream: MediaStream) {
    // Imported here, not at the top of the file: it needs browser-only APIs,
    // and Next.js also renders this page once on the server.
    const { MicVAD } = await import('@ricky0123/vad-web');
    const segmenter = new Segmenter(16000, {
      onPhrase: (wavBlob, id, tentative, endedAt) => uploadPhrase(wavBlob, id, tentative, endedAt),
      onConfirm: (id) => socketRef.current?.emit('phrase-confirm', { id }),
      onCancel: (id) => socketRef.current?.emit('phrase-cancel', { id }),
    });

    await MicVAD.new({
      model: 'v5',
      baseAssetPath: VAD_ASSET_URL,
      onnxWASMBasePath: ONNX_RUNTIME_URL,
      // Listen to the call's own mic, and never stop it -- the same audio
      // track is also being sent to the other people over WebRTC.
      getStream: async () => new MediaStream(stream.getAudioTracks()),
      pauseStream: async () => {},
      resumeStream: async (s) => s,
      startOnLoad: true,
      // Each frame arrives already resampled to 16 kHz. While a translated
      // voice is playing, treat the mic as silent so the speakers' output
      // isn't picked up and sent back as if I'd said it.
      onFrameProcessed: (probabilities, frame) => {
        const isSpeech = !playingVoiceRef.current && probabilities.isSpeech > 0.5;
        segmenter.push(frame, isSpeech);
      },
    });
  }

  async function uploadPhrase(wavBlob: Blob, phraseId: string, tentative: boolean, endedAt: number) {
    try {
      const result = await api.sendUtterance(code, myParticipantIdRef.current, wavBlob, phraseId, tentative);
      if (!result.empty && !result.cancelled) {
        const seconds = ((Date.now() - endedAt) / 1000).toFixed(1);
        setStatus(`Last phrase delivered ${seconds}s after you stopped speaking.`);
      }
    } catch (err) {
      setStatus(`Translation error: ${errorMessage(err)}`);
    }
  }

  // uploadPhrase is created once (inside startTranslationCapture, itself
  // called once from the "welcome" handler) so it can't close over a state
  // update to myParticipantId that happens a moment later -- read it from a
  // ref instead, the same trick as langRef above.
  const myParticipantIdRef = useRef(0);
  useEffect(() => {
    myParticipantIdRef.current = myParticipantId;
  }, [myParticipantId]);

  // A speaker whose words get translated into my language is muted outright
  // (not just while their translation plays), so I only ever hear the
  // translated voice -- not a few seconds of Hindi/Telugu first.
  function isTranslatedForMe(peer: PublicPeer) {
    return readAloud && lang === TARGET_LANG && peer.lang !== TARGET_LANG;
  }

  // ---------- captions box ----------

  // New captions are added at the bottom, so keep the box scrolled to the
  // newest one -- unless the person has scrolled up to re-read something,
  // in which case leave them where they are.
  const captionBoxRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  function onCaptionScroll() {
    const box = captionBoxRef.current;
    if (box) atBottomRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  }
  useEffect(() => {
    const box = captionBoxRef.current;
    if (box && atBottomRef.current) box.scrollTop = box.scrollHeight;
  }, [captions]);

  // ---------- controls ----------

  function toggleMute() {
    const track = localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }

  function toggleCamera() {
    const track = localStream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraOff(!track.enabled);
  }

  function changeLang(newLang: string) {
    setLang(newLang);
    langRef.current = newLang;
    localStorage.setItem('meet-translate:lang', newLang);
    socketRef.current?.emit('set-lang', { lang: newLang });
  }

  const [copied, setCopied] = useState(false);
  function copyInviteLink() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function leave() {
    localStream?.getTracks().forEach((t) => t.stop());
    socketRef.current?.disconnect();
    router.push('/');
  }

  // Stop everything if the tab closes mid-call, not just on the Leave button.
  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      localStream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- render ----------

  if (notFound) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
        <h2 className="text-2xl font-semibold">Meeting not found</h2>
        <p className="text-muted">Check the link or code and try again.</p>
        <Link href="/" className="text-sm text-brand hover:underline">
          Create a new meeting
        </Link>
      </main>
    );
  }

  if (!joined) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
        <Card className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">{meetingTitle || 'Loading meeting...'}</h2>
          <form onSubmit={join} className="flex flex-col gap-3">
            <div>
              <Label>Your name</Label>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
            </div>
            <div>
              <Label>The language you will speak</Label>
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                {Object.entries(languages).map(([code, langName]) => (
                  <option key={code} value={code}>
                    {langName}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">
                Pick English to hear Hindi, Telugu, Tamil and Kannada speakers in English. Pick your own language if
                you will speak it, and English listeners will hear you translated.
              </p>
            </div>
            <Button type="submit" disabled={joining || !meetingTitle}>
              {joining ? 'Joining...' : 'Join meeting'}
            </Button>
            {lobbyError && <ErrorText>{lobbyError}</ErrorText>}
          </form>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col">
      {mockMode && (
        <div className="bg-warn-soft px-3 py-2 text-center text-sm text-warn">
          Demo mode: captions are fake sample text, not real speech-to-text or translation.
        </div>
      )}

      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <strong className="min-w-0 truncate">{meetingTitle}</strong>
        <Button variant="quiet" className="text-xs" onClick={copyInviteLink}>
          {copied ? 'Copied!' : 'Copy invite link'}
        </Button>
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-sm whitespace-nowrap">
          I speak
          <select value={lang} onChange={(e) => changeLang(e.target.value)} className="w-auto">
            {Object.entries(languages).map(([code, langName]) => (
              <option key={code} value={code}>
                {langName}
              </option>
            ))}
          </select>
        </label>
      </header>
      <p className="border-b border-line bg-surface px-4 py-1 text-xs text-muted">{languageHint(lang, peers, languages)}</p>

      <section className="grid flex-1 grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2 overflow-auto p-2">
        <VideoTile
          stream={localStream}
          muted
          mirror
          videoOff={cameraOff}
          name={name}
          label={`${name} (you) · ${languages[lang] ?? lang}${muted ? ' · mic off' : ''}`}
        />
        {peers.map((p) => (
          <VideoTile
            key={p.socketId}
            stream={p.stream}
            muted={isTranslatedForMe(p)}
            name={p.name}
            label={`${p.name} · ${languages[p.lang] ?? p.lang}`}
          />
        ))}
        {peers.length === 0 && (
          <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line p-4 text-center">
            <p className="text-sm text-muted">Nobody else is here yet. Send them the invite link.</p>
            <Button variant="quiet" className="text-xs" onClick={copyInviteLink}>
              {copied ? 'Copied!' : 'Copy invite link'}
            </Button>
          </div>
        )}
      </section>

      <section className="border-t border-line bg-surface px-4 py-2">
        <div ref={captionBoxRef} onScroll={onCaptionScroll} className="h-38 overflow-y-auto">
          {captions.length === 0 && <p className="py-1 text-sm text-muted">Captions will appear here when someone speaks.</p>}
          {captions.map((c, i) => {
            const mine = c.from === mySocketId;
            const translated = c.translations[lang];
            // What was said, in English letters when we have that
            // ("aaj ki meeting mein kya hua") rather than Hindi/Telugu script.
            const said = c.romanized || c.original;
            // English is on its way (it streams in word by word): show "..."
            // until the first words arrive, with what was said underneath.
            const englishComing = !c.final && lang === TARGET_LANG && c.lang !== TARGET_LANG;
            return (
              <div key={c.id ?? i} className="flex flex-wrap gap-x-2 py-1">
                <b className="text-brand">{mine ? 'You' : c.name}</b>
                <span>
                  {translated || (englishComing ? '' : said)}
                  {!c.final && <span className="text-muted"> ...</span>}
                </span>
                {(translated || englishComing) && (
                  <small className="basis-full text-muted">
                    {languages[c.lang] ?? c.lang}: {said}
                  </small>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-muted">{status}</p>
      </section>

      <footer className="flex flex-wrap items-center gap-3 border-t border-line bg-surface px-4 py-3">
        {/* Red while off, so it's obvious at a glance that nobody can hear/see you. */}
        <Button variant={muted ? 'danger' : 'quiet'} onClick={toggleMute}>
          {muted ? 'Unmute' : 'Mute'}
        </Button>
        <Button variant={cameraOff ? 'danger' : 'quiet'} onClick={toggleCamera}>
          {cameraOff ? 'Camera on' : 'Camera off'}
        </Button>
        {/* Only English listeners are sent a translated voice, so the option
            means nothing to anyone else. */}
        {lang === TARGET_LANG && (
          <label className="flex items-center gap-2 text-sm whitespace-nowrap" title="Plays the English voice and mutes the speaker's own voice">
            <input type="checkbox" checked={readAloud} onChange={(e) => setReadAloud(e.target.checked)} className="w-auto" />
            Translated voice
          </label>
        )}
        <Button variant="danger" className="ml-auto" onClick={leave}>
          Leave
        </Button>
      </footer>
    </main>
  );
}

// One line under the header saying what the "I speak" choice means right now.
// In a real two-person test both people were on Hindi at one point and
// wondered why nothing was translated -- this says why, so nobody has to guess.
function languageHint(lang: string, peers: { lang: string }[], languages: Languages): string {
  const mine = languages[lang] ?? lang;
  if (lang === TARGET_LANG) return 'You hear Hindi, Telugu, Tamil and Kannada speakers translated into English.';
  if (peers.length > 0 && !peers.some((p) => p.lang === TARGET_LANG))
    return `Nobody else is on English, so your ${mine} is not being translated. To hear someone in English, set "I speak" to English.`;
  return `Speak ${mine}. English listeners hear you translated into English.`;
}
