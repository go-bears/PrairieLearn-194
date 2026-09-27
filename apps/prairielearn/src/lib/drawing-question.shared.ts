import { z } from 'zod';

/**
 * A drawing question is a `question.html` with a prompt and a single
 * `pl-tablet-input` element, plus an optional background image and reference
 * drawing. The drawing question builder edits it through this shape.
 */

export const DRAWING_TEMPLATE_QID = 'template/tablet-input/drawing';
export const REFERENCE_FILE_NAME = 'reference.json';
const MAX_CANVAS_DIMENSION = 1600;
/** Base64-encoded, this keeps the save request under the 5 MB JSON body limit. */
export const MAX_BACKGROUND_IMAGE_BYTES = 3 * 1024 * 1024;
export const BACKGROUND_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;
export type BackgroundImageType = (typeof BACKGROUND_IMAGE_TYPES)[number];

const backgroundImageTypes = new Set<string>(BACKGROUND_IMAGE_TYPES);

export function isBackgroundImageType(type: string): type is BackgroundImageType {
  return backgroundImageTypes.has(type);
}

const CanvasDimensionSchema = z.number().int().positive().max(MAX_CANVAS_DIMENSION);

const DrawingGradingSchema = z.object({
  autograde: z.boolean(),
  mode: z.enum(['overlap', 'function']),
  tolerance: z.number().positive().max(200),
  passThreshold: z.number().gt(0).max(1),
  partialCredit: z.boolean(),
});

export const DrawingQuestionSchema = z.object({
  prompt: z.string(),
  canvas: z.object({ width: CanvasDimensionSchema, height: CanvasDimensionSchema }),
  /** File name in `clientFilesQuestion/`. */
  backgroundImage: z.string().nullable(),
  telemetry: z.boolean(),
  grading: DrawingGradingSchema,
});
export type DrawingQuestion = z.infer<typeof DrawingQuestionSchema>;

const UnitSchema = z.number().min(0).max(1);

/** Visible strokes only, matching what `pl-tablet-input` loads from `reference-file`. */
export const ReferenceDrawingSchema = z.object({
  version: z.literal(1),
  strokes: z.array(
    z.object({ points: z.array(z.object({ x: UnitSchema, y: UnitSchema })).min(1) }),
  ),
});
export type ReferenceDrawing = z.infer<typeof ReferenceDrawingSchema>;

/** Mirrors the `pl-tablet-input` attribute defaults. */
export const DEFAULT_DRAWING_QUESTION: DrawingQuestion = {
  prompt: '',
  canvas: { width: 800, height: 400 },
  backgroundImage: null,
  telemetry: true,
  grading: {
    autograde: true,
    mode: 'overlap',
    tolerance: 12,
    passThreshold: 0.8,
    partialCredit: true,
  },
};

/** Fits an image into the canvas size limit while keeping its aspect ratio. */
export function canvasForImage(width: number, height: number): DrawingQuestion['canvas'] {
  const scale = Math.min(1, MAX_CANVAS_DIMENSION / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
