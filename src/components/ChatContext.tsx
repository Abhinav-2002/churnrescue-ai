'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface ChatContextType {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  customerId: string | null;
  setCustomerId: (id: string | null) => void;
  refreshKey: number;
  openChatForCustomer: (id: string) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem('churnrescue_chat_open') === 'true';
      } catch {}
    }
    return false;
  });
  const [customerId, setCustomerId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem('churnrescue_customer_id');
      } catch {}
    }
    return null;
  });
  const [refreshKey, setRefreshKey] = useState(0);

  // Listen to storage events across tabs/windows
  useEffect(() => {

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'churnrescue_customer_id') {
        setCustomerId(e.newValue);
        setRefreshKey((k) => k + 1);
      }
      if (e.key === 'churnrescue_chat_open') {
        setIsOpen(e.newValue === 'true');
      }
      if (e.key === 'churnrescue_chat_refresh') {
        setRefreshKey((k) => k + 1);
      }
    };

    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const handleSetCustomerId = useCallback((id: string | null) => {
    setCustomerId((prev) => {
      if (prev === id) return prev;
      return id;
    });
    setRefreshKey((k) => k + 1);
    try {
      if (id) {
        localStorage.setItem('churnrescue_customer_id', id);
      } else {
        localStorage.removeItem('churnrescue_customer_id');
      }
    } catch {}
  }, []);

  const handleSetIsOpen = useCallback((open: boolean) => {
    setIsOpen((prev) => {
      if (prev === open) return prev;
      return open;
    });
    if (open) {
      setRefreshKey((k) => k + 1);
    }
    try {
      localStorage.setItem('churnrescue_chat_open', open.toString());
    } catch {}
  }, []);

  const openChatForCustomer = useCallback((id: string) => {
    setCustomerId(id);
    setIsOpen(true);
    setRefreshKey((k) => k + 1);
    try {
      localStorage.setItem('churnrescue_customer_id', id);
      localStorage.setItem('churnrescue_chat_open', 'true');
      localStorage.setItem('churnrescue_chat_refresh', Date.now().toString());
    } catch {}
  }, []);

  return (
    <ChatContext.Provider
      value={{
        isOpen,
        setIsOpen: handleSetIsOpen,
        customerId,
        setCustomerId: handleSetCustomerId,
        refreshKey,
        openChatForCustomer,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used within a ChatProvider');
  return context;
}
