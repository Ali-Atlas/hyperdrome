'use client';

import { useEffect } from 'react';
import { Hexagon } from 'lucide-react';

const TEAL = '#03DAC6';
const BG = '#000000';
const CARD_BG = '#121212';
const BORDER = '#292929';
const TEXT = '#FFFFFF';
const MUTED = '#A0A0A0';

const buttonBase = {
  background: 'transparent',
  border: `1px solid ${TEAL}`,
  color: TEAL,
  fontFamily: 'Inter, system-ui, sans-serif',
  fontWeight: 600,
  fontSize: '0.875rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  padding: '12px 24px',
  borderRadius: 8,
  cursor: 'pointer',
  textDecoration: 'none',
  display: 'inline-block',
};

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: BG,
          color: TEXT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: '100%',
            background: CARD_BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: '40px 32px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Hexagon size={48} color={TEAL} aria-hidden="true" />
          <h1
            style={{
              fontFamily: 'Orbitron, system-ui, sans-serif',
              fontSize: '1.5rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
              margin: 0,
              color: TEXT,
            }}
          >
            Something went wrong
          </h1>
          <p style={{ margin: 0, color: MUTED, fontSize: '1rem' }}>
            Please try again.
          </p>
          <div
            style={{
              display: 'flex',
              gap: 12,
              marginTop: 16,
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}
          >
            <button type="button" onClick={() => reset()} style={buttonBase}>
              Try Again
            </button>
            <a href="/" style={buttonBase}>
              Go Home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
