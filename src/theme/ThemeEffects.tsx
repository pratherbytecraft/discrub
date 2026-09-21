import { Box, GlobalStyles, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useAppSelector } from '@/app/hooks';
import { selectSetting } from '@features/app/appSlice';
import { selectIsHeavyOperationRunning } from '@features/app/operationSelectors';
import { DiscrubSetting } from 'discrub-core/discrub-enum';

/**
 * Whole-app effects for themes that carry them. Abstract is the only one
 * (2.2.0): headings melt, buttons twist on hover, a misprint colour split
 * on titles, and two dim colour clouds drift across the app.
 *
 * Performance rules this file keeps:
 * - Every moving thing animates `transform` or `opacity` only.
 * - The melt is a fixed SVG warp on headings. The filter never animates.
 * - Idle sway is limited to controls (buttons, tabs, toggles, chips).
 * - Nothing in the message feed or the long lists moves while idle, so
 *   scrolling a big channel costs what it costs in any other theme.
 * - Idle motion stops with APP_THEME_ANIMATIONS off, with reduced motion
 *   on, and while a heavy operation runs. The look itself stays.
 */
const abstractLook = {
  // Misprint: a cyan and magenta edge on titles.
  '.MuiDialogTitle-root, .MuiTypography-h4, .MuiTypography-h5, .MuiTypography-h6': {
    textShadow: '-1px 0 rgba(34, 200, 214, 0.75), 1px 0 rgba(214, 59, 189, 0.75)',
  },
  '.MuiTypography-h4, .MuiTypography-h5, .MuiTypography-h6, .MuiDialogTitle-root, .MuiTypography-overline, .MuiTypography-subtitle1': { filter: 'url(#abstract-melt)' },
  'body .MuiPaper-rounded, body .MuiOutlinedInput-root': { transition: 'transform 700ms cubic-bezier(0.3, 1.6, 0.5, 1)' },
  'body .MuiOutlinedInput-root:hover, body .MuiOutlinedInput-root.Mui-focused': { transform: 'skewX(-1.5deg)' },
  // The same warp everywhere, not only on headings (owner, 2026-09-21). Long
  // lists get a fixed lean per row, which costs nothing; only short text gets the softer warp filter.
  // Message text and author names stay plain so a channel is still easy to read.
  '.MuiListItemText-primary, .MuiTab-root, .MuiFormLabel-root, .MuiButton-root, .MuiToggleButton-root, .MuiChip-label': { filter: 'url(#abstract-melt-soft)' },
  '.MuiListItemText-primary, .MuiTab-root': { textShadow: '-0.5px 0 rgba(34, 200, 214, 0.6), 0.5px 0 rgba(214, 59, 189, 0.6)' },
  'body .MuiListItemButton-root, body [data-testid="message-feed-row"]': { transition: 'transform 600ms cubic-bezier(0.3, 1.6, 0.5, 1), background-color 250ms' },
  'body .MuiListItemButton-root:nth-of-type(3n)': { transform: 'skewX(-0.8deg)' },
  'body .MuiListItemButton-root:nth-of-type(3n+1)': { transform: 'skewX(0.6deg)' },
  'body .MuiListItemButton-root:nth-of-type(3n+2)': { transform: 'rotate(-0.15deg)' },
  'body .MuiListItemButton-root:hover': { transform: 'skewX(-1.5deg) translateX(1px)' },
  'body [data-testid="message-feed-row"]:hover': { transform: 'skewX(-0.75deg) translateX(1px)' },
  'body .MuiOutlinedInput-root': { borderRadius: '9px 15px 8px 17px', transform: 'skewX(-1deg)' },
  // Buttons lean toward the pointer and buckle when pressed. The `body` prefix
  // outranks MUI's own transition on the button, which would otherwise make the twist snap.
  'body .MuiButton-root': { borderRadius: '9px 15px 8px 17px', transition: 'transform 600ms cubic-bezier(0.3, 1.6, 0.5, 1), background-color 250ms, box-shadow 250ms, border-color 250ms' },
  'body .MuiButton-root:hover, body .MuiButton-root.Mui-focusVisible': { transform: 'perspective(300px) rotateX(4deg) rotateZ(-0.8deg) skewX(-2deg) scale(1.01)' },
  'body .MuiButton-root:active': { transform: 'perspective(300px) rotateX(-5deg) rotateZ(1deg) scale(0.99)' },
  'body .MuiIconButton-root': { transition: 'transform 550ms cubic-bezier(0.3, 1.6, 0.5, 1), background-color 250ms' },
  'body .MuiIconButton-root:hover': { transform: 'rotate(-2.5deg) scale(1.03)' },
  'body .MuiToggleButton-root, body .MuiChip-root, body .MuiTab-root': { transition: 'transform 550ms cubic-bezier(0.3, 1.6, 0.5, 1), background-color 250ms, color 250ms' },
  'body .MuiToggleButton-root:hover, body .MuiChip-root:hover, body .MuiTab-root:hover': { transform: 'skewX(-2deg) rotate(-0.4deg)' },
  'body .MuiPaper-rounded': { borderRadius: '10px 16px 9px 18px' },
  '.MuiAvatar-root': { borderRadius: '42% 58% 55% 45% / 48% 42% 58% 52%' },
  '@keyframes abstract-drift-a': { to: { transform: 'translate(28%, 18%) scale(1.25)' } },
  '@keyframes abstract-drift-b': { to: { transform: 'translate(-30%, -22%) scale(0.8)' } },
  // Idle sway uses the separate rotate and translate properties, so it adds to the hover transform instead of replacing it.
  '@keyframes abstract-sway': { from: { rotate: '-0.5deg', translate: '0 -0.5px' }, to: { rotate: '0.6deg', translate: '0 0.5px' } },
  '@keyframes abstract-lean': { from: { rotate: '0.5deg', translate: '-0.5px 0' }, to: { rotate: '-0.5deg', translate: '0.5px -0.5px' } },
  '@keyframes abstract-drip': { from: { transform: 'scaleY(1)' }, to: { transform: 'scaleY(1.06) skewX(-1.5deg)' } },
};
const abstractMotion = {
  // Only controls sway: buttons, tabs, toggles and chips. Their count is small and fixed, unlike message rows.
  'body .MuiButton-root, body .MuiTab-root, body .MuiToggleButton-root': { animation: 'abstract-sway 6s ease-in-out infinite alternate' },
  'body .MuiButton-root:nth-of-type(2n), body .MuiTab-root:nth-of-type(2n), body .MuiToggleButton-root:nth-of-type(2n), body .MuiChip-root': { animation: 'abstract-lean 7.5s ease-in-out infinite alternate' },
  'body .MuiIconButton-root': { animation: 'abstract-lean 9s ease-in-out infinite alternate' },
  'body .MuiIconButton-root:nth-of-type(2n)': { animation: 'abstract-sway 8s ease-in-out infinite alternate-reverse' },
  '.MuiTypography-h4, .MuiTypography-h5, .MuiTypography-h6': { transformOrigin: '50% 0', animation: 'abstract-drip 8s ease-in-out infinite alternate' },
};
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")";

const ThemeEffects = () => {
  const theme = useTheme();
  const animations = useAppSelector(selectSetting(DiscrubSetting.APP_THEME_ANIMATIONS));
  const busy = useAppSelector(selectIsHeavyOperationRunning);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  if (theme.themeEffects !== 'abstract') return null;
  const moving = animations !== 'false' && !busy && !reducedMotion;
  const cloud = (color: string, place: object, name: string, seconds: number) => (
    <Box sx={{ position: 'absolute', width: '55%', height: '55%', borderRadius: '50%', filter: 'blur(80px)', backgroundColor: color, willChange: moving ? 'transform' : undefined, animation: moving ? `${name} ${seconds}s ease-in-out infinite alternate` : 'none', ...place }} />
  );
  return (
    <>
      <GlobalStyles styles={abstractLook} />
      {moving && <GlobalStyles styles={abstractMotion} />}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <filter id="abstract-melt" x="-5%" y="-10%" width="110%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.09" numOctaves="1" seed="4" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="abstract-melt-soft" x="-3%" y="-10%" width="106%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02 0.11" numOctaves="1" seed="9" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      {/* One fixed layer over the app carries all the colour: dim on purpose, it never takes clicks. */}
      <Box aria-hidden data-testid="theme-effects-abstract" data-moving={moving ? 'true' : 'false'} sx={{ position: 'fixed', inset: 0, zIndex: 1190, pointerEvents: 'none', overflow: 'hidden', mixBlendMode: 'screen', opacity: 0.13 }}>
        <Box sx={{ position: 'absolute', inset: '-20%' }}>
          {cloud('#d63bbd', { left: 0, top: '5%' }, 'abstract-drift-a', 23)}
          {cloud('#22c8d6', { right: 0, bottom: 0 }, 'abstract-drift-b', 29)}
        </Box>
        <Box sx={{ position: 'absolute', inset: 0, backgroundImage: GRAIN, opacity: 0.5 }} />
      </Box>
    </>
  );
};

export default ThemeEffects;
