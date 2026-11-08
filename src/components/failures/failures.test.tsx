import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { renderWithProviders, screen, fireEvent, waitFor } from '@/test/test-utils';
import SkipListRow, { type LoadedSkipList } from './SkipListRow';
import LastRunFailures from './LastRunFailures';
import { serializeFailures, type DeleteFailure } from '@features/failures/deleteFailures';
import { initialFailuresState } from '@features/failures/failuresSlice';

const refused = (id: string): DeleteFailure => ({ messageId: id, channelId: '200', guildId: 'g1', channelName: '#general', status: 403, kind: 'permanent', at: '2026-11-08T10:00:00.000Z' });
const flaky = (id: string): DeleteFailure => ({ messageId: id, channelId: '200', guildId: 'g1', channelName: '#general', kind: 'retryable', at: '2026-11-08T10:00:00.000Z' });

function Harness({ onValue }: { onValue: (v: LoadedSkipList | null) => void }) {
  const [value, setValue] = useState<LoadedSkipList | null>(null);
  return <SkipListRow value={value} onChange={(v) => { setValue(v); onValue(v); }} />;
}

const pick = (name: string, text: string) => {
  const file = new File([text], name, { type: 'application/json' });
  // jsdom's File has no text() in every version; the row only needs that one method.
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
  fireEvent.change(screen.getByTestId('skip-list-input'), { target: { files: [file] } });
};

describe('<SkipListRow /> (2.2.9)', () => {
  it('shows the button and what it is for before a file is loaded', () => {
    renderWithProviders(<Harness onValue={() => {}} />);
    expect(screen.getByTestId('skip-list-button')).toHaveTextContent('Skip list');
    expect(screen.getByTestId('skip-list-line')).toHaveTextContent('Load a failed list saved from an earlier run to leave those messages alone.');
  });

  it('loads a saved failed list, says what will be skipped and retried, and clears it', async () => {
    const onValue = vi.fn();
    renderWithProviders(<Harness onValue={onValue} />);
    pick('discrub-failed-2026-11-08.json', serializeFailures([refused('1111111111'), refused('2222222222'), flaky('3333333333')], 'json', '2.2.9'));

    await waitFor(() => expect(screen.getByTestId('skip-list-button')).toHaveTextContent('Skip list (2)'));
    expect(onValue).toHaveBeenLastCalledWith({ fileName: 'discrub-failed-2026-11-08.json', skipIds: ['1111111111', '2222222222'], retryableCount: 1 });
    const line = screen.getByTestId('skip-list-line');
    expect(line).toHaveTextContent('discrub-failed-2026-11-08.json. 2 messages Discord refused will be left alone.');
    expect(line).toHaveTextContent('1 that failed on a connection error will be tried again.');

    fireEvent.click(screen.getByTestId('skip-list-clear'));
    expect(onValue).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId('skip-list-button')).toHaveTextContent(/^Skip list$/);
  });

  it('says so when the file is not a failed list and loads nothing', async () => {
    const onValue = vi.fn();
    renderWithProviders(<Harness onValue={onValue} />);
    pick('notes.json', '{"hello":"world"}');
    await waitFor(() => expect(screen.getByTestId('skip-list-line')).toHaveTextContent("That file isn't a failed list saved by Discrub."));
    expect(onValue).toHaveBeenLastCalledWith(null);
  });
});

describe('<LastRunFailures /> (2.2.9)', () => {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:x');
  const revokeObjectURL = vi.fn();
  let clicked: string[] = [];
  beforeEach(() => {
    clicked = [];
    (URL as any).createObjectURL = createObjectURL;
    (URL as any).revokeObjectURL = revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
  });
  afterEach(() => { vi.restoreAllMocks(); createObjectURL.mockClear(); });

  it('renders nothing when the last run was clean', () => {
    renderWithProviders(<LastRunFailures source="purge" />);
    expect(screen.queryByTestId('last-run-failures')).not.toBeInTheDocument();
  });

  it('says how many messages the last run left and saves them as a file', async () => {
    renderWithProviders(<LastRunFailures source="purge" />, {
      preloadedState: { failures: { ...initialFailuresState, purge: [refused('1111111111'), refused('2222222222')] } } as never,
    });
    expect(screen.getByTestId('last-run-failures')).toHaveTextContent("The last run couldn't delete 2 messages.");
    fireEvent.click(screen.getByTestId('save-failed-list'));
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0]).toMatch(/^discrub-failed-\d{4}-\d{2}-\d{2}\.json$/);
    expect(createObjectURL.mock.calls[0][0].type).toBe('application/json');
  });

  it('keeps the package list apart from the Purge list', () => {
    renderWithProviders(<LastRunFailures source="package" />, {
      preloadedState: { failures: { ...initialFailuresState, purge: [refused('1111111111')] } } as never,
    });
    expect(screen.queryByTestId('last-run-failures')).not.toBeInTheDocument();
  });
});
