'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { Button, Card, ErrorText, Label } from '@/components/ui';

export default function HomePage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  // Public servers ask for an access code before creating a meeting (so a
  // stranger with the link can't run up the paid voice service). It's
  // remembered in this browser after the first time.
  const [needsCode, setNeedsCode] = useState(false);
  // Until the server has said whether a code is needed, "Create meeting"
  // waits -- otherwise the code field popped in a second later, and anyone
  // quick enough got "Wrong access code" before they'd seen it.
  const [configReady, setConfigReady] = useState(false);
  const [accessCode, setAccessCode] = useState(() =>
    typeof window === 'undefined' ? '' : localStorage.getItem('meet-translate:access-code') || '',
  );

  useEffect(() => {
    api
      .getConfig()
      .then((config) => setNeedsCode(config.accessCodeRequired))
      .catch(() => {}) // an older server without /config: no code needed
      .finally(() => setConfigReady(true));
  }, []);

  async function createMeeting(e: FormEvent) {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      const meeting = await api.createMeeting(title, accessCode.trim());
      localStorage.setItem('meet-translate:access-code', accessCode.trim());
      router.push(`/m/${meeting.code}`);
    } catch (err) {
      setError(errorMessage(err));
      setCreating(false);
    }
  }

  function joinMeeting(e: FormEvent) {
    e.preventDefault();
    // Accept either the bare code or the whole invite link.
    const joinCode = code.trim().split('/').pop();
    if (joinCode) router.push(`/m/${joinCode}`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4 py-12">
      <h1 className="mb-2 text-4xl font-semibold">
        Meet <em className="text-brand not-italic">Translate</em>
      </h1>
      <p className="mb-4 text-muted">Video meetings where Hindi, Telugu, Tamil and Kannada speakers are heard in English, with live captions and a translated voice.</p>

      <Card className="flex flex-col gap-3">
        <form onSubmit={createMeeting} className="flex flex-col gap-3">
          <div>
            <Label>Meeting name</Label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Interview with Priya" maxLength={80} />
          </div>
          {needsCode && (
            <div>
              <Label>Access code</Label>
              <input
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder="Ask the owner of this site"
                required
              />
            </div>
          )}
          <Button type="submit" disabled={creating || !configReady}>
            {!configReady ? 'Loading...' : creating ? 'Creating...' : 'Create meeting'}
          </Button>
        </form>
      </Card>

      <Card>
        <form onSubmit={joinMeeting} className="flex flex-col gap-3">
          <div>
            <Label>Have a code or link?</Label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste meeting code" required />
          </div>
          <Button type="submit" variant="quiet">
            Join
          </Button>
        </form>
      </Card>

      {error && <ErrorText>{error}</ErrorText>}
    </main>
  );
}
