import { z } from 'zod';

/**
 * The file type pl-freehand gives each response's full recording (strokes,
 * timing, and any pen telemetry). Must match `STROKES_MIMETYPE` in pl-freehand.py.
 */
export const FREEHAND_STROKES_MIMETYPE = 'application/vnd.prairielearn.freehand-strokes+json';

const PointSchema = z.tuple([z.number(), z.number()]);

/** What pl-freehand stores as the submitted answer: a summary, with the strokes in a file. */
const FreehandAnswerSchema = z.object({
  element: z.literal('pl-freehand'),
  summary: z.object({
    strokes_submitted: z.number(),
    undo_count: z.number(),
    clear_count: z.number(),
    cancelled_strokes: z.number(),
    first_stroke_started_ms: z.number().nullable(),
    last_stroke_ended_ms: z.number().nullable(),
    response_duration_ms: z.number().nullable(),
    start_stroke: PointSchema.nullable(),
    end_stroke: PointSchema.nullable(),
    /** Absent in summaries stored before these were recorded. */
    telemetry: z.boolean().optional(),
    /** File in clientFilesQuestion/, or null for a blank canvas. */
    background_image: z.string().nullable().optional(),
  }),
});

const PartialScoreSchema = z.object({
  score: z.number().nullish(),
  feedback: z.unknown(),
});

/** Grading details pl-freehand adds to its feedback when it autogrades against a reference. */
const GradingDetailsSchema = z.object({
  coverage_percent: z.number(),
  accuracy_percent: z.number(),
  overlapping_points: z.number(),
});

const SubmittedFilesSchema = z.array(
  z.object({ name: z.string(), contents: z.string(), mimetype: z.string().optional() }),
);

export interface FreehandSummary {
  answers_name: string;
  score: number | null;
  coverage_percent: number | null;
  accuracy_percent: number | null;
  overlapping_points: number | null;
  strokes_submitted: number;
  undo_count: number;
  clear_count: number;
  cancelled_strokes: number;
  first_stroke_started_ms: number | null;
  last_stroke_ended_ms: number | null;
  response_duration_ms: number | null;
  start_stroke: string | null;
  end_stroke: string | null;
  telemetry: boolean | null;
  /** The background's file name, "none" for a blank canvas, or null if not recorded. */
  background_image: string | null;
}

const formatPoint = (point: [number, number] | null) =>
  point ? `(${point[0]}, ${point[1]})` : null;

/**
 * One summary per pl-freehand canvas in a submission. Answers from before
 * pl-freehand stored summaries are skipped.
 */
export function freehandSummaries(
  submittedAnswer: Record<string, unknown> | null,
  partialScores: Record<string, unknown> | null,
): FreehandSummary[] {
  return Object.entries(submittedAnswer ?? {}).flatMap(([name, value]) => {
    const answer = FreehandAnswerSchema.safeParse(value);
    if (!answer.success) return [];
    const partialScore = PartialScoreSchema.safeParse(partialScores?.[name]).data;
    const grading = GradingDetailsSchema.safeParse(partialScore?.feedback).data;
    const { start_stroke, end_stroke, telemetry, background_image, ...summary } =
      answer.data.summary;
    return [
      {
        answers_name: name,
        score: partialScore?.score == null ? null : Math.round(partialScore.score * 100),
        coverage_percent: grading?.coverage_percent ?? null,
        accuracy_percent: grading?.accuracy_percent ?? null,
        overlapping_points: grading?.overlapping_points ?? null,
        ...summary,
        start_stroke: formatPoint(start_stroke),
        end_stroke: formatPoint(end_stroke),
        telemetry: telemetry ?? null,
        background_image: background_image === undefined ? null : (background_image ?? 'none'),
      },
    ];
  });
}

/** The full recording of each pl-freehand canvas in a submission, decoded from its file. */
export function freehandRecordings(
  submittedAnswer: Record<string, unknown> | null,
): { answers_name: string; recording: unknown }[] {
  const files = SubmittedFilesSchema.safeParse(submittedAnswer?._files).data ?? [];
  return files
    .filter((file) => file.mimetype === FREEHAND_STROKES_MIMETYPE)
    .map((file) => ({
      answers_name: file.name.replace(/-strokes\.json$/, ''),
      recording: JSON.parse(Buffer.from(file.contents, 'base64').toString('utf8')),
    }));
}
