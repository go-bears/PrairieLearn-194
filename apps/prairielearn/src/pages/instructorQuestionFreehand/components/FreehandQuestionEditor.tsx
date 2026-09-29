import { QueryClient, useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';

import { run } from '@prairielearn/run';
import { getAppError } from '@prairielearn/trpc/client';
import { AppErrorAlert, QueryClientProviderDebug } from '@prairielearn/trpc/react';

import {
  type BuiltInBackgroundId,
  type FreehandQuestion,
  type ReferenceDrawing,
  builtInBackgroundForFile,
} from '../../../lib/freehand-question.shared.js';
import { createCourseTrpcClient } from '../../../trpc/course/client.js';
import { TRPCProvider, useTRPC } from '../../../trpc/course/context.js';
import type { FreehandQuestionsError } from '../../../trpc/course/freehand-questions.js';

import { type BackgroundChoice, BackgroundPicker } from './BackgroundPicker.js';
import { ReferenceCanvas, type ReferenceCanvasHandle } from './ReferenceCanvas.js';

export interface AssessmentOption {
  id: string;
  label: string;
  containsQuestion: boolean;
}

interface EditorProps {
  questionId: string;
  urlPrefix: string;
  initialQuestion: FreehandQuestion;
  initialReference: ReferenceDrawing | null;
  hasUnmanagedContent: boolean;
  assessments: AssessmentOption[];
  builtInBackgroundUrls: Record<BuiltInBackgroundId, string>;
  /** Image files in the question's `clientFilesQuestion/` folder. */
  questionImages: string[];
}

interface FormValues {
  prompt: string;
  telemetry: boolean;
  autograde: boolean;
  mode: FreehandQuestion['grading']['mode'];
  tolerance: number;
  passPercent: number;
  partialCredit: boolean;
  assessmentId: string;
  points: number;
}

/** Everything that requires remounting the reference canvas when it changes. */
interface Surface {
  version: number;
  canvas: FreehandQuestion['canvas'];
  reference: ReferenceDrawing | null;
  background: BackgroundChoice;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <div id={id} className="invalid-feedback d-block">
      {message}
    </div>
  ) : null;
}

function FreehandQuestionForm({
  questionId,
  urlPrefix,
  initialQuestion,
  initialReference,
  hasUnmanagedContent,
  assessments,
  builtInBackgroundUrls,
  questionImages,
}: EditorProps) {
  const trpc = useTRPC();
  const saveMutation = useMutation(trpc.freehandQuestions.save.mutationOptions());
  const appError = getAppError<FreehandQuestionsError['Save']>(saveMutation.error);
  const canvasRef = useRef<ReferenceCanvasHandle>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const questionUrl = `${urlPrefix}/question/${questionId}`;
  const questionFileUrl = (fileName: string) =>
    `${questionUrl}/clientFilesQuestion/${encodeURIComponent(fileName)}`;

  const initialBackground = run((): BackgroundChoice => {
    const fileName = initialQuestion.backgroundImage;
    const builtIn = builtInBackgroundForFile(fileName);
    const background = builtIn
      ? { kind: 'builtIn' as const, id: builtIn }
      : fileName
        ? { kind: 'existing' as const, fileName }
        : { kind: 'none' as const };
    const url = builtIn ? builtInBackgroundUrls[builtIn] : fileName && questionFileUrl(fileName);
    return { background, url, canvas: initialQuestion.canvas };
  });
  const [surface, setSurface] = useState<Surface>({
    version: 0,
    canvas: initialQuestion.canvas,
    reference: initialReference,
    background: initialBackground,
  });

  const { grading } = initialQuestion;
  const defaultValues: FormValues = {
    prompt: initialQuestion.prompt,
    telemetry: initialQuestion.telemetry,
    autograde: grading.autograde,
    mode: grading.mode,
    tolerance: grading.tolerance,
    passPercent: Math.round(grading.passThreshold * 100),
    partialCredit: grading.partialCredit,
    assessmentId: '',
    points: 1,
  };
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues });
  const autograde = watch('autograde');
  const comparesWithAnswerKey = watch('mode') !== 'any-drawing';
  const assessmentId = watch('assessmentId');

  function changeBackground(background: BackgroundChoice) {
    setSurface((current) => ({
      version: current.version + 1,
      canvas: background.canvas ?? current.canvas,
      reference: canvasRef.current?.getReference() ?? current.reference,
      background,
    }));
  }

  function onSubmit(values: FormValues) {
    const reference = canvasRef.current?.getReference() ?? null;
    if (values.autograde && values.mode !== 'any-drawing' && !reference) {
      setReferenceError('Draw the correct answer on the canvas to enable autograding.');
      return;
    }
    setReferenceError(null);
    saveMutation.mutate(
      {
        questionId,
        question: {
          prompt: values.prompt,
          canvas: surface.canvas,
          telemetry: values.telemetry,
          grading: {
            autograde: values.autograde,
            mode: values.mode,
            tolerance: values.tolerance,
            passThreshold: values.passPercent / 100,
            partialCredit: values.partialCredit,
          },
        },
        background: surface.background.background,
        reference,
        assessment: values.assessmentId
          ? { assessmentId: values.assessmentId, points: values.points }
          : null,
      },
      { onSuccess: () => window.location.assign(`${questionUrl}/preview`) },
    );
  }

  const invalid = (field: keyof FormValues) =>
    errors[field]
      ? { 'aria-invalid': true, 'aria-errormessage': `${field}-error` }
      : { 'aria-invalid': undefined, 'aria-errormessage': undefined };

  return (
    <form className="d-flex flex-column gap-3" onSubmit={handleSubmit(onSubmit)}>
      {hasUnmanagedContent && (
        <div className="alert alert-warning mb-0" role="alert">
          This question's <code>question.html</code> contains content the freehand question builder
          doesn't manage. Saving replaces it with the prompt and canvas below.
        </div>
      )}

      <section className="card">
        <h2 className="card-header h6">Prompt</h2>
        <div className="card-body">
          <label className="form-label" htmlFor="prompt">
            Question text
          </label>
          <textarea
            id="prompt"
            className="form-control font-monospace"
            rows={5}
            aria-describedby="prompt-help"
            defaultValue={defaultValues.prompt}
            {...register('prompt')}
          />
          <small id="prompt-help" className="form-text text-muted">
            Markdown and LaTeX math (e.g. <code>$y = 2x - 1$</code>) are supported.
          </small>
        </div>
      </section>

      <section className="card">
        <h2 className="card-header h6">Canvas and answer key</h2>
        <div className="card-body d-flex flex-column gap-3">
          <BackgroundPicker
            questionId={questionId}
            urlPrefix={urlPrefix}
            initial={initialBackground}
            builtInUrls={builtInBackgroundUrls}
            questionImages={questionImages}
            questionFileUrl={questionFileUrl}
            onChange={changeBackground}
          />

          <div>
            <p className="mb-2">
              Draw the correct answer with your pen on the {surface.canvas.width} ×{' '}
              {surface.canvas.height} px canvas. Students see the background but not your drawing;
              it is shown with the correct answer after grading.
            </p>
            <ReferenceCanvas
              key={surface.version}
              ref={canvasRef}
              canvas={surface.canvas}
              backgroundUrl={surface.background.url}
              initialReference={surface.reference}
            />
            <FieldError id="reference-error" message={referenceError ?? undefined} />
          </div>

          <div className="form-check">
            <input
              id="telemetry"
              type="checkbox"
              className="form-check-input"
              defaultChecked={defaultValues.telemetry}
              {...register('telemetry')}
            />
            <label className="form-check-label" htmlFor="telemetry">
              Collect pen telemetry (pressure, tilt, and timing) from students
            </label>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="card-header h6">Grading</h2>
        <div className="card-body d-flex flex-column gap-3">
          <div className="form-check form-switch">
            <input
              id="autograde"
              type="checkbox"
              className="form-check-input"
              defaultChecked={defaultValues.autograde}
              {...register('autograde')}
            />
            <label className="form-check-label" htmlFor="autograde">
              Grade automatically by comparing with the answer key
            </label>
          </div>
          {!autograde && <p className="text-muted mb-0">Submissions will be graded manually.</p>}
          {autograde && (
            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label" htmlFor="mode">
                  Compare drawings as
                </label>
                <select
                  id="mode"
                  className="form-select"
                  defaultValue={defaultValues.mode}
                  {...register('mode')}
                >
                  <option value="function">Graphs of y = f(x)</option>
                  <option value="overlap">Shapes</option>
                  <option value="any-drawing">Any drawing (full credit for any mark)</option>
                </select>
              </div>
              {!comparesWithAnswerKey && (
                <p className="col-md-8 text-muted mb-0 align-self-end">
                  Any submission with at least one stroke earns full credit, for example a
                  signature. No answer key is needed.
                </p>
              )}
              {comparesWithAnswerKey && (
                <>
                  <div className="col-md-4">
                    <label className="form-label" htmlFor="tolerance">
                      Tolerance (pixels)
                    </label>
                    <input
                      id="tolerance"
                      type="number"
                      step="any"
                      className={clsx('form-control', errors.tolerance && 'is-invalid')}
                      defaultValue={defaultValues.tolerance}
                      {...invalid('tolerance')}
                      {...register('tolerance', {
                        valueAsNumber: true,
                        min: { value: 1, message: 'Enter at least 1 pixel' },
                        max: { value: 200, message: 'Enter at most 200 pixels' },
                      })}
                    />
                    <FieldError id="tolerance-error" message={errors.tolerance?.message} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label" htmlFor="passPercent">
                      Match for full credit (%)
                    </label>
                    <input
                      id="passPercent"
                      type="number"
                      className={clsx('form-control', errors.passPercent && 'is-invalid')}
                      defaultValue={defaultValues.passPercent}
                      {...invalid('passPercent')}
                      {...register('passPercent', {
                        valueAsNumber: true,
                        min: { value: 1, message: 'Enter a percentage from 1 to 100' },
                        max: { value: 100, message: 'Enter a percentage from 1 to 100' },
                      })}
                    />
                    <FieldError id="passPercent-error" message={errors.passPercent?.message} />
                  </div>
                  <div className="col-12 form-check ms-2">
                    <input
                      id="partialCredit"
                      type="checkbox"
                      className="form-check-input"
                      defaultChecked={defaultValues.partialCredit}
                      {...register('partialCredit')}
                    />
                    <label className="form-check-label" htmlFor="partialCredit">
                      Award partial credit for partial matches
                    </label>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <h2 className="card-header h6">Points</h2>
        <div className="card-body row g-3">
          <div className="col-md-8">
            <label className="form-label" htmlFor="assessmentId">
              Assessment
            </label>
            <select
              id="assessmentId"
              className="form-select"
              defaultValue=""
              aria-describedby="assessmentId-help"
              {...register('assessmentId')}
            >
              <option value="">Don't change assessments</option>
              {assessments.map((assessment) => (
                <option key={assessment.id} value={assessment.id}>
                  {assessment.label}
                  {assessment.containsQuestion ? ' (includes this question)' : ''}
                </option>
              ))}
            </select>
            <small id="assessmentId-help" className="form-text text-muted">
              Points are set per assessment. The question is added to the assessment if needed.
            </small>
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="points">
              {autograde ? 'Auto-graded points' : 'Manually graded points'}
            </label>
            <input
              id="points"
              type="number"
              step="any"
              className={clsx('form-control', errors.points && 'is-invalid')}
              disabled={!assessmentId}
              defaultValue={defaultValues.points}
              {...invalid('points')}
              {...register('points', {
                valueAsNumber: true,
                validate: (value, values) =>
                  !values.assessmentId || value > 0 || 'Enter a positive number of points',
              })}
            />
            <FieldError id="points-error" message={errors.points?.message} />
          </div>
        </div>
      </section>

      <AppErrorAlert
        error={appError}
        render={{
          SYNC_JOB_FAILED: ({ message, jobSequenceId }) => (
            <>
              {message}. <a href={`${urlPrefix}/jobSequence/${jobSequenceId}`}>View job logs</a>
            </>
          ),
          UNKNOWN: ({ message }) => message,
        }}
        onDismiss={() => saveMutation.reset()}
      />

      <div className="d-flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : 'Save and preview'}
        </button>
        <a className="btn btn-outline-secondary" href={`${questionUrl}/preview`}>
          Cancel
        </a>
      </div>
    </form>
  );
}

export function FreehandQuestionEditor({
  trpcCsrfToken,
  courseId,
  ...props
}: EditorProps & { trpcCsrfToken: string; courseId: string }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    createCourseTrpcClient({ csrfToken: trpcCsrfToken, courseId }),
  );

  return (
    <QueryClientProviderDebug client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <FreehandQuestionForm {...props} />
      </TRPCProvider>
    </QueryClientProviderDebug>
  );
}

FreehandQuestionEditor.displayName = 'FreehandQuestionEditor';
