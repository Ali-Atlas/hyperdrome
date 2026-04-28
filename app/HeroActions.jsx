'use client';

import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import styles from './HeroActions.module.css';

/**
 * Client-only hero CTA. Single dominant PLAY DEMO button: POSTs to
 * /api/auth/demo, then redirects to the dashboard. Login moved to a
 * subtle top-right link in the hero (rendered by app/page.jsx). Audio
 * toggle only renders when /hero-audio.mp3 is actually served (HEAD
 * probe on mount).
 */
export default function HeroActions() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [audioAvailable, setAudioAvailable] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/hero-audio.mp3', { method: 'HEAD' })
      .then((res) => {
        if (!cancelled && res.ok) setAudioAvailable(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDemo() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/demo', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not start demo. Try again.');
        setLoading(false);
        return;
      }
      window.location.href = data.redirectUrl || '/dashboard';
    } catch {
      setError('Network error. Try again.');
      setLoading(false);
    }
  }

  function toggleAudio() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.play()
        .then(() => setAudioPlaying(true))
        .catch(() => {});
    } else {
      el.pause();
      setAudioPlaying(false);
    }
  }

  return (
    <>
      {audioAvailable && (
        <>
          <audio ref={audioRef} loop preload="auto">
            <source src="/hero-audio.mp3" type="audio/mp3" />
          </audio>
          <button
            type="button"
            onClick={toggleAudio}
            className={styles.audioToggle}
            aria-label={audioPlaying ? 'Mute hero audio' : 'Play hero audio'}
          >
            {audioPlaying ? (
              <Volume2 size={20} aria-hidden="true" />
            ) : (
              <VolumeX size={20} aria-hidden="true" />
            )}
          </button>
        </>
      )}

      <div className={styles.cluster}>
        <button
          type="button"
          onClick={handleDemo}
          disabled={loading}
          className={styles.primary}
        >
          {loading ? 'Loading...' : 'Play Demo'}
        </button>
        {error && (
          <p role="alert" className={styles.errorText}>
            {error}
          </p>
        )}
      </div>
    </>
  );
}
