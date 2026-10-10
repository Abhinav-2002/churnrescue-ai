'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface ChatContextType {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  customerId: string | null;
  setCustomerId: (id: string | null) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      const savedId = localStorage.getItem('churnrescue_customer_id');
      const savedOpen = localStorage.getItem('churnrescue_chat_open');
      if (savedId) setCustomerId(savedId);
      if (savedOpen === 'true') setIsOpen(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const handleSetCustomerId = (id: string | null) => {
    setCustomerId(id);
    if (id) {
      localStorage.setItem('churnrescue_customer_id', id);
    } else {
      localStorage.removeItem('churnrescue_customer_id');
    }
  };

  const handleSetIsOpen = (open: boolean) => {
    setIsOpen(open);
    localStorage.setItem('churnrescue_chat_open', open.toString());
  };

  return (
    <ChatContext.Provider value={{ isOpen, setIsOpen: handleSetIsOpen, customerId, setCustomerId: handleSetCustomerId }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used within a ChatProvider');
  return context;
}
