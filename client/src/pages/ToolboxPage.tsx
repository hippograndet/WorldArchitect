import { useState, useEffect, useCallback, useRef } from 'react';
import { Trash2, RefreshCw, ExternalLink, Plus, Copy, Check, ChevronDown, ChevronRight, Upload } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { useStore } from '../stores/index.ts';
import type { NameEntry, CulturalProfile, NameEntityType, NameGender, NameSocialClass, NameComponent, EntityMention } from '../types/world.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENTITY_TYPES: { value: NameEntityType; label: string }[] = [
  { value: 'person',  label: 'Person' },
  { value: 'place',   label: 'Place' },
  { value: 'faction', label: 'Faction' },
  { value: 'concept', label: 'Concept' },
];

const ENTITY_COLORS: Record<NameEntityType, string> = {
  person:  'bg-blue-100 text-blue-700',
  place:   'bg-green-100 text-green-700',
  faction: 'bg-orange-100 text-orange-700',
  concept: 'bg-violet-100 text-violet-700',
};

const PROMPT_LAB_FOCUSES = [
  { value: '',                   label: 'General' },
  { value: 'atmosphere & vibe',  label: 'Atmosphere' },
  { value: 'writing style',      label: 'Writing Style' },
  { value: 'narrative rules',    label: 'Narrative Rules' },
  { value: 'character voice',    label: 'Character Voice' },
  { value: 'world rules',        label: 'World Rules' },
];

type Tab = 'nameBank' | 'promptLab';

// ---------------------------------------------------------------------------
// ToolboxPage
// ---------------------------------------------------------------------------

export default function ToolboxPage() {
  const { wid } = useParams<{ wid: string }>();
  const navigate  = useNavigate();
  const { addToast, worlds } = useStore();
  const currentWorld = worlds.find((w) => w.id === wid);

  const [activeTab, setActiveTab] = useState<Tab>('nameBank');

  // ── Name bank state ──────────────────────────────────────────────────────
  const [profiles, setProfiles]           = useState<CulturalProfile[]>([]);
  const [profileId, setProfileId]         = useState('');
  const [entityType, setEntityType]       = useState<NameEntityType>('person');
  const [gender, setGender]               = useState<NameGender | ''>('');          // '' = any
  const [socialClass, setSocialClass]     = useState<NameSocialClass | ''>('');     // '' = both
  const [nameComponent, setNameComponent] = useState<NameComponent>('full');
  const [count, setCount]                 = useState(8);
  const [tagInput, setTagInput]           = useState('');
  const [candidates, setCandidates]       = useState<string[]>([]);
  const [selected, setSelected]           = useState<Set<string>>(new Set());
  const [generating, setGenerating]       = useState(false);
  const [saving, setSaving]               = useState(false);

  // Manual add
  const [manualName, setManualName]       = useState('');
  const [manualSaving, setManualSaving]   = useState(false);

  // File upload
  const fileInputRef                      = useRef<HTMLInputElement>(null);
  const [uploadedNames, setUploadedNames] = useState<string[]>([]);
  const [uploadSaving, setUploadSaving]   = useState(false);

  // Saved names
  const [savedNames, setSavedNames]       = useState<NameEntry[]>([]);
  const [filterType, setFilterType]       = useState<NameEntityType | ''>('');
  const [loadingNames, setLoadingNames]   = useState(false);
  const [showSavedNames, setShowSavedNames] = useState(true);

  // Discovered entities
  const [mentions, setMentions]             = useState<EntityMention[]>([]);
  const [loadingMentions, setLoadingMentions] = useState(false);
  const [showEntities, setShowEntities]     = useState(false);

  // ── Prompt Lab state ──────────────────────────────────────────────────────
  const [promptFocus, setPromptFocus]     = useState('');
  const [promptNotes, setPromptNotes]     = useState('');
  const [promptOutput, setPromptOutput]   = useState('');
  const [promptGenerating, setPromptGenerating] = useState(false);
  const [promptCopied, setPromptCopied]   = useState(false);

  // ── Data loading ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!wid) return;
    setLoadingNames(true);
    api.names.list(wid).then(({ names, profiles: p }) => {
      setSavedNames(names);
      setProfiles(p);
      if (p.length > 0 && !profileId) setProfileId(p[0].id);
    }).catch((err: Error) => addToast({ message: err.message, type: 'error' }))
      .finally(() => setLoadingNames(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid]);

  const loadSavedNames = useCallback(async () => {
    if (!wid) return;
    try {
      const { names } = await api.names.list(wid, filterType ? { entityType: filterType } : undefined);
      setSavedNames(names);
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    }
  }, [wid, filterType, addToast]);

  useEffect(() => { loadSavedNames(); }, [loadSavedNames]);

  const loadMentions = useCallback(async () => {
    if (!wid) return;
    setLoadingMentions(true);
    try {
      const m = await api.entityMentions.list(wid);
      setMentions(m);
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setLoadingMentions(false);
    }
  }, [wid, addToast]);

  useEffect(() => {
    if (showEntities) loadMentions();
  }, [showEntities, loadMentions]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!wid || !profileId) return;
    setGenerating(true);
    setCandidates([]);
    setSelected(new Set());
    try {
      const { names } = await api.names.generate(wid, profileId, entityType, count, {
        gender: entityType === 'person' && gender ? gender : undefined,
        socialClass: entityType === 'person' && socialClass ? socialClass : undefined,
        nameComponent: entityType === 'person' ? nameComponent : undefined,
      });
      setCandidates(names);
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  const toggleCandidate = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const handleSave = async () => {
    if (!wid || selected.size === 0) return;
    const tags = tagInput.split(',').map((t) => t.trim()).filter(Boolean);
    setSaving(true);
    try {
      await api.names.save(wid, [...selected].map((name) => ({
        name, profileId, entityType,
        gender: entityType === 'person' && gender ? gender : 'neutral',
        socialClass: entityType === 'person' && socialClass ? socialClass : 'common',
        nameComponent: entityType === 'person' ? nameComponent : 'full',
        tags,
        source: 'generated' as const,
      })));
      addToast({ message: `Saved ${selected.size} name${selected.size > 1 ? 's' : ''}.`, type: 'success' });
      setCandidates([]);
      setSelected(new Set());
      setTagInput('');
      await loadSavedNames();
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleManualSave = async () => {
    if (!wid || !manualName.trim()) return;
    const tags = tagInput.split(',').map((t) => t.trim()).filter(Boolean);
    setManualSaving(true);
    try {
      await api.names.save(wid, [{
        name: manualName.trim(), profileId: profileId || 'roman', entityType,
        gender: entityType === 'person' && gender ? gender : 'neutral',
        socialClass: entityType === 'person' && socialClass ? socialClass : 'common',
        nameComponent: entityType === 'person' ? nameComponent : 'full',
        tags,
        source: 'user' as const,
      }]);
      addToast({ message: 'Name saved.', type: 'success' });
      setManualName('');
      await loadSavedNames();
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setManualSaving(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const names = text.split(/[\n,;]+/).map((n) => n.trim()).filter((n) => n.length > 0 && n.length < 100);
      setUploadedNames(names);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleUploadSave = async () => {
    if (!wid || uploadedNames.length === 0) return;
    setUploadSaving(true);
    try {
      await api.names.save(wid, uploadedNames.map((name) => ({
        name, profileId: profileId || 'roman', entityType,
        gender: 'neutral' as const, socialClass: 'common' as const, nameComponent: 'full' as const,
        tags: [], source: 'user' as const,
      })));
      addToast({ message: `Saved ${uploadedNames.length} names from file.`, type: 'success' });
      setUploadedNames([]);
      await loadSavedNames();
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setUploadSaving(false);
    }
  };

  const handleDelete = async (nid: string) => {
    if (!wid) return;
    try {
      await api.names.delete(wid, nid);
      setSavedNames((prev) => prev.filter((n) => n.id !== nid));
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    }
  };

  const handleIgnoreMention = async (mid: string) => {
    if (!wid) return;
    try {
      await api.entityMentions.ignore(wid, mid);
      setMentions((prev) => prev.map((m) => m.id === mid ? { ...m, status: 'ignored' as const } : m));
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    }
  };

  const handlePromptGenerate = async () => {
    if (!wid || !promptNotes.trim() || !currentWorld) return;
    setPromptGenerating(true);
    setPromptOutput('');
    try {
      const result = await api.worlds.promptEngineer({
        wid,
        fieldType: 'prompt_lab',
        rawText: promptNotes,
        worldName: currentWorld.name,
        worldDescription: currentWorld.description,
        focus: promptFocus || undefined,
      });
      if ('expandedDescription' in result) setPromptOutput(result.expandedDescription);
    } catch (err) {
      addToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setPromptGenerating(false);
    }
  };

  const handlePromptCopy = async () => {
    if (!promptOutput) return;
    await navigator.clipboard.writeText(promptOutput);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  };

  // ── Derived ──────────────────────────────────────────────────────────────

  const currentProfile     = profiles.find((p) => p.id === profileId);
  const profileExamples    = savedNames.filter((n) => n.profileId === profileId).slice(0, 6);
  const filteredNames      = filterType ? savedNames.filter((n) => n.entityType === filterType) : savedNames;
  const activeMentions     = mentions.filter((m) => m.status === 'created');
  const ignoredMentions    = mentions.filter((m) => m.status === 'ignored');

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto py-8 px-6">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Toolbox</h1>
      <p className="text-sm text-gray-500 mb-6">World-building utilities.</p>

      {/* Tabs */}
      <div className="flex gap-1 mb-8 border-b border-gray-200">
        {([['nameBank', 'Name Bank'], ['promptLab', 'Prompt Lab']] as [Tab, string][]).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-purple-600 text-purple-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════ NAME BANK TAB ═══════════════════════ */}
      {activeTab === 'nameBank' && (
        <>
          {/* 1. Cultural Profile */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-gray-800 mb-3">Cultural Profile</h2>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {profiles.map((p) => {
                const examplesForProfile = savedNames.filter((n) => n.profileId === p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => setProfileId(p.id)}
                    className={`text-left p-3 rounded-xl border transition-colors ${
                      profileId === p.id
                        ? 'border-purple-400 bg-purple-50'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <p className={`text-xs font-semibold mb-0.5 ${profileId === p.id ? 'text-purple-800' : 'text-gray-800'}`}>
                      {p.label}
                    </p>
                    <p className="text-xs text-gray-400 leading-tight mb-1">{p.feel}</p>
                    {examplesForProfile.length > 0 && (
                      <p className="text-[11px] text-gray-400 truncate">
                        e.g. {examplesForProfile.slice(0, 3).map((n) => n.name).join(', ')}
                      </p>
                    )}
                    {examplesForProfile.length === 0 && (
                      <p className="text-[11px] text-gray-300 italic">No names saved yet</p>
                    )}
                  </button>
                );
              })}
            </div>
            {currentProfile && profileExamples.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-1">
                {profileExamples.map((n) => (
                  <span key={n.id} className={`text-xs px-2 py-0.5 rounded-full font-medium ${ENTITY_COLORS[n.entityType]}`}>
                    {n.name}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* 2. Entity Type + Params + Generate */}
          <section className="border border-gray-200 rounded-xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">Generate Names</h2>

            {/* Entity type pills */}
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-600 block mb-2">Entity Type</label>
              <div className="flex gap-2">
                {ENTITY_TYPES.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setEntityType(value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      entityType === value
                        ? 'border-purple-400 bg-purple-600 text-white'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Person-specific params */}
            {entityType === 'person' && (
              <div className="grid grid-cols-3 gap-4 mb-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
                {/* Gender */}
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1.5">Gender</label>
                  <div className="flex flex-col gap-1">
                    {([['', 'Any'], ['male', 'Male'], ['female', 'Female']] as [NameGender | '', string][]).map(([v, l]) => (
                      <label key={v} className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" name="gender" value={v} checked={gender === v}
                          onChange={() => setGender(v)} className="accent-purple-600" />
                        <span className="text-xs text-gray-700">{l}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Component */}
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1.5">Component</label>
                  <div className="flex flex-col gap-1">
                    {([['full', 'Full name'], ['first', 'First name'], ['family', 'Family name']] as [NameComponent, string][]).map(([v, l]) => (
                      <label key={v} className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" name="nameComponent" value={v} checked={nameComponent === v}
                          onChange={() => setNameComponent(v)} className="accent-purple-600" />
                        <span className="text-xs text-gray-700">{l}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Social class */}
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1.5">Social Class</label>
                  <div className="flex flex-col gap-1">
                    {([['', 'Any'], ['common', 'Common'], ['noble', 'Noble']] as [NameSocialClass | '', string][]).map(([v, l]) => (
                      <label key={v} className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" name="socialClass" value={v} checked={socialClass === v}
                          onChange={() => setSocialClass(v)} className="accent-purple-600" />
                        <span className="text-xs text-gray-700">{l}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Count + tags row */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Count</label>
                <input
                  type="number" min={1} max={20} value={count}
                  onChange={(e) => setCount(Math.min(20, Math.max(1, Number(e.target.value))))}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-purple-300"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Tags <span className="text-gray-400">(optional)</span></label>
                <input
                  type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                  placeholder="noble, northern…"
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-purple-300 placeholder:text-gray-300"
                />
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={generating || !profileId}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-40 transition-colors mb-4"
            >
              <RefreshCw size={12} className={generating ? 'animate-spin' : ''} />
              {generating ? 'Generating…' : `Generate ${count} name${count !== 1 ? 's' : ''}`}
            </button>

            {/* Candidates */}
            {candidates.length > 0 && (
              <>
                <div className="flex flex-wrap gap-2 mb-4">
                  {candidates.map((name) => {
                    const checked = selected.has(name);
                    return (
                      <button key={name} type="button" onClick={() => toggleCandidate(name)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                          checked ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-700 border-gray-300 hover:border-purple-400'
                        }`}
                      >
                        <span className={`w-3 h-3 rounded-full border flex items-center justify-center shrink-0 ${checked ? 'bg-white border-white' : 'border-gray-400'}`}>
                          {checked && <span className="w-1.5 h-1.5 rounded-full bg-purple-600 block" />}
                        </span>
                        {name}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={handleSave} disabled={selected.size === 0 || saving}
                    className="px-4 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors">
                    {saving ? 'Saving…' : `Save selected (${selected.size})`}
                  </button>
                  <button onClick={() => setSelected(new Set(candidates))} className="text-xs text-gray-500 hover:text-gray-700">Select all</button>
                  <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:text-gray-700">Clear</button>
                </div>
              </>
            )}
          </section>

          {/* 3. Add to Bank */}
          <section className="border border-gray-200 rounded-xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">Add to Name Bank</h2>

            {/* Manual */}
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-600 block mb-1.5">Add manually</label>
              <div className="flex gap-2">
                <input
                  type="text" value={manualName} onChange={(e) => setManualName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleManualSave(); }}
                  placeholder="Enter a name…"
                  className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-purple-300 placeholder:text-gray-300"
                />
                <button
                  onClick={handleManualSave} disabled={!manualName.trim() || manualSaving}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-gray-800 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  <Plus size={12} />
                  {manualSaving ? 'Saving…' : 'Add'}
                </button>
              </div>
            </div>

            {/* File upload */}
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1.5">Upload from file</label>
              <p className="text-xs text-gray-400 mb-2">One name per line, or comma/semicolon separated. Saved under current profile + entity type.</p>
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-colors"
                >
                  <Upload size={12} />
                  Choose file
                </button>
                <input ref={fileInputRef} type="file" accept=".txt,.csv" className="hidden" onChange={handleFileUpload} />
                {uploadedNames.length > 0 && (
                  <span className="text-xs text-gray-500">{uploadedNames.length} names ready</span>
                )}
              </div>

              {uploadedNames.length > 0 && (
                <div className="mt-3">
                  <div className="flex flex-wrap gap-1.5 mb-3 max-h-24 overflow-y-auto p-2 bg-gray-50 rounded-lg border border-gray-100">
                    {uploadedNames.map((n, i) => (
                      <span key={i} className="text-xs bg-white px-2 py-0.5 border border-gray-200 rounded text-gray-700">
                        {n}
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleUploadSave}
                      disabled={uploadSaving}
                      className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
                    >
                      {uploadSaving ? 'Saving…' : `Save ${uploadedNames.length} names`}
                    </button>
                    <button onClick={() => setUploadedNames([])} className="text-xs text-gray-400 hover:text-gray-600">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 4. Saved Names */}
          <section className="mb-6">
            <button
              onClick={() => setShowSavedNames((v) => !v)}
              className="flex items-center gap-1.5 w-full text-left mb-3"
            >
              {showSavedNames ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
              <span className="text-sm font-semibold text-gray-800">
                Saved Names
                {savedNames.length > 0 && <span className="ml-2 text-xs text-gray-400 font-normal">({savedNames.length})</span>}
              </span>
            </button>

            {showSavedNames && (
              <>
                <div className="flex gap-1 mb-3 flex-wrap">
                  <button onClick={() => setFilterType('')}
                    className={`px-2 py-0.5 text-xs rounded-full transition-colors ${filterType === '' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-700'}`}>
                    All
                  </button>
                  {ENTITY_TYPES.map(({ value, label }) => (
                    <button key={value} onClick={() => setFilterType(value === filterType ? '' : value)}
                      className={`px-2 py-0.5 text-xs rounded-full transition-colors ${filterType === value ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-700'}`}>
                      {label}
                    </button>
                  ))}
                </div>

                {loadingNames && <p className="text-xs text-gray-400 py-4 text-center">Loading…</p>}
                {!loadingNames && filteredNames.length === 0 && (
                  <p className="text-xs text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-xl">
                    No names saved yet.
                  </p>
                )}
                {filteredNames.length > 0 && (
                  <div className="flex flex-col divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
                    {filteredNames.map((entry) => (
                      <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${ENTITY_COLORS[entry.entityType]}`}>
                          {entry.entityType}
                        </span>
                        <span className="text-sm text-gray-800 flex-1 font-medium">{entry.name}</span>
                        {entry.nameComponent !== 'full' && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">{entry.nameComponent}</span>
                        )}
                        {entry.socialClass === 'noble' && (
                          <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded shrink-0">noble</span>
                        )}
                        {entry.gender !== 'neutral' && entry.entityType === 'person' && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">{entry.gender}</span>
                        )}
                        {entry.tags.length > 0 && (
                          <div className="flex gap-1 shrink-0">
                            {entry.tags.map((tag) => (
                              <span key={tag} className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{tag}</span>
                            ))}
                          </div>
                        )}
                        <button onClick={() => handleDelete(entry.id)}
                          className="text-gray-300 hover:text-red-500 transition-colors shrink-0" aria-label="Delete name">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>

          {/* 5. Discovered Entities */}
          <section>
            <button
              onClick={() => setShowEntities((v) => !v)}
              className="flex items-center gap-1.5 w-full text-left mb-3"
            >
              {showEntities ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
              <span className="text-sm font-semibold text-gray-800">
                Discovered Entities
                {activeMentions.length > 0 && (
                  <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">
                    {activeMentions.length}
                  </span>
                )}
              </span>
            </button>

            {showEntities && (
              <>
                <p className="text-xs text-gray-400 mb-4">
                  Concepts created from Consolidate scans. Associate names here with a cultural profile.
                </p>

                {loadingMentions && <p className="text-xs text-gray-400 py-4 text-center">Loading…</p>}

                {!loadingMentions && mentions.length === 0 && (
                  <p className="text-xs text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-xl">
                    No created concept mentions yet. Run a concept scan from Consolidate.
                  </p>
                )}

                {activeMentions.length > 0 && (
                  <div className="flex flex-col divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden mb-4">
                    {activeMentions.map((m) => (
                      <div key={m.id} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0 bg-gray-100 text-gray-600 mt-0.5">
                          {m.templateType}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800">{m.title}</p>
                          {m.summary && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{m.summary}</p>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {m.articleId && (
                            <button
                              onClick={() => navigate(`/worlds/${wid}/articles/${m.articleId}`)}
                              className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-0.5"
                            >
                              <ExternalLink size={11} />
                              Open
                            </button>
                          )}
                          <button onClick={() => handleIgnoreMention(m.id)} className="text-xs text-gray-400 hover:text-gray-600">
                            Ignore
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {ignoredMentions.length > 0 && (
                  <div className="flex flex-col divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden opacity-50">
                    {ignoredMentions.map((m) => (
                      <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0 bg-gray-100 text-gray-400">{m.templateType}</span>
                        <span className="text-sm text-gray-500 flex-1">{m.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}

      {/* ═══════════════════════ PROMPT LAB TAB ═══════════════════════ */}
      {activeTab === 'promptLab' && (
        <section>
          <p className="text-sm text-gray-500 mb-6">
            Turn rough notes into a structured prompt fragment — ready to use as Forge constraints, world settings, or writing direction.
          </p>

          {/* Focus area */}
          <div className="mb-5">
            <label className="text-xs font-medium text-gray-600 block mb-2">Focus area</label>
            <div className="flex flex-wrap gap-2">
              {PROMPT_LAB_FOCUSES.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setPromptFocus(value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    promptFocus === value
                      ? 'border-purple-400 bg-purple-600 text-white'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes input */}
          <div className="mb-4">
            <label className="text-xs font-medium text-gray-600 block mb-1.5">Your notes</label>
            <textarea
              value={promptNotes}
              onChange={(e) => setPromptNotes(e.target.value)}
              rows={6}
              placeholder="Write anything — a mood, a constraint, a character trait, a rule about magic, a sentence you want to sound like…"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-300 placeholder:text-gray-300"
            />
          </div>

          <button
            onClick={handlePromptGenerate}
            disabled={promptGenerating || !promptNotes.trim() || !currentWorld}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-40 transition-colors mb-6"
          >
            <RefreshCw size={12} className={promptGenerating ? 'animate-spin' : ''} />
            {promptGenerating ? 'Structuring…' : 'Structure prompt'}
          </button>

          {/* Output */}
          {promptOutput && (
            <div className="border border-gray-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-700">Structured prompt fragment</h3>
                <button
                  onClick={handlePromptCopy}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                >
                  {promptCopied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                  {promptCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{promptOutput}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
