import React, { useEffect, useState } from 'react';
import { getTanks, postWaterQualityLog, postWaterQualityBatch, postIncidentReport } from '../../lib/api';



// ─── Types ─────────────────────────────────────────────────────────────────

interface Tank { id: string; tank_number: string; }
type Tab = 'water' | 'teststrip' | 'incident' | 'batch';

interface ValidationResult {
  [param: string]: { value: number; in_range: boolean };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);

const fieldLabel: Record<string, string> = {
  ph: 'pH', temperature: 'Temperature (°C)', dissolved_oxygen: 'Dissolved Oxygen (mg/L)',
  nitrate: 'Nitrate (ppm)', nitrite: 'Nitrite (ppm)', hardness: 'Hardness (ppm)',
  chlorine: 'Chlorine (ppm)', alkalinity: 'Alkalinity (ppm)', ammonia: 'Ammonia (ppm)',
};

const safeRangeHint: Record<string, string> = {
  nitrate: '0–40 ppm', nitrite: '0 ppm', hardness: '20–450 ppm',
  chlorine: '0 ppm', alkalinity: '120–180 ppm', ph: '6.5–9.0', ammonia: '0–0.5 ppm',
  temperature: '0–40 °C', dissolved_oxygen: '5.0–15.0 mg/L',
};

// ─── Sub-components ─────────────────────────────────────────────────────────

function ValidationBadge({ field, result }: { field: string; result: ValidationResult }) {
  const r = result[field];
  if (!r || r.in_range) return null;
  return (
    <span className="ml-2 inline-flex items-center gap-1 text-red-600 text-xs font-semibold">
      Out of Range
    </span>
  );
}

function FieldInput({
  label, name, value, onChange, hint, result,
}: {
  label: string; name: string; value: string;
  onChange: (v: string) => void; hint?: string; result?: ValidationResult;
}) {
  const outOfRange = result?.[name]?.in_range === false;
  return (
    <div>
      <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">
        {label}
        {result && <ValidationBadge field={name} result={result} />}
      </label>
      {hint && <p className="text-xs text-textSecondary mb-1">Safe Range: {hint}</p>}
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue transition-colors
          ${outOfRange ? 'border-red-500 bg-red-50 focus:ring-red-400' : 'border-border focus:border-brandBlue'}`}
        required
      />
    </div>
  );
}

function TankSelect({ tanks, value, onChange }: { tanks: Tank[]; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">Tank</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue"
        required
      >
        <option value="">Select a tank…</option>
        {tanks.map(t => {
          const tankId = t.id || (t as any)._id || '';
          return <option key={tankId} value={tankId}>Tank {t.tank_number}</option>;
        })}
      </select>
    </div>
  );
}

function SuccessToast({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-green-600 text-white px-5 py-3 rounded-xl shadow-2xl text-sm font-semibold animate-fade-in">
      {msg}
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100 text-lg leading-none">×</button>
    </div>
  );
}

// ─── Water Quality Form ──────────────────────────────────────────────────────

function WaterQualityForm({ tanks }: { tanks: Tank[] }) {
  const [tankId, setTankId] = useState('');
  const [date, setDate] = useState(today());
  const [ph, setPh] = useState('');
  const [temp, setTemp] = useState('');
  const [dissolvedOxygen, setDissolvedOxygen] = useState('');
  const [comments, setComments] = useState('');
  const [loading, setLoading] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(''); setValidation(null);
    try {
      const params: Record<string, number> = { ph: +ph, temperature: +temp };
      if (dissolvedOxygen !== '') params.dissolved_oxygen = +dissolvedOxygen;

      const res = await postWaterQualityLog({
        tank_id: tankId, type: 'daily', date,
        parameters: params,
        comments: comments || undefined,
      });
      setValidation(res.data.validation);
      setToast('Daily log created!');
      setPh(''); setTemp(''); setDissolvedOxygen(''); setComments('');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Submission failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-lg bg-red-50 border border-red-300 text-red-700 px-4 py-3 text-sm">{error}</div>}
      <div className="grid grid-cols-2 gap-4">
        <TankSelect tanks={tanks} value={tankId} onChange={setTankId} />
        <div>
          <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue" required />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <FieldInput label={fieldLabel.ph} name="ph" value={ph} onChange={setPh} hint={safeRangeHint.ph} result={validation || undefined} />
        <FieldInput label={fieldLabel.temperature} name="temperature" value={temp} onChange={setTemp} hint={safeRangeHint.temperature} result={validation || undefined} />
        <FieldInput label={fieldLabel.dissolved_oxygen} name="dissolved_oxygen" value={dissolvedOxygen} onChange={setDissolvedOxygen} hint={safeRangeHint.dissolved_oxygen} result={validation || undefined} />
      </div>
      <div>
        <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">Comments</label>
        <textarea value={comments} onChange={e => setComments(e.target.value)} rows={2}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue" />
      </div>
      {validation && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
          <strong>Validation complete.</strong>{' '}
          {Object.entries(validation).filter(([, v]) => !v.in_range).length > 0
            ? `${Object.entries(validation).filter(([, v]) => !v.in_range).map(([k]) => fieldLabel[k] || k).join(', ')} out of safe range.`
            : 'All parameters within safe range.'}
        </div>
      )}
      <button type="submit" disabled={loading || !tankId}
        className="w-full rounded-xl bg-brandBlue py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
        {loading ? 'Submitting…' : 'Submit Daily Log'}
      </button>
      {toast && <SuccessToast msg={toast} onClose={() => setToast('')} />}
    </form>
  );
}

// ─── Test Strip Form ─────────────────────────────────────────────────────────

const testStripFields = ['nitrate', 'nitrite', 'hardness', 'chlorine', 'alkalinity', 'ph', 'ammonia'] as const;

function TestStripForm({ tanks }: { tanks: Tank[] }) {
  const [tankId, setTankId] = useState('');
  const [date, setDate] = useState(today());
  const [fields, setFields] = useState<Record<string, string>>({});
  const [comments, setComments] = useState('');
  const [loading, setLoading] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const set = (k: string) => (v: string) => setFields(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(''); setValidation(null);
    const params: Record<string, number> = {};
    for (const k of testStripFields) params[k] = +(fields[k] ?? 0);
    try {
      const res = await postWaterQualityLog({
        tank_id: tankId, type: 'test_strip', date, parameters: params,
        comments: comments || undefined,
      });
      setValidation(res.data.validation);
      setToast('Test strip log created!');
      setFields({}); setComments('');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Submission failed');
    } finally {
      setLoading(false);
    }
  };

  const outOfRangeFields = validation ? Object.entries(validation).filter(([, v]) => !v.in_range).map(([k]) => k) : [];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-lg bg-red-50 border border-red-300 text-red-700 px-4 py-3 text-sm">{error}</div>}
      <div className="grid grid-cols-2 gap-4">
        <TankSelect tanks={tanks} value={tankId} onChange={setTankId} />
        <div>
          <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue" required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {testStripFields.map(f => (
          <FieldInput key={f} label={fieldLabel[f]} name={f} value={fields[f] ?? ''}
            onChange={set(f)} hint={safeRangeHint[f]} result={validation || undefined} />
        ))}
      </div>
      <div>
        <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">Comments</label>
        <textarea value={comments} onChange={e => setComments(e.target.value)} rows={2}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue" />
      </div>
      {validation && (
        <div className={`rounded-lg px-4 py-3 text-sm border ${outOfRangeFields.length > 0 ? 'bg-red-50 border-red-300 text-red-800' : 'bg-green-50 border-green-300 text-green-800'}`}>
          {outOfRangeFields.length > 0
            ? <>⚠ <strong>Out of range:</strong> {outOfRangeFields.map(k => fieldLabel[k] || k).join(', ')}</>
            : <>✅ All parameters within safe range.</>}
        </div>
      )}
      <button type="submit" disabled={loading || !tankId}
        className="w-full rounded-xl bg-brandBlue py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
        {loading ? 'Submitting…' : 'Submit Test Strip Log'}
      </button>
      {toast && <SuccessToast msg={toast} onClose={() => setToast('')} />}
    </form>
  );
}

// ─── Incident Report Form ─────────────────────────────────────────────────────

function ToggleSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer select-none">
      <span className="text-sm font-medium text-textPrimary">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brandBlue
          ${checked ? 'bg-brandBlue' : 'bg-gray-300'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </label>
  );
}

function IncidentReportForm({ tanks }: { tanks: Tank[] }) {
  const [tankId, setTankId] = useState('');
  const [date, setDate] = useState(today());
  const [problem, setProblem] = useState('');
  const [comments, setComments] = useState('');
  const [treatment, setTreatment] = useState('');
  const [aquatic, setAquatic] = useState(false);
  const [vet, setVet] = useState(false);
  const [researcher, setResearcher] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await postIncidentReport({
        tank_id: tankId, date, problem, comments: comments || undefined,
        treatment: treatment || undefined,
        aquatic_condition_checked: aquatic, vet_contacted: vet, researcher_notified: researcher,
      });
      setToast('Incident report created!');
      setProblem(''); setComments(''); setTreatment('');
      setAquatic(false); setVet(false); setResearcher(false);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Submission failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-lg bg-red-50 border border-red-300 text-red-700 px-4 py-3 text-sm">{error}</div>}
      <div className="grid grid-cols-2 gap-4">
        <TankSelect tanks={tanks} value={tankId} onChange={setTankId} />
        <div>
          <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue" required />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">Problem <span className="text-red-500">*</span></label>
        <textarea value={problem} onChange={e => setProblem(e.target.value)} rows={3}
          placeholder="Describe the issue observed…"
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue" required />
      </div>
      <div>
        <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">Treatment</label>
        <textarea value={treatment} onChange={e => setTreatment(e.target.value)} rows={2}
          placeholder="Actions taken…"
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue" />
      </div>
      <div>
        <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">Comments</label>
        <textarea value={comments} onChange={e => setComments(e.target.value)} rows={2}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue" />
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
        <p className="text-xs font-bold uppercase text-textSecondary tracking-wide">Checklist</p>
        <ToggleSwitch label="Aquatic Condition Checked" checked={aquatic} onChange={setAquatic} />
        <ToggleSwitch label="Vet Contacted" checked={vet} onChange={setVet} />
        <ToggleSwitch label="Researcher Notified" checked={researcher} onChange={setResearcher} />
      </div>
      {vet && (
        <div className="flex items-start gap-3 rounded-lg border-l-4 border-yellow-500 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          <span className="text-lg">⚠</span>
          <span>This incident will be <strong>highlighted on the Manager dashboard</strong> because Vet Contacted is enabled.</span>
        </div>
      )}
      <button type="submit" disabled={loading || !tankId || !problem}
        className="w-full rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
        {loading ? 'Submitting…' : 'Submit Incident Report'}
      </button>
      {toast && <SuccessToast msg={toast} onClose={() => setToast('')} />}
    </form>
  );
}

// ─── Batch Entry ──────────────────────────────────────────────────────────────

type BatchStep = 'select' | 'fill' | 'review';

const GROUPS: Record<string, string> = { 'Tanks 1–8': '1-8', 'Tanks 9–14': '9-14', 'Custom': 'custom' };

function BatchEntry({ tanks }: { tanks: Tank[] }) {
  const [step, setStep] = useState<BatchStep>('select');
  const [group, setGroup] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [logType, setLogType] = useState<'daily' | 'test_strip'>('daily');
  const [date, setDate] = useState(today());
  const [params, setParams] = useState<Record<string, string>>({});
  const [comments, setComments] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  const fields = logType === 'daily'
    ? ['ph', 'temperature', 'dissolved_oxygen']
    : testStripFields as unknown as string[];

  const setParam = (k: string) => (v: string) => setParams(p => ({ ...p, [k]: v }));

  const sortedTanks = React.useMemo(() => {
    return [...tanks].sort((a, b) => {
      const numA = parseInt(a.tank_number, 10);
      const numB = parseInt(b.tank_number, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return (a.tank_number || '').localeCompare(b.tank_number || '', undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [tanks]);

  const applyGroup = (g: string) => {
    setGroup(g);
    if (g === 'custom') { setSelectedIds([]); return; }
    const [lo, hi] = g.split('-').map(Number);
    const ids = sortedTanks.filter(t => {
      const n = parseInt(t.tank_number, 10);
      return n >= lo && n <= hi;
    }).map(t => t.id || (t as any)._id || '');
    setSelectedIds(ids);
  };

  const toggleCustom = (id: string) =>
    setSelectedIds(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const selectedTanks = sortedTanks.filter(t => selectedIds.includes(t.id || (t as any)._id || ''));

  const handleSubmit = async () => {
    setLoading(true); setError(''); setValidation(null);
    const numParams: Record<string, number> = {};
    for (const k of fields) numParams[k] = +(params[k] ?? 0);
    try {
      const res = await postWaterQualityBatch({
        type: logType, tank_ids: selectedIds, date, parameters: numParams,
        comments: comments || undefined,
      });
      setValidation(res.data.validation);
      setToast(`${res.data.created} Logs Created`);
      setStep('select'); setSelectedIds([]); setParams({});
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Submission failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg bg-red-50 border border-red-300 text-red-700 px-4 py-3 text-sm">{error}</div>}

      {/* Step 1: Select Group */}
      {step === 'select' && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-2">Tank Group</label>
            <div className="grid grid-cols-3 gap-3">
              {Object.keys(GROUPS).map(g => (
                <button key={g} type="button" onClick={() => applyGroup(GROUPS[g])}
                  className={`rounded-xl border-2 py-3 text-sm font-semibold transition-all
                    ${group === GROUPS[g] ? 'border-brandBlue bg-blue-50 text-brandBlue' : 'border-border bg-white text-textPrimary hover:border-brandBlue'}`}>
                  {g}
                </button>
              ))}
            </div>
          </div>
          {group === 'custom' && (
            <div>
              <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-2">Select Tanks</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-48 overflow-y-auto border border-border rounded-lg p-3 bg-surface">
                {sortedTanks.map(t => {
                  const tankId = t.id || (t as any)._id || '';
                  return (
                    <label key={tankId} htmlFor={`batch-tank-${tankId}`} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 rounded hover:bg-white transition-colors">
                      <input id={`batch-tank-${tankId}`} type="checkbox" checked={selectedIds.includes(tankId)}
                        onChange={() => toggleCustom(tankId)}
                        className="rounded border-border text-brandBlue focus:ring-brandBlue cursor-pointer" />
                      <span className="font-medium text-textPrimary">Tank {t.tank_number}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {selectedIds.length > 0 && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-800">
              {selectedIds.length} tank(s) selected
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">Log Type</label>
            <select value={logType} onChange={e => setLogType(e.target.value as 'daily' | 'test_strip')}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue">
              <option value="daily">Daily Water Quality</option>
              <option value="test_strip">Test Strip</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            {fields.map(f => (
              <FieldInput key={f} label={fieldLabel[f]} name={f} value={params[f] ?? ''}
                onChange={setParam(f)} hint={safeRangeHint[f]} />
            ))}
          </div>
          <div>
            <label className="block text-xs font-semibold text-textSecondary uppercase tracking-wide mb-1">Comments</label>
            <textarea value={comments} onChange={e => setComments(e.target.value)} rows={2}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandBlue" />
          </div>
          <button
            type="button"
            onClick={() => setStep('review')}
            disabled={selectedIds.length === 0}
            className="w-full rounded-xl bg-brandBlue py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
            Continue → Review
          </button>
        </div>
      )}

      {/* Step 2: Review */}
      {step === 'review' && (
        <div className="space-y-4">
          <h3 className="text-base font-bold text-textPrimary">Review Batch Submission</h3>
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {selectedTanks.map((t, i) => {
              const tankId = t.id || (t as any)._id || '';
              return (
                <div key={tankId} className="rounded-xl border border-border bg-surface p-4">
                  <p className="font-semibold text-textPrimary mb-2">Tank {t.tank_number}</p>
                  <div className="grid grid-cols-2 gap-1 text-sm text-textSecondary">
                    {fields.map(f => (
                      <span key={f}><strong>{fieldLabel[f]}:</strong> {params[f] ?? '—'}</span>
                    ))}
                    {comments && <span className="col-span-2"><strong>Comments:</strong> {comments}</span>}
                  </div>
                  {i < selectedTanks.length - 1 && <hr className="mt-3 border-border" />}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-textSecondary text-center">This will create {selectedTanks.length} independent, immutable log entries.</p>
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep('select')}
              className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold text-textPrimary hover:bg-surface transition-colors">
              ← Back
            </button>
            <button type="button" onClick={handleSubmit} disabled={loading}
              className="flex-1 rounded-xl bg-brandBlue py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {loading ? 'Submitting…' : `Submit ${selectedTanks.length} Logs`}
            </button>
          </div>
          {validation && (
            <div className={`rounded-lg px-4 py-3 text-sm border ${Object.values(validation).some(v => !v.in_range) ? 'bg-red-50 border-red-300 text-red-800' : 'bg-green-50 border-green-300 text-green-800'}`}>
              {Object.entries(validation).filter(([, v]) => !v.in_range).length > 0
                ? `⚠ Out of range: ${Object.entries(validation).filter(([, v]) => !v.in_range).map(([k]) => fieldLabel[k] || k).join(', ')}`
                : '✅ All parameters within safe range.'}
            </div>
          )}
        </div>
      )}
      {toast && <SuccessToast msg={toast} onClose={() => setToast('')} />}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: 'water', label: 'Water Quality' },
  { id: 'teststrip', label: 'Test Strip' },
  { id: 'incident', label: 'Incident Report' },
  { id: 'batch', label: 'Batch Entry' },
];

export const LogEntryPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('water');
  const [tanks, setTanks] = useState<Tank[]>([]);

  useEffect(() => {
    getTanks().then(r => {
      const sorted = [...(r.data || [])].sort((a: Tank, b: Tank) => {
        const numA = parseInt(a.tank_number, 10);
        const numB = parseInt(b.tank_number, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return (a.tank_number || '').localeCompare(b.tank_number || '', undefined, { numeric: true, sensitivity: 'base' });
      });
      setTanks(sorted);
    }).catch(() => {});
  }, []);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-textPrimary">Daily Log Entry</h1>
        <p className="text-sm text-textSecondary mt-1">All logs are immutable. Corrections create new records.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl bg-surface border border-border p-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            id={`log-tab-${tab.id}`}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-all
              ${activeTab === tab.id
                ? 'bg-white text-brandBlue shadow-sm border border-border'
                : 'text-textSecondary hover:text-textPrimary'}`}
          >
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Form panel */}
      <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
        {activeTab === 'water' && <WaterQualityForm tanks={tanks} />}
        {activeTab === 'teststrip' && <TestStripForm tanks={tanks} />}
        {activeTab === 'incident' && <IncidentReportForm tanks={tanks} />}
        {activeTab === 'batch' && <BatchEntry tanks={tanks} />}
      </div>
    </div>
  );
};

export default LogEntryPage;
