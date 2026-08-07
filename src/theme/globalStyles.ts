import type { Theme } from '@mui/material/styles';

/**
 * Global CSS styles for the application.
 * Returns a function that receives the theme for theme-aware values.
 */
export const globalStyles = (theme: Theme) => ({
  '*': {
    boxSizing: 'border-box',
    margin: 0,
    padding: 0,
  },
  html: {
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
    height: '100%',
    width: '100%',
  },
  body: {
    height: '100%',
    width: '100%',
    backgroundColor: theme.palette.background.default,
  },
  '#root': {
    height: '100%',
    width: '100%',
  },
  /* Selection color */
  '::selection': {
    backgroundColor: 'rgba(114, 137, 218, 0.5)',
    color: theme.palette.mode === 'dark' ? '#ffffff' : '#2e3338',
  },
  /* Link styling */
  a: {
    color: theme.palette.mode === 'dark' ? '#00b0f4' : '#0067e0',
    textDecoration: 'none',
    transition: 'color 200ms ease',
    '&:hover': {
      textDecoration: 'underline',
      color: theme.palette.mode === 'dark' ? '#00d4ff' : '#004db3',
    },
  },
  /* Glassmorphism utility classes */
  '.glass': {
    backgroundColor: theme.palette.backgroundGlass,
    backdropFilter: 'blur(12px) saturate(150%)',
    WebkitBackdropFilter: 'blur(12px) saturate(150%)',
    border: `1px solid ${theme.palette.divider}`,
    boxShadow: theme.palette.mode === 'dark' ? '0 8px 32px rgba(0, 0, 0, 0.4)' : '0 8px 32px rgba(0, 0, 0, 0.08)',
  },
  '.glass-strong': {
    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(40, 43, 48, 0.85)' : 'rgba(255, 255, 255, 0.9)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    border: `1px solid ${theme.palette.divider}`,
  },
  '.glass-subtle': {
    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(40, 43, 48, 0.5)' : 'rgba(255, 255, 255, 0.6)',
    backdropFilter: 'blur(8px) saturate(120%)',
    WebkitBackdropFilter: 'blur(8px) saturate(120%)',
    border: `1px solid ${theme.palette.divider}`,
  },
  /* Animation keyframes */
  '@keyframes shimmer': {
    '0%': { backgroundPosition: '-1000px 0' },
    '100%': { backgroundPosition: '1000px 0' },
  },
  '@keyframes pulse-glow': {
    '0%, 100%': {
      boxShadow: '0 0 20px rgba(114, 137, 218, 0.3)',
      transform: 'scale(1)',
    },
    '50%': {
      boxShadow: '0 0 40px rgba(114, 137, 218, 0.6)',
      transform: 'scale(1.02)',
    },
  },
  '@keyframes slide-in-bottom': {
    '0%': { opacity: 0, transform: 'translateY(20px)' },
    '100%': { opacity: 1, transform: 'translateY(0)' },
  },
  '@keyframes fade-in-scale': {
    '0%': { opacity: 0, transform: 'scale(0.95)' },
    '100%': { opacity: 1, transform: 'scale(1)' },
  },
  '@keyframes gradient-shift': {
    '0%': { backgroundPosition: '0% 50%' },
    '50%': { backgroundPosition: '100% 50%' },
    '100%': { backgroundPosition: '0% 50%' },
  },
  '@keyframes gold-shimmer': {
    '0%': { backgroundPosition: '0% 50%' },
    '50%': { backgroundPosition: '100% 50%' },
    '100%': { backgroundPosition: '0% 50%' },
  },
  '@keyframes prismatic-border': {
    '0%': { backgroundPosition: '0% 50%' },
    '33%': { backgroundPosition: '100% 50%' },
    '66%': { backgroundPosition: '50% 100%' },
    '100%': { backgroundPosition: '0% 50%' },
  },
  '@keyframes sparkle-hover': {
    '0%': { boxShadow: '0 6px 32px rgba(0, 212, 255, 0.2)' },
    '50%': { boxShadow: '0 6px 40px rgba(185, 242, 255, 0.4), 0 0 48px rgba(0, 212, 255, 0.25)' },
    '100%': { boxShadow: '0 6px 32px rgba(0, 212, 255, 0.2)' },
  },
  /* Shimmer loading utility */
  '.shimmer-loading': {
    background: `linear-gradient(90deg, ${theme.palette.background.paper} 0%, ${theme.palette.backgroundElevated} 50%, ${theme.palette.background.paper} 100%)`,
    backgroundSize: '1000px 100%',
    animation: 'shimmer 2s infinite linear',
  },
  /* Reduced motion support for accessibility */
  '@media (prefers-reduced-motion: reduce)': {
    '*': {
      animationDuration: '0.01ms !important',
      animationIterationCount: '1 !important',
      transitionDuration: '0.01ms !important',
    },
  },
  /* Focus-visible for accessibility */
  '*:focus-visible': {
    outline: `2px solid ${theme.palette.primary.main}`,
    outlineOffset: '2px',
    boxShadow: `0 0 0 4px ${theme.palette.mode === 'dark' ? 'rgba(114, 137, 218, 0.3)' : 'rgba(88, 101, 242, 0.2)'}`,
  },
});

export default globalStyles;
