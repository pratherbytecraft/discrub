import { useEffect, useRef, useState } from 'react';
import { Box, Link, useMediaQuery } from '@mui/material';
import { GitHub as GitHubIcon } from '@mui/icons-material';
import { keyframes } from '@mui/system';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/app/hooks';
import { selectSetting } from '@features/app/appSlice';
import { DiscrubSetting } from 'discrub-core/discrub-enum';
import { DEVELOPER } from '@components/welcome/developer';

/**
 * The developer's GitHub follow link on the What's New dialog, as a stamp on
 * the release (2.2.0, owner 2026-09-21). It sits in the dialog footer so it
 * stays in view while the notes scroll. When the dialog opens it lands like a
 * meteor: a streak from the top right, a flash, a shake, sparks and glowing
 * cracks that cool away to nothing. One canvas over the dialog paper, no
 * images. With theme animations off or reduced motion on, the link is simply
 * there.
 */

const HIT_S = 0.55;
const END_S = 5.2;
const POWER = 1.45;

const land = keyframes`
  0% { transform: scale(1.5); border-color: #fff; box-shadow: 0 0 0 2px #fff, 0 0 40px 12px #ffd27a; background-color: #fff3d6; filter: brightness(2); }
  8% { transform: scale(0.94); filter: brightness(1.5); }
  16% { transform: scale(1.03); }
  24% { transform: scale(1); }
  30% { border-color: #ffb24a; box-shadow: 0 0 0 1px #ff9a2a, 0 0 26px 6px rgba(255, 120, 20, 0.7); background-color: #2a1d16; filter: none; }
  100% { box-shadow: 0 0 0 0 transparent; }
`;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const heatColor = (h: number, alpha: number) => {
  const hot = h > 0.6;
  const t = hot ? (h - 0.6) / 0.4 : h / 0.6;
  const r = hot ? 255 : lerp(14, 255, t), g = hot ? lerp(120, 235, t) : lerp(9, 120, t), b = hot ? lerp(20, 170, t) : lerp(7, 20, t);
  return `rgba(${r | 0},${g | 0},${b | 0},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
};
const seeded = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

interface Crack { pts: [number, number][]; len: number }
interface Ember { x: number; y: number; vx: number; vy: number; life: number; r: number }

/** Jagged lines out of the stamp's edge, mostly upward, plus two that run along the footer. */
export const makeCracks = (ix: number, iy: number, halfW: number, rnd: () => number): Crack[] => {
  const cracks: Crack[] = [];
  const grow = (x: number, y: number, angle: number, len: number, flat: number) => {
    const pts: [number, number][] = [[x, y]]; let d = 0;
    while (d < len) { const s = 8 + rnd() * 14; angle += (rnd() - 0.5) * (flat < 1 ? 0.5 : 0.9); x += Math.cos(angle) * s; y += Math.sin(angle) * s * flat; d += s; pts.push([x, y]); }
    cracks.push({ pts, len });
  };
  for (let i = 0; i < 11; i++) {
    const a = -Math.PI * (0.04 + (0.92 * i) / 10) + (rnd() - 0.5) * 0.25;
    grow(Math.max(4, ix + Math.cos(a) * (i % 2 ? halfW : halfW * 0.6)), iy + Math.sin(a) * 18, a, (45 + rnd() * 95) * POWER, 1);
  }
  grow(ix + halfW, iy + 4, 0.06, 150 * POWER, 0.5);
  grow(ix - halfW, iy + 4, Math.PI - 0.05, 50 * POWER, 0.5);
  return cracks;
};

const FollowStamp = () => {
  const { t } = useTranslation();
  const animations = useAppSelector(selectSetting(DiscrubSetting.APP_THEME_ANIMATIONS));
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const still = animations === 'false' || reducedMotion;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pillRef = useRef<HTMLAnchorElement | null>(null);
  const [phase, setPhase] = useState<'wait' | 'landed'>(still ? 'landed' : 'wait');

  useEffect(() => {
    if (still) { setPhase('landed'); return; }
    const canvas = canvasRef.current, pill = pillRef.current;
    const paper = canvas?.closest('.MuiDialog-paper') as HTMLElement | null;
    // jsdom has no canvas; asking it for a context only logs an error.
    const g = /jsdom/i.test(navigator.userAgent) ? null : canvas?.getContext?.('2d') ?? null;
    if (!canvas || !pill || !paper || !g) { setPhase('landed'); return; }
    let raf = 0, t0 = 0, hit = false, cancelled = false;
    let embers: Ember[] = [];
    let cracks: Crack[] = [];
    let ix = 0, iy = 0, w = 0, h = 0;
    const measure = () => {
      const pr = paper.getBoundingClientRect(), r = pill.getBoundingClientRect();
      w = paper.clientWidth; h = paper.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      ix = r.left - pr.left + r.width / 2; iy = r.top - pr.top + r.height / 2;
      return r.width / 2;
    };
    const finish = () => { g.clearRect(0, 0, w, h); paper.style.transform = ''; };
    const frame = (now: number) => {
      if (cancelled) return;
      if (!t0) t0 = now;
      const time = Math.max(0, (now - t0) / 1000);
      g.clearRect(0, 0, w, h);
      if (time < HIT_S) {
        const p = Math.pow(time / HIT_S, 2.2), sx = w - 60, sy = -70;
        const hx = lerp(sx, ix, p), hy = lerp(sy, iy, p), dx = sx - ix, dy = sy - iy, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
        const tail = 260 * Math.min(1, p * 3 + 0.2);
        g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
        for (let k = 0; k < 4; k++) {
          const lg = g.createLinearGradient(hx, hy, hx + ux * tail, hy + uy * tail);
          lg.addColorStop(0, `rgba(255,${230 - k * 40},${170 - k * 50},${(0.8 - k * 0.17).toFixed(2)})`); lg.addColorStop(1, 'rgba(255,60,0,0)');
          g.strokeStyle = lg; g.lineWidth = (4 + k * 7) * POWER; g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + ux * tail, hy + uy * tail); g.stroke();
        }
        const head = g.createRadialGradient(hx, hy, 0, hx, hy, 26 * POWER);
        head.addColorStop(0, '#fff'); head.addColorStop(0.3, 'rgba(255,210,120,0.9)'); head.addColorStop(1, 'rgba(255,90,0,0)');
        g.fillStyle = head; g.beginPath(); g.arc(hx, hy, 26 * POWER, 0, 7); g.fill();
        g.globalCompositeOperation = 'source-over';
      } else {
        const u = time - HIT_S;
        if (!hit) {
          hit = true; setPhase('landed');
          const rnd = seeded(11);
          embers = Array.from({ length: Math.round(54 * POWER) }, () => { const a = -Math.PI * rnd(), sp = (120 + rnd() * 460) * Math.sqrt(POWER); return { x: ix + (rnd() - 0.5) * 180, y: iy - 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + rnd() * 1.3, r: 1.2 + rnd() * 2.2 }; });
        }
        const heat = Math.exp(-u / 1.25), fade = Math.max(0, 1 - Math.max(0, u - 2.2) / 2.4), grown = Math.min(1, u / 0.28);
        // Scorch under the stamp, then the molten glow over it.
        const squash = (ry: number, draw: () => void) => { g.save(); g.translate(ix, iy); g.scale(1, ry); g.translate(-ix, -iy); draw(); g.restore(); };
        const char = g.createRadialGradient(ix, iy, 10, ix, iy, 150 * POWER);
        char.addColorStop(0, `rgba(0,0,0,${(0.55 * fade).toFixed(3)})`); char.addColorStop(0.55, `rgba(8,5,3,${(0.28 * fade).toFixed(3)})`); char.addColorStop(1, 'rgba(0,0,0,0)');
        squash(0.42, () => { g.fillStyle = char; g.fillRect(ix - 260, iy - 260, 520, 520); });
        if (heat > 0.01) {
          g.globalCompositeOperation = 'lighter';
          const glow = g.createRadialGradient(ix, iy, 20, ix, iy, 210 * POWER);
          glow.addColorStop(0, `rgba(255,190,90,${(0.75 * heat).toFixed(3)})`); glow.addColorStop(0.35, `rgba(255,100,15,${(0.5 * heat).toFixed(3)})`); glow.addColorStop(1, 'rgba(160,20,0,0)');
          squash(0.45, () => { g.fillStyle = glow; g.fillRect(ix - 320, iy - 320, 640, 640); });
        }
        for (const c of cracks) {
          const lim = c.len * grown; let d = 0;
          g.beginPath(); g.moveTo(c.pts[0][0], c.pts[0][1]);
          for (let i = 1; i < c.pts.length; i++) {
            const a = c.pts[i - 1], b = c.pts[i], s = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (d + s > lim) { const f = (lim - d) / s; g.lineTo(lerp(a[0], b[0], f), lerp(a[1], b[1], f)); break; }
            g.lineTo(b[0], b[1]); d += s;
          }
          g.globalCompositeOperation = heat > 0.25 ? 'lighter' : 'source-over';
          g.lineCap = 'round'; g.lineJoin = 'round';
          g.shadowColor = `rgba(255,120,20,${heat.toFixed(3)})`; g.shadowBlur = 14 * heat;
          g.lineWidth = 1 + 1.6 * heat; g.strokeStyle = heatColor(heat, (0.35 + 0.65 * heat) * fade); g.stroke(); g.shadowBlur = 0;
        }
        g.globalCompositeOperation = 'lighter';
        if (u < 0.22) {
          const fa = 1 - u / 0.22, flash = g.createRadialGradient(ix, iy, 0, ix, iy, 340 * POWER);
          flash.addColorStop(0, `rgba(255,250,230,${fa.toFixed(3)})`); flash.addColorStop(0.4, `rgba(255,170,60,${(0.6 * fa).toFixed(3)})`); flash.addColorStop(1, 'rgba(255,80,0,0)');
          g.fillStyle = flash; g.fillRect(0, 0, w, h);
        }
        if (u < 0.7) { const e = 1 - Math.pow(1 - u / 0.7, 3); g.strokeStyle = `rgba(255,170,80,${(0.8 * (1 - u / 0.7)).toFixed(3)})`; g.lineWidth = 3; g.beginPath(); g.arc(ix, iy, 20 + 440 * e * POWER, 0, 7); g.stroke(); }
        for (const m of embers) {
          if (u > m.life) continue;
          const f = 1 - u / m.life; g.fillStyle = heatColor(0.35 + 0.65 * f, f);
          g.beginPath(); g.arc(m.x + m.vx * u, m.y + m.vy * u + 0.5 * 680 * u * u, m.r * (0.5 + 0.5 * f), 0, 7); g.fill();
        }
        g.globalCompositeOperation = 'source-over';
        const shake = u < 0.42 ? (1 - u / 0.42) * 9 * POWER : 0;
        paper.style.transform = shake ? `translate(${(shake * Math.sin(u * 95)).toFixed(1)}px, ${(shake * Math.cos(u * 78) * 0.7).toFixed(1)}px)` : '';
        if (u > END_S - HIT_S) { finish(); return; }
      }
      raf = requestAnimationFrame(frame);
    };
    // Let the dialog's own open transition settle, so the stamp has its final place.
    const start = window.setTimeout(() => {
      if (cancelled) return;
      try { const halfW = measure(); cracks = makeCracks(ix, iy, halfW, seeded(7)); raf = requestAnimationFrame(frame); } catch { setPhase('landed'); }
    }, 450);
    return () => { cancelled = true; window.clearTimeout(start); cancelAnimationFrame(raf); paper.style.transform = ''; };
  }, [still]);

  return (
    <>
      <Box component="canvas" ref={canvasRef} aria-hidden data-testid="follow-stamp-canvas" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2 }} />
      <Link
        ref={pillRef}
        href={DEVELOPER.profileUrl}
        target="_blank"
        rel="noopener noreferrer"
        underline="none"
        data-testid="follow-stamp"
        data-phase={phase}
        sx={{
          mr: 'auto', position: 'relative', zIndex: 3, display: 'inline-flex', alignItems: 'center', gap: 1, height: 36, pl: 0.5, pr: 1.5, borderRadius: 4.5,
          border: '1px solid', borderColor: 'primary.main', backgroundColor: 'background.default', color: 'text.primary', fontSize: '0.8125rem', fontWeight: 600, whiteSpace: 'nowrap',
          transformOrigin: '12% 50%', visibility: phase === 'wait' ? 'hidden' : 'visible',
          animation: phase === 'landed' && !still ? `${land} 3.2s cubic-bezier(0.2, 0.9, 0.3, 1) both` : 'none',
          '&:hover': { backgroundColor: 'action.hover' },
        }}
      >
        <Box component="img" src={DEVELOPER.avatar} alt="" width={28} height={28} sx={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
        <GitHubIcon sx={{ fontSize: 16 }} />
        {t('bots.follow', { handle: DEVELOPER.handle })}
      </Link>
    </>
  );
};

export default FollowStamp;
