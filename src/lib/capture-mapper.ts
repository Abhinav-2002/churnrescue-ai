export function mapCaptureResponse(res: any, status: number) {
  if (status === 200 && res.success) {
    return { kind: 'success', message: 'Your payment was successful!' };
  }
  
  if (res.error === 'declined') {
    return { kind: 'declined', message: 'your payment was declined' };
  }
  
  if (res.error === 'not_approved') {
    return { kind: 'not_approved', message: 'Please complete the approval process to continue.' };
  }
  
  if (res.error === 'in_progress' || res.error === 'capture_unknown') {
    return { kind: 'polling', message: 'confirming your payment' };
  }
  
  if (res.error === 'expired') {
    return { kind: 'expired', message: 'this offer expired' };
  }
  
  // get_order_failed, capture_failed, amount_mismatch, or network error
  return { kind: 'error', message: 'A network error occurred. Please try again.' };
}
