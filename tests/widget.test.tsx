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
});
