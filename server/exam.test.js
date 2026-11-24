import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pickRandom, isCorrect, validSelection } from './exam.js';
import { createApp } from './index.js';

const bank = JSON.parse(fs.readFileSync(new URL('../data/questions.json', import.meta.url), 'utf8'));

test('question bank is sane', () => {
  assert.equal(bank.length, 810);
  assert.equal(new Set(bank.map((q) => q.id)).size, bank.length);
  for (const q of bank) {
    assert.ok(q.options.length >= 2 && q.options.length <= 6, `#${q.id} options`);
    assert.ok(q.correct.every((i) => i >= 0 && i < q.options.length), `#${q.id} correct index`);
    if (q.type === 'single') assert.equal(q.correct.length, 1);
  }
});

test('pickRandom returns distinct items', () => {
  const picked = pickRandom(bank, 50);
  assert.equal(picked.length, 50);
  assert.equal(new Set(picked.map((q) => q.id)).size, 50);
});

test('grading: single, multi (any order), order (exact)', () => {
  assert.ok(isCorrect({ type: 'single', correct: [2] }, [2]));
  assert.ok(!isCorrect({ type: 'single', correct: [2] }, [1]));
  assert.ok(isCorrect({ type: 'multi', correct: [0, 2] }, [2, 0]));
  assert.ok(!isCorrect({ type: 'multi', correct: [0, 2] }, [0]));
  assert.ok(isCorrect({ type: 'multi', correct: [] }, []));
  assert.ok(isCorrect({ type: 'order', correct: [1, 0, 2] }, [1, 0, 2]));
  assert.ok(!isCorrect({ type: 'order', correct: [1, 0, 2] }, [0, 1, 2]));
  assert.ok(!validSelection({ type: 'single', options: ['a', 'b'] }, [0, 1]));
  assert.ok(!validSelection({ type: 'order', options: ['a', 'b', 'c'] }, [0, 1]));
  assert.ok(!validSelection({ type: 'multi', options: ['a', 'b'] }, [0, 0]));
});

test('full session over HTTP: 50 distinct questions, never leaks answers, score adds up', async () => {
  const server = createApp(bank).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  try {
    assert.deepEqual((await call('GET', '/api/info')).body, { bankSize: 810, perSession: 50, examMinutes: 60 });
    let { status, body } = await call('POST', '/api/sessions');
    assert.equal(status, 201);
    const id = body.sessionId;
    const byId = new Map(bank.map((q) => [q.id, q]));
    const seen = new Set();
    let expected = 0;
    for (let i = 0; i < 50; i++) {
      assert.equal(body.index, i);
      assert.equal(body.total, 50);
      assert.ok(!('correct' in body.question), 'question must not include the answer');
      assert.ok(!seen.has(body.question.id), 'question repeated');
      seen.add(body.question.id);
      const truth = byId.get(body.question.id);
      // answer correctly on even questions, wrongly on odd ones
      let pick;
      if (i % 2 === 0) pick = truth.correct.slice();
      else if (truth.type === 'single') pick = [(truth.correct[0] + 1) % truth.options.length];
      else if (truth.type === 'order') pick = truth.correct.slice().reverse();
      else pick = truth.correct.length ? [] : [0];
      // next before answering is refused
      assert.equal((await call('POST', `/api/sessions/${id}/next`)).status, 409);
      const ans = await call('POST', `/api/sessions/${id}/answer`, { selected: pick });
      assert.equal(ans.status, 200);
      assert.equal(ans.body.correct, i % 2 === 0, `question ${truth.id} (${truth.type}) grading`);
      if (ans.body.correct) expected++;
      assert.deepEqual(ans.body.correctIndices, truth.correct);
      // answering twice is refused
      assert.equal((await call('POST', `/api/sessions/${id}/answer`, { selected: pick })).status, 409);
      body = (await call('POST', `/api/sessions/${id}/next`)).body;
    }
    assert.equal(body.done, true);
    assert.equal(body.score, expected);
    assert.equal(body.total, 50);
    assert.equal(body.wrong.length, 25);
    assert.equal(seen.size, 50);
    assert.equal((await call('GET', '/api/sessions/does-not-exist')).status, 404);
  } finally {
    server.close();
  }
});

test('reset ends the session and starts a new one with new random questions', async () => {
  const server = createApp(bank).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  // read all 50 question ids of a session by answering and moving on (grading is irrelevant here)
  const ids = async (first) => {
    const out = [];
    let body = first.body;
    const id = body.sessionId;
    for (let i = 0; i < 50; i++) {
      out.push(body.question.id);
      const q = bank.find((x) => x.id === body.question.id);
      await call('POST', `/api/sessions/${id}/answer`, { selected: q.correct.slice() });
      body = (await call('POST', `/api/sessions/${id}/next`)).body;
    }
    return out;
  };
  try {
    const first = await call('POST', '/api/sessions');
    const oldId = first.body.sessionId;
    const oldQuestions = (await call('GET', `/api/sessions/${oldId}`)).body;
    // make some progress in the old session
    const q0 = bank.find((x) => x.id === oldQuestions.question.id);
    await call('POST', `/api/sessions/${oldId}/answer`, { selected: q0.correct.slice() });
    await call('POST', `/api/sessions/${oldId}/next`);

    const fresh = await call('POST', `/api/sessions/${oldId}/reset`);
    assert.equal(fresh.status, 201);
    assert.notEqual(fresh.body.sessionId, oldId);
    assert.equal(fresh.body.index, 0);
    assert.equal(fresh.body.score, 0);
    assert.equal(fresh.body.total, 50);
    assert.equal(fresh.body.answered, null);
    assert.ok(!('correct' in fresh.body.question));
    // the old session is gone
    assert.equal((await call('GET', `/api/sessions/${oldId}`)).status, 404);
    assert.equal((await call('POST', `/api/sessions/${oldId}/answer`, { selected: [0] })).status, 404);
    // the new session is a full, different set of 50 distinct questions
    const newIds = await ids(fresh);
    assert.equal(new Set(newIds).size, 50);
    const another = await call('POST', `/api/sessions/${fresh.body.sessionId}/reset`);
    const anotherIds = await ids(another);
    assert.notDeepEqual(anotherIds, newIds);
    // resetting an unknown or expired id still gives a working new session
    const orphan = await call('POST', '/api/sessions/does-not-exist/reset');
    assert.equal(orphan.status, 201);
    assert.equal(orphan.body.total, 50);
  } finally {
    server.close();
  }
});

// ---- exam timer (60 minutes), tested with a fake clock so nothing has to wait ----------------------------

const MIN = 60 * 1000;

function timedApp(options = {}) {
  const clock = { t: 1_700_000_000_000 };
  const server = createApp(bank, { now: () => clock.t, ...options }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const truth = (qid) => bank.find((x) => x.id === qid);
  // answer the current question correctly and move on; returns the next state
  const doOne = async (id, state) => {
    const ans = await call('POST', `/api/sessions/${id}/answer`, { selected: truth(state.question.id).correct.slice() });
    assert.equal(ans.status, 200);
    return (await call('POST', `/api/sessions/${id}/next`)).body;
  };
  return { clock, server, call, truth, doOne };
}

test('timer: every new exam gets 60 minutes and the remaining time is reported', async () => {
  const { clock, server, call } = timedApp();
  try {
    const info = (await call('GET', '/api/info')).body;
    assert.equal(info.examMinutes, 60);
    const first = (await call('POST', '/api/sessions')).body;
    assert.equal(first.timeLeftMs, 60 * MIN);
    assert.equal(first.durationMs, 60 * MIN);
    clock.t += 10 * MIN;
    const later = (await call('GET', `/api/sessions/${first.sessionId}`)).body;
    assert.equal(later.timeLeftMs, 50 * MIN);
    assert.equal(later.index, 0);
  } finally { server.close(); }
});

test('timer: reset restarts the clock at 60 minutes', async () => {
  const { clock, server, call } = timedApp();
  try {
    const first = (await call('POST', '/api/sessions')).body;
    clock.t += 45 * MIN;
    assert.equal((await call('GET', `/api/sessions/${first.sessionId}`)).body.timeLeftMs, 15 * MIN);
    const fresh = (await call('POST', `/api/sessions/${first.sessionId}/reset`)).body;
    assert.equal(fresh.timeLeftMs, 60 * MIN);
    assert.equal((await call('GET', `/api/sessions/${first.sessionId}`)).status, 404);
  } finally { server.close(); }
});

test('timer: the browser may only end the exam when time is really up; then the summary says so', async () => {
  const { clock, server, call, truth, doOne } = timedApp();
  try {
    let state = (await call('POST', '/api/sessions')).body;
    const id = state.sessionId;
    clock.t += 5 * MIN;
    for (let i = 0; i < 3; i++) state = await doOne(id, state); // 3 correct answers, now on question 4
    assert.equal(state.index, 3);
    // answer question 4 but do not press "next"
    const q4 = truth(state.question.id);
    assert.equal((await call('POST', `/api/sessions/${id}/answer`, { selected: q4.correct.slice() })).status, 200);

    // too early: refused, and the server says how much time is left so the browser can re-sync
    const early = await call('POST', `/api/sessions/${id}/finish`);
    assert.equal(early.status, 409);
    assert.equal(early.body.timeLeftMs, 55 * MIN);

    clock.t += 55 * MIN; // exactly at the deadline
    const atZero = (await call('GET', `/api/sessions/${id}`)).body;
    assert.equal(atZero.done, undefined); // still running (grace period for late answers)
    assert.equal(atZero.timeLeftMs, 0);

    const fin = await call('POST', `/api/sessions/${id}/finish`);
    assert.equal(fin.status, 200);
    assert.equal(fin.body.done, true);
    assert.equal(fin.body.timedOut, true);
    assert.equal(fin.body.score, 4); // 3 + the answered-but-not-"next" question
    assert.equal(fin.body.answeredCount, 4);
    assert.equal(fin.body.unanswered, 46);
    assert.equal(fin.body.total, 50);
    assert.equal(fin.body.elapsedMs, 60 * MIN);
    assert.equal(fin.body.wrong.length, 0);
    // finishing again is harmless, and nothing can be answered any more
    assert.equal((await call('POST', `/api/sessions/${id}/finish`)).body.timedOut, true);
    const late = await call('POST', `/api/sessions/${id}/answer`, { selected: [0] });
    assert.equal(late.status, 409);
    assert.equal(late.body.timeUp, true);
    assert.equal((await call('GET', `/api/sessions/${id}`)).body.timedOut, true);
    assert.equal((await call('POST', `/api/sessions/${id}/next`)).body.timedOut, true);
  } finally { server.close(); }
});

test('timer: an answer sent a moment after the deadline still counts; one sent much later does not', async () => {
  const { clock, server, call, truth } = timedApp();
  try {
    const a = (await call('POST', '/api/sessions')).body;
    clock.t += 60 * MIN + 2000; // 2 s late: inside the grace period
    const q = truth(a.question.id);
    const ok = await call('POST', `/api/sessions/${a.sessionId}/answer`, { selected: q.correct.slice() });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.correct, true);

    const b = (await call('POST', '/api/sessions')).body;
    clock.t += 60 * MIN + 5000; // 5 s late: too late, and the exam closes by itself (nobody called "finish")
    const late = await call('POST', `/api/sessions/${b.sessionId}/answer`, { selected: [0] });
    assert.equal(late.status, 409);
    assert.equal(late.body.timeUp, true);
    const summary = (await call('GET', `/api/sessions/${b.sessionId}`)).body;
    assert.equal(summary.done, true);
    assert.equal(summary.timedOut, true);
    assert.equal(summary.score, 0);
    assert.equal(summary.unanswered, 50);
  } finally { server.close(); }
});

test('timer: finishing all 50 questions in time is not a time-out, and the time used is reported', async () => {
  const { clock, server, call, doOne } = timedApp();
  try {
    let state = (await call('POST', '/api/sessions')).body;
    const id = state.sessionId;
    for (let i = 0; i < 50; i++) { clock.t += 30 * 1000; state = await doOne(id, state); }
    assert.equal(state.done, true);
    assert.equal(state.timedOut, false);
    assert.equal(state.unanswered, 0);
    assert.equal(state.answeredCount, 50);
    assert.equal(state.elapsedMs, 25 * MIN);
    assert.equal(state.score, 50);
    // "finish" on a completed exam just returns the same summary
    const again = await call('POST', `/api/sessions/${id}/finish`);
    assert.equal(again.status, 200);
    assert.equal(again.body.timedOut, false);
  } finally { server.close(); }
});

test('timer: the limit can be changed (EXAM_MINUTES) and is shown to the browser', async () => {
  const { server, call } = timedApp({ durationMs: 90 * MIN });
  try {
    assert.equal((await call('GET', '/api/info')).body.examMinutes, 90);
    assert.equal((await call('POST', '/api/sessions')).body.timeLeftMs, 90 * MIN);
  } finally { server.close(); }
});
