import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { screen, fireEvent, renderWithProviders } from '@/test/test-utils';
import { DisplayTab } from './DisplayTab';

// The embedded ThemePicker dispatches live-preview actions, so the tab
// needs the full provider stack (Redux + app theme).
const render = (ui: ReactElement) => renderWithProviders(ui);
import { defaultSettings } from '@features/app/appSlice';
import { DiscrubSetting, DateFormat, DmSortOrder, TimeFormat } from 'discrub-core/discrub-enum';
import type { AppSettings } from 'discrub-core/types/discrub-types';

// MUI Select renders InputLabel text twice (label + notched outline legend).
// Use getAllByText and check length >= 1 for label presence, or query by role.

describe('DisplayTab', () => {
  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onChange = vi.fn();
  });

  it('renders all display settings controls', () => {
    render(<DisplayTab formValues={defaultSettings} onChange={onChange} />);

    // Four select controls (Language + Date Format + Time Format + DM List Order)
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(4);

    // Description text
    expect(screen.getByText(/Customize how dates, times/)).toBeInTheDocument();

    // Layouts, themes and Scrublings live in the Appearance menu; this tab only says so.
    expect(screen.queryByTestId('theme-picker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('theme-card-auto')).not.toBeInTheDocument();
    expect(screen.queryByTestId('display-layout-block')).not.toBeInTheDocument();
    expect(screen.getByTestId('display-appearance-pointer')).toHaveTextContent('Layouts, themes and Scrublings are under Appearance on the top bar.');
  });

  it('displays default date format value', () => {
    render(<DisplayTab formValues={defaultSettings} onChange={onChange} />);
    // Default is MMDDYYYY
    expect(screen.getByText('MM/DD/YYYY')).toBeInTheDocument();
  });

  it('displays default time format value', () => {
    render(<DisplayTab formValues={defaultSettings} onChange={onChange} />);
    // Default is _12HOUR
    expect(screen.getByText('12 Hour (AM/PM)')).toBeInTheDocument();
  });

  it('date format select shows both options', () => {
    render(<DisplayTab formValues={defaultSettings} onChange={onChange} />);
    const selects = screen.getAllByRole('combobox');
    // First select is Date Format
    fireEvent.mouseDown(selects[1]);
    // "MM/DD/YYYY" appears twice (select trigger + selected menu item), so use getAllByRole
    const options = screen.getAllByRole('option');
    expect(options.length).toBe(2);
    expect(options[0]).toHaveTextContent('MM/DD/YYYY');
    expect(options[1]).toHaveTextContent('DD/MM/YYYY');
  });

  it('time format select shows all 4 options', () => {
    render(<DisplayTab formValues={defaultSettings} onChange={onChange} />);
    const selects = screen.getAllByRole('combobox');
    // Second select is Time Format
    fireEvent.mouseDown(selects[2]);
    // "12 Hour (AM/PM)" appears twice (select trigger + selected menu item), so use getAllByRole
    const options = screen.getAllByRole('option');
    expect(options.length).toBe(4);
    expect(options[0]).toHaveTextContent('12 Hour (AM/PM)');
    expect(options[1]).toHaveTextContent('24 Hour');
    expect(options[2]).toHaveTextContent('12 Hour with Seconds');
    expect(options[3]).toHaveTextContent('24 Hour with Seconds');
  });

  it('changing date format calls onChange with correct key', () => {
    render(<DisplayTab formValues={defaultSettings} onChange={onChange} />);
    const selects = screen.getAllByRole('combobox');
    fireEvent.mouseDown(selects[1]);
    fireEvent.click(screen.getByText('DD/MM/YYYY'));
    expect(onChange).toHaveBeenCalledWith(DiscrubSetting.DATE_FORMAT, expect.any(String));
  });

  it('changing time format calls onChange with correct key', () => {
    render(<DisplayTab formValues={defaultSettings} onChange={onChange} />);
    const selects = screen.getAllByRole('combobox');
    fireEvent.mouseDown(selects[2]);
    fireEvent.click(screen.getByText('24 Hour'));
    expect(onChange).toHaveBeenCalledWith(DiscrubSetting.TIME_FORMAT, expect.any(String));
  });

  it('selecting "12 Hour with Seconds" calls onChange with correct key', () => {
    render(<DisplayTab formValues={defaultSettings} onChange={onChange} />);
    const selects = screen.getAllByRole('combobox');
    fireEvent.mouseDown(selects[2]);
    fireEvent.click(screen.getByText('12 Hour with Seconds'));
    expect(onChange).toHaveBeenCalledWith(DiscrubSetting.TIME_FORMAT, expect.any(String));
  });

  it('selecting "24 Hour with Seconds" calls onChange with correct key', () => {
    render(<DisplayTab formValues={defaultSettings} onChange={onChange} />);
    const selects = screen.getAllByRole('combobox');
    fireEvent.mouseDown(selects[2]);
    fireEvent.click(screen.getByText('24 Hour with Seconds'));
    expect(onChange).toHaveBeenCalledWith(DiscrubSetting.TIME_FORMAT, expect.any(String));
  });

  it('dm list order select shows all 3 options with recent as default', () => {
    render(<DisplayTab formValues={defaultSettings} onChange={onChange} />);
    expect(screen.getByText('Recent activity')).toBeInTheDocument();
    const selects = screen.getAllByRole('combobox');
    // Third select is DM List Order
    fireEvent.mouseDown(selects[3]);
    const options = screen.getAllByRole('option');
    expect(options.length).toBe(3);
    expect(options[0]).toHaveTextContent('Recent activity');
    expect(options[1]).toHaveTextContent('Name');
    expect(options[2]).toHaveTextContent("Discord's order");
  });

  it('changing dm list order calls onChange with correct key', () => {
    render(<DisplayTab formValues={defaultSettings} onChange={onChange} />);
    const selects = screen.getAllByRole('combobox');
    fireEvent.mouseDown(selects[3]);
    fireEvent.click(screen.getByText('Name'));
    expect(onChange).toHaveBeenCalledWith(
      DiscrubSetting.APP_DM_SORT_ORDER,
      DmSortOrder.NAME,
    );
  });

  it('displays DD/MM/YYYY when formValues has DDMMYYYY date format', () => {
    const settings: AppSettings = {
      ...defaultSettings,
      [DiscrubSetting.DATE_FORMAT]: DateFormat.DDMMYYYY,
    };
    render(<DisplayTab formValues={settings} onChange={onChange} />);
    expect(screen.getByText('DD/MM/YYYY')).toBeInTheDocument();
  });

  it('displays 24 Hour when formValues has _24HOUR time format', () => {
    const settings: AppSettings = {
      ...defaultSettings,
      [DiscrubSetting.TIME_FORMAT]: TimeFormat._24HOUR,
    };
    render(<DisplayTab formValues={settings} onChange={onChange} />);
    expect(screen.getByText('24 Hour')).toBeInTheDocument();
  });

  it('renders helper text for date format', () => {
    render(<DisplayTab formValues={defaultSettings} onChange={onChange} />);
    expect(screen.getByText('How dates are formatted throughout the application')).toBeInTheDocument();
  });

  it('renders helper text for time format', () => {
    render(<DisplayTab formValues={defaultSettings} onChange={onChange} />);
    expect(screen.getByText('How times are formatted throughout the application')).toBeInTheDocument();
  });

  describe('language picker (#124)', () => {
    it('lists English and machine-drafted German, English selected by default', () => {
      const onChange = vi.fn();
      render(<DisplayTab formValues={defaultSettings} onChange={onChange} />);
      const selects = screen.getAllByRole('combobox');
      expect(selects[0]).toHaveTextContent('English');
      fireEvent.mouseDown(selects[0]);
      const options = screen.getAllByRole('option');
      expect(options.map((o) => o.textContent)).toEqual(['English', 'Deutsch (machine-drafted)']);
    });

    it('reports a language change under APP_LANGUAGE', () => {
      const onChange = vi.fn();
      render(<DisplayTab formValues={defaultSettings} onChange={onChange} />);
      fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
      fireEvent.click(screen.getByTestId('language-option-de'));
      expect(onChange).toHaveBeenCalledWith(DiscrubSetting.APP_LANGUAGE, 'de');
    });

    it('shows the saved language', () => {
      render(
        <DisplayTab
          formValues={{ ...defaultSettings, [DiscrubSetting.APP_LANGUAGE]: 'de' }}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getAllByRole('combobox')[0]).toHaveTextContent('Deutsch');
    });
  });
});
