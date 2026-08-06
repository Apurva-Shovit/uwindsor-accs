import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ShieldAlert, FileJson, FileSpreadsheet, AlertTriangle } from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';
import { getExportPreview, downloadExport } from '../../lib/api';

const UWindsorBufferingLoader: React.FC<{ message?: string }> = ({ message = "Synchronizing ACARE Facility Data..." }) => (
  <div className="flex flex-col items-center justify-center py-12 px-6 bg-gradient-to-b from-blue-50/40 via-white to-amber-50/20 border border-blue-100 rounded-2xl shadow-sm text-center space-y-4 my-4">
    <div className="relative flex items-center justify-center w-14 h-14">
      <div className="absolute inset-0 rounded-full border-4 border-[#FFCE00]/50 animate-ping" />
      <div className="w-12 h-12 border-4 border-[#005596] border-t-[#FFCE00] border-r-[#005596] rounded-full animate-spin shadow-md" />
      <div className="absolute w-2.5 h-2.5 bg-[#005596] rounded-full shadow" />
    </div>
    <div className="space-y-1">
      <h4 className="text-xs font-extrabold text-[#005596] uppercase tracking-wider">University of Windsor ACARE System</h4>
      <p className="text-xs font-bold text-slate-600 animate-pulse">{message}</p>
    </div>
  </div>
);

const COLLECTION_LABELS: Record<string, string> = {
  users: 'Users',
  facilities: 'Facilities',
  rooms: 'Rooms',
  tanks: 'Tanks',
  species: 'Species',
  projects: 'Research Projects',
  tank_assignments: 'Tank Assignments',
  individual_fish: 'Individual Fish (RFID)',
  census_events: 'Census Events',
  water_quality_logs: 'Water Quality Logs',
  incident_reports: 'Incident Reports',
  quarantine_exemptions: 'Quarantine Exemptions',
  audit_logs: 'Audit Logs',
};

export const ExportPage: React.FC = () => {
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [format, setFormat] = React.useState<'json' | 'csv'>('csv');
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  const [error, setError] = React.useState('');

  const debouncedStart = useDebounce(startDate, 500);
  const debouncedEnd = useDebounce(endDate, 500);

  const rangeError = startDate && endDate && startDate > endDate ? 'From date must be on or before To date.' : '';

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['exportPreview', debouncedStart, debouncedEnd],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (debouncedStart) params.start_date = debouncedStart;
      if (debouncedEnd) params.end_date = debouncedEnd;
      const res = await getExportPreview(params);
      return res.data;
    },
    enabled: !rangeError,
  });

  const recordCounts: Record<string, number> = preview?.record_counts || {};
  const totalRecords = Object.values(recordCounts).reduce((sum: number, n) => sum + (n || 0), 0);

  const handleFullBackup = () => {
    setStartDate('');
    setEndDate('');
    setFormat('json');
  };

  const handleConfirmDownload = async () => {
    setDownloading(true);
    setError('');
    try {
      const params: { start_date?: string; end_date?: string; format: 'json' | 'csv' } = { format };
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      const res = await downloadExport(params);
      const blob = new Blob([res.data], { type: format === 'json' ? 'application/json' : 'application/zip' });
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `acare_backup_${today}.${format === 'json' ? 'json' : 'zip'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setShowConfirm(false);
    } catch (err) {
      setError('Export failed. Please try again or contact your system administrator.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl font-extrabold text-[#005596] flex items-center gap-2">
          <Download className="w-7 h-7 text-[#005596]" />
          Data Export &amp; Backup
        </h1>
        <p className="text-xs text-slate-500 mt-1 max-w-2xl">
          Download a complete backup of all ACARE data. Static reference data (users, facilities, rooms, tanks, species) is always
          exported in full; the date range below only scopes event records (projects, census, water quality, incidents,
          quarantine exemptions, audit logs).
        </p>
      </div>

      {/* Date Range + Format */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">From Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#005596]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">To Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#005596]"
              />
            </div>
            {(startDate || endDate) && (
              <button
                onClick={() => { setStartDate(''); setEndDate(''); }}
                className="text-xs font-bold text-red-600 hover:underline mb-2.5"
              >
                Clear Range
              </button>
            )}
          </div>
          <button
            onClick={handleFullBackup}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs rounded-xl transition-colors whitespace-nowrap"
          >
            Full Backup (Everything)
          </button>
        </div>

        {rangeError && <p className="text-xs font-bold text-red-600">{rangeError}</p>}

        {/* Format Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => setFormat('json')}
            className={`text-left rounded-2xl border-2 p-4 transition-colors ${
              format === 'json' ? 'border-[#005596] bg-blue-50/50' : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <FileJson className="w-5 h-5 text-[#005596]" />
              <span className="text-sm font-extrabold text-slate-800">JSON Backup (Machine)</span>
            </div>
            <p className="text-xs text-slate-500">
              Complete structured bundle for future recovery/import. Includes every field, including credential data. Handle as a secret.
            </p>
          </button>
          <button
            onClick={() => setFormat('csv')}
            className={`text-left rounded-2xl border-2 p-4 transition-colors ${
              format === 'csv' ? 'border-[#005596] bg-blue-50/50' : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
              <span className="text-sm font-extrabold text-slate-800">CSV Workbook (Human)</span>
            </div>
            <p className="text-xs text-slate-500">
              A .zip of readable CSV files, one per collection, plus a summary manifest. Excludes credential data. Safe for
              sharing within authorised teams.
            </p>
          </button>
        </div>
      </div>

      {/* Record Count Preview */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            {startDate || endDate ? 'Records In Selected Range' : 'All Records (Full Backup)'}
          </h3>
          <span className="text-xs font-bold text-slate-600">{totalRecords.toLocaleString()} total records</span>
        </div>
        {previewLoading ? (
          <UWindsorBufferingLoader message="Calculating record counts..." />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {Object.entries(recordCounts).map(([name, count]) => (
              <div key={name} className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                  {COLLECTION_LABELS[name] || name}
                </span>
                <span className="text-lg font-extrabold text-slate-800">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 text-xs text-red-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Download Button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowConfirm(true)}
          disabled={!!rangeError}
          className="px-6 py-3 bg-[#005596] hover:bg-[#002B51] disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-sm rounded-xl shadow-sm transition-colors flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Download Export
        </button>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold uppercase mb-1 ${
                    format === 'json' ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {format === 'json' ? 'Machine Backup' : 'Human Workbook'}
                </span>
                <h3 className="text-xl font-bold text-slate-900">Confirm Data Export</h3>
              </div>
              <button
                onClick={() => !downloading && setShowConfirm(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-slate-600 space-y-1">
              <div>
                <strong>Scope:</strong>{' '}
                {startDate || endDate ? `${startDate || 'Beginning'} to ${endDate || 'Today'}` : 'Full Backup (all data)'}
              </div>
              <div><strong>Format:</strong> {format === 'json' ? 'JSON (machine-readable)' : 'CSV workbook (.zip)'}</div>
              <div><strong>Total Records:</strong> {totalRecords.toLocaleString()}</div>
            </div>

            {format === 'json' && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 space-y-1 text-xs text-amber-900">
                <div className="font-bold flex items-center gap-1.5 text-amber-800">
                  <ShieldAlert className="w-4 h-4 text-amber-600" /> Security Notice
                </div>
                <p>
                  This export contains password hashes for all user accounts. Treat this file as a secret: do not upload it
                  to shared drives, send it via email, or store it anywhere outside a secure, access-controlled location.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={downloading}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDownload}
                disabled={downloading}
                className="px-4 py-2 bg-[#005596] hover:bg-[#002B51] text-white font-extrabold text-xs rounded-xl shadow transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {downloading ? 'Preparing Download...' : 'Download'}
              </button>
            </div>

            {downloading && <UWindsorBufferingLoader message="Building your export bundle..." />}
          </div>
        </div>
      )}
    </div>
  );
};

export default ExportPage;
