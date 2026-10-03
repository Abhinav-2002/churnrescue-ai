import { describe, it, expect } from 'vitest';
import { mapCaptureResponse } from '../src/lib/capture-mapper';

describe('mapCaptureResponse', () => {
  it('maps success', () => {
    expect(mapCaptureResponse({ success: true }, 200)).toEqual({ kind: 'success', message: 'Your payment was successful!' });
  });

  it('maps declined', () => {
    expect(mapCaptureResponse({ error: 'declined' }, 400)).toEqual({ kind: 'declined', message: 'your payment was declined' });
  });

  it('maps not_approved', () => {
    expect(mapCaptureResponse({ error: 'not_approved' }, 400)).toEqual({ kind: 'not_approved', message: 'Please complete the approval process to continue.' });
  });

  it('maps polling', () => {
    expect(mapCaptureResponse({ error: 'in_progress' }, 409)).toEqual({ kind: 'polling', message: 'confirming your payment' });
    expect(mapCaptureResponse({ error: 'capture_unknown' }, 500)).toEqual({ kind: 'polling', message: 'confirming your payment' });
  });

  it('maps expired', () => {
    expect(mapCaptureResponse({ error: 'expired' }, 400)).toEqual({ kind: 'expired', message: 'this offer expired' });
  });

  it('maps network/other error', () => {
    expect(mapCaptureResponse({ error: 'get_order_failed' }, 500)).toEqual({ kind: 'error', message: 'A network error occurred. Please try again.' });
    expect(mapCaptureResponse({}, 0)).toEqual({ kind: 'error', message: 'A network error occurred. Please try again.' });
  });
});
