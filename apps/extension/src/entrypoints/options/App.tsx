import {
  ArrowRight,
  AudioLines,
  Camera,
  CircleAlert,
  Keyboard,
  Layers,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Workflow,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatCost } from '../../lib/assistant';
import { checkKey } from '../../lib/openrouter';
import { DEFAULT_MODEL, DEFAULT_SETTINGS } from '../../lib/settings';
import type { M2Settings, MineContent, NoteTypeMapping } from '../../lib/settings';
import { useAnki, useSettings } from './hooks';
import type { AnkiData } from './hooks';

const SECTIONS = [
  'Anki',
  'Card mapping',
  'Quick cards',
  'Whisper',
  'AI',
  'Hotkeys',
  'Capture',
] as const;
type Section = (typeof SECTIONS)[number];

const SECTION_ICONS: Record<Section, LucideIcon> = {
  Anki: Layers,
  'Card mapping': Workflow,
  'Quick cards': Zap,
  Whisper: AudioLines,
  AI: Sparkles,
  Hotkeys: Keyboard,
  Capture: Camera,
};

const LEDES: Record<Section, string> = {
  Anki: 'Connection to AnkiConnect (the Anki add-on, code 2055492159).',
  'Card mapping':
    'The ＋ button updates the newest note of one of these note types (mine the word with Yomitan first). Per note type, choose which Anki field receives each piece of captured content. Unmapped content is not written.',
  'Quick cards':
    'Alt+click a ＋ (or the selection chip) to create a standalone card without Yomitan — for the occasional English line. Front = the text you type in the prompt; Back = sentence, audio, screenshot and origin.',
  Whisper:
    'The waveform button in the sidebar header generates subtitles for videos that have none: audio is captured from playback in 30-second chunks and transcribed progressively via the local transcription worker. Generated tracks are cached per video.',
  AI: "Select subtitle text and click Explain to ask why it's said the way it is. The model sees the video details and the transcript up to shortly after your selection (so it can't spoil what comes later). Click the sparkle button in the sidebar header for a short summary of the whole video, written in the subtitles' language. Requests go straight to OpenRouter with your key.",
  Hotkeys: 'Toggles work on both YouTube and Netflix.',
  Capture: 'Audio clip padding and screenshot quality.',
};

const CONTENT_LABELS: Record<MineContent, string> = {
  word: 'Card word (check)',
  sentenceAudio: 'Sentence audio',
  image: 'Image',
  sentence: 'Sentence text',
  origin: 'Origin',
};
const CONTENT_ORDER: MineContent[] = ['word', 'sentenceAudio', 'image', 'sentence', 'origin'];

/** Radix Select can't hold '' — stands in for "no field". */
const NONE = '__none__';

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
    <div className="mx-auto grid max-w-[1040px] grid-cols-[200px_minmax(0,1fr)] gap-12 px-6 pt-10 pb-20">
      <aside className="sticky top-10 self-start">
        <div className="flex items-center gap-2.5 px-2.5">
          <div className="grid size-7 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground">
            F
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Freegaku</div>
            <div className="text-xs text-muted-foreground">Settings</div>
          </div>
        </div>
        <nav className="mt-6 flex flex-col gap-0.5">
          {SECTIONS.map((s) => {
            const Icon = SECTION_ICONS[s];
            const active = s === section;
            return (
              <button
                key={s}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-8 cursor-pointer items-center gap-2.5 rounded-[var(--m2-row-radius)] px-2.5 text-left text-[13px] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
                  active
                    ? 'bg-active text-[color:var(--m2-active-fg)] [box-shadow:inset_var(--m2-active-bar)_0_0_var(--m2-primary)]'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
                onClick={() => setSection(s)}
              >
                <Icon className={cn('size-4', active && 'text-primary')} aria-hidden />
                {s}
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="max-w-[740px] min-w-0">
        <header className="mb-6">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-[22px] font-semibold tracking-tight">{section}</h1>
            <span
              aria-live="polite"
              className="text-xs font-medium text-success transition-opacity duration-400"
              style={{ opacity: savedVisible ? 1 : 0 }}
            >
              Saved ✓
            </span>
          </div>
          <p className="mt-1.5 max-w-[64ch] text-sm leading-relaxed text-muted-foreground">
            {LEDES[section]}
          </p>
        </header>
        <div className="flex flex-col gap-4">
          {section === 'Anki' && <AnkiSection settings={settings} update={update} anki={anki} />}
          {section === 'Card mapping' && (
            <MappingSection settings={settings} update={update} anki={anki} />
          )}
          {section === 'Quick cards' && (
            <QuickCardsSection settings={settings} update={update} anki={anki} />
          )}
          {section === 'Whisper' && <WhisperSection settings={settings} update={update} />}
          {section === 'AI' && <AiSection settings={settings} update={update} />}
          {section === 'Hotkeys' && <HotkeysSection settings={settings} update={update} />}
          {section === 'Capture' && <CaptureSection settings={settings} update={update} />}
        </div>
      </main>
    </div>
  );
}

interface SectionProps {
  settings: M2Settings;
  update: (patch: Partial<M2Settings>) => void;
}

/** A card of settings rows, optionally titled. */
function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Card>
      {title && (
        <CardHeader>
          <CardTitle className="m2-label text-muted-foreground">{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="divide-y divide-border px-0">{children}</CardContent>
    </Card>
  );
}

/** Label and description on the left, control on the right. */
function Row({
  label,
  htmlFor,
  description,
  children,
}: {
  label: string;
  htmlFor?: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-8 px-5 py-4">
      <div className="min-w-0 flex-1">
        {htmlFor ? (
          <Label htmlFor={htmlFor}>{label}</Label>
        ) : (
          <div className="text-sm leading-none font-medium">{label}</div>
        )}
        {description && (
          <div className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{description}</div>
        )}
      </div>
      <div className="flex max-w-[60%] shrink-0 flex-col items-end gap-1.5">{children}</div>
    </div>
  );
}

type Tone = 'muted' | 'success' | 'warn' | 'error';
const TONE_TEXT: Record<Tone, string> = {
  muted: '',
  success: 'text-success',
  warn: 'text-warn',
  error: 'text-destructive',
};

function FieldError({ children }: { children: ReactNode }) {
  return <p className="text-xs text-destructive">{children}</p>;
}

function Kbd({ keys }: { keys: string[] }) {
  return (
    <span className="flex h-8 items-center gap-2">
      {keys.map((k, i) => (
        <Fragment key={k}>
          {i > 0 && <span className="text-xs text-muted-foreground">+</span>}
          <kbd className="m2-kbd">{k}</kbd>
        </Fragment>
      ))}
    </span>
  );
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
    <>
      <span className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          step={step}
          className="w-24 tabular-nums"
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
        {unit && <span className="w-5 text-[13px] text-muted-foreground">{unit}</span>}
      </span>
      {error && <FieldError>{error}</FieldError>}
    </>
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
    <>
      <Input
        id={id}
        type="text"
        className="w-64 font-mono text-xs"
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
      {error && <FieldError>{error}</FieldError>}
    </>
  );
}

/** Single-letter hotkey input with the same draft/error behavior. */
function KeyField({
  id,
  value,
  onCommit,
}: {
  id: string;
  value: string;
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
  return (
    <>
      <span className="flex items-center gap-2">
        <kbd className="m2-kbd">Alt</kbd>
        <span className="text-xs text-muted-foreground">+</span>
        <Input
          id={id}
          className="h-7 w-9 px-0 text-center text-xs font-semibold"
          type="text"
          maxLength={1}
          aria-invalid={error !== null}
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
      {error && <FieldError>{error}</FieldError>}
    </>
  );
}

function ConnectionBanner({ anki }: { anki: AnkiData }) {
  if (anki.status !== 'error') return null;
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>Can’t reach Anki</AlertTitle>
      <AlertDescription>Open Anki with the AnkiConnect add-on, then retry.</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={anki.refresh}>
          Retry
        </Button>
      </AlertAction>
    </Alert>
  );
}

function AnkiStatusBadge({ anki }: { anki: AnkiData }) {
  if (anki.status === 'connecting') {
    return (
      <Badge variant="warn">
        <Loader2 className="animate-spin" />
        Connecting…
      </Badge>
    );
  }
  return (
    <Badge variant={anki.status === 'connected' ? 'success' : 'destructive'}>
      <span className="size-1.5 rounded-full bg-current" />
      {anki.status === 'connected' ? `Connected · AnkiConnect v${anki.version}` : 'Not reachable'}
    </Badge>
  );
}

function AnkiSection({ settings, update, anki }: SectionProps & { anki: AnkiData }) {
  return (
    <>
      <ConnectionBanner anki={anki} />
      <Group>
        <Row label="AnkiConnect URL" htmlFor="ankiUrl" description="Where the add-on listens.">
          <UrlField
            id="ankiUrl"
            value={settings.ankiUrl}
            defaultValue={DEFAULT_SETTINGS.ankiUrl}
            onCommit={(ankiUrl) => update({ ankiUrl })}
          />
        </Row>
        <Row
          label="Status"
          description={
            anki.status === 'connected' ? (
              `${anki.decks.length} decks · ${anki.models.length} note types`
            ) : anki.status === 'error' && anki.error ? (
              <span className="text-destructive">{anki.error}</span>
            ) : undefined
          }
        >
          <span className="flex h-8 items-center gap-3">
            <AnkiStatusBadge anki={anki} />
            <Button variant="outline" onClick={anki.refresh}>
              Test
            </Button>
          </span>
        </Row>
      </Group>
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
        {
          model,
          fields: { word: 'Word', sentenceAudio: null, image: null, sentence: null, origin: null },
        },
      ],
    });
  };

  return (
    <>
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
      <div>
        <Button variant="outline" onClick={addMapping} disabled={anki.status !== 'connected'}>
          <Plus />
          Add note type
        </Button>
      </div>
    </>
  );
}

/** Default field-name guesses, matched loosely (case/hyphen/space-insensitive). */
const FIELD_GUESSES: Record<MineContent, string[]> = {
  word: ['Word', 'Expression', 'Term'],
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
    <Card>
      <CardHeader className="py-2.5">
        <ModelSelect
          className="w-72 font-medium"
          value={mapping.model}
          models={anki.models}
          verified={verified}
          onChange={(model) => {
            anki.ensureFields(model);
            onChange({
              ...mapping,
              model,
              fields: remapFields(mapping.fields, anki.modelFields[model]),
            });
          }}
        />
        {verified && mapping.model && !anki.models.includes(mapping.model) && (
          <Badge variant="warn">note type not found in Anki</Badge>
        )}
        {onRemove && (
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              title="Remove this note type"
              onClick={onRemove}
            >
              <Trash2 />
              Remove
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="px-0 py-2">
        {CONTENT_ORDER.map((content) => {
          const value = mapping.fields[content];
          const missing =
            value !== null && verified && fields !== undefined && !fields.includes(value);
          return (
            <div
              className="grid grid-cols-[minmax(0,1fr)_auto_13rem] items-center gap-4 px-5 py-1.5"
              key={content}
            >
              <span className="flex min-w-0 items-center gap-2 text-sm">
                {CONTENT_LABELS[content]}
                {missing && <Badge variant="warn">field missing on this note type</Badge>}
              </span>
              <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
              <Select
                value={value ?? NONE}
                onValueChange={(v) =>
                  onChange({
                    ...mapping,
                    fields: { ...mapping.fields, [content]: v === NONE ? null : v },
                  })
                }
              >
                <SelectTrigger
                  aria-label={CONTENT_LABELS[content]}
                  aria-invalid={missing}
                  className={cn('w-full', value === null && 'text-muted-foreground')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} className="text-muted-foreground">
                    {content === 'word' ? '— not configured' : '— don’t write'}
                  </SelectItem>
                  {/* Saved value stays selectable even when Anki is offline. */}
                  {value && !(fields ?? []).includes(value) && (
                    <SelectItem className={missing ? 'text-destructive' : ''} value={value}>
                      {value}
                      {missing ? ' (missing)' : ''}
                    </SelectItem>
                  )}
                  {(fields ?? []).map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ModelSelect({
  id,
  className,
  value,
  models,
  verified,
  onChange,
}: {
  id?: string;
  className?: string;
  value: string;
  models: string[];
  verified: boolean;
  onChange: (model: string) => void;
}) {
  const known = models.includes(value);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder="— choose a note type" />
      </SelectTrigger>
      <SelectContent>
        {!known && value && (
          <SelectItem value={value}>
            {value}
            {verified ? ' (missing)' : ''}
          </SelectItem>
        )}
        {models.map((m) => (
          <SelectItem key={m} value={m}>
            {m}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
      <ConnectionBanner anki={anki} />
      <Group>
        <Row label="Deck" htmlFor="basicDeck" description="Where quick cards are added.">
          <Select value={settings.basicDeck} onValueChange={(basicDeck) => update({ basicDeck })}>
            <SelectTrigger id="basicDeck" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {!anki.decks.includes(settings.basicDeck) && (
                <SelectItem value={settings.basicDeck}>
                  {settings.basicDeck}
                  {verified ? ' (missing)' : ''}
                </SelectItem>
              )}
              {anki.decks.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Note type" htmlFor="basicModel" description="Must have Front and Back fields.">
          <ModelSelect
            id="basicModel"
            className="w-64"
            value={settings.basicModel}
            models={anki.models}
            verified={verified}
            onChange={(basicModel) => update({ basicModel })}
          />
          {missingFrontBack && <Badge variant="warn">needs Front and Back fields</Badge>}
        </Row>
      </Group>
    </>
  );
}

function WhisperSection({ settings, update }: SectionProps) {
  const [health, setHealth] = useState<{ text: string; tone: Tone } | null>(null);
  const testWorker = async (): Promise<void> => {
    try {
      const res = await fetch(new URL('/health', settings.workerUrl));
      const data = (await res.json()) as { ok: boolean; mock: boolean; hasKey: boolean };
      setHealth(
        data.mock
          ? { text: 'Reachable · MOCK mode (no real transcription)', tone: 'warn' }
          : data.hasKey
            ? { text: 'Reachable · API key configured ✓', tone: 'success' }
            : {
                text: 'Reachable, but no OPENAI_API_KEY — add it to apps/worker/.dev.vars',
                tone: 'warn',
              },
      );
    } catch {
      setHealth({ text: 'Not reachable — run `pnpm --filter @migaku2/worker dev`', tone: 'error' });
    }
  };
  return (
    <Group>
      <Row label="Worker URL" htmlFor="workerUrl" description="The transcription worker.">
        <UrlField
          id="workerUrl"
          value={settings.workerUrl}
          defaultValue={DEFAULT_SETTINGS.workerUrl}
          onCommit={(workerUrl) => update({ workerUrl })}
        />
      </Row>
      <Row
        label="Status"
        description={
          health ? (
            <span className={TONE_TEXT[health.tone]}>{health.text}</span>
          ) : (
            'Checks the worker’s /health endpoint.'
          )
        }
      >
        <Button variant="outline" onClick={() => void testWorker()}>
          Test
        </Button>
      </Row>
      <Row
        label="Worker token"
        htmlFor="workerToken"
        description="Empty for a local worker; required once deployed."
      >
        <Input
          id="workerToken"
          type="password"
          className="w-64"
          value={settings.workerToken}
          onChange={(e) => update({ workerToken: e.target.value.trim() })}
        />
      </Row>
      <Row
        label="Language hint"
        htmlFor="whisperLang"
        description="ISO-639-1 (e.g. ja); empty = auto-detect."
      >
        <Input
          id="whisperLang"
          type="text"
          maxLength={2}
          className="w-16 text-center"
          value={settings.whisperLang}
          onChange={(e) => {
            const v = e.target.value.toLowerCase().replace(/[^a-z]/g, '');
            if (v.length === 0 || v.length === 2) update({ whisperLang: v });
          }}
        />
      </Row>
      <Row
        label="Generation speed"
        htmlFor="generateRate"
        description="YouTube only; video is muted while >1×. Netflix always 1×."
      >
        <NumberField
          id="generateRate"
          value={settings.generateRate}
          min={1}
          max={3}
          step={0.25}
          unit="×"
          onCommit={(generateRate) => update({ generateRate })}
        />
      </Row>
    </Group>
  );
}

function AiSection({ settings, update }: SectionProps) {
  const [keyStatus, setKeyStatus] = useState<{ text: string; tone: Tone } | null>(null);
  const testKey = async (): Promise<void> => {
    setKeyStatus({ text: 'Checking…', tone: 'muted' });
    try {
      const info = await checkKey(settings.openRouterKey);
      const spent = `${formatCost(info.usage)} used`;
      setKeyStatus({
        text: `Key works ✓ · ${info.limit === null ? spent : `${spent} of ${formatCost(info.limit)} limit`}`,
        tone: 'success',
      });
    } catch (e) {
      setKeyStatus({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    }
  };
  return (
    <Group>
      <Row
        label="OpenRouter key"
        htmlFor="openRouterKey"
        description={
          keyStatus && <span className={TONE_TEXT[keyStatus.tone]}>{keyStatus.text}</span>
        }
      >
        <span className="flex items-center gap-2">
          <Input
            id="openRouterKey"
            type="password"
            className="w-64"
            placeholder="sk-or-…"
            value={settings.openRouterKey}
            onChange={(e) => {
              setKeyStatus(null);
              update({ openRouterKey: e.target.value.trim() });
            }}
          />
          <Button variant="outline" onClick={() => void testKey()}>
            Test
          </Button>
        </span>
      </Row>
      <Row label="Explain model" htmlFor="explainModel">
        <AiModelPicker
          id="explainModel"
          value={settings.explainModel}
          onChange={(explainModel) => update({ explainModel })}
        />
      </Row>
      <Row
        label="Explain in"
        htmlFor="explainLanguage"
        description="Questions asked in another language are answered in that one."
      >
        <Input
          id="explainLanguage"
          type="text"
          className="w-40"
          value={settings.explainLanguage}
          onChange={(e) => update({ explainLanguage: e.target.value })}
          onBlur={(e) => {
            if (!e.target.value.trim())
              update({ explainLanguage: DEFAULT_SETTINGS.explainLanguage });
          }}
        />
      </Row>
      <Row
        label="Summary model"
        htmlFor="summaryModel"
        description="Sees the whole transcript, so a long-context model helps."
      >
        <AiModelPicker
          id="summaryModel"
          value={settings.summaryModel}
          onChange={(summaryModel) => update({ summaryModel })}
        />
      </Row>
    </Group>
  );
}

/** "Default (…)" stores '' so the model follows future default bumps; "Custom…"
 * reveals a free-text OpenRouter model id. */
function AiModelPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (model: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const custom = editing || value.trim() !== '';
  const useDefault = () => {
    setEditing(false);
    onChange('');
  };
  return (
    <>
      <Select
        value={custom ? 'custom' : 'default'}
        onValueChange={(v) => (v === 'custom' ? setEditing(true) : useDefault())}
      >
        <SelectTrigger id={custom ? undefined : id} className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          onCloseAutoFocus={(e) => {
            // Radix refocuses the trigger on close; "Custom…" wants the input.
            if (editing && input.current) {
              e.preventDefault();
              input.current.focus();
            }
          }}
        >
          <SelectItem value="default">Default ({DEFAULT_MODEL.label})</SelectItem>
          <SelectItem value="custom">Custom…</SelectItem>
        </SelectContent>
      </Select>
      {custom && (
        <Input
          ref={input}
          id={id}
          type="text"
          className="w-64 font-mono text-xs"
          placeholder={DEFAULT_MODEL.id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            if (!e.target.value.trim()) useDefault();
          }}
        />
      )}
    </>
  );
}

const SHORTCUTS_HINT = (
  <>
    A browser-level shortcut; change it at{' '}
    <code className="font-mono text-xs text-foreground">brave://extensions/shortcuts</code> (or
    chrome://).
  </>
);

function HotkeysSection({ settings, update }: SectionProps) {
  return (
    <Group>
      <Row label="Toggle sidebar" description={SHORTCUTS_HINT}>
        <Kbd keys={['Alt', 'T']} />
      </Row>
      <Row label="Toggle overlay" htmlFor="overlayKey">
        <KeyField
          id="overlayKey"
          value={settings.overlayKey}
          onCommit={(overlayKey) => update({ overlayKey })}
        />
      </Row>
      <Row
        label="Mine current line"
        description={
          <>{SHORTCUTS_HINT} On Netflix, the first Alt+M of a session also unlocks audio capture.</>
        }
      >
        <Kbd keys={['Alt', 'M']} />
      </Row>
    </Group>
  );
}

function CaptureSection({ settings, update }: SectionProps) {
  return (
    <>
      <Group title="Audio">
        <Row label="Padding before line" htmlFor="padStartMs">
          <NumberField
            id="padStartMs"
            value={settings.padStartMs}
            min={0}
            max={5000}
            step={50}
            unit="ms"
            onCommit={(padStartMs) => update({ padStartMs })}
          />
        </Row>
        <Row label="Padding after line" htmlFor="padEndMs">
          <NumberField
            id="padEndMs"
            value={settings.padEndMs}
            min={0}
            max={5000}
            step={50}
            unit="ms"
            onCommit={(padEndMs) => update({ padEndMs })}
          />
        </Row>
      </Group>
      <Group title="Screenshot">
        <Row label="Max width" htmlFor="imageMaxWidth">
          <NumberField
            id="imageMaxWidth"
            value={settings.imageMaxWidth}
            min={320}
            max={3840}
            step={10}
            unit="px"
            onCommit={(imageMaxWidth) => update({ imageMaxWidth })}
          />
        </Row>
        <Row label="JPEG quality" htmlFor="jpegQuality">
          <NumberField
            id="jpegQuality"
            value={Math.round(settings.jpegQuality * 100)}
            min={10}
            max={100}
            step={5}
            unit="%"
            onCommit={(pct) => update({ jpegQuality: pct / 100 })}
          />
        </Row>
      </Group>
    </>
  );
}
