import { assert, describe, it } from 'vitest';

import {
  FREEHAND_STROKES_MIMETYPE,
  freehandRecordings,
  freehandSummaries,
} from './freehand-submissions.js';

const SUMMARY = {
  strokes_submitted: 2,
  undo_count: 1,
  clear_count: 0,
  cancelled_strokes: 0,
  first_stroke_started_ms: 800,
  last_stroke_ended_ms: 4200,
  response_duration_ms: 5000,
  start_stroke: [162, 416],
  end_stroke: [350, 41],
};

describe('freehandSummaries', () => {
  it('combines the answer summary with the grading details', () => {
    const summaries = freehandSummaries(
      {
        graph: { element: 'pl-freehand', version: 2, summary: SUMMARY },
        other: { value: 3 },
      },
      {
        graph: {
          score: 0.874,
          weight: 1,
          feedback: {
            text: '…',
            coverage_percent: 91,
            accuracy_percent: 84,
            overlapping_points: 120,
          },
        },
      },
    );
    assert.deepEqual(summaries, [
      {
        answers_name: 'graph',
        score: 87,
        coverage_percent: 91,
        accuracy_percent: 84,
        overlapping_points: 120,
        strokes_submitted: 2,
        undo_count: 1,
        clear_count: 0,
        cancelled_strokes: 0,
        first_stroke_started_ms: 800,
        last_stroke_ended_ms: 4200,
        response_duration_ms: 5000,
        start_stroke: '(162, 416)',
        end_stroke: '(350, 41)',
      },
    ]);
  });

  it('leaves grading columns blank for ungraded canvases', () => {
    const [summary] = freehandSummaries(
      { graph: { element: 'pl-freehand', summary: SUMMARY } },
      null,
    );
    assert.isNull(summary.score);
    assert.isNull(summary.coverage_percent);
  });

  it('skips answers stored before summaries existed', () => {
    assert.deepEqual(freehandSummaries({ graph: { version: 1, strokes: [] } }, null), []);
  });
});

describe('freehandRecordings', () => {
  it('decodes only pl-freehand strokes files', () => {
    const recording = { version: 1, strokes: [] };
    const recordings = freehandRecordings({
      _files: [
        {
          name: 'graph-strokes.json',
          contents: Buffer.from(JSON.stringify(recording)).toString('base64'),
          mimetype: FREEHAND_STROKES_MIMETYPE,
        },
        { name: 'notes.txt', contents: Buffer.from('hi').toString('base64') },
      ],
    });
    assert.deepEqual(recordings, [{ answers_name: 'graph', recording }]);
  });
});
