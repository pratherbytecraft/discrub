import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { Box, Typography, Button, keyframes } from '@mui/material';
import ghost from '@features/scrublings/sprites/ghost';
import { frameDataUri } from '@features/scrublings/spriteRender';
import { SPRITE_H, SPRITE_W } from '@features/scrublings/spriteTypes';

/** The Ghost on the fallback page (2.2.1): idle frames stepped by CSS, no scheduler and no store. */
const ghostIdle = keyframes`
  0%, 49% { background-image: url("${frameDataUri(ghost, 'idle1')}"); }
  50%, 100% { background-image: url("${frameDataUri(ghost, 'idle2')}"); }
`;
import { store } from '@/app/store';
import { addStatusEntry } from '@features/status/statusSlice';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary — catches render crashes in the component tree.
 * Logs the error to the status log and shows a recovery UI.
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const componentStack = info.componentStack?.split('\n')[1]?.trim() || '';
    store.dispatch(
      addStatusEntry({
        level: 'error',
        message: `Render crash: ${error.message}${componentStack ? ` (${componentStack})` : ''}`,
      })
    );
  }

  handleRecover = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            gap: 2,
            p: 4,
            textAlign: 'center',
            bgcolor: 'background.default',
            color: 'text.primary',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1.5 }}>
            <Box sx={{ position: 'relative' }}>
              <Box
                data-testid="error-ghost"
                aria-hidden
                sx={{ width: SPRITE_W * 3, height: SPRITE_H * 3, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat', imageRendering: 'pixelated', backgroundImage: `url("${frameDataUri(ghost, 'idle1')}")`, animation: `${ghostIdle} 1.2s steps(1) infinite`, '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }}
              />
              <Box aria-hidden sx={{ position: 'absolute', left: '50%', top: -6, transform: 'translateX(-50%)', whiteSpace: 'nowrap', color: '#ffff00', font: '700 11px/12px ui-monospace, Menlo, monospace', textShadow: '1px 0 #000, -1px 0 #000, 0 1px #000, 0 -1px #000, 1px 1px #000, -1px -1px #000, 1px -1px #000, -1px 1px #000' }}>
                Wasn&apos;t me.
              </Box>
            </Box>
            <Typography variant="h5" sx={{ fontWeight: 600 }}>
              Something went wrong
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 400 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </Typography>
          <Button variant="contained" onClick={this.handleRecover}>
            Try Again
          </Button>
        </Box>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
