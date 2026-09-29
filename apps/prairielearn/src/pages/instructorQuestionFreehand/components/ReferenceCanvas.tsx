import { type Ref, useEffect, useImperativeHandle, useRef } from 'react';

import type { FreehandQuestion, ReferenceDrawing } from '../../../lib/freehand-question.shared.js';

interface TabletRecorder {
  undo: () => void;
  clear: () => void;
  serialize: () => { strokes: { undone?: boolean; points: { x: number; y: number }[] }[] };
}

/** The drawing API that `pl-tablet-input.js` exposes as `window.PLTabletInput`. */
interface PLTabletInputApi {
  createRenderer: (canvas: HTMLCanvasElement, options: object) => unknown;
  createRecorder: (
    canvas: HTMLCanvasElement,
    options: object,
    renderer: unknown,
    onChange: () => void,
  ) => TabletRecorder;
}

declare global {
  interface Window {
    PLTabletInput?: PLTabletInputApi;
  }
}

export interface ReferenceCanvasHandle {
  getReference: () => ReferenceDrawing | null;
}

/**
 * The instructor's reference drawing, recorded with the same code as the
 * `pl-tablet-input` element so it matches what students see. Remount (via
 * `key`) to change the canvas size; strokes are normalized, so they carry over
 * through `initialReference`.
 */
export function ReferenceCanvas({
  canvas,
  backgroundUrl,
  initialReference,
  ref,
}: {
  canvas: FreehandQuestion['canvas'];
  backgroundUrl: string | null;
  initialReference: ReferenceDrawing | null;
  ref: Ref<ReferenceCanvasHandle>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<TabletRecorder | null>(null);

  // Attach the element's pointer recorder to the canvas, detaching it on unmount.
  useEffect(() => {
    const api = window.PLTabletInput;
    if (!api || !canvasRef.current) return;
    const controller = new AbortController();
    const options = {
      ...canvas,
      maxPoints: 100000,
      telemetry: false,
      strokeColor: '#198754',
      strokeWidth: 3,
      initialAnswer: initialReference,
      signal: controller.signal,
    };
    const renderer = api.createRenderer(canvasRef.current, options);
    recorderRef.current = api.createRecorder(canvasRef.current, options, renderer, () => {});
    return () => controller.abort();
  }, [canvas, initialReference]);

  useImperativeHandle(ref, () => ({
    getReference: () => {
      const strokes = (recorderRef.current?.serialize().strokes ?? [])
        .filter((stroke) => !stroke.undone && stroke.points.length > 0)
        .map((stroke) => ({ points: stroke.points.map(({ x, y }) => ({ x, y })) }));
      return strokes.length > 0 ? { version: 1, strokes } : null;
    },
  }));

  return (
    <div>
      <div className="d-flex gap-2 mb-2" role="toolbar" aria-label="Reference drawing tools">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={() => recorderRef.current?.undo()}
        >
          <i className="bi bi-arrow-counterclockwise" aria-hidden="true" /> Undo
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={() => recorderRef.current?.clear()}
        >
          <i className="bi bi-trash3" aria-hidden="true" /> Clear
        </button>
      </div>
      <div className="pl-tablet-input-surface" style={{ maxWidth: canvas.width }}>
        {backgroundUrl && (
          <img
            className="pl-tablet-input-background pl-tablet-input-background-fill"
            src={backgroundUrl}
            alt=""
          />
        )}
        <canvas
          ref={canvasRef}
          className="pl-tablet-input-canvas"
          width={canvas.width}
          height={canvas.height}
          aria-label="Reference drawing canvas"
        />
      </div>
    </div>
  );
}
