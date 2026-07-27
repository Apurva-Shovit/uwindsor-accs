import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Radio, Search, Tag, AlertCircle } from 'lucide-react';


export const RFIDScannerWidget: React.FC = () => {
  const [scanTag, setScanTag] = useState('');
  const [scanResult, setScanResult] = useState<any | null>(null);
  const [scanError, setScanError] = useState('');

  const { data: config } = useQuery({
    queryKey: ['rfidConfig'],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await fetch('http://localhost:8000/individual-fish/config', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch RFID config');
      return res.json();
    }
  });

  const isEnabled = config?.rfid_tracking_enabled ?? false;

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanTag.trim()) return;

    setScanError('');
    setScanResult(null);

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`http://localhost:8000/individual-fish/scan/${encodeURIComponent(scanTag.trim())}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error('No fish record found matching RFID tag');
      }
      const data = await res.json();
      setScanResult(data);
    } catch (err: any) {
      setScanError(err.message);
    }
  };

  if (!isEnabled) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-slate-400" />
          <span><strong>Individual Fish RFID Tracking:</strong> Feature toggle is currently disabled in system config.</span>
        </div>
        <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-600 font-mono text-[10px]">FLAG_DISABLED</span>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Tag className="w-4 h-4 text-[#005596]" />
          Individual Fish RFID Scanner Lookup
        </h3>
        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full">
          RFID ENABLED
        </span>
      </div>

      <form onSubmit={handleScan} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Scan RFID Tag or Enter Fish ID..."
            value={scanTag}
            onChange={(e) => setScanTag(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-[#005596] focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="bg-[#005596] hover:bg-[#002B51] text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          Lookup Tag
        </button>
      </form>

      {scanError && (
        <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {scanError}
        </div>
      )}

      {scanResult && (
        <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-lg text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#005596] text-sm">Fish ID: {scanResult.fish_id}</span>
            <span className="capitalize font-semibold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
              {scanResult.status}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-slate-600">
            <div>Species: <strong>{scanResult.species}</strong></div>
            <div>RFID Tag: <code className="font-mono text-slate-800">{scanResult.rfid_tag || 'N/A'}</code></div>
          </div>
        </div>
      )}
    </div>
  );
};
