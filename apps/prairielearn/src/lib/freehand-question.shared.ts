import { z } from 'zod';

/**
 * A freehand question is a `question.html` with a prompt and a single
 * `pl-freehand` element, plus an optional background image and reference
 * drawing. The freehand question builder edits it through this shape.
 */

export const FREEHAND_TEMPLATE_QID = 'template/freehand/basic';
export const REFERENCE_FILE_NAME = 'reference.json';
/** The file type pl-freehand gives telemetry files; must match `TELEMETRY_MIMETYPE` in pl-freehand.py. */
export const FREEHAND_TELEMETRY_MIMETYPE = 'application/vnd.prairielearn.freehand-telemetry+json';
export const MAX_CANVAS_DIMENSION = 1600;
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

/** Grids shipped in `elements/pl-freehand/clientFilesElement/`, copied into a question when chosen. */
const BuiltInBackgroundIdSchema = z.enum(['grid-paper', 'grid-axes']);
export type BuiltInBackgroundId = z.infer<typeof BuiltInBackgroundIdSchema>;
export const BUILT_IN_BACKGROUND_IDS = BuiltInBackgroundIdSchema.options;
export const BUILT_IN_BACKGROUNDS: Record<
  BuiltInBackgroundId,
  { label: string; fileName: string; canvas: { width: number; height: number } }
> = {
  'grid-paper': {
    label: 'Grid paper',
    fileName: 'grid-paper.png',
    canvas: { width: 800, height: 600 },
  },
  'grid-axes': {
    label: 'Grid with axes (1 square = 1 unit)',
    fileName: 'grid-axes.png',
    canvas: { width: 800, height: 600 },
  },
};

export function builtInBackgroundForFile(fileName: string | null): BuiltInBackgroundId | null {
  return (
    BUILT_IN_BACKGROUND_IDS.find((id) => BUILT_IN_BACKGROUNDS[id].fileName === fileName) ?? null
  );
}

/** The background the instructor picked in the builder. */
export const BackgroundInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('builtIn'), id: BuiltInBackgroundIdSchema }),
  /** A custom image already in `clientFilesQuestion/`. */
  z.object({ kind: z.literal('existing'), fileName: z.string().min(1) }),
  z.object({
    kind: z.literal('upload'),
    name: z.string().min(1),
    type: z.enum(BACKGROUND_IMAGE_TYPES),
    contentBase64: z.string(),
  }),
]);
export type BackgroundInput = z.infer<typeof BackgroundInputSchema>;

const CanvasDimensionSchema = z.number().int().positive().max(MAX_CANVAS_DIMENSION);

const FreehandGradingSchema = z.object({
  autograde: z.boolean(),
  mode: z.enum(['overlap', 'function']),
  tolerance: z.number().positive().max(200),
  passThreshold: z.number().gt(0).max(1),
  partialCredit: z.boolean(),
});

export const FreehandQuestionSchema = z.object({
  prompt: z.string(),
  canvas: z.object({ width: CanvasDimensionSchema, height: CanvasDimensionSchema }),
  /** File name in `clientFilesQuestion/`. */
  backgroundImage: z.string().nullable(),
  telemetry: z.boolean(),
  grading: FreehandGradingSchema,
});
export type FreehandQuestion = z.infer<typeof FreehandQuestionSchema>;

const UnitSchema = z.number().min(0).max(1);

/** Visible strokes only, matching what `pl-freehand` loads from `reference-file`. */
export const ReferenceDrawingSchema = z.object({
  version: z.literal(1),
  strokes: z.array(
    z.object({ points: z.array(z.object({ x: UnitSchema, y: UnitSchema })).min(1) }),
  ),
});
export type ReferenceDrawing = z.infer<typeof ReferenceDrawingSchema>;

/** The `pl-freehand` canvas size when `width` and `height` are omitted. */
export const ELEMENT_DEFAULT_CANVAS = { width: 800, height: 400 };

/** Grading settings mirror the `pl-freehand` attribute defaults. */
export const DEFAULT_FREEHAND_QUESTION: FreehandQuestion = {
  prompt: '',
  canvas: BUILT_IN_BACKGROUNDS['grid-paper'].canvas,
  backgroundImage: BUILT_IN_BACKGROUNDS['grid-paper'].fileName,
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
export function canvasForImage(width: number, height: number): FreehandQuestion['canvas'] {
  const scale = Math.min(1, MAX_CANVAS_DIMENSION / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
