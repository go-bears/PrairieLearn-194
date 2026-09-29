import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import { type ReactNode, useState } from 'react';

import { getAppError } from '@prairielearn/trpc/client';
import { AppErrorAlert } from '@prairielearn/trpc/react';

import {
  BACKGROUND_IMAGE_TYPES,
  BUILT_IN_BACKGROUNDS,
  BUILT_IN_BACKGROUND_IDS,
  type BackgroundInput,
  type BuiltInBackgroundId,
  type FreehandQuestion,
  MAX_BACKGROUND_IMAGE_BYTES,
  MAX_CANVAS_DIMENSION,
  canvasForImage,
  isBackgroundImageType,
} from '../../../lib/freehand-question.shared.js';
import { useTRPC } from '../../../trpc/course/context.js';
import type { FreehandQuestionsError } from '../../../trpc/course/freehand-questions.js';

type Canvas = FreehandQuestion['canvas'];
type UploadBackground = Extract<BackgroundInput, { kind: 'upload' }>;

export interface BackgroundChoice {
  background: BackgroundInput;
  url: string | null;
  /** The canvas size this background needs, or null to keep the current size. */
  canvas: Canvas | null;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result).split(',')[1]));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

async function imageSize(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return { width: image.naturalWidth, height: image.naturalHeight };
}

/** Explains how an oversized image is scaled to fit the canvas, if it is. */
function scaleNotice(size: Canvas, canvas: Canvas): string | null {
  return canvas.width === size.width
    ? null
    : `This image is ${size.width} × ${size.height} px, so the canvas will use ${canvas.width} × ${canvas.height} px.`;
}

const NO_BACKGROUND: BackgroundChoice = { background: { kind: 'none' }, url: null, canvas: null };

/**
 * Chooses among the built-in grids, custom backgrounds (images in the
 * question's `clientFilesQuestion/` folder, or a new upload), or no background.
 * Custom backgrounds other than the saved one can be removed.
 */
export function BackgroundPicker({
  questionId,
  urlPrefix,
  initial,
  builtInUrls,
  questionImages,
  questionFileUrl,
  onChange,
}: {
  questionId: string;
  urlPrefix: string;
  initial: BackgroundChoice;
  builtInUrls: Record<BuiltInBackgroundId, string>;
  /** Image files in the question's `clientFilesQuestion/` folder. */
  questionImages: string[];
  questionFileUrl: (fileName: string) => string;
  onChange: (choice: BackgroundChoice) => void;
}) {
  const [selected, setSelected] = useState(initial.background);
  const [notice, setNotice] = useState<string | null>(null);
  const [upload, setUpload] = useState<{
    background: UploadBackground;
    choice: BackgroundChoice;
    notice: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedFileName = initial.background.kind === 'existing' ? initial.background.fileName : null;
  const [images, setImages] = useState(() => [
    ...new Set([...questionImages, ...(savedFileName ? [savedFileName] : [])]),
  ]);
  /** The question file awaiting confirmation before it's deleted. */
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(null);
  /** Changing this key clears the file input, so a discarded upload can be chosen again. */
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const trpc = useTRPC();
  const deleteImage = useMutation(trpc.freehandQuestions.deleteImage.mutationOptions());
  const deleteError = getAppError<FreehandQuestionsError['DeleteImage']>(deleteImage.error);

  function choose(choice: BackgroundChoice, choiceNotice: string | null = null) {
    setSelected(choice.background);
    setNotice(choiceNotice);
    onChange(choice);
  }

  async function chooseQuestionImage(fileName: string) {
    // Show the choice right away; the canvas updates once the image is measured.
    setSelected({ kind: 'existing', fileName });
    const url = questionFileUrl(fileName);
    const size = await imageSize(url).catch(() => null);
    const canvas = size && canvasForImage(size.width, size.height);
    choose(
      { background: { kind: 'existing', fileName }, url, canvas },
      size && canvas && scaleNotice(size, canvas),
    );
  }

  function removeQuestionImage(fileName: string) {
    deleteImage.mutate(
      { questionId, fileName },
      {
        onSuccess: () => {
          setImages((current) => current.filter((name) => name !== fileName));
          setConfirmingRemoval(null);
          if (selected.kind === 'existing' && selected.fileName === fileName) choose(NO_BACKGROUND);
        },
      },
    );
  }

  function discardUpload() {
    setUpload(null);
    setUploadInputKey((key) => key + 1);
    if (selected.kind === 'upload') choose(NO_BACKGROUND);
  }

  async function uploadImage(file: File | undefined) {
    if (!file) return;
    if (!isBackgroundImageType(file.type)) {
      setError('Choose a PNG, JPEG, GIF, or WebP image.');
      return;
    }
    if (file.size > MAX_BACKGROUND_IMAGE_BYTES) {
      setError(`Choose an image smaller than ${MAX_BACKGROUND_IMAGE_BYTES / 1024 / 1024} MB.`);
      return;
    }
    setError(null);
    const url = URL.createObjectURL(file);
    const [size, contentBase64] = await Promise.all([imageSize(url), readAsBase64(file)]);
    const canvas = canvasForImage(size.width, size.height);
    const background: UploadBackground = {
      kind: 'upload',
      name: file.name,
      type: file.type,
      contentBase64,
    };
    const next = {
      background,
      choice: { background, url, canvas },
      notice: scaleNotice(size, canvas),
    };
    setUpload(next);
    choose(next.choice, next.notice);
  }

  const radio = (
    id: string,
    label: ReactNode,
    checked: boolean,
    onSelect: () => void,
    action?: ReactNode,
  ) => (
    <div key={id} className="form-check d-flex align-items-center gap-2">
      <input
        id={`background-${id}`}
        type="radio"
        name="background"
        className="form-check-input"
        checked={checked}
        onChange={onSelect}
      />
      <label className="form-check-label" htmlFor={`background-${id}`}>
        {label}
      </label>
      {action}
    </div>
  );

  const removeButton = (label: string, onClick: () => void) => (
    <button
      type="button"
      className="btn btn-sm btn-link text-danger p-0"
      aria-label={label}
      onClick={onClick}
    >
      Remove
    </button>
  );

  return (
    <fieldset>
      <legend className="form-label fs-6">Background</legend>
      {BUILT_IN_BACKGROUND_IDS.map((id) =>
        radio(
          id,
          BUILT_IN_BACKGROUNDS[id].label,
          selected.kind === 'builtIn' && selected.id === id,
          () =>
            choose({
              background: { kind: 'builtIn', id },
              url: builtInUrls[id],
              canvas: BUILT_IN_BACKGROUNDS[id].canvas,
            }),
        ),
      )}
      {images.map((fileName) => (
        <div key={fileName}>
          {radio(
            `file-${fileName}`,
            `Custom background: ${fileName}`,
            selected.kind === 'existing' && selected.fileName === fileName,
            () => void chooseQuestionImage(fileName),
            fileName === savedFileName ? (
              <span className="small text-muted">(current background)</span>
            ) : (
              removeButton(`Remove ${fileName}`, () => setConfirmingRemoval(fileName))
            ),
          )}
          {confirmingRemoval === fileName && (
            <div className="alert alert-warning py-2 px-3 my-2 d-flex flex-wrap align-items-center gap-2">
              <span className="me-auto">
                Delete <code>{fileName}</code> from this question's files? It is deleted right away,
                not when you save.
              </span>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={deleteImage.isPending}
                onClick={() => removeQuestionImage(fileName)}
              >
                {deleteImage.isPending ? 'Deleting…' : 'Delete file'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => {
                  setConfirmingRemoval(null);
                  deleteImage.reset();
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      ))}
      {upload &&
        radio(
          'upload',
          `Custom background: ${upload.background.name} (not saved yet)`,
          selected.kind === 'upload',
          () => choose(upload.choice, upload.notice),
          removeButton(`Remove ${upload.background.name}`, discardUpload),
        )}
      {radio('none', 'None (blank canvas)', selected.kind === 'none', () => choose(NO_BACKGROUND))}
      <AppErrorAlert
        error={deleteError}
        render={{
          SYNC_JOB_FAILED: ({ message, jobSequenceId }) => (
            <>
              {message}. <a href={`${urlPrefix}/jobSequence/${jobSequenceId}`}>View job logs</a>
            </>
          ),
          UNKNOWN: ({ message }) => message,
        }}
        onDismiss={() => deleteImage.reset()}
      />

      <label className="form-label mt-2" htmlFor="background-upload">
        Upload your own image
      </label>
      <input
        key={uploadInputKey}
        id="background-upload"
        type="file"
        className={clsx('form-control', error && 'is-invalid')}
        accept={BACKGROUND_IMAGE_TYPES.join(',')}
        aria-describedby="background-upload-help"
        aria-invalid={error ? true : undefined}
        aria-errormessage={error ? 'background-upload-error' : undefined}
        onChange={(event) => uploadImage(event.target.files?.[0])}
      />
      {error && (
        <div id="background-upload-error" className="invalid-feedback d-block">
          {error}
        </div>
      )}
      {notice && <div className="form-text text-warning-emphasis">{notice}</div>}
      <small id="background-upload-help" className="form-text text-muted d-block">
        Images in this question's <code>clientFilesQuestion/</code> folder, including ones added on
        the <strong>Files</strong> tab, are listed as custom backgrounds. The canvas takes the
        background's proportions, up to {MAX_CANVAS_DIMENSION} px on the longer side.
      </small>
    </fieldset>
  );
}
