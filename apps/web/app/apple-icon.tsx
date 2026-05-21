import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#FAF7F2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 112,
          fontWeight: 500,
          letterSpacing: '-0.04em',
          fontFamily: 'serif',
        }}
      >
        <span style={{ fontStyle: 'italic', color: '#8B7355' }}>m</span>
        <span style={{ color: '#2C1F14' }}>M</span>
      </div>
    ),
    { ...size },
  );
}
