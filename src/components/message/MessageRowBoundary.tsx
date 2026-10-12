import { Component, type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { t } from '@/i18n';
import { store } from '@/app/store';
import { addStatusEntry } from '@features/status/statusSlice';

interface MessageRowBoundaryProps {
  messageId: string;
  children: ReactNode;
}

interface MessageRowBoundaryState {
  failed: boolean;
}

/**
 * Row 124 (pass 2): one row that cannot render shows a line in its place
 * instead of taking the whole feed, and with it the app, down. The
 * boundary resets when the row's message changes.
 */
class MessageRowBoundary extends Component<MessageRowBoundaryProps, MessageRowBoundaryState> {
  state: MessageRowBoundaryState = { failed: false };

  static getDerivedStateFromError(): MessageRowBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    store.dispatch(addStatusEntry({ level: 'error', message: `Row ${this.props.messageId} could not be shown: ${error.message}` }));
  }

  componentDidUpdate(prev: MessageRowBoundaryProps) {
    if (this.state.failed && prev.messageId !== this.props.messageId) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Box data-testid="message-row-failed" sx={{ px: 2, py: 0.5 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
          {t('feed.rowCouldNotBeShown')}
        </Typography>
      </Box>
    );
  }
}

export default MessageRowBoundary;
