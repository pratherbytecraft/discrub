import { alpha, keyframes, styled } from '@mui/material';

/** The slow pulse the loading placeholders use. */
const pulse = keyframes`
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
`;
/** Fade used when a skeleton stands in for a chunk during a fast scroll. */
const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;
const fadeOut = keyframes`
  from { opacity: 1; }
  to { opacity: 0; }
`;

/** Bar widths cycle so a column of skeletons does not read as one repeated row. */
const BAR_WIDTHS = ['38%', '62%', '47%', '71%', '55%', '30%', '66%', '44%'];

/** Lines a skeleton of this height holds: one per 22 px after the header, between one and four. */
export const skeletonLines = (height?: number): number => (height ? Math.max(1, Math.min(4, Math.round((height - 24) / 22))) : 2);

/** Height of the media block under the bars of a tall chunk (an embed, an image, a file card), or 0. */
export const skeletonBlockHeight = (height?: number): number => {
  if (!height) return 0;
  const left = height - 24 - skeletonLines(height) * 22 - 12;
  return left >= 48 ? Math.min(left, 320) : 0;
};

// Plain host elements under one styled root: a fast scroll draws a couple of
// hundred of these per block of travel, so each row costs a handful of DOM
// nodes and no per-element component work. The fast layer's rows carry no
// animation of their own: a hundred separately animated rows each become a
// compositor layer and Chrome cannot raster them ahead of a drag (measured
// 2026-10-18, the feed went blank with them and painted every frame without).
// The layer animates as one element instead.
const Root = styled('div', { shouldForwardProp: (p) => p !== 'overlay' && p !== 'fade' && p !== 'animated' })<{ overlay: boolean; fade?: 'in' | 'out'; animated: boolean }>(({ theme, overlay, fade, animated }) => ({
  display: 'flex',
  gap: 10,
  padding: '6px 10px',
  boxSizing: 'border-box',
  minHeight: 56,
  overflow: 'hidden',
  animation: !animated ? 'none' : fade === 'in' ? `${fadeIn} 160ms ease-out both` : fade === 'out' ? `${fadeOut} 220ms ease-out both` : `${pulse} 1.8s ease-in-out infinite`,
  ...(overlay ? { position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 } : {}),
  '& .avatar': { width: 40, height: 40, borderRadius: '50%', flexShrink: 0, backgroundColor: alpha(theme.palette.text.primary, 0.11) },
  '& .bars': { flex: 1, minWidth: 0, paddingTop: 2 },
  '& .bar': { height: 14, borderRadius: 4, marginBottom: 8, backgroundColor: alpha(theme.palette.text.primary, 0.11) },
  '& .bar.name': { width: 120, height: 16 },
  '& .block': { width: '42%', maxWidth: 420, borderRadius: 8, marginTop: 4, backgroundColor: alpha(theme.palette.text.primary, 0.07) },
  '@media (prefers-reduced-motion: reduce)': { animation: 'none', ...(fade === 'out' ? { opacity: 0 } : {}) },
}));

interface MessageChunkSkeletonProps {
  /** Pixel height to fill; the chunk's measured or estimated size. Omitted for a pending chunk, which sizes itself. */
  height?: number;
  /** Seeds the bar widths so neighbouring skeletons differ. */
  seed?: number;
  /** `in` fades the skeleton up as a fast scroll starts; `out` fades it away over the real row as the scroll settles. */
  fade?: 'in' | 'out';
  /** Drawn over the real chunk while it fades in (absolute, click-through). */
  overlay?: boolean;
  /** False for a row inside the fast scroll layer, which animates as one element. */
  animated?: boolean;
  'data-testid'?: string;
}

/**
 * The skeleton for one feed chunk: an avatar circle, a name bar and one to
 * four text bars. Drawn while a chunk's bodies are not loaded, and for every
 * chunk on screen while the feed scrolls faster than it can render (2.2.5).
 */
const MessageChunkSkeleton = ({ height, seed = 0, fade, overlay = false, animated = true, 'data-testid': testId = 'message-chunk-skeleton' }: MessageChunkSkeletonProps) => {
  const lines = skeletonLines(height);
  const block = skeletonBlockHeight(height);
  const bars: JSX.Element[] = [];
  for (let i = 0; i < lines; i++) bars.push(<div key={i} className="bar" style={{ width: BAR_WIDTHS[(seed * 3 + i) % BAR_WIDTHS.length] }} />);
  return (
    <Root data-testid={testId} aria-hidden overlay={overlay} fade={fade} animated={animated} style={height ? { height, minHeight: height } : undefined}>
      <div className="avatar" />
      <div className="bars">
        <div className="bar name" />
        {bars}
        {block > 0 && <div className="block" style={{ height: block }} />}
      </div>
    </Root>
  );
};

export default MessageChunkSkeleton;
