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
    assert.deepEqual((await call('GET', '/api/info')).body, { bankSize: 810, perSession: 50 });
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
