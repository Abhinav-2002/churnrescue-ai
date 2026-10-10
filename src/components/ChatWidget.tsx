'use client';

import { useState, useEffect, useRef, FormEvent, useCallback } from 'react';
import { PayPalProvider, PayPalOneTimePaymentButton, usePayPal, INSTANCE_LOADING_STATE } from '@paypal/react-paypal-js/sdk-v6';
import { mapCaptureResponse } from '@/lib/capture-mapper';
import { useChat } from './ChatContext';

function PayPalWrapper({ orderId, offerId, onCaptureResult }: { orderId: string, offerId: string, onCaptureResult: (res: any, status: number) => void }) {
  const { loadingStatus } = usePayPal();
  const [isCapturing, setIsCapturing] = useState(false);

  if (loadingStatus === INSTANCE_LOADING_STATE.PENDING) {
    return <div className="text-gray-500 italic p-4 text-center">Loading secure payment...</div>;
  }
  if (loadingStatus === INSTANCE_LOADING_STATE.REJECTED) {
    return <div className="text-red-500 p-4 text-center">Failed to load payment options.</div>;
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
          onCaptureResult({ error: 'not_approved' }, 400);
        }}
        onError={(err) => {
          if (err.isRecoverable) {
            onCaptureResult({ error: 'get_order_failed' }, 500);
          } else {
            onCaptureResult({ error: 'declined' }, 400);
          }
        }}
      />
    </div>
  );
}

export function ChatWidget() {
  const { isOpen, setIsOpen, customerId } = useChat();
  
  const [customer, setCustomer] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [nextStep, setNextStep] = useState('none');
  const [offerInfo, setOfferInfo] = useState<{ offerId?: string, orderId?: string, recoveredAmountCents?: number }>({});
  
  const [loading, setLoading] = useState(false);
  const [typing, setTyping] = useState(false);
  const [systemMsg, setSystemMsg] = useState<{ kind: string, text: string } | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const startAttempted = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, systemMsg, nextStep, isOpen]);

  const loadState = useCallback(async (cId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/agent/state?customerId=${cId}`);
      if (!res.ok) throw new Error('State fetch failed');
      const data = await res.json();
      
      setCustomer(data.customer);
      setMessages(data.messages);
      setNextStep(data.nextStep || 'none');
      
      const newOfferInfo: any = {};
      if (data.offerId) {
        newOfferInfo.offerId = data.offerId;
        newOfferInfo.orderId = data.paypalOrderId;
      }
      if (data.recoveredAmountCents !== undefined) {
        newOfferInfo.recoveredAmountCents = data.recoveredAmountCents;
      }
      if (Object.keys(newOfferInfo).length > 0) {
        setOfferInfo(prev => ({ ...prev, ...newOfferInfo }));
      }
    } catch(e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const startConversation = useCallback(async (cId: string) => {
    setTyping(true);
    try {
      const res = await fetch('/api/agent/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: cId })
      });
      if (res.ok) {
        await loadState(cId);
      } else {
        const data = await res.json();
        setSystemMsg({ kind: 'error', text: `Failed to start chat: ${data.error || 'Unknown'}` });
      }
    } catch(e) {
      setSystemMsg({ kind: 'error', text: 'Network error starting chat.' });
    } finally {
      setTyping(false);
    }
  }, [loadState]);

  useEffect(() => {
    if (customerId && isOpen) {
      const timer = setTimeout(() => {
        loadState(customerId);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [customerId, isOpen, loadState]);

  // Trigger startConversation if we loaded an at_risk customer with no messages
  useEffect(() => {
    if (customer?.status === 'at_risk' && messages.length === 0 && !startAttempted.current) {
      startAttempted.current = true;
      startConversation(customer.id);
    }
  }, [customer, messages, startConversation]);

  async function sendMessage(text: string) {
    if (!text.trim() || !customerId) return;
    const msgText = text.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'customer', text: msgText }]);
    setTyping(true);
    
    try {
      const res = await fetch('/api/agent/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, text: msgText })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      await loadState(customerId);
    } catch(e) {
      setSystemMsg({ kind: 'error', text: 'Failed to send message.' });
    } finally {
      setTyping(false);
    }
  }

  async function handleConfirmPause() {
    setNextStep('none');
    setSystemMsg({ kind: 'success', text: 'Processing your pause request...' });
    if (!customerId) return;
    try {
      await fetch('/api/agent/confirm-pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId })
      });
      await loadState(customerId);
      setSystemMsg({ kind: 'success', text: 'Your subscription has been paused successfully.' });
    } catch(e) {
      setSystemMsg({ kind: 'error', text: 'Failed to pause subscription.' });
    }
  }

  function handleCaptureResult(data: any, status: number) {
    if (!customerId) return;
    const result = mapCaptureResponse(data, status);
    
    if (result.kind === 'pending') {
      setSystemMsg({ kind: 'info', text: result.message });
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        try {
          const sRes = await fetch(`/api/agent/state?customerId=${customerId}`);
          const sData = await sRes.json();
          if (sData.nextStep === 'pay' && sData.offerId === offerInfo.offerId) {
             // Still pending/capturing
          } else {
             clearInterval(interval);
             if (sData.customer.status === 'recovered') {
               setSystemMsg({ kind: 'success', text: 'Your payment was successful!' });
               loadState(customerId);
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
      loadState(customerId);
    }
  }

  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || 'test';

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 bg-blue-600 text-white rounded-full p-4 shadow-xl hover:bg-blue-700 z-50 flex items-center justify-center transition-transform hover:scale-105"
      >
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-full max-w-sm md:w-[400px] h-[600px] max-h-[80vh] bg-white rounded-2xl shadow-2xl flex flex-col z-50 border border-gray-200 overflow-hidden font-sans text-gray-800">
      {/* Header */}
      <div className="bg-blue-600 text-white px-4 py-3 flex justify-between items-center shadow-sm z-10">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
          <span className="font-medium text-sm">Support Chat</span>
        </div>
        <button onClick={() => setIsOpen(false)} className="text-blue-100 hover:text-white p-1 rounded-full hover:bg-blue-700 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
        {!customerId ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 text-sm p-6 text-center">
            <svg className="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" /></svg>
            <p>No customer selected.</p>
            <p className="mt-1">Go to the Admin dashboard and select a customer to simulate.</p>
          </div>
        ) : (
          <>
            {loading && <div className="text-center text-gray-400 text-xs py-2">Loading conversation...</div>}
            
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'customer' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm shadow-sm ${m.role === 'customer' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white text-gray-800 border border-gray-100 rounded-bl-none'}`}>
                  {m.text}
                </div>
              </div>
            ))}
            
            {typing && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-100 text-gray-500 rounded-2xl rounded-bl-none px-4 py-2 shadow-sm text-xs flex gap-1 items-center h-9">
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            )}
            
            {systemMsg && (
              <div className={`text-center px-4 py-3 text-xs rounded-xl border ${
                systemMsg.kind === 'success' ? 'bg-green-50 text-green-700 border-green-200' :
                systemMsg.kind === 'error' || systemMsg.kind === 'declined' || systemMsg.kind === 'expired' ? 'bg-red-50 text-red-700 border-red-200' :
                'bg-blue-50 text-blue-700 border-blue-200'
              }`}>
                <div>{systemMsg.text}</div>
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
              <div className="flex gap-2 mt-4 justify-center">
                <button onClick={handleConfirmPause} className="bg-blue-600 text-white px-3 py-1.5 text-sm rounded-lg font-medium hover:bg-blue-700 flex-1 shadow-sm">Confirm Pause</button>
                <button onClick={() => setNextStep('none')} className="bg-white border border-gray-300 text-gray-700 px-3 py-1.5 text-sm rounded-lg font-medium hover:bg-gray-50 flex-1 shadow-sm">Cancel</button>
              </div>
            )}
            
            {nextStep === 'escalated' && (
              <div className="text-center p-3 bg-orange-50 border border-orange-200 rounded-xl text-orange-700 text-sm font-medium">
                This conversation has been escalated to the billing team.
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input Area */}
      {customerId && (
        <div className="p-3 bg-white border-t border-gray-100 z-10">
          {customer?.status === 'at_risk' ? (
            <>
              {systemMsg?.kind === 'declined' && (
                <div className="mb-2">
                  <button onClick={() => sendMessage('Can I get a new offer?')} className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 hover:border-blue-200 transition-colors shadow-sm font-medium">Request a new offer</button>
                </div>
              )}
              {systemMsg?.kind === 'expired' && (
                <div className="mb-2">
                  <button onClick={() => sendMessage('Can I get the offer again?')} className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 hover:border-blue-200 transition-colors shadow-sm font-medium">Request offer again</button>
                </div>
              )}
              
              <form onSubmit={e => { e.preventDefault(); sendMessage(input); }} className="relative flex items-center bg-gray-50 border border-gray-200 rounded-xl p-1 focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-400 transition-all">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value.slice(0, 500))}
                  disabled={nextStep === 'escalated'}
                  placeholder="Type a message..."
                  className="flex-1 bg-transparent border-none px-3 py-2 text-sm focus:outline-none focus:ring-0 disabled:opacity-50"
                />
                <button 
                  type="submit" 
                  disabled={!input.trim() || nextStep === 'escalated'}
                  className="bg-blue-600 text-white w-8 h-8 rounded-lg flex items-center justify-center hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 transition-colors mr-1 shadow-sm shrink-0"
                >
                  <svg className="w-4 h-4 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                </button>
              </form>
            </>
          ) : (
            <div className="text-center font-medium py-2">
              {customer?.status === 'recovered' && (
                <div className="text-green-600 text-sm flex flex-col items-center gap-1">
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center mb-1">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                  </div>
                  Account Recovered
                  {offerInfo.recoveredAmountCents !== undefined && (
                    <div className="text-xs font-normal text-green-700">
                      Captured: ${(offerInfo.recoveredAmountCents / 100).toFixed(2)}
                    </div>
                  )}
                </div>
              )}
              {customer?.status === 'paused' && (
                <div className="text-blue-600 text-sm flex flex-col items-center gap-1">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mb-1">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 9v6m4-6v6" /></svg>
                  </div>
                  Subscription Paused
                </div>
              )}
              {customer?.status === 'healthy' && (
                <div className="text-gray-500 text-sm">
                  Customer is healthy. Simulation ready.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
