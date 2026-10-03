// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import Home from '../src/app/page';

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

describe('Widget Smoke Test', () => {
  afterEach(() => {
    cleanup();
    usePayPalMock.mockReturnValue({ loadingStatus: 'resolved' });
  });
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation((url) => {
      if (url === '/api/customers') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: 'c_1', name: 'Diana', status: 'at_risk', plan_name: 'Pro', plan_price_cents: 5000, usage_percent: 45 }])
        });
      }
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
    render(<Home />);
    
    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.children.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c_1' } });
    
    await waitFor(() => expect(screen.getByText('Hello, your payment failed.')).toBeTruthy());
    expect(screen.getByPlaceholderText('Type your message...')).toBeTruthy();
  });

  it('reload restores without duplicate', async () => {
    render(<Home />);
    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.children.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c_1' } });
    await waitFor(() => expect(screen.getByText('Hello, your payment failed.')).toBeTruthy());

    cleanup();
    render(<Home />);
    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.children.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c_1' } });
    
    await waitFor(() => {
      const msgs = screen.getAllByText('Hello, your payment failed.');
      expect(msgs.length).toBe(1);
    });
  });

  it('chips and input hidden when recovered', async () => {
    mockFetch.mockImplementation((url) => {
      if (url === '/api/customers') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: 'c_1', name: 'Diana', status: 'recovered' }])
        });
      }
      if (url.startsWith('/api/agent/state')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            customer: { status: 'recovered' },
            messages: [{ role: 'agent', text: 'Hello, your payment failed.' }, { role: 'customer', text: 'Yes' }, { role: 'agent', text: 'Success' }],
            nextStep: 'none',
            recoveredAmountCents: 4000
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<Home />);
    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.children.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c_1' } });

    await waitFor(() => {
      expect(screen.getByText(/Account Recovered/)).toBeTruthy();
      expect(screen.getByText(/Captured: \$40\.00/)).toBeTruthy();
      expect(screen.queryByPlaceholderText('Type your message...')).toBeNull();
      expect(screen.queryByText('Yes, proceed')).toBeNull();
    });
  });

  it('renders the PayPal button area for nextStep pay', async () => {
    mockFetch.mockImplementation((url) => {
      if (url === '/api/customers') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: 'c_1', name: 'Diana', status: 'at_risk' }])
        });
      }
      if (url.startsWith('/api/agent/state')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            customer: { status: 'at_risk' },
            messages: [],
            nextStep: 'pay',
            offerId: 'off_123',
            orderId: 'ord_123',
            amountCents: 4000
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<Home />);
    await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).children.length).toBeGreaterThan(1));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c_1' } });

    await waitFor(() => {
      expect(screen.getByTestId('paypal-button')).toBeTruthy();
    });
  });

  it('shows friendly message when PayPal is rejected', async () => {
    usePayPalMock.mockReturnValue({ loadingStatus: 'rejected' });
    
    mockFetch.mockImplementation((url) => {
      if (url === '/api/customers') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: 'c_1', name: 'Diana', status: 'at_risk' }])
        });
      }
      if (url.startsWith('/api/agent/state')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            customer: { status: 'at_risk' },
            messages: [],
            nextStep: 'pay',
            offerId: 'off_123',
            orderId: 'ord_123',
            amountCents: 4000
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<Home />);
    await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).children.length).toBeGreaterThan(1));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c_1' } });

    await waitFor(() => {
      expect(screen.getByText(/Failed to load payment options/i)).toBeTruthy();
    });
  });
});
