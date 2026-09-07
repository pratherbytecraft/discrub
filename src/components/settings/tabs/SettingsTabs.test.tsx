import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, renderWithProviders } from '@/test/test-utils';
import type { ReactElement } from 'react';
import {
  OperationDelaysTab,
  SAFEST_COLOR,
  buildRailGradient,
  secondsToSlider,
  sliderToSeconds,
  type DelaySliderConfig,
} from './OperationDelaysTab';

// The tabs read custom palette tokens (cta) that only exist on the app's
// registry themes, and DisplayTab's embedded ThemePicker dispatches
// live-preview actions, so render under the full provider stack.
const render = (ui: ReactElement) => renderWithProviders(ui);
import { ExportPreferencesTab } from './ExportPreferencesTab';
import { DisplayTab } from './DisplayTab';
import { UserDataTab } from './UserDataTab';
import { PurgeTab } from './PurgeTab';
import { defaultSettings } from '@features/app/appSlice';
import { DiscrubSetting } from 'discrub-core/discrub-enum';

// MUI Select renders InputLabel text twice (label + notched outline legend).
// Use getAllByText and check length >= 1 for label presence, or query by role.

describe('OperationDelaysTab', () => {
  it('should render three sliders for delays', () => {
    render(<OperationDelaysTab formValues={defaultSettings} onChange={vi.fn()} />);
    const sliders = screen.getAllByRole('slider');
    expect(sliders.length).toBe(3);
  });

  it('renders the rest-breaks switch on by default and reports a toggle as "false"', () => {
    const onChange = vi.fn();
    render(<OperationDelaysTab formValues={defaultSettings} onChange={onChange} />);
    const toggle = screen.getByRole('checkbox', { name: 'Rest breaks' });
    expect(toggle).toBeChecked();
    expect(screen.getByText(/Pause for 10 minutes after every 45 minutes of activity/)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(DiscrubSetting.REST_BREAKS, 'false');
  });

  it('shows the rest-breaks switch off when the setting is "false"', () => {
    render(
      <OperationDelaysTab
        formValues={{ ...defaultSettings, [DiscrubSetting.REST_BREAKS]: 'false' }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Rest breaks' })).not.toBeChecked();
  });

  it('should render rate-limiting info alert', () => {
    render(<OperationDelaysTab formValues={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByText(/These delays prevent Discord rate-limit errors/)).toBeInTheDocument();
  });

  it('should show effective delay ranges', () => {
    render(<OperationDelaysTab formValues={defaultSettings} onChange={vi.fn()} />);
    // The modifier only adds (calculateRandomDelay = base + random(0..modifier)),
    // so the range starts at the base, never below it.
    // Search: 1s base, 0.5s modifier gives "Effective delay: 1s to 1.5s"
    // Delete: 2s base, 0.5s modifier gives "Effective delay: 2s to 2.5s"
    const ranges = screen.getAllByText(/Effective delay:/);
    expect(ranges.length).toBe(2);
    expect(screen.getByText('Effective delay: 1s to 1.5s')).toBeInTheDocument();
    expect(screen.getByText('Effective delay: 2s to 2.5s')).toBeInTheDocument();
  });

  it('should display default delay values', () => {
    render(<OperationDelaysTab formValues={defaultSettings} onChange={vi.fn()} />);
    // Sliders show current values — search=1s, delete=2s, modifier=0.5s
    const sliders = screen.getAllByRole('slider');
    expect(sliders[0]).toHaveAttribute('aria-valuenow', '1');
    expect(sliders[1]).toHaveAttribute('aria-valuenow', '2');
    expect(sliders[2]).toHaveAttribute('aria-valuenow', '0.5');
  });

  it('should display slider labels', () => {
    render(<OperationDelaysTab formValues={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByText('Search Delay')).toBeInTheDocument();
    expect(screen.getByText('Delete / Edit Delay')).toBeInTheDocument();
    expect(screen.getByText('Delay Modifier')).toBeInTheDocument();
  });

  it('should show recommended zone labels', () => {
    render(<OperationDelaysTab formValues={defaultSettings} onChange={vi.fn()} />);
    // Default values are in recommended range
    const recommendedLabels = screen.getAllByText('Recommended');
    expect(recommendedLabels.length).toBeGreaterThanOrEqual(2);
  });

  it('should show risky zone label when value is 0', () => {
    const settings = {
      ...defaultSettings,
      [DiscrubSetting.SEARCH_DELAY]: '0',
    };
    render(<OperationDelaysTab formValues={settings} onChange={vi.fn()} />);
    expect(screen.getByText('Risky')).toBeInTheDocument();
  });

  it('should show low zone label when below recommended range', () => {
    const settings = {
      ...defaultSettings,
      [DiscrubSetting.SEARCH_DELAY]: '0.5',
    };
    render(<OperationDelaysTab formValues={settings} onChange={vi.fn()} />);
    expect(screen.getByText('Low')).toBeInTheDocument();
  });

  it('should show safe zone label when above recommended range', () => {
    const settings = {
      ...defaultSettings,
      [DiscrubSetting.SEARCH_DELAY]: '8',
    };
    render(<OperationDelaysTab formValues={settings} onChange={vi.fn()} />);
    expect(screen.getByText('Safe')).toBeInTheDocument();
  });

  describe('Safest zone (above 10s, up to 30s)', () => {
    const config: DelaySliderConfig = {
      key: DiscrubSetting.SEARCH_DELAY,
      labelKey: 'x', descriptionKey: 'x',
      min: 0, max: 10, step: 0.1,
      recommendedMin: 1, recommendedMax: 3,
      safest: { from: 10, to: 30, step: 0.5 },
    };

    it('shows the Safest label and color past 10s', () => {
      const settings = { ...defaultSettings, [DiscrubSetting.SEARCH_DELAY]: '15' };
      render(<OperationDelaysTab formValues={settings} onChange={vi.fn()} />);
      const label = screen.getByText('Safest');
      expect(label).toBeInTheDocument();
      expect(label).toHaveStyle({ color: SAFEST_COLOR });
      expect(screen.getAllByText('15s').length).toBeGreaterThanOrEqual(1);
    });

    it('applies to the delete slider too', () => {
      const settings = { ...defaultSettings, [DiscrubSetting.DELETE_DELAY]: '30' };
      render(<OperationDelaysTab formValues={settings} onChange={vi.fn()} />);
      expect(screen.getByText('Safest')).toBeInTheDocument();
      expect(screen.getAllByText('30s').length).toBeGreaterThanOrEqual(1);
    });

    it('keeps the Safe label at exactly 10s', () => {
      const settings = { ...defaultSettings, [DiscrubSetting.SEARCH_DELAY]: '10' };
      render(<OperationDelaysTab formValues={settings} onChange={vi.fn()} />);
      expect(screen.getAllByText('Safe').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('Safest')).not.toBeInTheDocument();
    });

    it('extends the search and delete sliders to 30s but leaves the modifier at 5s', () => {
      render(<OperationDelaysTab formValues={defaultSettings} onChange={vi.fn()} />);
      const maxes = screen.getAllByRole('slider').map((el) => el.getAttribute('aria-valuemax'));
      expect(maxes).toEqual(['30', '30', '5']);
    });

    it('reports the slider position in seconds after the compressed stretch', () => {
      const onChange = vi.fn();
      render(<OperationDelaysTab formValues={defaultSettings} onChange={onChange} />);
      const [search] = screen.getAllByRole('slider');
      // The rail's last tick is 14 (10 ticks of 0.1s, then 4 ticks worth 5s each): 30s.
      fireEvent.change(search, { target: { value: '14' } });
      expect(onChange).toHaveBeenCalledWith(DiscrubSetting.SEARCH_DELAY, '30.0');
      fireEvent.change(search, { target: { value: '12' } });
      expect(onChange).toHaveBeenCalledWith(DiscrubSetting.SEARCH_DELAY, '20.0');
      fireEvent.change(search, { target: { value: '7' } });
      expect(onChange).toHaveBeenCalledWith(DiscrubSetting.SEARCH_DELAY, '7.0');
    });

    it('maps seconds to slider ticks and back (0.1s ticks below 10s, 0.5s above)', () => {
      expect(secondsToSlider(5, config)).toBe(5);
      expect(secondsToSlider(10, config)).toBe(10);
      expect(secondsToSlider(20, config)).toBeCloseTo(12);
      expect(secondsToSlider(30, config)).toBeCloseTo(14);
      expect(secondsToSlider(45, config)).toBeCloseTo(14);
      expect(sliderToSeconds(5, config)).toBe(5);
      expect(sliderToSeconds(10.1, config)).toBe(10.5);
      expect(sliderToSeconds(12, config)).toBe(20);
      expect(sliderToSeconds(14, config)).toBe(30);
      expect(sliderToSeconds(14.5, config)).toBe(30);
      for (const secs of [0, 0.3, 7.7, 10, 12.5, 29.5, 30]) {
        expect(sliderToSeconds(secondsToSlider(secs, config), config)).toBeCloseTo(secs);
      }
    });

    it('is the identity for sliders without a Safest zone', () => {
      const plain = { ...config, safest: undefined };
      expect(secondsToSlider(4.2, plain)).toBe(4.2);
      expect(sliderToSeconds(4.2, plain)).toBe(4.2);
      expect(buildRailGradient(plain, '#5865f2')).not.toContain(SAFEST_COLOR);
    });

    it('ends the rail gradient in the Safest color, starting where the blue zone ends', () => {
      const gradient = buildRailGradient(config, '#5865f2');
      // 10s sits at tick 10 of 14 on the rail.
      expect(gradient).toContain(`#5865f2 ${(10 / 14) * 100}%`);
      expect(gradient).toContain(`${SAFEST_COLOR} 100%`);
    });
  });
});

describe('ExportPreferencesTab', () => {
  it('should render checkbox controls', () => {
    render(<ExportPreferencesTab formValues={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/Separate threads/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Artist mode/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Preview media in export/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Download files for offline viewing/)).toBeInTheDocument();
  });

  it('should render sort order select and messages per page slider', () => {
    render(<ExportPreferencesTab formValues={defaultSettings} onChange={vi.fn()} />);
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(1); // Message Sort Order
    expect(screen.getByRole('slider')).toBeInTheDocument(); // Messages Per Page
  });

  it('should render media type toggle chips', () => {
    render(<ExportPreferencesTab formValues={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByText('Images')).toBeInTheDocument();
    expect(screen.getByText('Videos')).toBeInTheDocument();
    expect(screen.getByText('Audio')).toBeInTheDocument();
    expect(screen.getByText('Other files')).toBeInTheDocument();
  });

  it('should render section headers', () => {
    render(<ExportPreferencesTab formValues={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.getByText('Files & Media')).toBeInTheDocument();
    expect(screen.getByText('Display')).toBeInTheDocument();
  });

  it('should call onChange when a checkbox is toggled', () => {
    const onChange = vi.fn();
    render(<ExportPreferencesTab formValues={defaultSettings} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Artist mode/));
    expect(onChange).toHaveBeenCalledWith(DiscrubSetting.EXPORT_ARTIST_MODE, 'true');
  });

  it('should call onChange when a media type chip is clicked', () => {
    const onChange = vi.fn();
    render(<ExportPreferencesTab formValues={defaultSettings} onChange={onChange} />);
    fireEvent.click(screen.getByText('Images'));
    expect(onChange).toHaveBeenCalledWith(DiscrubSetting.EXPORT_MEDIA_IMAGES, 'false');
  });

  it('should show messages per page default value on slider', () => {
    render(<ExportPreferencesTab formValues={defaultSettings} onChange={vi.fn()} />);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('aria-valuenow', '500');
  });
});

describe('DisplayTab', () => {
  it('should render four select controls', () => {
    render(<DisplayTab formValues={defaultSettings} onChange={vi.fn()} />);
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(4); // Language + Date Format + Time Format + DM List Order
  });

  it('should display default format values', () => {
    render(<DisplayTab formValues={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByText('MM/DD/YYYY')).toBeInTheDocument();
    expect(screen.getByText('12 Hour (AM/PM)')).toBeInTheDocument();
  });

  it('should call onChange when Date Format select is changed', () => {
    const onChange = vi.fn();
    render(<DisplayTab formValues={defaultSettings} onChange={onChange} />);
    const selects = screen.getAllByRole('combobox');
    fireEvent.mouseDown(selects[1]);
    fireEvent.click(screen.getByText('DD/MM/YYYY'));
    expect(onChange).toHaveBeenCalledWith(DiscrubSetting.DATE_FORMAT, expect.any(String));
  });
});

describe('UserDataTab', () => {
  it('should render checkbox controls', () => {
    render(<UserDataTab formValues={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Enable reactions')).toBeInTheDocument();
    expect(screen.getByLabelText('Look up server nicknames')).toBeInTheDocument();
    expect(screen.getByLabelText('Look up display names')).toBeInTheDocument();
  });

  it('should render one select control for refresh rate', () => {
    render(<UserDataTab formValues={defaultSettings} onChange={vi.fn()} />);
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(1);
  });

  it('should display default refresh rate value', () => {
    render(<UserDataTab formValues={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByText('Daily')).toBeInTheDocument();
  });

  it('should call onChange when a checkbox is toggled', () => {
    const onChange = vi.fn();
    render(<UserDataTab formValues={defaultSettings} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Enable reactions'));
    expect(onChange).toHaveBeenCalledWith(DiscrubSetting.REACTIONS_ENABLED, 'false');
  });
});

describe('PurgeTab', () => {
  it('should render warning alert', () => {
    render(<PurgeTab formValues={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByText(/control default behavior for purge operations/)).toBeInTheDocument();
  });

  it('should render purge mode radio buttons', () => {
    render(<PurgeTab formValues={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Delete Messages')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove Reactions')).toBeInTheDocument();
  });

  it('should default to Messages mode', () => {
    render(<PurgeTab formValues={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Delete Messages')).toBeChecked();
  });

  it('should render retain media checkbox', () => {
    render(<PurgeTab formValues={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Clear text, keep attachments')).toBeInTheDocument();
  });

  it('should call onChange when retain media checkbox is toggled', () => {
    const onChange = vi.fn();
    render(<PurgeTab formValues={defaultSettings} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Clear text, keep attachments'));
    expect(onChange).toHaveBeenCalledWith(DiscrubSetting.PURGE_RETAIN_ATTACHED_MEDIA, 'true');
  });
});
