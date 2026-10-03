'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule, themeQuartz } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);

const StatusRenderer = (props: any) => {
  const value = props.value;
  let bg = 'bg-gray-100 text-gray-800';
  if (value === 'healthy') bg = 'bg-green-100 text-green-800';
  if (value === 'at_risk') bg = 'bg-yellow-100 text-yellow-800';
  if (value === 'paused') bg = 'bg-blue-100 text-blue-800';
  if (value === 'recovered') bg = 'bg-purple-100 text-purple-800';
  
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium uppercase ${bg}`}>
      {value}
    </span>
  );
};

const CurrencyRenderer = (props: any) => {
  const cents = props.value || 0;
  return `$${(cents / 100).toFixed(2)}`;
};

const ClampsRenderer = (props: any) => {
  const clamps = props.value || [];
  if (clamps.length === 0) return <span className="text-gray-400">-</span>;
  return <span>{clamps.join(', ')}</span>;
};

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<any[]>([]);
  const [convLoading, setConvLoading] = useState(false);

  const [quickFilterText, setQuickFilterText] = useState('');

  const custGridRef = useRef<AgGridReact>(null);
  const actionsGridRef = useRef<AgGridReact>(null);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      return json;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  };

  useEffect(() => {
    let mounted = true;
    const initData = async () => {
      const json = await fetchData();
      if (mounted && json) {
        setData(json);
        setLoading(false);
      }
    };
    initData();

    const interval = setInterval(async () => {
      const json = await fetchData();
      if (mounted && json && custGridRef.current && actionsGridRef.current) {
        // We use applyTransaction for live updates
        const custApi = custGridRef.current.api;
        if (custApi) {
          const rowData: any[] = [];
          custApi.forEachNode(node => rowData.push(node.data));
          
          const updated: any[] = [];
          json.customers.forEach((newCust: any) => {
            const oldCust = rowData.find(c => c.id === newCust.id);
            if (oldCust && JSON.stringify(oldCust) !== JSON.stringify(newCust)) {
              updated.push(newCust);
            }
          });
          
          if (updated.length > 0) {
            custApi.applyTransaction({ update: updated });
          }
        }
        
        const actionsApi = actionsGridRef.current.api;
        if (actionsApi) {
          const rowData: any[] = [];
          actionsApi.forEachNode(node => rowData.push(node.data));
          
          const newActions = json.actions.filter((newA: any) => !rowData.some(oldA => oldA.id === newA.id));
          if (newActions.length > 0) {
            actionsApi.applyTransaction({ add: newActions, addIndex: 0 });
          }
        }
        
        setData((prev: any) => ({ ...prev, summary: json.summary }));
      }
    }, 2000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (selectedCustomerId) {
      setConvLoading(true);
      fetch(`/api/dashboard/conversations?customerId=${selectedCustomerId}`)
        .then(r => r.json())
        .then(data => {
          setConversations(data);
          setConvLoading(false);
        })
        .catch(() => setConvLoading(false));
    } else {
      setConversations([]);
    }
  }, [selectedCustomerId]);

  const custColDefs = useMemo(() => [
    { field: 'name', headerName: 'Customer Name', flex: 1, filter: true },
    { field: 'plan', headerName: 'Plan', width: 120, filter: true },
    { field: 'usagePercent', headerName: 'Usage %', width: 100, filter: 'agNumberColumnFilter' },
    { field: 'status', headerName: 'Status', width: 120, cellRenderer: StatusRenderer, filter: true },
    { field: 'failedAmount', headerName: 'Failed', width: 110, cellRenderer: CurrencyRenderer, enableCellChangeFlash: true },
    { field: 'offeredAmount', headerName: 'Offered', width: 110, cellRenderer: CurrencyRenderer, enableCellChangeFlash: true },
    { field: 'recoveredAmount', headerName: 'Recovered', width: 110, cellRenderer: CurrencyRenderer, enableCellChangeFlash: true },
    { field: 'lastAgentAction', headerName: 'Last Action', flex: 1, enableCellChangeFlash: true }
  ], []);

  const actionColDefs = useMemo(() => [
    { field: 'timestamp', headerName: 'Time', width: 180, valueFormatter: (p:any) => new Date(p.value).toLocaleString() },
    { field: 'customer', headerName: 'Customer', width: 150 },
    { field: 'action', headerName: 'Action', width: 120 },
    { field: 'reasoning', headerName: 'Reasoning', flex: 1, wrapText: true, autoHeight: true },
    { field: 'clampsApplied', headerName: 'Clamps', flex: 1, cellRenderer: ClampsRenderer, wrapText: true, autoHeight: true }
  ], []);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true
  }), []);

  const onRowClicked = useCallback((e: any) => {
    setSelectedCustomerId(e.data.id);
  }, []);

  if (error) return <div className="p-8 text-red-500">Error: {error}</div>;

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
      <header className="bg-white shadow-sm px-6 py-4 flex justify-between items-center border-b">
        <h1 className="text-xl font-bold">Dashboard</h1>
        <Link href="/" className="text-blue-600 hover:underline">
          &larr; Back to Demo
        </Link>
      </header>
      
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-500">Loading dashboard...</p>
        </div>
      ) : !data ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-500">No data available.</p>
        </div>
      ) : (
        <main className="flex-1 flex overflow-hidden">
          {/* Main Content Area */}
          <div className="flex-1 overflow-y-auto p-6 flex flex-col space-y-6">
            
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded shadow border">
                <p className="text-sm text-gray-500 font-medium uppercase">Failed Amount</p>
                <p className="text-2xl font-bold mt-1">${(data.summary.totalFailedAmount / 100).toFixed(2)}</p>
              </div>
              <div className="bg-white p-4 rounded shadow border">
                <p className="text-sm text-gray-500 font-medium uppercase">Recovered Amount</p>
                <p className="text-2xl font-bold mt-1 text-green-600">${(data.summary.totalRecoveredAmount / 100).toFixed(2)}</p>
              </div>
              <div className="bg-white p-4 rounded shadow border">
                <p className="text-sm text-gray-500 font-medium uppercase">Recovery Rate</p>
                <p className="text-2xl font-bold mt-1">
                  {(data.summary.recoveryRate * 100).toFixed(1)}%
                </p>
              </div>
              <div className="bg-white p-4 rounded shadow border">
                <p className="text-sm text-gray-500 font-medium uppercase">At-Risk / Paused</p>
                <p className="text-2xl font-bold mt-1 text-yellow-600">{data.summary.atRiskOrPausedCount}</p>
              </div>
            </div>

            {/* Customers Grid */}
            <div className="bg-white rounded shadow border flex flex-col h-96">
              <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                <h2 className="font-semibold text-lg">Customers</h2>
                <input 
                  type="text"
                  placeholder="Quick filter..."
                  value={quickFilterText}
                  onChange={(e) => setQuickFilterText(e.target.value)}
                  className="border px-3 py-1 rounded text-sm w-64"
                />
              </div>
              <div className="flex-1 w-full relative">
                <AgGridReact
                  ref={custGridRef}
                  theme={themeQuartz}
                  rowData={data.customers}
                  columnDefs={custColDefs}
                  defaultColDef={defaultColDef}
                  quickFilterText={quickFilterText}
                  onRowClicked={onRowClicked}
                  getRowId={(params) => params.data.id}
                  animateRows={false}
                  rowSelection="single"
                />
              </div>
            </div>

            {/* Actions Grid */}
            <div className="bg-white rounded shadow border flex flex-col flex-1 min-h-[300px]">
              <div className="p-4 border-b bg-gray-50">
                <h2 className="font-semibold text-lg">Agent Action Log</h2>
              </div>
              <div className="flex-1 w-full relative">
                <AgGridReact
                  ref={actionsGridRef}
                  theme={themeQuartz}
                  rowData={data.actions}
                  columnDefs={actionColDefs}
                  defaultColDef={defaultColDef}
                  getRowId={(params) => params.data.id}
                  animateRows={false}
                />
              </div>
            </div>

          </div>

          {/* Side Panel for Conversations */}
          {selectedCustomerId && (
            <aside className="w-80 bg-white border-l shadow-xl flex flex-col h-full z-10">
              <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
                <h3 className="font-bold text-md truncate pr-4">
                  Transcript: {data.customers.find((c: any) => c.id === selectedCustomerId)?.name}
                </h3>
                <button 
                  onClick={() => setSelectedCustomerId(null)}
                  className="text-gray-500 hover:text-black font-bold text-xl leading-none"
                >
                  &times;
                </button>
              </div>
              <div className="flex-1 p-4 overflow-y-auto bg-gray-100 space-y-4">
                {convLoading ? (
                  <p className="text-sm text-gray-500 text-center mt-4">Loading transcript...</p>
                ) : conversations.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center mt-4">No conversation found.</p>
                ) : (
                  conversations.map((msg: any) => (
                    <div 
                      key={msg.id} 
                      className={`p-3 rounded-lg text-sm max-w-[90%] shadow-sm ${
                        msg.role === 'customer' 
                          ? 'bg-blue-600 text-white ml-auto' 
                          : 'bg-white text-gray-800 border'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.text}</p>
                    </div>
                  ))
                )}
              </div>
            </aside>
          )}
        </main>
      )}
    </div>
  );
}
