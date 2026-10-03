// Iterative Formula entry model, prompts, and the plain-text format stored (encrypted) per entry.
export type CodexSequence = 'A' | 'B';

/** Form values for an entry before serialization. */
export interface CodexEntryDraft {
  title: string;
  sequence?: CodexSequence;
  signature?: string;
  catalyst: string;
  friction: string;
  parameter: string;
  notes?: string;
}

export const ITERATIVE_FORMULA_PROTOCOL = 'PROTOCOL 03: ITERATIVE FORMULA';

/** An entry read back from its decrypted text. */
export interface ParsedCodexEntry {
  title: string;
  sequence: CodexSequence;
  sequenceLabel: string;
  signature: string | null;
  catalyst: string;
  friction: string;
  parameter: string;
  notes?: string;
  protocol: string;
}

/** Maps a stored sequence label back to 'A' or 'B'. */
export function getSequenceKeyFromLabel(label: string): CodexSequence {
  const normalized = label.toLowerCase();
  return normalized.includes('sequence b') || normalized.includes('proactive') ? 'B' : 'A';
}

/** Display label for a sequence. */
export function getSequenceLabel(sequence: CodexSequence): string {
  return sequence === 'A' ? 'Sequence A | Reactive Template' : 'Sequence B | Proactive Template';
}

/** Uppercases and keeps at most two A-Z letters. */
export function normalizeCitizenInitials(value: string): string {
  return value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
}

/** True only for exactly two A-Z letters. */
export function isValidCitizenInitials(value: string): boolean {
  return /^[A-Z]{2}$/.test(value);
}

/** Per-sequence guidance text shown above the entry fields (wording comes from the Archive). */
export function getSequencePrompts(sequence: CodexSequence) {
  if (sequence === 'A') {
    return {
      overview: 'Initiated by Destabilization. This is the physical manifestation of Structural Friction—processing failure within the physical or social boundaries of the operating environment. It occurs when an external Node initiates a coercive vector, overriding consent and extracting resources. The Citizen executes this sequence to neutralize the threat, re-secure Bodily Autonomy, and restore Biological Homeostasis.',
      catalyst: 'Prompt — Isolate the physical event and breached boundary.',
      catalystExecution: 'Objectively isolate the coercive vector. Specify the action, non-consensual extraction, or boundary breached—excluding narrative projection.',
      friction: 'Prompt — Quantify the drain on biological and cognitive resources.',
      frictionExecution: 'Conduct a localized audit of the destabilization. Quantify the drain on metabolic energy, cognitive labor, or physical safety by measuring the deviation from the Localized Constant.',
      parameter: 'Prompt — Define the structural boundary for engagement.',
      parameterExecution: 'Synthesize a non-negotiable stabilization coordinate. Define the physical refusal, condition of engagement, or Geometric Severance required to neutralize the coercion and prevent recurrence.',
    };
  }

  return {
    overview: 'Initiated by Systemic Void. This is the conceptual manifestation of Epistemological Friction—processing failure within the Navigational Architecture. It occurs when the Citizen encounters an unmapped Phenomenon and lacks the load-bearing parameters to process it safely. The Citizen executes this sequence to engineer structural scaffolding and integrate the variable.',
    catalyst: 'Prompt — Isolate the unmapped variable and intersection coordinate.',
    catalystExecution: 'Objectively isolate the variable. Establish the coordinate where the unknown intersects with the Navigational Architecture—excluding narrative projection.',
    friction: 'Prompt — Audit the Systemic Void to identify processing gaps.',
    frictionExecution: 'Conduct a structural audit of the Systemic Void. Delineate where the Navigational Architecture lacks the framework, capacity, or verifiable data to map the variable safely.',
    parameter: 'Prompt — Synthesize the load-bearing rule for integration.',
    parameterExecution: 'Synthesize a load-bearing expansion coordinate. Define the operational rule, structural scaffolding, or Functional Partitioning required to map the Systemic Void and achieve operational integration.',
  };
}

/** Trims fields and applies defaults. */
export function normalizeCodexDraft(input: Partial<CodexEntryDraft>): CodexEntryDraft {
  return {
    title: (input.title ?? '').trim(),
    sequence: input.sequence === 'B' ? 'B' : 'A',
    signature: normalizeCitizenInitials(input.signature ?? ''),
    catalyst: (input.catalyst ?? '').trim(),
    friction: (input.friction ?? '').trim(),
    parameter: (input.parameter ?? '').trim(),
    notes: (input.notes ?? '').trim(),
  };
}

/** Builds the canonical text block that gets encrypted and saved. */
export function serializeCodexEntry(entry: Partial<CodexEntryDraft>): string {
  const normalized = normalizeCodexDraft(entry);
  const sequenceLabel = getSequenceLabel(normalized.sequence ?? 'A');

  const blocks = [
    `TITLE: ${normalized.title || 'Untitled Entry'}`,
    '',
    `[SIGNATURE] [${normalized.signature || '__'}]`,
    '',
    `[SEQUENCE] ${sequenceLabel}`,
    '',
    '[CATALYST]',
    normalized.catalyst || '—',
    '',
    '[FRICTION]',
    normalized.friction || '—',
    '',
    '[PARAMETER]',
    normalized.parameter || '—',
  ];

  if (normalized.notes) {
    blocks.push('', '[NOTES]', normalized.notes);
  }

  blocks.push('', `[${ITERATIVE_FORMULA_PROTOCOL}]`);

  return blocks.join('\n');
}

/** Parses decrypted entry text; tolerant of missing or reordered sections. */
export function parseCodexEntry(raw: string): ParsedCodexEntry {
  const lines = raw.split(/\r?\n/);
  const entry: ParsedCodexEntry = {
    title: 'Untitled Entry',
    sequence: 'A',
    sequenceLabel: getSequenceLabel('A'),
    signature: null,
    catalyst: '—',
    friction: '—',
    parameter: '—',
    notes: undefined,
    protocol: ITERATIVE_FORMULA_PROTOCOL,
  };

  let activeBlock: 'catalyst' | 'friction' | 'parameter' | 'notes' | null = null;
  const aggregates = {
    catalyst: [] as string[],
    friction: [] as string[],
    parameter: [] as string[],
    notes: [] as string[],
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('TITLE:')) {
      entry.title = trimmed.replace(/^TITLE:\s*/, '').trim() || 'Untitled Entry';
      continue;
    }

    if (trimmed.startsWith('[SEQUENCE]')) {
      const value = trimmed.replace(/^\[SEQUENCE\]\s*/i, '').trim();
      entry.sequenceLabel = value || entry.sequenceLabel;
      entry.sequence = getSequenceKeyFromLabel(value);
      continue;
    }

    if (trimmed.startsWith('[SIGNATURE]')) {
      const value = trimmed.match(/^\[SIGNATURE\]\s*\[([A-Z]{2})\]$/i)?.[1];
      entry.signature = value ? normalizeCitizenInitials(value) : null;
      continue;
    }

    if (trimmed.startsWith('[CATALYST]')) {
      activeBlock = 'catalyst';
      continue;
    }

    if (trimmed.startsWith('[FRICTION]')) {
      activeBlock = 'friction';
      continue;
    }

    if (trimmed.startsWith('[PARAMETER]')) {
      activeBlock = 'parameter';
      continue;
    }

    if (trimmed.startsWith('[NOTES]')) {
      activeBlock = 'notes';
      continue;
    }

    if (trimmed.startsWith('[PROTOCOL')) {
      const protocolValue = trimmed.replace(/^\[|\]$/g, '').trim();
      entry.protocol = protocolValue || entry.protocol;
      activeBlock = null;
      continue;
    }

    if (activeBlock) {
      aggregates[activeBlock].push(trimmed);
    }
  }

  const catalystText = aggregates.catalyst.join('\n').trim();
  const frictionText = aggregates.friction.join('\n').trim();
  const parameterText = aggregates.parameter.join('\n').trim();
  const notesText = aggregates.notes.join('\n').trim();

  if (catalystText) entry.catalyst = catalystText;
  if (frictionText) entry.friction = frictionText;
  if (parameterText) entry.parameter = parameterText;
  if (notesText) entry.notes = notesText;

  entry.sequenceLabel = getSequenceLabel(entry.sequence);
  return entry;
}

/** Live summary lines shown under the entry form. */
export function buildCodexPreview(entry: Partial<CodexEntryDraft>): string[] {
  const normalized = normalizeCodexDraft(entry);

  return [
    `Signature: [${normalized.signature || '__'}]`,
    `Sequence: ${getSequenceLabel(normalized.sequence ?? 'A')}`,
    `Catalyst: ${normalized.catalyst || '—'}`,
    `Friction: ${normalized.friction || '—'}`,
    `Parameter: ${normalized.parameter || '—'}`,
  ];
}
