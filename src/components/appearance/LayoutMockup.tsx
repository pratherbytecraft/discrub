import { Box, useTheme } from '@mui/material';
import type { LayoutKey } from '@/layouts/types';

/**
 * A drawn miniature of Discrub in a given layout (2.2.0). Replaces the
 * wireframe glyph wherever a user is deciding on a layout: it draws the
 * message view the way that layout arranges it, in the current theme's
 * colours, so every theme previews for free and nothing goes stale when a
 * real screen changes. Drawn on a fixed 320x200 stage and scaled to `width`.
 */
const STAGE_W = 320;
const STAGE_H = 200;

interface Ink {
  bg: string;
  paper: string;
  line: string;
  ink: string;
  mute: string;
  primary: string;
  cta: string;
}

const px = (n: number) => `${n}px`;

/** A rounded bar of text. */
const Bar = ({ w, h = 4, c, o = 1, mt = 0, r = 2 }: { w: number | string; h?: number; c: string; o?: number; mt?: number; r?: number }) => (
  <Box component="i" sx={{ display: 'block', width: typeof w === 'number' ? px(w) : w, height: px(h), bgcolor: c, opacity: o, borderRadius: px(r), mt: px(mt), flexShrink: 0 }} />
);

/** One message row: avatar, name, time, one or two lines of text. */
const Row = ({ ink, i, wide = false, dense = false }: { ink: Ink; i: number; wide?: boolean; dense?: boolean }) => {
  const avatars = [ink.primary, ink.cta, ink.mute, ink.primary];
  const names = [34, 26, 40, 30];
  const lines = [[0.82, 0.5], [0.6], [0.9, 0.35], [0.45]];
  if (dense) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '5px', height: 11, borderBottom: `1px solid ${ink.line}`, px: '5px' }}>
        <Box component="i" sx={{ width: 5, height: 5, border: `1px solid ${ink.mute}`, borderRadius: '1px', display: 'block', flexShrink: 0 }} />
        <Bar w={22} h={3} c={ink.mute} o={0.7} />
        <Bar w={names[i % 4]} h={3} c={ink.ink} o={0.85} />
        <Bar w={`${lines[i % 4][0] * 45}%`} h={3} c={ink.mute} o={0.55} />
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'flex', gap: '6px', px: '8px', py: '5px' }}>
      <Box component="i" sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: avatars[i % 4], opacity: 0.9, display: 'block', flexShrink: 0, mt: '1px' }} />
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Bar w={names[i % 4]} h={4} c={ink.ink} o={0.9} />
          <Bar w={18} h={3} c={ink.mute} o={0.5} />
        </Box>
        {lines[i % 4].map((f, k) => (
          <Bar key={k} w={`${f * (wide ? 100 : 100)}%`} h={3} c={ink.mute} o={0.6} />
        ))}
      </Box>
    </Box>
  );
};

/** The app's top bar: logo, title, the Appearance pill, two icon dots. */
const TopBar = ({ ink, h = 18 }: { ink: Ink; h?: number }) => (
  <Box sx={{ height: h, flexShrink: 0, bgcolor: ink.paper, borderBottom: `1px solid ${ink.line}`, display: 'flex', alignItems: 'center', gap: '5px', px: '7px' }}>
    <Box component="i" sx={{ width: 9, height: 9, borderRadius: '2px', bgcolor: ink.primary, display: 'block' }} />
    <Bar w={30} h={4} c={ink.ink} o={0.9} />
    <Box sx={{ flex: 1 }} />
    <Box sx={{ height: 9, px: '5px', borderRadius: '5px', border: `1px solid ${ink.line}`, display: 'flex', alignItems: 'center', gap: '3px' }}>
      <Box component="i" sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: ink.primary, display: 'block' }} />
      <Bar w={16} h={3} c={ink.ink} o={0.8} />
    </Box>
    <Box component="i" sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: ink.mute, display: 'block' }} />
    <Box component="i" sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: ink.cta, display: 'block' }} />
  </Box>
);

/** A row of toolbar buttons, one filled. */
const Toolbar = ({ ink, n = 4, filled = 1 }: { ink: Ink; n?: number; filled?: number }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', px: '8px', py: '5px', borderBottom: `1px solid ${ink.line}` }}>
    {Array.from({ length: n }, (_, k) => (
      <Box key={k} sx={{ height: 9, width: 24 + (k % 3) * 6, borderRadius: '3px', border: `1px solid ${k === filled ? ink.cta : ink.line}`, bgcolor: k === filled ? ink.cta : 'transparent', opacity: k === filled ? 0.95 : 1 }} />
    ))}
    <Box sx={{ flex: 1 }} />
    <Box sx={{ height: 9, width: 16, borderRadius: '3px', border: `1px solid ${ink.line}` }} />
  </Box>
);

/** The Classic channel sidebar: a search box, a server line, channel list with one selected. */
const Sidebar = ({ ink, w, items = 6 }: { ink: Ink; w: number; items?: number }) => (
  <Box sx={{ width: w, flexShrink: 0, bgcolor: ink.paper, borderRight: `1px solid ${ink.line}`, display: 'flex', flexDirection: 'column', gap: '5px', p: '7px 6px' }}>
    <Box sx={{ height: 9, borderRadius: '4px', border: `1px solid ${ink.line}` }} />
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', mt: '2px' }}>
      <Box component="i" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: ink.mute, display: 'block' }} />
      <Bar w="60%" h={4} c={ink.ink} o={0.85} />
    </Box>
    {Array.from({ length: items }, (_, k) => (
      <Box key={k} sx={{ display: 'flex', alignItems: 'center', gap: '4px', height: 8, borderRadius: '2px', bgcolor: k === 1 ? ink.primary : 'transparent', px: '3px', opacity: k === 1 ? 0.9 : 1 }}>
        <Bar w={4} h={4} c={k === 1 ? ink.bg : ink.mute} o={0.7} />
        <Bar w={`${40 + (k * 17) % 45}%`} h={3} c={k === 1 ? ink.bg : ink.mute} o={k === 1 ? 0.9 : 0.6} />
      </Box>
    ))}
  </Box>
);

/** Native's Discord-style server rail. */
const Rail = ({ ink }: { ink: Ink }) => (
  <Box sx={{ width: 18, flexShrink: 0, bgcolor: ink.paper, borderRight: `1px solid ${ink.line}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', py: '6px' }}>
    {[ink.primary, ink.mute, ink.mute, ink.cta, ink.mute].map((c, k) => (
      <Box key={k} component="i" sx={{ width: 10, height: 10, borderRadius: k === 0 ? '3px' : '50%', bgcolor: c, opacity: k === 0 ? 1 : 0.55, display: 'block' }} />
    ))}
  </Box>
);

/** A side panel of labelled blocks (Native inspector, Operator log). */
const Panel = ({ ink, w, blocks, mono = false }: { ink: Ink; w: number; blocks: number; mono?: boolean }) => (
  <Box sx={{ width: w, flexShrink: 0, bgcolor: ink.paper, borderLeft: `1px solid ${ink.line}`, p: '7px 6px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
    <Bar w="55%" h={4} c={ink.ink} o={0.85} />
    {mono
      ? Array.from({ length: blocks }, (_, k) => (
          <Box key={k} sx={{ display: 'flex', gap: '3px' }}>
            <Bar w={10} h={3} c={ink.primary} o={0.8} />
            <Bar w={`${45 + (k * 23) % 50}%`} h={3} c={ink.mute} o={0.6} />
          </Box>
        ))
      : Array.from({ length: blocks }, (_, k) => (
          <Box key={k} sx={{ borderRadius: '3px', border: `1px solid ${ink.line}`, p: '4px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <Bar w="40%" h={3} c={ink.mute} o={0.6} />
            <Bar w="75%" h={4} c={ink.ink} o={0.8} />
          </Box>
        ))}
    {!mono && <Box sx={{ mt: 'auto', height: 10, borderRadius: '3px', bgcolor: ink.cta, opacity: 0.95 }} />}
  </Box>
);

/** A progress line with a label, used by the Workbench dock and the Operator panel. */
const Progress = ({ ink, f = 0.62 }: { ink: Ink; f?: number }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1 }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
      <Bar w={36} h={3} c={ink.ink} o={0.8} />
      <Bar w={16} h={3} c={ink.mute} o={0.6} />
    </Box>
    <Box sx={{ height: 5, borderRadius: '3px', bgcolor: ink.line, overflow: 'hidden' }}>
      <Box sx={{ width: `${f * 100}%`, height: '100%', bgcolor: ink.primary }} />
    </Box>
  </Box>
);

const Feed = ({ ink, rows, from = 0, wide }: { ink: Ink; rows: number; from?: number; wide?: boolean }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    {Array.from({ length: rows }, (_, k) => <Row key={k} ink={ink} i={k + from} wide={wide} />)}
  </Box>
);

const Stage = ({ ink, children }: { ink: Ink; children: React.ReactNode }) => (
  <Box sx={{ width: STAGE_W, height: STAGE_H, bgcolor: ink.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{children}</Box>
);

const scenes: Record<LayoutKey, (ink: Ink) => React.ReactNode> = {
  classic: (ink) => (
    <Stage ink={ink}>
      <TopBar ink={ink} />
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar ink={ink} w={84} />
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Toolbar ink={ink} n={4} filled={1} />
          <Feed ink={ink} rows={5} />
        </Box>
      </Box>
    </Stage>
  ),
  native: (ink) => (
    <Stage ink={ink}>
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Rail ink={ink} />
        <Sidebar ink={ink} w={70} items={7} />
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ height: 18, flexShrink: 0, borderBottom: `1px solid ${ink.line}`, display: 'flex', alignItems: 'center', gap: '4px', px: '8px' }}>
            <Bar w={5} h={5} c={ink.mute} o={0.7} />
            <Bar w={34} h={4} c={ink.ink} o={0.9} />
            <Box sx={{ flex: 1 }} />
            <Bar w={22} h={3} c={ink.mute} o={0.5} />
          </Box>
          <Feed ink={ink} rows={6} />
        </Box>
        <Panel ink={ink} w={78} blocks={3} />
      </Box>
    </Stage>
  ),
  workbench: (ink) => (
    <Stage ink={ink}>
      <TopBar ink={ink} h={16} />
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar ink={ink} w={70} items={5} />
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Toolbar ink={ink} n={6} filled={2} />
          <Box sx={{ height: 12, bgcolor: ink.paper, borderBottom: `1px solid ${ink.line}`, display: 'flex', alignItems: 'center', gap: '5px', px: '5px' }}>
            <Box component="i" sx={{ width: 5, height: 5, border: `1px solid ${ink.mute}`, borderRadius: '1px', display: 'block' }} />
            <Bar w={22} h={3} c={ink.ink} o={0.7} />
            <Bar w={30} h={3} c={ink.ink} o={0.7} />
            <Bar w={40} h={3} c={ink.ink} o={0.7} />
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {Array.from({ length: 9 }, (_, k) => <Row key={k} ink={ink} i={k} dense />)}
          </Box>
          <Box sx={{ height: 34, flexShrink: 0, bgcolor: ink.paper, borderTop: `1px solid ${ink.line}`, display: 'flex', alignItems: 'center', gap: '8px', px: '8px' }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', border: `1px solid ${ink.mute}` }} />
            <Progress ink={ink} />
            <Box sx={{ width: 56, display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <Bar w="70%" h={3} c={ink.mute} o={0.6} />
              <Bar w="100%" h={3} c={ink.mute} o={0.6} />
            </Box>
          </Box>
        </Box>
      </Box>
    </Stage>
  ),
  simple: (ink) => (
    <Stage ink={ink}>
      <TopBar ink={ink} />
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center' }}>
        <Box sx={{ width: 230, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '5px', px: '8px', pt: '8px', pb: '5px' }}>
            <Bar w={5} h={5} c={ink.mute} o={0.7} />
            <Bar w={44} h={5} c={ink.ink} o={0.9} />
            <Box sx={{ flex: 1 }} />
            <Box sx={{ height: 9, width: 26, borderRadius: '3px', bgcolor: ink.cta, opacity: 0.95 }} />
          </Box>
          <Feed ink={ink} rows={5} wide />
        </Box>
      </Box>
    </Stage>
  ),
  operator: (ink) => (
    <Stage ink={ink}>
      <TopBar ink={ink} h={16} />
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar ink={ink} w={64} items={5} />
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', p: '7px', gap: '6px' }}>
          <Box sx={{ borderRadius: '4px', border: `1px solid ${ink.line}`, bgcolor: ink.paper, p: '7px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: ink.cta }} />
              <Progress ink={ink} f={0.44} />
            </Box>
            <Box sx={{ display: 'flex', gap: '5px' }}>
              {[0, 1, 2].map((k) => (
                <Box key={k} sx={{ flex: 1, borderRadius: '3px', border: `1px solid ${ink.line}`, p: '4px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <Bar w="50%" h={3} c={ink.mute} o={0.6} />
                  <Bar w="35%" h={5} c={ink.ink} o={0.9} />
                </Box>
              ))}
            </Box>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, borderRadius: '4px', border: `1px solid ${ink.line}`, overflow: 'hidden' }}>
            <Feed ink={ink} rows={3} from={1} />
          </Box>
        </Box>
        <Panel ink={ink} w={82} blocks={8} mono />
      </Box>
    </Stage>
  ),
  timeline: (ink) => (
    <Stage ink={ink}>
      <TopBar ink={ink} h={16} />
      <Box sx={{ height: 40, flexShrink: 0, bgcolor: ink.paper, borderBottom: `1px solid ${ink.line}`, display: 'flex', alignItems: 'flex-end', gap: '3px', px: '10px', pb: '6px' }}>
        {[4, 9, 6, 14, 7, 11, 16, 8, 5, 10, 13, 6, 9, 15, 7, 4, 12, 8, 6, 10, 5, 9, 14, 7].map((v, k) => (
          <Box key={k} sx={{ flex: 1, height: v * 1.5, borderRadius: '1px', bgcolor: k >= 6 && k <= 9 ? ink.cta : ink.primary, opacity: k >= 6 && k <= 9 ? 0.95 : 0.6 }} />
        ))}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', px: '30px' }}>
        {[0, 1].map((d) => (
          <Box key={d}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', pt: '7px', pb: '3px' }}>
              <Bar w={40} h={4} c={ink.ink} o={0.85} />
              <Box sx={{ flex: 1, height: 1, bgcolor: ink.line }} />
              <Bar w={14} h={3} c={ink.mute} o={0.5} />
            </Box>
            <Feed ink={ink} rows={d === 0 ? 2 : 3} from={d * 2} wide />
          </Box>
        ))}
      </Box>
    </Stage>
  ),
};

/**
 * Draws the given layout in the current theme. `width` sets the rendered
 * size; the drawing keeps its 16:10 stage.
 */
const LayoutMockup = ({ layout, width = 224 }: { layout: LayoutKey; width?: number }) => {
  const theme = useTheme();
  const p = theme.palette;
  const ink: Ink = {
    bg: p.background.default,
    paper: p.background.paper,
    line: p.divider,
    ink: p.text.primary,
    mute: p.text.secondary,
    primary: p.primary.main,
    cta: p.cta?.main ?? p.primary.main,
  };
  const scale = width / STAGE_W;
  return (
    <Box
      aria-hidden
      data-testid={`layout-mockup-${layout}`}
      sx={{ width, height: STAGE_H * scale, position: 'relative', overflow: 'hidden', borderRadius: '4px', border: `1px solid ${ink.line}`, flexShrink: 0 }}
    >
      <Box sx={{ position: 'absolute', left: 0, top: 0, transform: `scale(${scale})`, transformOrigin: 'top left' }}>{scenes[layout](ink)}</Box>
    </Box>
  );
};

export default LayoutMockup;
