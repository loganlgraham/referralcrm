import { act, fireEvent, render, screen } from '@testing-library/react';

import { SearchInput } from '@/components/ui/search-input';

const mockRouter = { replace: jest.fn() };

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const advance = (milliseconds = 300) => act(() => { jest.advanceTimersByTime(milliseconds); });

describe('SearchInput', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRouter.replace.mockClear();
    window.history.replaceState(null, '', '/referrals');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('updates typing immediately and submits only after a pause without rerendering the table', () => {
    let tableRenders = 0;
    function Table() {
      tableRenders += 1;
      return <SearchInput aria-label="Search" />;
    }
    render(<Table />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'j' } });
    advance(200);
    fireEvent.change(input, { target: { value: 'jo' } });
    advance(200);
    fireEvent.change(input, { target: { value: 'jordan' } });

    expect(input).toHaveValue('jordan');
    expect(tableRenders).toBe(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    advance(299);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    advance(1);
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith('/referrals?search=jordan', { scroll: false });
  });

  it('uses the latest filters, resets the page, and preserves the hash', () => {
    window.history.replaceState(null, '', '/referrals?status=Paired&page=5&pageSize=50#results');
    render(<SearchInput aria-label="Search" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Taylor  ' } });

    // A filter can change while the search debounce is still waiting.
    window.history.replaceState(null, '', '/referrals?status=Active+Lead&page=5&pageSize=50&mc=123#results');
    advance();

    expect(mockRouter.replace).toHaveBeenCalledWith(
      '/referrals?status=Active+Lead&pageSize=50&mc=123&search=Taylor#results',
      { scroll: false }
    );
  });

  it('notifies surrounding filters about navigation without notifying for each keystroke', () => {
    const onPendingChange = jest.fn();
    render(<SearchInput aria-label="Search" onPendingChange={onPendingChange} />);
    expect(onPendingChange).toHaveBeenCalledWith(false);
    onPendingChange.mockClear();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Jordan' } });
    expect(onPendingChange).not.toHaveBeenCalled();
    advance();
    expect(onPendingChange).toHaveBeenCalledWith(true);
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
  });

  it('does not replace a newer draft when an earlier slow search finishes', () => {
    const view = render(<SearchInput aria-label="Search" />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'jo' } });
    advance();
    fireEvent.change(input, { target: { value: 'jordan' } });
    advance(100);

    window.history.replaceState(null, '', '/referrals?search=jo');
    view.rerender(<SearchInput aria-label="Search" />);
    expect(input).toHaveValue('jordan');
    advance(200);

    expect(mockRouter.replace).toHaveBeenLastCalledWith('/referrals?search=jordan', { scroll: false });
    expect(mockRouter.replace).toHaveBeenCalledTimes(2);
  });

  it('keeps the newest draft across multiple outstanding searches', () => {
    const view = render(<SearchInput aria-label="Search" />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'jo' } });
    advance();
    fireEvent.change(input, { target: { value: 'jordan' } });
    advance();
    fireEvent.change(input, { target: { value: 'jordan smith' } });

    window.history.replaceState(null, '', '/referrals?search=jo');
    view.rerender(<SearchInput aria-label="Search" />);
    window.history.replaceState(null, '', '/referrals?search=jordan');
    view.rerender(<SearchInput aria-label="Search" />);
    expect(input).toHaveValue('jordan smith');
    advance();
    expect(mockRouter.replace).toHaveBeenLastCalledWith('/referrals?search=jordan+smith', { scroll: false });
  });

  it('removes an empty search and returns to the first page', () => {
    window.history.replaceState(null, '', '/referrals?search=Jordan&page=3&status=Paired');
    render(<SearchInput aria-label="Search" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    advance();

    expect(mockRouter.replace).toHaveBeenCalledWith('/referrals?status=Paired', { scroll: false });
  });

  it('can clear a search whose server navigation has not finished yet', () => {
    render(<SearchInput aria-label="Search" />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Jordan' } });
    advance();
    fireEvent.change(input, { target: { value: '' } });
    advance();

    expect(mockRouter.replace).toHaveBeenCalledTimes(2);
    expect(mockRouter.replace).toHaveBeenLastCalledWith('/referrals', { scroll: false });
    expect(input).toHaveValue('');
  });

  it('updates client list URLs without a server navigation and keeps focus while loading', () => {
    window.history.replaceState(null, '', '/agents?ahaFilter=AHA&page=4');
    const replaceState = jest.spyOn(window.history, 'replaceState');
    const view = render(<SearchInput navigation="client" aria-label="Search" />);
    const input = screen.getByRole('textbox');
    input.focus();
    fireEvent.change(input, { target: { value: 'Jordan' } });
    advance();
    view.rerender(<SearchInput navigation="client" isLoading aria-label="Search" />);

    expect(replaceState).toHaveBeenCalledWith(null, '', '/agents?ahaFilter=AHA&search=Jordan');
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(input).toHaveFocus();
    expect(input).not.toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Updating results');
    fireEvent.change(input, { target: { value: 'Jordan Smith' } });
    expect(input).toHaveValue('Jordan Smith');
  });

  it('restores an external URL search and cancels a queued draft', () => {
    const view = render(<SearchInput aria-label="Search" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unfinished' } });

    window.history.replaceState(null, '', '/referrals?search=Saved');
    view.rerender(<SearchInput aria-label="Search" />);
    advance();

    expect(screen.getByRole('textbox')).toHaveValue('Saved');
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('restores Back/Forward history even when its search equals the previous committed URL', () => {
    window.history.replaceState(null, '', '/referrals?search=Saved&page=2');
    render(<SearchInput aria-label="Search" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unfinished' } });

    act(() => {
      window.history.replaceState(null, '', '/referrals?search=Saved&page=1');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    advance();

    expect(screen.getByRole('textbox')).toHaveValue('Saved');
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('waits for IME composition to finish before searching', () => {
    render(<SearchInput aria-label="Search" />);
    const input = screen.getByRole('textbox');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '山' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    advance(1000);
    expect(mockRouter.replace).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '山田' } });
    fireEvent.compositionEnd(input);
    advance();
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith('/referrals?search=%E5%B1%B1%E7%94%B0', { scroll: false });
  });

  it('submits immediately on Enter without a duplicate debounced request', () => {
    render(<SearchInput aria-label="Search" />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Jordan' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    advance();
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
  });

  it('does not refetch when only whitespace around the current search changes', () => {
    window.history.replaceState(null, '', '/referrals?search=Jordan&page=2');
    render(<SearchInput aria-label="Search" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' Jordan ' } });
    advance();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('cancels pending searches on unmount or after leaving the page', () => {
    const view = render(<SearchInput aria-label="Search" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Jordan' } });
    view.unmount();
    advance();
    expect(mockRouter.replace).not.toHaveBeenCalled();

    render(<SearchInput aria-label="Search" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Taylor' } });
    window.history.replaceState(null, '', '/deals');
    advance();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
