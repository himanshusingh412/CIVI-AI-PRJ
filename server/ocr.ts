import crypto from 'crypto';
import { generateJsonFromImage, Type } from './providers.js';
import { isLive, demoModeEnabled } from './config.js';

/**
 * Document reading: image or PDF in, structured fields out.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Provider is an implementation detail, on purpose
 * ─────────────────────────────────────────────────────────────────────────
 * The pipeline above this file (normalise → compare → explain) does not care
 * whether the text came from Gemini Vision, Textract, Tesseract or a human
 * typist. Swapping the provider means implementing `OcrProvider` and nothing
 * else changes, which is the difference between an OCR *adapter* and OCR
 * *code sprayed through the request handler*.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The rule about confidence
 * ─────────────────────────────────────────────────────────────────────────
 * A field the model could not read must come back as `null`, never as a
 * plausible guess. Everything downstream treats null as "nothing to compare"
 * and says so; a hallucinated date of birth would instead be compared,
 * scored, and reported to a citizen as a discrepancy in their own documents.
 * That is the single worst thing this feature could do, so the extraction
 * prompt is explicit about it and the temperature is zero.
 */

export const DOCUMENT_TYPES = [
  'identity_card',        // Aadhaar-style national identity
  'pan_card',
  'passport',
  'driving_licence',
  'voter_id',
  'birth_certificate',
  'income_certificate',
  'residence_certificate',
  'caste_certificate',
  'educational_certificate',
  'bank_passbook',
  'utility_bill',
  'other',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  identity_card: 'Identity card',
  pan_card: 'PAN card',
  passport: 'Passport',
  driving_licence: 'Driving licence',
  voter_id: 'Voter ID',
  birth_certificate: 'Birth certificate',
  income_certificate: 'Income certificate',
  residence_certificate: 'Residence certificate',
  caste_certificate: 'Caste certificate',
  educational_certificate: 'Educational certificate',
  bank_passbook: 'Bank passbook',
  utility_bill: 'Utility bill',
  other: 'Other document',
};

/**
 * The comparable fields. Deliberately small: every field added here is a
 * field that can produce a false mismatch, so the list is what actually
 * causes application rejections rather than everything a document contains.
 */
export type ExtractedFields = {
  name: string | null;
  fatherName: string | null;
  motherName: string | null;
  dob: string | null;
  gender: string | null;
  address: string | null;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  issuingAuthority: string | null;
};

export const EMPTY_FIELDS: ExtractedFields = {
  name: null, fatherName: null, motherName: null, dob: null, gender: null,
  address: null, documentNumber: null, issueDate: null, expiryDate: null,
  issuingAuthority: null,
};

export type ExtractionResult = {
  documentType: DocumentType;
  fields: ExtractedFields;
  /** 0..1, the model's own confidence that it read the document correctly. */
  confidence: number;
  provider: 'gemini-vision' | 'claude-vision' | 'fixture';
  /** True when the fields are simulated rather than read from the file. */
  simulated: boolean;
  /** Set when nothing could be read. Fields will all be null. */
  error?: string;
};

export const OCR_LIMITS = {
  MAX_BYTES: 8 * 1024 * 1024,
  ACCEPTED_MIME: [
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
  ] as const,
} as const;

// ───────────────────────── prompt ─────────────────────────

const SYSTEM = `You transcribe Indian government documents. You are a TRANSCRIBER, not an interpreter.

Absolute rules:
- Copy values EXACTLY as printed, including the original date format. If the document prints "12/03/2001", return "12/03/2001" — never reformat it, and never decide whether 12 is the day or the month.
- If a field is absent, illegible, or you are not certain, return null. Never guess. Never infer a value from another field.
- Do not correct spelling, expand abbreviations, or normalise anything. Downstream code does that and needs the original.
- Return the name exactly as printed on THIS document, even if it looks misspelled.
- "confidence" is your honest assessment that you read this document correctly: 1.0 for a clean scan you are certain about, below 0.5 for a blurred or partially obscured image.`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    documentType: { type: Type.STRING, enum: [...DOCUMENT_TYPES] },
    name: { type: Type.STRING },
    fatherName: { type: Type.STRING },
    motherName: { type: Type.STRING },
    dob: { type: Type.STRING },
    gender: { type: Type.STRING },
    address: { type: Type.STRING },
    documentNumber: { type: Type.STRING },
    issueDate: { type: Type.STRING },
    expiryDate: { type: Type.STRING },
    issuingAuthority: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
  },
  required: ['documentType', 'confidence'],
};

const JSON_HINT =
  '{"documentType":string,"name":string|null,"fatherName":string|null,"motherName":string|null,' +
  '"dob":string|null,"gender":string|null,"address":string|null,"documentNumber":string|null,' +
  '"issueDate":string|null,"expiryDate":string|null,"issuingAuthority":string|null,"confidence":number}';

/**
 * Models sometimes emit the STRING "null", "N/A" or "" for an absent field
 * rather than a JSON null. Left alone, "N/A" on two documents would compare
 * as a perfect match on a field neither document actually carries.
 */
const NULLISH = new Set(['', 'null', 'nil', 'n/a', 'na', 'none', 'not available', 'not specified', '-', '--']);

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || NULLISH.has(t.toLowerCase())) return null;
  return t.slice(0, 300);
}

// ───────────────────────── fixture provider ─────────────────────────

/**
 * Deterministic stand-in used when no vision model is configured.
 *
 * It is NOT random. The same file always produces the same fields, because a
 * demo where re-uploading the same document changes the person's name is
 * worse than no demo. The chosen persona is derived from a hash of the file
 * bytes, so two different uploads reliably differ — which is what makes a
 * mismatch demonstrable.
 *
 * Everything it returns is marked `simulated: true` and surfaces in the UI
 * as "Demo". It is never presented as having read the file.
 */
const FIXTURES: Array<{ type: DocumentType; fields: ExtractedFields }> = [
  {
    type: 'identity_card',
    fields: {
      ...EMPTY_FIELDS,
      name: 'Rahul Kumar Singh',
      fatherName: 'Mahesh Kumar Singh',
      dob: '12/03/2001',
      gender: 'Male',
      address: 'H.No 214, Sector 14, Dwarka, New Delhi 110078',
      documentNumber: '4321 8765 2109',
      issuingAuthority: 'Unique Identification Authority',
    },
  },
  {
    type: 'pan_card',
    fields: {
      ...EMPTY_FIELDS,
      name: 'Rahul K. Singh',
      fatherName: 'Mahesh Kumar Singh',
      // The demonstration case: the same date under the other convention.
      dob: '03/12/2001',
      documentNumber: 'BKJPS4321M',
      issuingAuthority: 'Income Tax Department',
    },
  },
  {
    type: 'residence_certificate',
    fields: {
      ...EMPTY_FIELDS,
      name: 'Rahul Kumar Singh',
      fatherName: 'Mahesh Kumar Singh',
      dob: '12 March 2001',
      address: 'House No 214, Sec 14, Dwarka, New Delhi 110078',
      documentNumber: 'RC/DL/2024/88214',
      issueDate: '04/01/2024',
      issuingAuthority: 'Office of the Sub-Divisional Magistrate',
    },
  },
  {
    type: 'educational_certificate',
    fields: {
      ...EMPTY_FIELDS,
      name: 'Rahul Kumar Singh',
      fatherName: 'Mahesh K. Singh',
      dob: '12/03/2001',
      documentNumber: 'CBSE/2019/2214887',
      issueDate: '15/07/2019',
      issuingAuthority: 'Central Board of Secondary Education',
    },
  },
];

function fixtureFor(bytes: Buffer, hinted?: DocumentType): ExtractionResult {
  if (hinted) {
    const exact = FIXTURES.find(f => f.type === hinted);
    if (exact) {
      return {
        documentType: exact.type, fields: { ...exact.fields },
        confidence: 0.92, provider: 'fixture', simulated: true,
      };
    }
  }
  const digest = crypto.createHash('sha256').update(bytes).digest();
  const pick = FIXTURES[digest[0] % FIXTURES.length];
  return {
    documentType: pick.type, fields: { ...pick.fields },
    confidence: 0.92, provider: 'fixture', simulated: true,
  };
}

// ───────────────────────── public entry ─────────────────────────

/**
 * The explicit `reason?: undefined` on the success branch is load-bearing.
 * This tsconfig has strictNullChecks off, and without it TypeScript refuses
 * to narrow the union on `!result.ok` - the same trap documented in
 * server/sms.ts and server/rbac.ts.
 */
export function validateUpload(
  mimeType: string,
  byteLength: number,
): { ok: true; reason?: undefined } | { ok: false; reason: string } {
  if (!(OCR_LIMITS.ACCEPTED_MIME as readonly string[]).includes(mimeType)) {
    return { ok: false, reason: 'Upload a JPG, PNG, WEBP or PDF file.' };
  }
  if (byteLength > OCR_LIMITS.MAX_BYTES) {
    return { ok: false, reason: `Files must be under ${Math.floor(OCR_LIMITS.MAX_BYTES / (1024 * 1024))} MB.` };
  }
  if (byteLength < 128) {
    return { ok: false, reason: 'That file appears to be empty.' };
  }
  return { ok: true };
}

export async function extractDocument(input: {
  bytes: Buffer;
  mimeType: string;
  /** What the citizen said this is. A hint only — the model still decides. */
  hintedType?: DocumentType;
}): Promise<ExtractionResult> {
  // No vision model configured → simulate, and say so.
  if (!isLive('ocr')) {
    if (!demoModeEnabled()) {
      return {
        documentType: input.hintedType ?? 'other',
        fields: { ...EMPTY_FIELDS },
        confidence: 0,
        provider: 'fixture',
        simulated: true,
        error: 'Document reading is not configured on this deployment. Set AI_API_KEY to enable it.',
      };
    }
    return fixtureFor(input.bytes, input.hintedType);
  }

  try {
    const result = await generateJsonFromImage<any>({
      system: SYSTEM,
      prompt:
        'Transcribe every field you can read from this document. ' +
        (input.hintedType
          ? `The citizen says this is a ${DOCUMENT_LABELS[input.hintedType]}, but classify it yourself from what you see. `
          : '') +
        'Remember: copy dates in their printed format, and return null for anything you cannot read with certainty.',
      images: [{ data: input.bytes, mimeType: input.mimeType }],
      schema: SCHEMA,
      jsonHint: JSON_HINT,
    });

    const d = result.data ?? {};
    const documentType: DocumentType =
      (DOCUMENT_TYPES as readonly string[]).includes(d.documentType) ? d.documentType : 'other';

    const confidence = Number.isFinite(d.confidence)
      ? Math.min(1, Math.max(0, Number(d.confidence)))
      : 0.5;

    return {
      documentType,
      fields: {
        name: clean(d.name),
        fatherName: clean(d.fatherName),
        motherName: clean(d.motherName),
        dob: clean(d.dob),
        gender: clean(d.gender),
        address: clean(d.address),
        documentNumber: clean(d.documentNumber),
        issueDate: clean(d.issueDate),
        expiryDate: clean(d.expiryDate),
        issuingAuthority: clean(d.issuingAuthority),
      },
      confidence,
      provider: result.provider === 'claude' ? 'claude-vision' : 'gemini-vision',
      simulated: false,
    };
  } catch (err: any) {
    /**
     * Critically: this returns an ERROR with empty fields, not empty fields
     * alone. "The model could not see this document" and "this document has
     * no name on it" are different facts, and collapsing them would let a
     * failed read present as a document that legitimately lacks every field.
     */
    console.error('[ocr] extraction failed:', err?.message ?? err);
    return {
      documentType: input.hintedType ?? 'other',
      fields: { ...EMPTY_FIELDS },
      confidence: 0,
      provider: 'gemini-vision',
      simulated: false,
      error: 'This document could not be read. Try a clearer photo, or one taken in better light.',
    };
  }
}
