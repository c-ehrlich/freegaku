import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import type { M2Settings, MineContent, NoteTypeMapping } from '../../lib/settings';
import { useAnki, useSettings } from './hooks';
import type { AnkiData } from './hooks';

const SECTIONS = ['Anki', 'Card mapping', 'Quick cards', 'Whisper', 'Hotkeys', 'Capture'] as const;
type Section = (typeof SECTIONS)[number];

const CONTENT_LABELS: Record<MineContent, string> = {
  sentenceAudio: 'Sentence audio',
  image: 'Image',
  sentence: 'Sentence text',
  origin: 'Origin',
};
const CONTENT_ORDER: MineContent[] = ['sentenceAudio', 'image', 'sentence', 'origin'];

export function App() {
  const { settings, update, savedTick } = useSettings();
  const anki = useAnki(settings?.ankiUrl);
  const [section, setSection] = useState<Section>('Anki');
  const [savedVisible, setSavedVisible] = useState(false);

  useEffect(() => {
    if (savedTick === 0) return;
    setSavedVisible(true);
    const t = setTimeout(() => setSavedVisible(false), 1500);
    return () => clearTimeout(t);
  }, [savedTick]);

  if (!settings) return null;

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          Freegaku
          <small>settings</small>
        </div>
        <nav>
          {SECTIONS.map((s) => (
            <button key={s} className={s === section ? 'active' : ''} onClick={() => setSection(s)}>
              {s}
            </button>
          ))}
        </nav>
        <div className="save-state" style={{ opacity: savedVisible ? 1 : 0 }}>
          Saved ✓
        </div>
      </aside>
      <main className="content">
        {section === 'Anki' && <AnkiSection settings={settings} update={update} anki={anki} />}
        {section === 'Card mapping' && (
          <MappingSection settings={settings} update={update} anki={anki} />
        )}
        {section === 'Quick cards' && (
          <QuickCardsSection settings={settings} update={update} anki={anki} />
        )}
        {section === 'Whisper' && <WhisperSection settings={settings} update={update} />}
        {section === 'Hotkeys' && <HotkeysSection settings={settings} update={update} />}
        {section === 'Capture' && <CaptureSection settings={settings} update={update} />}
      </main>
    </div>
  );
}

interface SectionProps {
  settings: M2Settings;
  update: (patch: Partial<M2Settings>) => void;
}

/** Draft-state number input: type freely, errors shown inline, only valid
 * values are committed (the last valid value stays saved meanwhile). */
function NumberField({
  id,
  value,
  min,
  max,
  step,
  unit,
  onCommit,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);

  // Reflect external changes, but never while the user is mid-edit.
  useEffect(() => {
    if (!editing.current) {
      setDraft(String(value));
      setError(null);
    }
  }, [value]);

  const handle = (raw: string): void => {
    setDraft(raw);
    const v = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(v)) {
      setError('Enter a number');
    } else if (v < min || v > max) {
      setError(`Must be between ${min} and ${max}`);
    } else {
      setError(null);
      onCommit(v);
    }
  };

  return (
    <span className="field">
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          id={id}
          type="number"
          step={step}
          className={error ? 'invalid' : ''}
          aria-invalid={error !== null}
          value={draft}
          onFocus={() => (editing.current = true)}
          onBlur={() => {
            editing.current = false;
            if (error) {
              // leave the error visible; snap the draft back to the saved value
              setDraft(String(value));
              setError(null);
            }
          }}
          onChange={(e) => handle(e.target.value)}
        />
        {unit && <span className="hint">{unit}</span>}
      </span>
      {error && <span className="field-error">{error}</span>}
    </span>
  );
}

/** URL input: draft while typing, committed on blur/Enter after validation. */
function UrlField({
  id,
  value,
  defaultValue,
  onCommit,
}: {
  id: string;
  value: string;
  defaultValue: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) {
      setDraft(value);
      setError(null);
    }
  }, [value]);

  const commit = (): void => {
    editing.current = false;
    const raw = draft.trim();
    if (raw === '') {
      setError(null);
      setDraft(defaultValue);
      onCommit(defaultValue);
      return;
    }
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
      setError(null);
      onCommit(raw);
    } catch {
      setError('Enter a valid http(s) URL, e.g. http://127.0.0.1:8765');
    }
  };

  return (
    <span className="field" style={{ flex: 1 }}>
      <input
        id={id}
        type="text"
        className={error ? 'invalid' : ''}
        aria-invalid={error !== null}
        value={draft}
        onFocus={() => (editing.current = true)}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      {error && <span className="field-error">{error}</span>}
    </span>
  );
}

/** Single-letter hotkey input with the same draft/error behavior. */
function KeyField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) {
      setDraft(value);
      setError(null);
    }
  }, [value]);
  return (
    <span className="field">
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="kbd-prefix">Alt +</span>
        <input
          className={`key ${error ? 'invalid' : ''}`}
          type="text"
          maxLength={1}
          value={draft}
          onFocus={() => (editing.current = true)}
          onBlur={() => {
            editing.current = false;
            setDraft(value);
            setError(null);
          }}
          onChange={(e) => {
            const raw = e.target.value.toUpperCase();
            setDraft(raw);
            if (/^[A-Z]$/.test(raw)) {
              setError(null);
              onCommit(raw);
            } else {
              setError('One letter, A–Z');
            }
          }}
        />
      </span>
      {error && <span className="field-error">{error}</span>}
    </span>
  );
}

function ConnectionBanner({ anki }: { anki: AnkiData }) {
  if (anki.status !== 'error') return null;
  return (
    <div className="banner">
      Can’t reach Anki — open Anki with the AnkiConnect add-on, then retry.
      <button className="btn" onClick={anki.refresh}>
        Retry
      </button>
    </div>
  );
}

function AnkiSection({ settings, update, anki }: SectionProps & { anki: AnkiData }) {
  return (
    <>
      <h1>Anki</h1>
      <p className="lede">Connection to AnkiConnect (the Anki add-on, code 2055492159).</p>
      <div className="panel">
        <div className="row">
          <label htmlFor="ankiUrl">AnkiConnect URL</label>
          <UrlField
            id="ankiUrl"
            value={settings.ankiUrl}
            defaultValue={DEFAULT_SETTINGS.ankiUrl}
            onCommit={(ankiUrl) => update({ ankiUrl })}
          />
        </div>
        <div className="row">
          <label>Status</label>
          <span className={`pill ${anki.status}`}>
            {anki.status === 'connected' && `Connected · AnkiConnect v${anki.version}`}
            {anki.status === 'connecting' && 'Connecting…'}
            {anki.status === 'error' && 'Not reachable'}
          </span>
          <button className="btn" onClick={anki.refresh}>
            Test
          </button>
        </div>
        {anki.status === 'connected' && (
          <div className="row-hint">
            {anki.decks.length} decks · {anki.models.length} note types
          </div>
        )}
        {anki.status === 'error' && anki.error && <div className="row-hint">{anki.error}</div>}
      </div>
    </>
  );
}

function MappingSection({ settings, update, anki }: SectionProps & { anki: AnkiData }) {
  useEffect(() => {
    for (const m of settings.mappings) anki.ensureFields(m.model);
  }, [settings.mappings, anki]);

  const setMapping = (index: number, next: NoteTypeMapping) => {
    const mappings = settings.mappings.map((m, i) => (i === index ? next : m));
    update({ mappings });
  };
  const removeMapping = (index: number) => {
    update({ mappings: settings.mappings.filter((_, i) => i !== index) });
  };
  const addMapping = () => {
    const used = new Set(settings.mappings.map((m) => m.model));
    const model = anki.models.find((m) => !used.has(m)) ?? '';
    update({
      mappings: [
        ...settings.mappings,
        { model, fields: { sentenceAudio: null, image: null, sentence: null, origin: null } },
      ],
    });
  };

  return (
    <>
      <h1>Card mapping</h1>
      <p className="lede">
        The ＋ button updates the newest note of one of these note types (mine the word with
        Yomitan first). Per note type, choose which Anki field receives each piece of captured
        content. Unmapped content is not written.
      </p>
      <ConnectionBanner anki={anki} />
      {settings.mappings.map((mapping, i) => (
        <MappingCard
          key={i}
          mapping={mapping}
          anki={anki}
          onChange={(next) => setMapping(i, next)}
          onRemove={settings.mappings.length > 1 ? () => removeMapping(i) : undefined}
        />
      ))}
      <button className="btn" onClick={addMapping} disabled={anki.status !== 'connected'}>
        ＋ Add note type
      </button>
    </>
  );
}

/** Default field-name guesses, matched loosely (case/hyphen/space-insensitive). */
const FIELD_GUESSES: Record<MineContent, string[]> = {
  sentenceAudio: ['Sentence-Audio', 'SentenceAudio', 'Audio-Sentence'],
  image: ['Image', 'Picture', 'Screenshot'],
  sentence: ['Sentence', 'Expression-Sentence'],
  origin: ['Origin', 'Source', 'URL'],
};

const normalize = (s: string): string => s.toLowerCase().replace(/[-_\s]/g, '');

/** Yomitan-style transactional model switch: keep same-named fields, then
 * guess by conventional names, else unmapped. */
function remapFields(
  prev: NoteTypeMapping['fields'],
  modelFields: string[] | undefined,
): NoteTypeMapping['fields'] {
  if (!modelFields) return prev; // can't verify — keep as-is
  const next = {} as NoteTypeMapping['fields'];
  for (const content of CONTENT_ORDER) {
    const old = prev[content];
    if (old && modelFields.includes(old)) {
      next[content] = old;
      continue;
    }
    next[content] =
      modelFields.find((f) => FIELD_GUESSES[content].some((g) => normalize(g) === normalize(f))) ??
      null;
  }
  return next;
}

function MappingCard({
  mapping,
  anki,
  onChange,
  onRemove,
}: {
  mapping: NoteTypeMapping;
  anki: AnkiData;
  onChange: (next: NoteTypeMapping) => void;
  onRemove?: () => void;
}) {
  useEffect(() => anki.ensureFields(mapping.model), [mapping.model, anki]);
  const fields = anki.modelFields[mapping.model];
  const verified = anki.status === 'connected';

  return (
    <div className="mapping">
      <div className="mapping-head">
        <ModelSelect
          value={mapping.model}
          models={anki.models}
          verified={verified}
          onChange={(model) => {
            anki.ensureFields(model);
            onChange({ ...mapping, model, fields: remapFields(mapping.fields, anki.modelFields[model]) });
          }}
        />
        {verified && mapping.model && !anki.models.includes(mapping.model) && (
          <span className="badge">note type not found in Anki</span>
        )}
        {onRemove && (
          <button className="btn subtle" title="Remove this note type" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      {CONTENT_ORDER.map((content) => {
        const value = mapping.fields[content];
        const missing = value !== null && verified && fields !== undefined && !fields.includes(value);
        return (
          <div className="map-row" key={content}>
            <span>{CONTENT_LABELS[content]}</span>
            <span className="arrow">→</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select
                value={value ?? ''}
                onChange={(e) =>
                  onChange({
                    ...mapping,
                    fields: { ...mapping.fields, [content]: e.target.value || null },
                  })
                }
              >
                <option value="">— don’t write</option>
                {/* Saved value stays selectable even when Anki is offline. */}
                {value && !(fields ?? []).includes(value) && (
                  <option className={missing ? 'missing' : ''} value={value}>
                    {value}
                    {missing ? ' (missing)' : ''}
                  </option>
                )}
                {(fields ?? []).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              {missing && <span className="badge">field missing on this note type</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ModelSelect({
  value,
  models,
  verified,
  onChange,
}: {
  value: string;
  models: string[];
  verified: boolean;
  onChange: (model: string) => void;
}) {
  const known = models.includes(value);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {!known && value && (
        <option value={value}>
          {value}
          {verified ? ' (missing)' : ''}
        </option>
      )}
      {!value && <option value="">— choose a note type</option>}
      {models.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
}

function QuickCardsSection({ settings, update, anki }: SectionProps & { anki: AnkiData }) {
  useEffect(() => anki.ensureFields(settings.basicModel), [settings.basicModel, anki]);
  const fields = anki.modelFields[settings.basicModel];
  const verified = anki.status === 'connected';
  const missingFrontBack =
    verified && fields !== undefined && (!fields.includes('Front') || !fields.includes('Back'));

  return (
    <>
      <h1>Quick cards</h1>
      <p className="lede">
        Alt+click a ＋ (or the selection chip) to create a standalone card without Yomitan — for
        the occasional English line. Front = the text you type in the prompt; Back = sentence,
        audio, screenshot and origin.
      </p>
      <ConnectionBanner anki={anki} />
      <div className="panel">
        <div className="row">
          <label htmlFor="basicDeck">Deck</label>
          <select
            id="basicDeck"
            value={settings.basicDeck}
            onChange={(e) => update({ basicDeck: e.target.value })}
          >
            {!anki.decks.includes(settings.basicDeck) && (
              <option value={settings.basicDeck}>
                {settings.basicDeck}
                {verified ? ' (missing)' : ''}
              </option>
            )}
            {anki.decks.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <label htmlFor="basicModel">Note type</label>
          <ModelSelect
            value={settings.basicModel}
            models={anki.models}
            verified={verified}
            onChange={(basicModel) => update({ basicModel })}
          />
          {missingFrontBack && <span className="badge">needs Front and Back fields</span>}
        </div>
      </div>
    </>
  );
}

function WhisperSection({ settings, update }: SectionProps) {
  const [health, setHealth] = useState<string | null>(null);
  const testWorker = async (): Promise<void> => {
    try {
      const res = await fetch(new URL('/health', settings.workerUrl));
      const data = (await res.json()) as { ok: boolean; mock: boolean; hasKey: boolean };
      setHealth(
        data.mock
          ? 'Reachable · MOCK mode (no real transcription)'
          : data.hasKey
            ? 'Reachable · API key configured ✓'
            : 'Reachable, but no OPENAI_API_KEY — add it to apps/worker/.dev.vars',
      );
    } catch {
      setHealth('Not reachable — run `pnpm --filter @migaku2/worker dev`');
    }
  };
  return (
    <>
      <h1>Whisper</h1>
      <p className="lede">
        The ✨ button in the sidebar generates subtitles for videos that have none: audio is
        captured from playback in 30-second chunks and transcribed progressively via the local
        transcription worker. Generated tracks are cached per video.
      </p>
      <div className="panel">
        <div className="row">
          <label htmlFor="workerUrl">Worker URL</label>
          <UrlField
            id="workerUrl"
            value={settings.workerUrl}
            defaultValue={DEFAULT_SETTINGS.workerUrl}
            onCommit={(workerUrl) => update({ workerUrl })}
          />
        </div>
        <div className="row">
          <label>Status</label>
          <button className="btn" onClick={() => void testWorker()}>
            Test
          </button>
          {health && <span className="hint">{health}</span>}
        </div>
        <div className="row">
          <label htmlFor="workerToken">Worker token</label>
          <input
            id="workerToken"
            type="password"
            style={{ width: 260 }}
            value={settings.workerToken}
            onChange={(e) => update({ workerToken: e.target.value.trim() })}
          />
          <span className="hint">empty for a local worker; required once deployed</span>
        </div>
        <div className="row">
          <label htmlFor="whisperLang">Language hint</label>
          <input
            id="whisperLang"
            type="text"
            maxLength={2}
            style={{ width: 64, textAlign: 'center' }}
            value={settings.whisperLang}
            onChange={(e) => {
              const v = e.target.value.toLowerCase().replace(/[^a-z]/g, '');
              if (v.length === 0 || v.length === 2) update({ whisperLang: v });
            }}
          />
          <span className="hint">ISO-639-1 (e.g. ja); empty = auto-detect</span>
        </div>
        <div className="row">
          <label htmlFor="generateRate">Generation speed</label>
          <NumberField
            id="generateRate"
            value={settings.generateRate}
            min={1}
            max={3}
            step={0.25}
            unit="× (YouTube only; video is muted while >1×. Netflix always 1×.)"
            onCommit={(generateRate) => update({ generateRate })}
          />
        </div>
      </div>
    </>
  );
}

function HotkeysSection({ settings, update }: SectionProps) {
  return (
    <>
      <h1>Hotkeys</h1>
      <p className="lede">Toggles work on both YouTube and Netflix.</p>
      <div className="panel">
        <div className="row">
          <label>Toggle sidebar</label>
          <KeyField value={settings.sidebarKey} onCommit={(sidebarKey) => update({ sidebarKey })} />
        </div>
        <div className="row">
          <label>Toggle overlay</label>
          <KeyField value={settings.overlayKey} onCommit={(overlayKey) => update({ overlayKey })} />
        </div>
        <div className="row">
          <label>Mine current line</label>
          <span className="hint">
            Alt+M — a browser-level shortcut; change it at <code>brave://extensions/shortcuts</code>
            (or chrome://). On Netflix, the first Alt+M of a session also unlocks audio capture.
          </span>
        </div>
      </div>
    </>
  );
}

function CaptureSection({ settings, update }: SectionProps) {
  return (
    <>
      <h1>Capture</h1>
      <p className="lede">Audio clip padding and screenshot quality.</p>
      <div className="panel">
        <h2>Audio</h2>
        <div className="row">
          <label htmlFor="padStartMs">Padding before line</label>
          <NumberField
            id="padStartMs"
            value={settings.padStartMs}
            min={0}
            max={5000}
            step={50}
            unit="ms"
            onCommit={(padStartMs) => update({ padStartMs })}
          />
        </div>
        <div className="row">
          <label htmlFor="padEndMs">Padding after line</label>
          <NumberField
            id="padEndMs"
            value={settings.padEndMs}
            min={0}
            max={5000}
            step={50}
            unit="ms"
            onCommit={(padEndMs) => update({ padEndMs })}
          />
        </div>
      </div>
      <div className="panel">
        <h2>Screenshot</h2>
        <div className="row">
          <label htmlFor="imageMaxWidth">Max width</label>
          <NumberField
            id="imageMaxWidth"
            value={settings.imageMaxWidth}
            min={320}
            max={3840}
            step={10}
            unit="px"
            onCommit={(imageMaxWidth) => update({ imageMaxWidth })}
          />
        </div>
        <div className="row">
          <label htmlFor="jpegQuality">JPEG quality</label>
          <NumberField
            id="jpegQuality"
            value={Math.round(settings.jpegQuality * 100)}
            min={10}
            max={100}
            step={5}
            unit="%"
            onCommit={(pct) => update({ jpegQuality: pct / 100 })}
          />
        </div>
      </div>
    </>
  );
}
