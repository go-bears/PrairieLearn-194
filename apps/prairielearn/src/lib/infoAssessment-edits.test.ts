import { assert, describe, it } from 'vitest';

import type { AssessmentJsonInput, ZoneAssessmentJsonInput } from '../schemas/infoAssessment.js';

import { removeQidsFromAssessment, setQuestionPoints } from './infoAssessment-edits.js';

function makeAssessment(zones: ZoneAssessmentJsonInput[]): AssessmentJsonInput {
  return {
    uuid: '11111111-1111-4111-8111-111111111111',
    type: 'Homework',
    title: 'Test assessment',
    set: 'Homework',
    number: '1',
    zones,
  };
}

describe('removeQidsFromAssessment', () => {
  it('reports only the deleted qids that the assessment actually references', () => {
    const assessment = makeAssessment([
      {
        title: 'z1',
        questions: [
          { id: 'used-a', points: 5 },
          { id: 'kept', points: 5 },
        ],
      },
      {
        title: 'z2',
        questions: [{ points: 5, alternatives: [{ id: 'used-b' }, { id: 'kept-alt' }] }],
      },
    ]);

    const { matchedQids, lockpointsMovedOrRemoved } = removeQidsFromAssessment(
      assessment,
      new Set(['used-a', 'used-b', 'not-referenced']),
    );

    assert.sameMembers(matchedQids, ['used-a', 'used-b']);
    assert.equal(lockpointsMovedOrRemoved, 0);
  });

  it('drops all zones when every zone would be emptied', () => {
    const assessment = makeAssessment([{ title: 'z1', questions: [{ id: 'a', points: 5 }] }]);

    const {
      assessment: updated,
      matchedQids,
      lockpointsMovedOrRemoved,
    } = removeQidsFromAssessment(assessment, new Set(['a']));

    assert.isEmpty(updated.zones ?? []);
    assert.sameMembers(matchedQids, ['a']);
    assert.equal(lockpointsMovedOrRemoved, 0);
  });

  it('removes the lockpoint when a lockpoint zone is promoted to first', () => {
    const assessment = makeAssessment([
      { title: 'first', questions: [{ id: 'a', points: 5 }] },
      { title: 'second', lockpoint: true, questions: [{ id: 'b', points: 5 }] },
    ]);

    const { assessment: updated, lockpointsMovedOrRemoved } = removeQidsFromAssessment(
      assessment,
      new Set(['a']),
    );

    assert.lengthOf(updated.zones ?? [], 1);
    assert.equal(updated.zones?.[0].title, 'second');
    assert.isFalse(updated.zones?.[0].lockpoint);
    assert.equal(lockpointsMovedOrRemoved, 1);
  });

  it('shifts a lockpoint to the next zone when its zone is emptied', () => {
    const assessment = makeAssessment([
      { title: 'first', questions: [{ id: 'a', points: 5 }] },
      { title: 'locked', lockpoint: true, questions: [{ id: 'b', points: 5 }] },
      { title: 'last', questions: [{ id: 'c', points: 5 }] },
    ]);

    const { assessment: updated, lockpointsMovedOrRemoved } = removeQidsFromAssessment(
      assessment,
      new Set(['b']),
    );

    assert.deepEqual(
      (updated.zones ?? []).map((zone) => zone.title),
      ['first', 'last'],
    );
    assert.isNotTrue(updated.zones?.[0].lockpoint);
    assert.isTrue(updated.zones?.[1].lockpoint);
    assert.equal(lockpointsMovedOrRemoved, 1);
  });

  it('skips unselectable zones when shifting a lockpoint', () => {
    const assessment = makeAssessment([
      { title: 'first', questions: [{ id: 'a', points: 5 }] },
      { title: 'locked', lockpoint: true, questions: [{ id: 'b', points: 5 }] },
      { title: 'unselectable', numberChoose: 0, questions: [{ id: 'c', points: 5 }] },
      { title: 'selectable', questions: [{ id: 'd', points: 5 }] },
    ]);

    const { assessment: updated, lockpointsMovedOrRemoved } = removeQidsFromAssessment(
      assessment,
      new Set(['b']),
    );

    assert.deepEqual(
      (updated.zones ?? []).map((zone) => zone.title),
      ['first', 'unselectable', 'selectable'],
    );
    assert.isNotTrue(updated.zones?.[0].lockpoint);
    assert.isNotTrue(updated.zones?.[1].lockpoint);
    assert.isTrue(updated.zones?.[2].lockpoint);
    assert.equal(lockpointsMovedOrRemoved, 1);
  });

  it('drops a shifted lockpoint when only unselectable zones remain later', () => {
    const assessment = makeAssessment([
      { title: 'first', questions: [{ id: 'a', points: 5 }] },
      { title: 'locked', lockpoint: true, questions: [{ id: 'b', points: 5 }] },
      { title: 'unselectable', numberChoose: 0, questions: [{ id: 'c', points: 5 }] },
    ]);

    const { assessment: updated, lockpointsMovedOrRemoved } = removeQidsFromAssessment(
      assessment,
      new Set(['b']),
    );

    assert.deepEqual(
      (updated.zones ?? []).map((zone) => zone.title),
      ['first', 'unselectable'],
    );
    assert.isNotTrue(updated.zones?.[0].lockpoint);
    assert.isNotTrue(updated.zones?.[1].lockpoint);
    assert.equal(lockpointsMovedOrRemoved, 1);
  });

  it('drops a lockpoint when its zone is the last and is emptied', () => {
    const assessment = makeAssessment([
      { title: 'first', questions: [{ id: 'a', points: 5 }] },
      { title: 'locked', lockpoint: true, questions: [{ id: 'b', points: 5 }] },
    ]);

    const { assessment: updated, lockpointsMovedOrRemoved } = removeQidsFromAssessment(
      assessment,
      new Set(['b']),
    );

    assert.deepEqual(
      (updated.zones ?? []).map((zone) => zone.title),
      ['first'],
    );
    assert.isNotTrue(updated.zones?.[0].lockpoint);
    assert.equal(lockpointsMovedOrRemoved, 1);
  });
});

describe('setQuestionPoints', () => {
  it('replaces every points setting on an existing question', () => {
    const assessment = makeAssessment([
      {
        questions: [
          { id: 'q1', points: [3, 2, 1], maxPoints: 5 },
          { id: 'q2', autoPoints: 1 },
        ],
      },
    ]);
    const { assessment: updated, added } = setQuestionPoints(assessment, 'q1', { manualPoints: 4 });
    assert.isFalse(added);
    assert.deepEqual(updated.zones?.[0].questions, [
      { id: 'q1', manualPoints: 4 },
      { id: 'q2', autoPoints: 1 },
    ]);
  });

  it('updates the question inside an alternative group', () => {
    const assessment = makeAssessment([
      {
        questions: [{ numberChoose: 1, alternatives: [{ id: 'q1' }, { id: 'q2', autoPoints: 1 }] }],
      },
    ]);
    const { assessment: updated } = setQuestionPoints(assessment, 'q2', { autoPoints: 5 });
    assert.deepEqual(updated.zones?.[0].questions[0].alternatives, [
      { id: 'q1' },
      { id: 'q2', autoPoints: 5 },
    ]);
  });

  it('adds a missing question in a new zone without mutating the input', () => {
    const assessment = makeAssessment([{ questions: [{ id: 'q1', autoPoints: 1 }] }]);
    const { assessment: updated, added } = setQuestionPoints(assessment, 'q2', { autoPoints: 2 });
    assert.isTrue(added);
    assert.deepEqual(updated.zones?.[1], { questions: [{ id: 'q2', autoPoints: 2 }] });
    assert.lengthOf(assessment.zones ?? [], 1);
  });
});
