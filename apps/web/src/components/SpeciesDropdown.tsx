import React, { useEffect, useState } from 'react';
import { getSpecies, createSpecies } from '../lib/api';

interface SpeciesDropdownProps {
  species: string;
  setSpecies: (value: string) => void;
}

const SpeciesDropdown: React.FC<SpeciesDropdownProps> = ({ species, setSpecies }) => {
  const [speciesList, setSpeciesList] = useState<string[]>([]);
  const [showOtherInput, setShowOtherInput] = useState(false);
  const [newSpecies, setNewSpecies] = useState('');

  const fetchSpecies = async () => {
    try {
      const res = await getSpecies();
      // Assuming API returns { data: [{ name: string }, ...] } or plain array of names
      const data = res.data;
      const names: string[] = Array.isArray(data)
        ? data.map((item: any) => (typeof item === 'string' ? item : item.name))
        : [];
      setSpeciesList(names);
    } catch (err) {
      console.error('Failed to fetch species list', err);
    }
  };

  useEffect(() => {
    fetchSpecies();
  }, []);

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === 'Other') {
      setShowOtherInput(true);
      setNewSpecies('');
    } else {
      setShowOtherInput(false);
      setSpecies(value);
    }
  };

  const selectedValue = showOtherInput ? 'Other' : (speciesList.includes(species) ? species : '');

  const handleAddNewSpecies = async () => {
    if (!newSpecies.trim()) return;
    try {
      await createSpecies({ name: newSpecies.trim() });
      // Refresh list and select the newly added species
      await fetchSpecies();
      setSpecies(newSpecies.trim());
      setShowOtherInput(false);
    } catch (err) {
      console.error('Failed to create species', err);
    }
  };

  return (
    <div className="space-y-2">
      <select
        value={selectedValue}
        onChange={handleSelectChange}
        className="w-full rounded border border-border px-3 py-1.5 text-xs focus:outline-none focus:border-brandBlue"
      >
        <option value="" disabled>
          Select species
        </option>
        {speciesList.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
        <option value="Other">Other</option>
      </select>

      {showOtherInput && (
        <div className="flex gap-2 items-center mt-2">
          <input
            type="text"
            placeholder="New species name"
            value={newSpecies}
            onChange={(e) => setNewSpecies(e.target.value)}
            className="flex-1 rounded border border-border px-3 py-1.5 text-xs focus:outline-none focus:border-brandBlue"
          />
          <button
            type="button"
            onClick={handleAddNewSpecies}
            className="rounded bg-brandBlue px-3 py-1 text-xs text-white hover:bg-brandBlueDark"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
};

export default SpeciesDropdown;
