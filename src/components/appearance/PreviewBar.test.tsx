import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/test-utils';
import { createBaseState } from '@/test/state-factories';
import PreviewBar from './PreviewBar';

const withPreview = (preview: { layout: 'workbench' | null; theme: string | null }) => {
  const state = createBaseState();
  state.app = { ...state.app, preview };
  return state;
};

describe('<PreviewBar />', () => {
  it('renders nothing when nothing is previewed', () => {
    renderWithProviders(<PreviewBar />, { preloadedState: withPreview({ layout: null, theme: null }) });
    expect(screen.queryByTestId('preview-bar')).toBeNull();
  });

  it('names the layout and theme, has no Apply, and End preview ends it', () => {
    const { store } = renderWithProviders(<PreviewBar />, { preloadedState: withPreview({ layout: 'workbench', theme: 'synthwave' }) });
    expect(screen.getByTestId('preview-bar')).toHaveTextContent('Previewing Workbench · Synthwave');
    expect(screen.queryByTestId('preview-apply')).toBeNull();
    fireEvent.click(screen.getByTestId('preview-end'));
    expect(store.getState().app.preview).toEqual({ layout: null, theme: null });
  });

  it('a click outside the bar ends it', async () => {
    const { store } = renderWithProviders(<><div data-testid="outside">app</div><PreviewBar /></>, { preloadedState: withPreview({ layout: 'workbench', theme: null }) });
    // ClickAwayListener arms itself a tick after mount so the click that opened it never counts.
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(screen.getByTestId('outside'));
    expect(store.getState().app.preview).toEqual({ layout: null, theme: null });
  });

  it('Esc ends it', () => {
    const { store } = renderWithProviders(<PreviewBar />, { preloadedState: withPreview({ layout: null, theme: 'terminal' }) });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(store.getState().app.preview).toEqual({ layout: null, theme: null });
  });
});
