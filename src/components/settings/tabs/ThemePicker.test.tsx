import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, renderWithProviders } from '@/test/test-utils';
import ThemeGrid from './ThemePicker';
import { THEME_DESCRIPTORS, type ThemeDescriptor } from '@/theme/theme';

const supporterDescriptor: ThemeDescriptor = {
  id: 'test-supporter',
  name: 'Test Supporter',
  base: 'dark',
  tier: 'supporter',
  palette: THEME_DESCRIPTORS[0].palette,
};

const rosterWithSupporter = [...THEME_DESCRIPTORS, supporterDescriptor];

describe('ThemeGrid', () => {
  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onChange = vi.fn();
  });

  const renderGrid = (props: Partial<React.ComponentProps<typeof ThemeGrid>> = {}) =>
    renderWithProviders(<ThemeGrid value="auto" onChange={onChange} {...props} />);

  it('renders the Auto card plus one card per registry theme', () => {
    renderGrid();
    expect(screen.getByTestId('theme-card-auto')).toBeInTheDocument();
    for (const d of THEME_DESCRIPTORS) {
      expect(screen.getByTestId(`theme-card-${d.id}`)).toBeInTheDocument();
    }
  });

  it('marks the current form value as selected', () => {
    renderGrid({ value: 'discord-light' });
    expect(screen.getByTestId('theme-selected-discord-light')).toBeInTheDocument();
    expect(screen.queryByTestId('theme-selected-auto')).not.toBeInTheDocument();
  });

  it('resolves legacy alias values to their canonical theme', () => {
    renderGrid({ value: 'dark' });
    expect(screen.getByTestId('theme-selected-discord-dark')).toBeInTheDocument();
  });

  it('treats unknown stored values as auto', () => {
    renderGrid({ value: 'not-a-theme' });
    expect(screen.getByTestId('theme-selected-auto')).toBeInTheDocument();
  });

  it('clicking an unlocked card selects it', () => {
    renderGrid({ value: 'auto' });
    fireEvent.click(screen.getByTestId('theme-card-discord-dark'));
    expect(onChange).toHaveBeenCalledWith('discord-dark');
  });

  it('has no eye button and no preview bar', () => {
    renderGrid({ value: 'auto' });
    expect(screen.queryByTestId('theme-preview-discord-light')).not.toBeInTheDocument();
    expect(screen.queryByTestId('theme-preview-bar')).not.toBeInTheDocument();
  });

  it('shows a lock badge on supporter themes when not a supporter', () => {
    renderGrid({ descriptors: rosterWithSupporter, isSupporter: false });
    expect(screen.getByTestId('theme-locked-test-supporter')).toBeInTheDocument();
  });

  it('clicking a locked card calls onLockedPick instead of selecting', () => {
    const onLockedPick = vi.fn();
    renderGrid({ descriptors: rosterWithSupporter, isSupporter: false, onLockedPick });
    fireEvent.click(screen.getByTestId('theme-card-test-supporter'));
    expect(onLockedPick).toHaveBeenCalledWith('test-supporter');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clicking a locked card without onLockedPick does nothing', () => {
    renderGrid({ descriptors: rosterWithSupporter, isSupporter: false });
    fireEvent.click(screen.getByTestId('theme-card-test-supporter'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('supporter themes unlock when isSupporter is true', () => {
    renderGrid({ descriptors: rosterWithSupporter, isSupporter: true });
    expect(screen.queryByTestId('theme-locked-test-supporter')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('theme-card-test-supporter'));
    expect(onChange).toHaveBeenCalledWith('test-supporter');
  });
});
