import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  afterEach(() => { vi.useRealTimers(); });

  it('groups the cards, Standard then Holiday then an empty Commissioned, out of season (2.2.3)', () => {
    vi.setSystemTime(new Date(2026, 8, 15));
    renderGrid();
    const sections = screen.getAllByTestId(/^theme-group-section-/).map((el) => el.getAttribute('data-testid'));
    expect(sections).toEqual(['theme-group-section-standard', 'theme-group-section-holiday', 'theme-group-section-commissioned']);
    expect(screen.getByTestId('theme-group-section-standard')).toContainElement(screen.getByTestId('theme-card-auto'));
    expect(screen.getByTestId('theme-group-section-holiday')).toContainElement(screen.getByTestId('theme-card-halloween-26'));
    expect(screen.getByTestId('theme-locked-halloween-26')).toBeInTheDocument();
    expect(screen.getByTestId('theme-group-empty-commissioned')).toHaveTextContent('Nothing here yet.');
    expect(screen.queryByTestId('theme-group-holiday-open')).toBeNull();
  });

  it('leads with Holiday and unlocks the holiday theme for everyone in season (2.2.3)', () => {
    vi.setSystemTime(new Date(2026, 9, 10));
    renderGrid();
    const sections = screen.getAllByTestId(/^theme-group-section-/).map((el) => el.getAttribute('data-testid'));
    expect(sections[0]).toBe('theme-group-section-holiday');
    expect(screen.queryByTestId('theme-locked-halloween-26')).toBeNull();
    expect(screen.getByTestId('theme-group-holiday-open')).toHaveTextContent("Halloween '26 is open to everyone through November 2.");
    fireEvent.click(screen.getByTestId('theme-card-halloween-26'));
    expect(onChange).toHaveBeenCalledWith('halloween-26');
  });

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

  it('has no eye without onPreview, and with it only locked cards get one', () => {
    const { unmount } = renderGrid({ value: 'auto', descriptors: rosterWithSupporter });
    expect(screen.queryByTestId('theme-preview-discord-light')).not.toBeInTheDocument();
    expect(screen.queryByTestId('theme-preview-test-supporter')).not.toBeInTheDocument();
    unmount();
    const onPreview = vi.fn();
    renderGrid({ value: 'auto', descriptors: rosterWithSupporter, onPreview });
    expect(screen.queryByTestId('theme-preview-discord-light')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('theme-preview-test-supporter'));
    expect(onPreview).toHaveBeenCalledWith('test-supporter');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a supporter sees no eye at all', () => {
    renderGrid({ value: 'auto', descriptors: rosterWithSupporter, isSupporter: true, onPreview: vi.fn() });
    expect(screen.queryByTestId('theme-preview-test-supporter')).not.toBeInTheDocument();
  });

  it('marks the current card by name as well as by check', () => {
    renderGrid({ value: 'discord-light' });
    expect(screen.getByTestId('theme-current-discord-light')).toHaveTextContent('Light Original');
    expect(screen.queryByTestId('theme-current-auto')).not.toBeInTheDocument();
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
