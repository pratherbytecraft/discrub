import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

// Mock the store dispatch
const mockDispatch = vi.fn();
vi.mock('@/app/store', () => ({
  store: { dispatch: (...args: any[]) => mockDispatch(...args) },
}));

vi.mock('@features/status/statusSlice', () => ({
  addStatusEntry: vi.fn((payload) => ({ type: 'status/addStatusEntry', payload })),
}));

// Test component that throws on command
const ThrowingComponent = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test render crash');
  }
  return <div>Content renders fine</div>;
};

describe('ErrorBoundary', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    // Suppress console.error from React's error boundary logging
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div>Hello world</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('shows recovery UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Test render crash')).toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('dispatches error status entry when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          level: 'error',
          message: expect.stringContaining('Render crash: Test render crash'),
        },
      })
    );
  });

  it('attempts recovery when Try Again is clicked', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Click Try Again — boundary resets its error state
    // The child still throws, so it re-enters error state, but the button works
    fireEvent.click(screen.getByText('Try Again'));

    // Boundary re-catches the same throw — still shows recovery UI
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('does not show recovery UI when no error', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(screen.getByText('Content renders fine')).toBeInTheDocument();
  });

  // 2.2.1: the Ghost keeps the fallback page company, drawn without the store.
  it('shows the Ghost with its line beside the heading', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('error-ghost')).toBeInTheDocument();
    expect(screen.getByText("Wasn't me.")).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});
