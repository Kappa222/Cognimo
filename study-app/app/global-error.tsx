'use client';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}

export default function GlobalError({ unstable_retry }: GlobalErrorProps) {
  return (
    <html lang="hu">
      <body>
        <div
          style={{
            margin: '0 auto',
            minHeight: '100vh',
            maxWidth: '42rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '3rem 1.5rem',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div
            style={{
              width: '100%',
              borderRadius: '1rem',
              border: '1px solid #e4e4e7',
              background: '#fff',
              padding: '3rem',
              textAlign: 'center',
            }}
          >
            <p style={{ marginBottom: '0.25rem', fontSize: '1.125rem', fontWeight: 600 }}>
              Valami hiba történt
            </p>
            <p style={{ marginBottom: '1.5rem', fontSize: '0.875rem', color: '#71717a' }}>
              Próbáld újra, vagy térj vissza később.
            </p>
            <button
              type="button"
              onClick={() => unstable_retry()}
              style={{
                borderRadius: '0.5rem',
                background: '#7c3aed',
                padding: '0.625rem 1.5rem',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Újra
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
