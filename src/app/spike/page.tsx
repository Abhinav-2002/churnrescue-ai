'use client';

import { useSearchParams } from 'next/navigation';
import { PayPalProvider, PayPalOneTimePaymentButton } from '@paypal/react-paypal-js/sdk-v6';
import { useState, Suspense } from 'react';

function SpikeClient() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('orderId');
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || 'test';
  
  const [log, setLog] = useState<string>('Ready.');

  if (!orderId) {
    return <div>No orderId provided in query string. Use ?orderId=XYZ</div>;
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>PayPal SDK Spike</h1>
      <p>Attempting to approve order: {orderId}</p>
      
      <div style={{ maxWidth: 400, marginTop: 20 }}>
        <PayPalProvider
          clientId={clientId}
          environment="sandbox"
        >
          <PayPalOneTimePaymentButton
            orderId={orderId}
            onApprove={async (data) => {
              setLog(`Approved! Order ID from PayPal: ${data.orderId}`);
              console.log('onApprove data:', data);
            }}
            onCancel={() => setLog('Cancelled by user')}
            onError={(err) => {
              console.error(err);
              setLog(`Error: ${err}`);
            }}
          />
        </PayPalProvider>
      </div>

      <div style={{ marginTop: 20, padding: 10, background: '#eee' }}>
        <strong>Log:</strong> {log}
      </div>
    </div>
  );
}

export default function SpikePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SpikeClient />
    </Suspense>
  );
}
