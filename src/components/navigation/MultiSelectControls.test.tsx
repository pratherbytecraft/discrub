import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MultiSelectControls from './MultiSelectControls';

const baseProps = {
  selectedCount: 0,
  totalCount: 10,
  allSelected: false,
  onToggleAll: () => {},
  onExport: () => {},
  onPurge: () => {},
  onCopyNames: () => {},
  noun: 'channels',
};

describe('MultiSelectControls (Backlog #135)', () => {
  it('renders nothing when inactive', () => {
    const { container } = render(<MultiSelectControls {...baseProps} active={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the "X of Y" count when active', () => {
    render(<MultiSelectControls {...baseProps} active selectedCount={4} totalCount={12} />);
    expect(screen.getByTestId('multi-select-count')).toHaveTextContent('4 of 12');
  });

  it('shows the "Select all" link when not all are selected', () => {
    render(<MultiSelectControls {...baseProps} active selectedCount={2} totalCount={10} allSelected={false} />);
    const link = screen.getByTestId('multi-select-toggle-all');
    expect(link).toHaveTextContent('Select all');
    expect(link).toHaveAttribute('aria-label', 'Select all channels');
  });

  it('shows the "Deselect all" link when everything is selected', () => {
    render(<MultiSelectControls {...baseProps} active selectedCount={10} totalCount={10} allSelected />);
    const link = screen.getByTestId('multi-select-toggle-all');
    expect(link).toHaveTextContent('Deselect all');
    expect(link).toHaveAttribute('aria-label', 'Deselect all channels');
  });

  it('hides Export, Purge, and Copy buttons when nothing is selected', () => {
    render(<MultiSelectControls {...baseProps} active selectedCount={0} />);
    expect(screen.queryByTestId('multi-select-export')).toBeNull();
    expect(screen.queryByTestId('multi-select-purge')).toBeNull();
    expect(screen.queryByTestId('multi-select-copy')).toBeNull();
  });

  it('shows Export, Purge, and Copy buttons once at least one item is selected', () => {
    render(<MultiSelectControls {...baseProps} active selectedCount={1} />);
    expect(screen.getByTestId('multi-select-export')).toBeInTheDocument();
    expect(screen.getByTestId('multi-select-purge')).toBeInTheDocument();
    expect(screen.getByTestId('multi-select-copy')).toBeInTheDocument();
  });

  it('uses the provided noun in action button aria labels', () => {
    render(<MultiSelectControls {...baseProps} active selectedCount={1} noun="conversations" />);
    expect(screen.getByLabelText('Export selected conversations')).toBeInTheDocument();
    expect(screen.getByLabelText('Purge selected conversations')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy selected conversations names')).toBeInTheDocument();
  });

  it('calls onToggleAll when the link is clicked', () => {
    const onToggleAll = vi.fn();
    render(<MultiSelectControls {...baseProps} active onToggleAll={onToggleAll} />);
    fireEvent.click(screen.getByTestId('multi-select-toggle-all'));
    expect(onToggleAll).toHaveBeenCalledTimes(1);
  });

  it('calls onExport when Export is clicked', () => {
    const onExport = vi.fn();
    render(<MultiSelectControls {...baseProps} active selectedCount={3} onExport={onExport} />);
    fireEvent.click(screen.getByTestId('multi-select-export'));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('calls onPurge when Purge is clicked', () => {
    const onPurge = vi.fn();
    render(<MultiSelectControls {...baseProps} active selectedCount={3} onPurge={onPurge} />);
    fireEvent.click(screen.getByTestId('multi-select-purge'));
    expect(onPurge).toHaveBeenCalledTimes(1);
  });

  it('calls onCopyNames when Copy is clicked', () => {
    const onCopyNames = vi.fn();
    render(<MultiSelectControls {...baseProps} active selectedCount={3} onCopyNames={onCopyNames} />);
    fireEvent.click(screen.getByTestId('multi-select-copy'));
    expect(onCopyNames).toHaveBeenCalledTimes(1);
  });

  // Backlog #215 — bulk edit across multi-selected channels/DMs.
  it('renders the Edit button only when onEdit is provided', () => {
    const { rerender } = render(<MultiSelectControls {...baseProps} active selectedCount={3} />);
    expect(screen.queryByTestId('multi-select-edit')).toBeNull();
    rerender(<MultiSelectControls {...baseProps} active selectedCount={3} onEdit={() => {}} />);
    expect(screen.getByTestId('multi-select-edit')).toBeInTheDocument();
  });

  it('calls onEdit when Edit is clicked', () => {
    const onEdit = vi.fn();
    render(<MultiSelectControls {...baseProps} active selectedCount={3} onEdit={onEdit} />);
    fireEvent.click(screen.getByTestId('multi-select-edit'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  // Backlog #155: ServerList renders MultiSelectControls Copy-only for v1.
  describe('optional Export/Purge handlers (Backlog #155)', () => {
    const copyOnlyProps = {
      active: true as const,
      selectedCount: 2,
      totalCount: 10,
      allSelected: false,
      onToggleAll: () => {},
      onCopyNames: () => {},
      noun: 'servers',
    };

    it('hides Export when onExport is omitted', () => {
      render(<MultiSelectControls {...copyOnlyProps} />);
      expect(screen.queryByTestId('multi-select-export')).toBeNull();
    });

    it('hides Purge when onPurge is omitted', () => {
      render(<MultiSelectControls {...copyOnlyProps} />);
      expect(screen.queryByTestId('multi-select-purge')).toBeNull();
    });

    it('still renders Copy (the only required action) when Export/Purge are omitted', () => {
      render(<MultiSelectControls {...copyOnlyProps} />);
      expect(screen.getByTestId('multi-select-copy')).toBeInTheDocument();
    });
  });

  // 2.2.5 WP4b: an unfinished run shows its button as Resume, even with nothing selected.
  it('shows the actions with nothing selected when a run can resume, and that button reads Resume', () => {
    render(<MultiSelectControls {...baseProps} active selectedCount={0} totalCount={10} resume={{ purge: true }} />);
    expect(screen.getByTestId('multi-select-purge')).toHaveTextContent('Resume');
    expect(screen.getByTestId('multi-select-export')).toHaveTextContent('Export');
  });
});
