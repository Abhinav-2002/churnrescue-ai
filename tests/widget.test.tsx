// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React, { useEffect } from 'react';
import { ChatWidget } from '../src/components/ChatWidget';
import { ChatProvider, useChat } from '../src/components/ChatContext';

export const usePayPalMock = vi.fn(() => ({ loadingStatus: 'resolved' }));

vi.mock('@paypal/react-paypal-js/sdk-v6', () => ({
  PayPalProvider: ({ children }: any) => <div>{children}</div>,
  usePayPal: () => usePayPalMock(),
  PayPalOneTimePaymentButton: () => <div data-testid="paypal-button">PayPal Button</div>,
  INSTANCE_LOADING_STATE: { PENDING: 'pending', RESOLVED: 'resolved', REJECTED: 'rejected' }
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;
window.HTMLElement.prototype.scrollIntoView = vi.fn();

function TestHarness({ initialCustomerId = 'c_1' }) {
  const { setCustomerId, setIsOpen } = useChat();
  useEffect(() => {
    setCustomerId(initialCustomerId);
    setIsOpen(true);
  }, [initialCustomerId, setCustomerId, setIsOpen]);
  
  return <ChatWidget />;
}

describe('Widget Smoke Test', () => {
  afterEach(() => {
    cleanup();
    usePayPalMock.mockReturnValue({ loadingStatus: 'resolved' });
    localStorage.clear();
  });
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation((url) => {
      if (url.startsWith('/api/agent/state')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            customer: { status: 'at_risk' },
            messages: [{ role: 'agent', text: 'Hello, your payment failed.' }],
            nextStep: 'none'
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  it('opens with the agent first message', async () => {
    render(
      <ChatProvider>
        <TestHarness />
      </ChatProvider>
    );
    
    await waitFor(() => expect(screen.getByText('Hello, your payment failed.')).toBeTruthy());
    expect(screen.getByPlaceholderText('Type a message...')).toBeTruthy();
  });

  it('reload restores without duplicate', async () => {
    render(
      <ChatProvider>
        <TestHarness />
      </ChatProvider>
    );
    await waitFor(() => expect(screen.getByText('Hello, your payment failed.')).toBeTruthy());

    cleanup();
    render(
      <ChatProvider>
        <TestHarness />
      </ChatProvider>
    );
    
    await waitFor(() => {
      const msgs = screen.getAllByText('Hello, your payment failed.');
      expect(msgs.length).toBe(1);
    });
  });

  it('widget refetch after confirm-pause AND after capture success',  async () => {
    mockFetch.mockImplementation((url) => {
      if (url.startsWith('/api/agent/state')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            customer: { status: 'recovered' },
            messages: [{ role: 'agent', text: 'Hello, your payment failed.' }, { role: 'customer', text: 'Yes' }, { role: 'agent', text: 'Success' }],
            nextStep: 'none',
            offerId: 'off_123',
            recoveredAmountCents: 4000
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <ChatProvider>
        <TestHarness />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Account Recovered/)).toBeTruthy();
      expect(screen.getByText(/Captured: \$40\.00/)).toBeTruthy();
      expect(screen.queryByPlaceholderText('Type a message...')).toBeNull();
      expect(screen.queryByText('Yes, proceed')).toBeNull();
    });
  });

  it('renders the PayPal button area for nextStep pay', async () => {
    mockFetch.mockImplementation((url) => {
      if (url.startsWith('/api/agent/state')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            customer: { status: 'at_risk' },
            messages: [],
            nextStep: 'pay',
            offerId: 'off_123',
            paypalOrderId: 'ord_123',
            amountCents: 4000
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <ChatProvider>
        <TestHarness />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('paypal-button')).toBeTruthy();
    });
  });

  it('shows friendly message when PayPal is rejected', async () => {
    usePayPalMock.mockReturnValue({ loadingStatus: 'rejected' });
    
    mockFetch.mockImplementation((url) => {
      if (url.startsWith('/api/agent/state')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            customer: { status: 'at_risk' },
            messages: [],
            nextStep: 'pay',
            offerId: 'off_123',
            paypalOrderId: 'ord_123',
            amountCents: 4000
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <ChatProvider>
        <TestHarness />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Failed to load payment options/i)).toBeTruthy();
    });
  });

  it('D10: empty at_risk state starts the conversation at most once (no start/state loop)', async () => {
    mockFetch.mockImplementation((url) => {
      if (url.startsWith('/api/agent/state')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ customer: { status: 'at_risk' }, messages: [], nextStep: 'none' })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <ChatProvider>
        <TestHarness />
      </ChatProvider>
    );

    await waitFor(() => {
      const starts = mockFetch.mock.calls.filter(([u]) => String(u).startsWith('/api/agent/start'));
      expect(starts.length).toBeGreaterThanOrEqual(1);
    });
    await new Promise(r => setTimeout(r, 300));

    const starts = mockFetch.mock.calls.filter(([u]) => String(u).startsWith('/api/agent/start'));
    expect(starts.length).toBe(1);
  });

  it('Fix Pack 3: confirm-pause passes offerId and clears pause button, and openChatForCustomer resets customer state', async () => {
    let currentState: any = {
      customer: { id: 'c_1', status: 'at_risk' },
      messages: [{ role: 'agent', text: 'Would you like to pause?' }],
      nextStep: 'confirm_pause',
      offerId: 'off_pause_123',
    };

    mockFetch.mockImplementation((url, opts) => {
      if (String(url).startsWith('/api/agent/state')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(currentState),
        });
      }
      if (String(url).startsWith('/api/agent/confirm-pause')) {
        const body = JSON.parse(opts?.body);
        expect(body.customerId).toBe('c_1');
        expect(body.offerId).toBe('off_pause_123');
        currentState = {
          customer: { id: 'c_1', status: 'paused' },
          messages: [{ role: 'agent', text: 'Account is now paused.' }],
          nextStep: 'none',
        };
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    function TestHarnessWithControls() {
      const { openChatForCustomer } = useChat();
      return (
        <div>
          <button type="button" onClick={() => openChatForCustomer('c_2')}>Switch to C2</button>
          <TestHarness initialCustomerId="c_1" />
        </div>
      );
    }

    render(
      <ChatProvider>
        <TestHarnessWithControls />
      </ChatProvider>
    );

    // Initial load: confirm pause button appears
    await waitFor(() => expect(screen.getByText('Confirm Pause')).toBeTruthy());
    expect(screen.getByText('Would you like to pause?')).toBeTruthy();

    // Click confirm pause
    fireEvent.click(screen.getByText('Confirm Pause'));

    // After pause confirmed, pause button is gone and confirmation shows
    await waitFor(() => expect(screen.queryByText('Confirm Pause')).toBeNull());
    expect(screen.getByText(/Your subscription has been paused successfully/i)).toBeTruthy();

    // Now switch customer using openChatForCustomer
    currentState = {
      customer: { id: 'c_2', status: 'at_risk' },
      messages: [{ role: 'agent', text: 'Hello C2, renewal failed.' }],
      nextStep: 'none',
    };

    fireEvent.click(screen.getByText('Switch to C2'));
    await waitFor(() => expect(screen.getByText('Hello C2, renewal failed.')).toBeTruthy());
    expect(screen.queryByText('Would you like to pause?')).toBeNull();
  });

  it('hydrates saved localStorage state after mount without server/client branch mismatch', async () => {
    localStorage.setItem('churnrescue_chat_open', 'true');
    localStorage.setItem('churnrescue_customer_id', 'c_hydrated');

    mockFetch.mockImplementation((url) => {
      if (url.startsWith('/api/agent/state?customerId=c_hydrated')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            customer: { id: 'c_hydrated', status: 'at_risk' },
            messages: [{ role: 'agent', text: 'Welcome back c_hydrated.' }],
            nextStep: 'none'
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <ChatProvider>
        <ChatWidget />
      </ChatProvider>
    );

    // After mount, useEffect hydrates localStorage and opens the chat
    await waitFor(() => {
      expect(screen.getByText('Welcome back c_hydrated.')).toBeTruthy();
    });
    expect(screen.getByPlaceholderText('Type a message...')).toBeTruthy();
  });
});
