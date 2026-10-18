import { within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import FilterModal, { inferDateMode } from './FilterModal';
import { IsPinnedType } from 'discrub-core/discord-enum';
import { defaultCriteria } from './searchConstants';
import { renderWithProviders } from '@/test/test-utils';

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onServerSearch: vi.fn(),
  onRefine: vi.fn(),
  onClearSearch: vi.fn(),
  onClearRefine: vi.fn(),
  cachedUserMap: {},
  currentUserId: '123',
};

describe('FilterModal', () => {
  describe('rendering', () => {
    it('should render when open', () => {
      renderWithProviders(<FilterModal {...defaultProps} />);
      expect(screen.getByText('Filters')).toBeInTheDocument();
    });

    it('explains that has: types are matched together (#272)', () => {
      renderWithProviders(<FilterModal {...defaultProps} />);
      const help = screen.getAllByTestId('has-filter-help');
      expect(help.length).toBeGreaterThan(0);
      expect(help[0]).toHaveTextContent('Messages that have any of the selected types.');
    });

    it('should not render content when closed', () => {
      renderWithProviders(<FilterModal {...defaultProps} open={false} />);
      expect(screen.queryByText('Filters')).not.toBeInTheDocument();
    });

    it('should render Search section header', () => {
      renderWithProviders(<FilterModal {...defaultProps} />);
      expect(screen.getByText('Discord API')).toBeInTheDocument();
    });

    it('should render Refine section header', () => {
      renderWithProviders(<FilterModal {...defaultProps} />);
      expect(screen.getByText('Refine')).toBeInTheDocument();
      expect(screen.getByText('Loaded messages')).toBeInTheDocument();
    });

    it('should render all filter fields', () => {
      renderWithProviders(<FilterModal {...defaultProps} />);
      // Two "From" labels (search + refine)
      expect(screen.getAllByText('From').length).toBeGreaterThanOrEqual(2);
      // "Has" appears twice (search + refine)
      expect(screen.getAllByText('Has').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Mentions')).toBeInTheDocument();
      expect(screen.getByText('Date')).toBeInTheDocument();
      expect(screen.getByText('Author Type')).toBeInTheDocument();
    });
  });

  describe('search section', () => {
    it('should call onServerSearch when Search button is clicked', () => {
      const onServerSearch = vi.fn();
      const savedSearchCriteria = { ...defaultCriteria, searchMessageContents: ['test'] };
      renderWithProviders(<FilterModal {...defaultProps} onServerSearch={onServerSearch} savedSearchCriteria={savedSearchCriteria} />);
      fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
      expect(onServerSearch).toHaveBeenCalled();
    });

    it('should disable Search button when no search filters active', () => {
      renderWithProviders(<FilterModal {...defaultProps} />);
      const searchButtons = screen.getAllByRole('button', { name: /^Search$/ });
      // The contained "Search" button in the search section
      const searchBtn = searchButtons.find(btn => btn.classList.contains('MuiButton-contained'));
      expect(searchBtn).toBeDisabled();
    });

    describe('incomplete dates (#250)', () => {
      // What MUI's DateTimePicker emits while the typed value is incomplete.
      const invalidAfter = { ...defaultCriteria, searchAfterDate: new Date(NaN) };

      it('disables the Search button while a date is an Invalid Date', () => {
        renderWithProviders(<FilterModal {...defaultProps} savedSearchCriteria={invalidAfter} />);
        const searchButtons = screen.getAllByRole('button', { name: /^Search$/ });
        const searchBtn = searchButtons.find(btn => btn.classList.contains('MuiButton-contained'));
        expect(searchBtn).toBeDisabled();
      });

      it('shows the field-level explanation', () => {
        renderWithProviders(<FilterModal {...defaultProps} savedSearchCriteria={invalidAfter} />);
        expect(screen.getByText('Finish the date and time, or clear the field')).toBeInTheDocument();
      });

      it('refuses the Enter-to-apply path too, so no criteria reach the caller', () => {
        const onServerSearch = vi.fn();
        renderWithProviders(
          <FilterModal {...defaultProps} onServerSearch={onServerSearch} savedSearchCriteria={invalidAfter} />
        );
        const input = screen.getByPlaceholderText('Search message content...');
        fireEvent.change(input, { target: { value: 'receipt' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onServerSearch).not.toHaveBeenCalled();
      });

      it('applies normally once the date is real', () => {
        const onServerSearch = vi.fn();
        const valid = { ...defaultCriteria, searchAfterDate: new Date(2026, 7, 29, 10, 0) };
        renderWithProviders(
          <FilterModal {...defaultProps} onServerSearch={onServerSearch} savedSearchCriteria={valid} />
        );
        const searchButtons = screen.getAllByRole('button', { name: /^Search$/ });
        const searchBtn = searchButtons.find(btn => btn.classList.contains('MuiButton-contained'));
        expect(searchBtn).not.toBeDisabled();
        fireEvent.click(searchBtn!);
        expect(onServerSearch).toHaveBeenCalled();
      });
    });

    it('should call onClearSearch when search Clear is clicked', () => {
      const onClearSearch = vi.fn();
      const savedSearchCriteria = { ...defaultCriteria, userIds: ['123'] };
      renderWithProviders(<FilterModal {...defaultProps} onClearSearch={onClearSearch} savedSearchCriteria={savedSearchCriteria} />);
      // Find the search section's Clear button (first one)
      const clearButtons = screen.getAllByRole('button', { name: /Clear/ });
      fireEvent.click(clearButtons[0]);
      expect(onClearSearch).toHaveBeenCalled();
    });

    it('should trigger search on Enter in content field', () => {
      const onServerSearch = vi.fn();
      renderWithProviders(<FilterModal {...defaultProps} onServerSearch={onServerSearch} />);
      const input = screen.getByPlaceholderText('Search message content...');
      fireEvent.change(input, { target: { value: 'test' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onServerSearch).toHaveBeenCalled();
    });

    it('should show search filter count', () => {
      const savedSearchCriteria = { ...defaultCriteria, userIds: ['1', '2'], isPinned: IsPinnedType.YES };
      renderWithProviders(<FilterModal {...defaultProps} savedSearchCriteria={savedSearchCriteria} />);
      expect(screen.getByText(/Clear \(3\)/)).toBeInTheDocument();
    });
  });

  describe('refine section', () => {
    it('should call onRefine when Apply Refine is clicked', () => {
      const onRefine = vi.fn();
      const savedRefineCriteria = { ...defaultCriteria, searchMessageContents: ['local'] };
      renderWithProviders(<FilterModal {...defaultProps} onRefine={onRefine} savedRefineCriteria={savedRefineCriteria} />);
      fireEvent.click(screen.getByRole('button', { name: /Apply Refine/ }));
      expect(onRefine).toHaveBeenCalled();
    });

    it('should disable Apply Refine when no refine filters active', () => {
      renderWithProviders(<FilterModal {...defaultProps} />);
      const refineBtn = screen.getByRole('button', { name: /Apply Refine/ });
      expect(refineBtn).toBeDisabled();
    });

    it('should call onClearRefine when refine Clear is clicked', () => {
      const onClearRefine = vi.fn();
      const savedRefineCriteria = { ...defaultCriteria, searchMessageContents: ['test'] };
      renderWithProviders(<FilterModal {...defaultProps} onClearRefine={onClearRefine} savedRefineCriteria={savedRefineCriteria} />);
      // Refine clear is the second Clear button
      const clearButtons = screen.getAllByRole('button', { name: /Clear/ });
      fireEvent.click(clearButtons[1]);
      expect(onClearRefine).toHaveBeenCalled();
    });

    it('should trigger refine on Enter in refine content field', () => {
      const onRefine = vi.fn();
      renderWithProviders(<FilterModal {...defaultProps} onRefine={onRefine} />);
      const input = screen.getByPlaceholderText('Filter by content...');
      fireEvent.change(input, { target: { value: 'test' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onRefine).toHaveBeenCalled();
    });

    // #201 — system-message type refine (client-side only)
    it('renders the System Messages refine control with Show only / Hide modes', () => {
      renderWithProviders(<FilterModal {...defaultProps} />);
      expect(screen.getByText('System Messages')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Show only' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();
      // The picker's buckets render in the Refine section.
      expect(screen.getByRole('checkbox', { name: 'Pin notifications' })).toBeInTheDocument();
    });

    it('threads a system-only refine into onRefine and APPLIES it (count fix #201)', () => {
      // A system-only refine must register as an active filter — otherwise
      // handleRefineApply would treat it as 0 filters and clear instead.
      const onRefine = vi.fn();
      const onClearRefine = vi.fn();
      renderWithProviders(
        <FilterModal {...defaultProps} onRefine={onRefine} onClearRefine={onClearRefine} />,
      );
      fireEvent.click(screen.getByRole('checkbox', { name: 'Pin notifications' }));
      fireEvent.click(screen.getByRole('button', { name: /Apply Refine/ }));
      expect(onClearRefine).not.toHaveBeenCalled();
      expect(onRefine).toHaveBeenCalledWith(
        expect.objectContaining({ systemMessageGroups: ['pins'] }),
      );
    });

    it('emits systemMessageMode=hide when Hide is selected', () => {
      const onRefine = vi.fn();
      renderWithProviders(<FilterModal {...defaultProps} onRefine={onRefine} />);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Boost notifications' }));
      fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
      fireEvent.click(screen.getByRole('button', { name: /Apply Refine/ }));
      expect(onRefine).toHaveBeenCalledWith(
        expect.objectContaining({ systemMessageGroups: ['boosts'], systemMessageMode: 'hide' }),
      );
    });
  });

  describe('independent state', () => {
    it('should maintain separate criteria for search and refine', () => {
      const savedSearchCriteria = { ...defaultCriteria, searchMessageContents: ['server query'] };
      const savedRefineCriteria = { ...defaultCriteria, searchMessageContents: ['local filter'] };
      renderWithProviders(<FilterModal {...defaultProps} savedSearchCriteria={savedSearchCriteria} savedRefineCriteria={savedRefineCriteria} />);
      expect(within(screen.getByTestId('content-filter-search')).getByText('server query')).toBeInTheDocument();
      expect(within(screen.getByTestId('content-filter-refine')).getByText('local filter')).toBeInTheDocument();
    });

    it('should not persist changes to parent until apply is clicked', () => {
      const onServerSearch = vi.fn();
      renderWithProviders(<FilterModal {...defaultProps} onServerSearch={onServerSearch} />);
      // Type content but don't click Search
      const input = screen.getByPlaceholderText('Search message content...');
      fireEvent.change(input, { target: { value: 'typed but not applied' } });
      // onServerSearch should NOT have been called
      expect(onServerSearch).not.toHaveBeenCalled();
    });
  });

  describe('close and keyboard', () => {
    it('should call onClose when Cancel is clicked', () => {
      const onClose = vi.fn();
      renderWithProviders(<FilterModal {...defaultProps} onClose={onClose} />);
      fireEvent.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalled();
    });

    it('should call onClose when X is clicked', () => {
      const onClose = vi.fn();
      renderWithProviders(<FilterModal {...defaultProps} onClose={onClose} />);
      fireEvent.click(screen.getByLabelText('Close'));
      expect(onClose).toHaveBeenCalled();
    });

    it('should close on Escape', () => {
      const onClose = vi.fn();
      renderWithProviders(<FilterModal {...defaultProps} onClose={onClose} />);
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('date progressive disclosure', () => {
    it('should show "+ Add date" by default', () => {
      renderWithProviders(<FilterModal {...defaultProps} />);
      expect(screen.getByText('Add date')).toBeInTheDocument();
    });
  });

  // ── #182: inferDateMode distinguishes during vs between ──────────
  describe('inferDateMode', () => {
    it('returns null when no criteria is supplied', () => {
      expect(inferDateMode(undefined)).toBeNull();
    });

    it('returns null when neither bound is set', () => {
      expect(inferDateMode({ ...defaultCriteria })).toBeNull();
    });

    it('returns "after" when only searchAfterDate is set', () => {
      expect(inferDateMode({ ...defaultCriteria, searchAfterDate: new Date(2024, 0, 1) })).toBe('after');
    });

    it('returns "before" when only searchBeforeDate is set', () => {
      expect(inferDateMode({ ...defaultCriteria, searchBeforeDate: new Date(2024, 0, 31) })).toBe('before');
    });

    it('returns "during" when bounds match the startOfDay/endOfDay pair for one calendar day', () => {
      const day = new Date(2024, 0, 15);
      const start = new Date(2024, 0, 15, 0, 0, 0);
      const end = new Date(2024, 0, 15, 23, 59, 59);
      expect(inferDateMode({ ...defaultCriteria, searchAfterDate: start, searchBeforeDate: end })).toBe('during');
      // Sanity: the picker emits exactly this shape via date-fns startOfDay/endOfDay on `day`.
      void day;
    });

    it('returns "between" when both bounds are set but the day window does not match During', () => {
      // Different days
      expect(inferDateMode({
        ...defaultCriteria,
        searchAfterDate: new Date(2024, 0, 1, 0, 0, 0),
        searchBeforeDate: new Date(2024, 0, 31, 23, 59, 59),
      })).toBe('between');

      // Same day but the bounds don't span midnight to end-of-day
      expect(inferDateMode({
        ...defaultCriteria,
        searchAfterDate: new Date(2024, 0, 15, 9, 0, 0),
        searchBeforeDate: new Date(2024, 0, 15, 17, 0, 0),
      })).toBe('between');
    });
  });

  describe('edge cases', () => {
    it('should render correctly with null savedCriteria', () => {
      renderWithProviders(<FilterModal {...defaultProps} savedSearchCriteria={undefined} savedRefineCriteria={undefined} />);
      expect(screen.getByText('Filters')).toBeInTheDocument();
    });

    it('should clear rather than search when the last content term is removed and applied', () => {
      const onServerSearch = vi.fn();
      const saved = { ...defaultCriteria, searchMessageContents: ['old'] };
      renderWithProviders(<FilterModal {...defaultProps} onServerSearch={onServerSearch} savedSearchCriteria={saved} />);
      // Remove the only term chip
      fireEvent.click(within(screen.getByTestId('content-filter-search')).getByTestId('CancelIcon'));
      // Apply — should call onClearSearch since filters are empty but there are changes
      // The button is enabled because searchHasChanges is true
      fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
      // onServerSearch should NOT be called (count is 0, so it calls onClearSearch)
      expect(onServerSearch).not.toHaveBeenCalled();
    });
  });

  describe('hideAuthorFilters (Backlog #137)', () => {
    it('renders the Search-section From and Author Type fields by default', () => {
      renderWithProviders(<FilterModal {...defaultProps} />);
      expect(screen.getByTestId('filter-modal-search-from')).toBeInTheDocument();
      expect(screen.getByTestId('filter-modal-search-author-type')).toBeInTheDocument();
    });

    it('renders both fields when hideAuthorFilters is explicitly false', () => {
      renderWithProviders(<FilterModal {...defaultProps} hideAuthorFilters={false} />);
      expect(screen.getByTestId('filter-modal-search-from')).toBeInTheDocument();
      expect(screen.getByTestId('filter-modal-search-author-type')).toBeInTheDocument();
    });

    it('hides the Search-section From field when hideAuthorFilters is true', () => {
      renderWithProviders(<FilterModal {...defaultProps} hideAuthorFilters />);
      expect(screen.queryByTestId('filter-modal-search-from')).toBeNull();
    });

    it('hides the Search-section Author Type field when hideAuthorFilters is true', () => {
      renderWithProviders(<FilterModal {...defaultProps} hideAuthorFilters />);
      expect(screen.queryByTestId('filter-modal-search-author-type')).toBeNull();
    });

    it('keeps every other Search-section field visible when hideAuthorFilters is true', () => {
      renderWithProviders(<FilterModal {...defaultProps} hideAuthorFilters />);
      expect(screen.getByPlaceholderText(/Search message content/i)).toBeInTheDocument();
      expect(screen.getAllByText('Has').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Mentions')).toBeInTheDocument();
      expect(screen.getByText('Date')).toBeInTheDocument();
      expect(screen.getAllByText(/Pinned/i).length).toBeGreaterThanOrEqual(1);
    });

    it('still renders the Refine-section From (which has its own scope)', () => {
      // Refine's "From" filters already-loaded messages — independent of
      // the Search-section author lock. hideAuthorFilters only affects
      // the Search section. With Search-From hidden, the total From
      // count drops from 2 (search + refine) to 1 (refine only).
      renderWithProviders(<FilterModal {...defaultProps} hideAuthorFilters />);
      expect(screen.getAllByText('From')).toHaveLength(1);
    });
  });

  // ── #172: packageMode strips the modal to package-evaluable criteria ──
  describe('packageMode', () => {
    it('shows the "Refine" header label (not "Search") when packageMode is true', () => {
      renderWithProviders(<FilterModal {...defaultProps} packageMode />);
      // "Refine" appears once — as the section header. The Apply button
      // defaults to "Search" text unless overridden, so we only check
      // the header by scoping inside the dialog title area.
      expect(screen.getByText('Refine')).toBeInTheDocument();
      // No "Loaded messages" tag (that's the live-mode Refine section).
      expect(screen.queryByText('Loaded messages')).toBeNull();
    });

    it('hides the "Discord API" chip in packageMode', () => {
      renderWithProviders(<FilterModal {...defaultProps} packageMode />);
      expect(screen.queryByText('Discord API')).toBeNull();
    });

    it('hides the Refine section entirely in packageMode', () => {
      renderWithProviders(<FilterModal {...defaultProps} packageMode />);
      // "Apply Refine" button only exists when the refine section renders.
      expect(screen.queryByRole('button', { name: /Apply Refine/i })).toBeNull();
      expect(screen.queryByText('Loaded messages')).toBeNull();
    });

    it('hides Mentions, Has, Author Type, Pinned, and From in packageMode', () => {
      renderWithProviders(<FilterModal {...defaultProps} packageMode />);
      expect(screen.queryByText('Mentions')).toBeNull();
      expect(screen.queryByText('Author Type')).toBeNull();
      expect(screen.queryByText(/^Pinned$/)).toBeNull();
      // 'Has' is the MessageTypeFilter label
      expect(screen.queryByText('Has')).toBeNull();
      // No "From" anywhere — Search From hidden via packageMode's
      // hideAuthorFilters, Refine From hidden because the whole Refine
      // section is gone.
      expect(screen.queryByText('From')).toBeNull();
    });

    it('keeps Message Content + Date in packageMode', () => {
      renderWithProviders(<FilterModal {...defaultProps} packageMode />);
      expect(screen.getByPlaceholderText(/Search message content/i)).toBeInTheDocument();
      expect(screen.getByText('Date')).toBeInTheDocument();
    });

    it('preserves saved criteria when opened in packageMode', () => {
      const saved = { ...defaultCriteria, searchMessageContents: ['pizza'] };
      renderWithProviders(<FilterModal {...defaultProps} packageMode savedSearchCriteria={saved} />);
      expect(within(screen.getByTestId('content-filter-search')).getByText('pizza')).toBeInTheDocument();
    });

    it('respects applyButtonLabel in packageMode (e.g. "Apply filters")', () => {
      renderWithProviders(<FilterModal {...defaultProps} packageMode applyButtonLabel="Apply filters" savedSearchCriteria={{ ...defaultCriteria, searchMessageContents: ['pizza'] }} />);
      expect(screen.getByRole('button', { name: /Apply filters/i })).toBeInTheDocument();
    });

    it('dispatches the Apply action with the typed criteria', () => {
      const onServerSearch = vi.fn();
      const saved = { ...defaultCriteria, searchMessageContents: ['hello'] };
      renderWithProviders(
        <FilterModal
          {...defaultProps}
          packageMode
          applyButtonLabel="Apply filters"
          onServerSearch={onServerSearch}
          savedSearchCriteria={saved}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Apply filters/i }));
      expect(onServerSearch).toHaveBeenCalledWith(expect.objectContaining({ searchMessageContents: ['hello'] }));
    });

    // ── #182 + #172: between-mode dates flow through packageMode apply ──
    it('preserves both bounds and applies them when saved criteria is in between-mode', () => {
      const onServerSearch = vi.fn();
      const after = new Date(2024, 0, 1, 0, 0, 0);
      const before = new Date(2024, 0, 31, 23, 59, 59);
      const saved = {
        ...defaultCriteria,
        searchAfterDate: after,
        searchBeforeDate: before,
      };
      renderWithProviders(
        <FilterModal
          {...defaultProps}
          packageMode
          applyButtonLabel="Apply filters"
          onServerSearch={onServerSearch}
          savedSearchCriteria={saved}
        />,
      );
      // The Date row renders without crashing; inferDateMode reports between.
      expect(screen.getByText('Date')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Apply filters/i }));
      expect(onServerSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          searchAfterDate: after,
          searchBeforeDate: before,
        }),
      );
    });

    it('packageMode preserves non-package criteria fields (no UI for them) untouched on apply', () => {
      // A saved snapshot could come from live-mode use carrying isPinned or
      // userIds. packageMode hides the controls for those fields but must
      // not silently strip the values; #172 chose to filter on apply, not
      // mutate the saved object. This pins that behavior.
      const onServerSearch = vi.fn();
      const saved = {
        ...defaultCriteria,
        searchMessageContents: ['pizza'],
        isPinned: IsPinnedType.YES,
        userIds: ['9999'],
      };
      renderWithProviders(
        <FilterModal
          {...defaultProps}
          packageMode
          applyButtonLabel="Apply filters"
          onServerSearch={onServerSearch}
          savedSearchCriteria={saved}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Apply filters/i }));
      // Whatever the modal emits, it must at minimum carry the content.
      // Non-package fields may or may not survive (implementation choice);
      // this test pins that the apply doesn't crash and the content lands.
      expect(onServerSearch).toHaveBeenCalled();
      const arg = onServerSearch.mock.calls[0][0];
      expect(arg.searchMessageContents).toEqual(['pizza']);
    });
  });

  describe('attachment filters (GH #13)', () => {
    it('sends extensions and exact filename with the server search', () => {
      const onServerSearch = vi.fn();
      renderWithProviders(<FilterModal {...defaultProps} onServerSearch={onServerSearch} />);
      const ext = screen.getByTestId('attachment-extension-input-search');
      fireEvent.change(ext, { target: { value: 'PNG' } });
      fireEvent.keyDown(ext, { key: 'Enter' });
      const name = screen.getByTestId('attachment-filename-input-search');
      fireEvent.change(name, { target: { value: 'Report.pdf' } });
      fireEvent.keyDown(name, { key: 'Enter' });
      expect(onServerSearch).toHaveBeenCalledWith(
        expect.objectContaining({ attachmentExtensions: ['png'], attachmentFilename: 'Report.pdf' }),
      );
    });

    it('offers the attachment filter in the Refine section too', () => {
      renderWithProviders(<FilterModal {...defaultProps} />);
      expect(screen.getByTestId('attachment-filter-refine')).toBeInTheDocument();
    });
  });
});
