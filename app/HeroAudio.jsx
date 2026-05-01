'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './page.module.css';

/**
 * Hero background audio + corner mute/unmute toggle.
 *
 * Behavior contract:
 * - `<audio preload="none">` so nothing loads until first user gesture.
 *   Zero impact on page load / LCP / FCP / hero render.
 * - First `pointerdown` anywhere on the document starts playback (browser
 *   autoplay rules require a user gesture; this satisfies them on the very
 *   first tap or click, including PLAY DEMO). Listener detaches after
 *   the first successful start.
 * - Toggle button in the hero's top-left corner; clicking it pauses or
 *   resumes manually. Its own `pointerdown` stops propagation so the
 *   global first-interaction listener doesn't fire-and-immediately-pause
 *   when the user's first interaction IS the toggle.
 * - On unmount (user leaves the landing page) the audio is paused and
 *   its `src` cleared so the browser drops the media-session indicator
 *   and releases the resource. Audio is local to the landing page; no
 *   cross-route handoff.
 *
 * Iconography is inline SVG (no library) so the toggle ships with zero
 * extra runtime dependencies.
 */
export default function HeroAudio() {
  const audioRef = useRef(null);
  const startedRef = useRef(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const start = () => {
      if (startedRef.current) return;
      const audio = audioRef.current;
      if (!audio) return;
      audio
        .play()
        .then(() => {
          startedRef.current = true;
          setPlaying(true);
          document.removeEventListener('pointerdown', start);
        })
        .catch(() => {
          /* gesture rejected; user can still try via the toggle */
        });
    };
    document.addEventListener('pointerdown', start);
    return () => {
      document.removeEventListener('pointerdown', start);
      // Tear down the media element on unmount so the browser stops
      // showing a media-session indicator after the user navigates
      // away. Pausing alone isn't enough on some browsers; clearing
      // src + load() releases the resource entirely.
      const audio = audioRef.current;
      if (audio) {
        try {
          audio.pause();
          audio.removeAttribute('src');
          audio.load();
        } catch {
          /* element may already be detached; nothing to do */
        }
      }
    };
  }, []);

  const handleToggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio
        .play()
        .then(() => {
          startedRef.current = true;
          setPlaying(true);
        })
        .catch(() => {});
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  // Stop propagation so the global pointerdown handler doesn't fire when
  // the toggle itself is the user's first interaction (which would
  // play, then the click handler immediately pauses).
  const swallowPointer = (e) => {
    e.stopPropagation();
  };

  return (
    <>
      <audio
        ref={audioRef}
        src="/audio/hero-bg.mp3"
        preload="none"
        loop
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={handleToggle}
        onPointerDown={swallowPointer}
        className={styles.heroAudioToggle}
        aria-label={playing ? 'Mute background audio' : 'Play background audio'}
        aria-pressed={playing}
      >
        {playing ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
      </button>
    </>
  );
}

function SpeakerOnIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function SpeakerOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  );
}
