// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import Home from '../src/app/page';

vi.mock('@paypal/react-paypal-js', () => ({
  PayPalScriptProvider: ({ children }: any) => <div>{children}</div>,
  usePayPal: () => ({ loadingStatus: 'resolved' }),
  PayPalOneTimePaymentButton: () => <div data-testid="paypal-button">PayPal Button</div>,
  INSTANCE_LOADING_STATE: { PENDING: 'pending', RESOLVED: 'resolved' }
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;
window.HTMLElement.prototype.scrollIntoView = vi.fn();

describe('Widget Smoke Test', () => {
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

  it('widget opens with the agent first message, restores without duplicate, and hides input on recovery', async () => {
    const { unmount } = render(<Home />);
    
    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.children.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c_1' } });
    
    // a) Widget opens with agent's first message
    await waitFor(() => expect(screen.getByText('Hello, your payment failed.')).toBeTruthy());
    expect(screen.getByPlaceholderText('Type your message...')).toBeTruthy();

    // b) Reload restores same conversation without duplicate
    // We simulate a reload by unmounting and remounting, which triggers fetch /api/agent/state again
    cleanup();
    render(<Home />);
    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.children.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c_1' } });
    
    await waitFor(() => {
      const msgs = screen.getAllByText('Hello, your payment failed.');
      expect(msgs.length).toBe(1); // No duplicates
    });

    // c) Chips and input are hidden once state is recovered
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
            messages: [{ role: 'agent', text: 'Hello, your payment failed.' }, { role: 'user', text: 'Yes' }, { role: 'agent', text: 'Success' }],
            nextStep: 'none',
            recoveredAmountCents: 4000
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    // Trigger reload for recovered state by remounting
    cleanup();
    render(<Home />);
    
    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.children.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c_1' } });

    await waitFor(() => {
      expect(screen.getByText(/Account Recovered/)).toBeTruthy();
      expect(screen.getByText(/Captured: \$40\.00/)).toBeTruthy();
      expect(screen.queryByPlaceholderText('Type your message...')).toBeNull(); // input hidden
      expect(screen.queryByText('Yes, proceed')).toBeNull(); // chips hidden
    });
  });
});
