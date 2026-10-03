'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { PayPalProvider, PayPalOneTimePaymentButton, usePayPal, INSTANCE_LOADING_STATE } from '@paypal/react-paypal-js/sdk-v6';
import { mapCaptureResponse } from '@/lib/capture-mapper';

function PayPalWrapper({ orderId, offerId, onCaptureResult }: { orderId: string, offerId: string, onCaptureResult: (res: any, status: number) => void }) {
  const { loadingStatus } = usePayPal();
  const [isCapturing, setIsCapturing] = useState(false);

  if (loadingStatus === INSTANCE_LOADING_STATE.PENDING) {
    return <div className="text-gray-500 italic p-4 text-center">Loading secure payment...</div>;
  }
  if (loadingStatus === INSTANCE_LOADING_STATE.REJECTED) {
    return <div className="text-red-500 p-4 text-center">Failed to load payment options. Please try again later.</div>;
  }

  return (
    <div className="mt-4 p-4 border rounded bg-blue-50 relative">
      {isCapturing && (
        <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}
      <PayPalOneTimePaymentButton
        orderId={orderId}
        onApprove={async () => {
          setIsCapturing(true);
          try {
            const response = await fetch(`/api/offers/${offerId}/capture`, { method: 'POST' });
            const data = await response.json().catch(() => ({}));
            onCaptureResult(data, response.status);
          } catch (e) {
            onCaptureResult({}, 0);
          }
          setIsCapturing(false);
        }}
        onCancel={() => {
          onCaptureResult({ error: 'not_approved' }, 400); // reuse not_approved mapper
        }}
        onError={(err) => {
          if (err.isRecoverable) {
            onCaptureResult({ error: 'get_order_failed' }, 500);
          } else {
            onCaptureResult({ error: 'declined' }, 400); // Generic unrecoverable
          }
        }}
      />
    </div>
  );
}

export default function Home() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [nextStep, setNextStep] = useState('none');
  const [offerInfo, setOfferInfo] = useState<{ offerId?: string, orderId?: string }>({});
  
  const [loading, setLoading] = useState(false);
  const [typing, setTyping] = useState(false);
  const [systemMsg, setSystemMsg] = useState<{ kind: string, text: string } | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/reset', { method: 'POST' }).then(() => loadCustomers());
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, systemMsg, nextStep]);

  async function loadCustomers() {
    const res = await fetch('/api/customers');
    const data = await res.json();
    setCustomers(data);
  }

  async function handleSelect(cId: string) {
    const c = customers.find(x => x.id === cId);
    setSelectedCustomer(c);
    setMessages([]);
    setNextStep('none');
    setSystemMsg(null);
    if (!c) return;
    
    if (c.status === 'at_risk') {
      await loadState(c.id);
    }
  }

  async function loadState(cId: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/agent/state?customerId=${cId}`);
      if (!res.ok) throw new Error('State fetch failed');
      const data = await res.json();
      
      setMessages(data.messages || []);
      setNextStep(data.nextStep || 'none');
      setOfferInfo({ offerId: data.offerId, orderId: data.orderId });
      
      if (data.messages.length === 0 && data.customer.status === 'at_risk') {
        // Start conversation
        setTyping(true);
        const startRes = await fetch('/api/agent/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId: cId })
        });
        const startData = await startRes.json();
        
        // Re-fetch state to get full messages list
        const sRes = await fetch(`/api/agent/state?customerId=${cId}`);
        const sData = await sRes.json();
        
        setMessages(sData.messages || []);
        setNextStep(sData.nextStep || 'none');
        setOfferInfo({ offerId: sData.offerId, orderId: sData.orderId });
        setTyping(false);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  async function sendMessage(text: string) {
    if (!text.trim() || !selectedCustomer) return;
    
    const newMsg = { role: 'user', text };
    setMessages(prev => [...prev, newMsg]);
    setInput('');
    setTyping(true);
    setSystemMsg(null);

    try {
      const res = await fetch('/api/agent/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: selectedCustomer.id, text })
      });
      const data = await res.json();
      if (!res.ok) {
        setSystemMsg({ kind: 'error', text: data.error || 'Failed to send' });
      } else {
        // Re-fetch state to get full messages list
        const sRes = await fetch(`/api/agent/state?customerId=${selectedCustomer.id}`);
        const sData = await sRes.json();
        
        setMessages(sData.messages || []);
        setNextStep(sData.nextStep || 'none');
        setOfferInfo({ offerId: sData.offerId, orderId: sData.orderId });
      }
    } catch (e) {
      setSystemMsg({ kind: 'error', text: 'Network error' });
    }
    setTyping(false);
  }

  async function handleCaptureResult(resData: any, status: number) {
    const result = mapCaptureResponse(resData, status);
    
    if (result.kind === 'polling') {
      setSystemMsg({ kind: 'info', text: result.message });
      // Poll every 2s up to 30s
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        try {
          const sRes = await fetch(`/api/agent/state?customerId=${selectedCustomer.id}`);
          const sData = await sRes.json();
          if (sData.nextStep === 'pay' && sData.offerId === offerInfo.offerId) {
             // Still pending/capturing
          } else {
             clearInterval(interval);
             if (sData.customer.status === 'recovered') {
               setSystemMsg({ kind: 'success', text: 'Your payment was successful!' });
               setNextStep('none');
               loadCustomers(); // refresh list
             } else {
               setSystemMsg({ kind: 'error', text: 'Payment state resolved without success.' });
             }
          }
        } catch(e) {}
        if (attempts >= 15) {
          clearInterval(interval);
          setSystemMsg({ kind: 'error', text: 'Status unknown. Please check your email later.' });
        }
      }, 2000);
      return;
    }

    setSystemMsg({ kind: result.kind, text: result.message });
    if (result.kind === 'success') {
      setNextStep('none');
      loadCustomers();
    }
  }

  async function handleConfirmPause() {
    setSystemMsg({ kind: 'info', text: 'Confirming...' });
    try {
      const res = await fetch('/api/agent/confirm-pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: selectedCustomer.id, offerId: offerInfo.offerId })
      });
      if (res.ok) {
        setSystemMsg({ kind: 'success', text: 'Your subscription is paused.' });
        setNextStep('none');
        loadCustomers();
      } else {
        setSystemMsg({ kind: 'error', text: 'Failed to pause subscription.' });
      }
    } catch (e) {
      setSystemMsg({ kind: 'error', text: 'Network error.' });
    }
  }

  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || 'test';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-10 px-4 font-sans text-gray-800">
      <div className="w-full max-w-3xl">
        <div className="mb-6 bg-white p-6 rounded-lg shadow-sm border border-gray-100">
          <h1 className="text-2xl font-bold mb-4">ChurnRescue AI Demo</h1>
          <div className="flex items-center gap-4">
            <select 
              className="border p-2 rounded flex-1"
              onChange={e => handleSelect(e.target.value)}
              value={selectedCustomer?.id || ''}
            >
              <option value="">Select a customer...</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.email} ({c.plan_name} - {c.status})</option>
              ))}
            </select>
            <button 
              onClick={async () => {
                await fetch('/api/reset', { method: 'POST' });
                await loadCustomers();
                setSelectedCustomer(null);
                setMessages([]);
                setNextStep('none');
                setSystemMsg(null);
              }}
              className="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300"
            >
              Reset Demo
            </button>
          </div>
        </div>

        {selectedCustomer && selectedCustomer.status === 'healthy' && (
          <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-6 text-center">
            <h2 className="text-xl font-medium mb-4">Customer is healthy</h2>
            <button 
              onClick={async () => {
                await fetch('/api/simulate-failure', { 
                  method: 'POST', 
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ customerId: selectedCustomer.id })
                });
                const res = await fetch('/api/customers');
                const data = await res.json();
                setCustomers(data);
                const updatedC = data.find((x: any) => x.id === selectedCustomer.id);
                setSelectedCustomer(updatedC);
                if (updatedC?.status === 'at_risk') {
                  loadState(updatedC.id);
                }
              }}
              className="bg-red-600 text-white px-6 py-2 rounded font-medium hover:bg-red-700"
            >
              Simulate Failed Renewal
            </button>
          </div>
        )}

        {selectedCustomer && selectedCustomer.status === 'at_risk' && (
          <div className="bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden flex flex-col h-[600px]">
            <div className="bg-blue-600 text-white p-4 font-semibold">
              Support Chat
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {loading && <div className="text-center text-gray-500">Loading conversation...</div>}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-lg p-3 ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
                    {m.text}
                  </div>
                </div>
              ))}
              {typing && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-500 rounded-lg p-3 italic text-sm">Agent is typing...</div>
                </div>
              )}
              
              {systemMsg && (
                <div className={`text-center p-3 text-sm rounded ${
                  systemMsg.kind === 'success' ? 'bg-green-100 text-green-800' :
                  systemMsg.kind === 'error' || systemMsg.kind === 'declined' || systemMsg.kind === 'expired' ? 'bg-red-100 text-red-800' :
                  'bg-blue-100 text-blue-800'
                }`}>
                  {systemMsg.text}
                </div>
              )}

              {nextStep === 'pay' && offerInfo.orderId && (
                <PayPalProvider clientId={clientId} environment="sandbox">
                  <PayPalWrapper 
                    orderId={offerInfo.orderId!} 
                    offerId={offerInfo.offerId!}
                    onCaptureResult={handleCaptureResult}
                  />
                </PayPalProvider>
              )}

              {nextStep === 'confirm_pause' && (
                <div className="flex gap-3 mt-4 justify-center">
                  <button onClick={handleConfirmPause} className="bg-blue-600 text-white px-4 py-2 rounded font-medium hover:bg-blue-700">Confirm Pause</button>
                  <button onClick={() => setNextStep('none')} className="bg-gray-200 text-gray-800 px-4 py-2 rounded font-medium hover:bg-gray-300">Cancel</button>
                </div>
              )}
              
              {nextStep === 'escalated' && (
                <div className="text-center p-4 text-orange-600 font-medium">
                  This conversation has been escalated to the billing team.
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 border-t bg-gray-50">
              {systemMsg?.kind === 'declined' && (
                <div className="mb-3 flex gap-2">
                  <button onClick={() => sendMessage('Can I get a new offer?')} className="bg-white border rounded-full px-3 py-1 text-sm text-blue-600 hover:bg-blue-50">Can I get a new offer?</button>
                </div>
              )}
              {systemMsg?.kind === 'expired' && (
                <div className="mb-3 flex gap-2">
                  <button onClick={() => sendMessage('Can I get the offer again?')} className="bg-white border rounded-full px-3 py-1 text-sm text-blue-600 hover:bg-blue-50">Can I get the offer again?</button>
                </div>
              )}
              {nextStep === 'none' && !typing && messages.length > 0 && messages[messages.length-1].role === 'agent' && (
                <div className="mb-3 flex flex-wrap gap-2">
                  <button onClick={() => sendMessage('Yes, proceed')} className="bg-white border border-gray-300 rounded-full px-3 py-1 text-sm hover:bg-gray-100">Yes, proceed</button>
                  <button onClick={() => sendMessage('No thanks')} className="bg-white border border-gray-300 rounded-full px-3 py-1 text-sm hover:bg-gray-100">No thanks</button>
                </div>
              )}
              
              <form onSubmit={e => { e.preventDefault(); sendMessage(input); }} className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value.slice(0, 500))}
                    disabled={nextStep === 'escalated'}
                    placeholder="Type your message..."
                    className="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                  />
                  <div className="absolute right-3 top-2.5 text-xs text-gray-400">
                    {input.length}/500
                  </div>
                </div>
                <button 
                  type="submit" 
                  disabled={!input.trim() || nextStep === 'escalated'}
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            </div>
          </div>
        )}
        
        <div className="mt-8 text-center text-sm text-gray-500 pb-8">
          Demo uses one-time PayPal Orders for the recovery payment. A production subscription fix would use the Subscriptions API.
        </div>
      </div>
    </div>
  );
}
