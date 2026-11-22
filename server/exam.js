// Pure exam logic: picking random questions, checking answers, in-memory sessions.
import { randomUUID } from 'node:crypto';

export const QUESTIONS_PER_SESSION = 50;
const SESSION_TTL_MS = 3 * 60 * 60 * 1000; // forget sessions after 3 hours

/** Random sample without repeats (partial Fisher–Yates). */
export function pickRandom(items, count, rng = Math.random) {
  const pool = items.slice();
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/** What the browser may see: never includes the correct answer. */
export function publicQuestion(q) {
  return { id: q.id, text: q.text, options: q.options, type: q.type };
}

/** Is `selected` (array of option indexes) a valid answer shape for this question? */
export function validSelection(q, selected) {
  if (!Array.isArray(selected)) return false;
  if (!selected.every((i) => Number.isInteger(i) && i >= 0 && i < q.options.length)) return false;
  if (new Set(selected).size !== selected.length) return false;
  if (q.type === 'single') return selected.length === 1;
  if (q.type === 'order') return selected.length === q.options.length;
  return true; // multi: any number of ticks, including none ("all statements are wrong")
}

export function isCorrect(q, selected) {
  if (q.type === 'single') return selected[0] === q.correct[0];
  if (q.type === 'order') return selected.every((v, i) => v === q.correct[i]);
  const a = [...selected].sort((x, y) => x - y);
  return a.length === q.correct.length && a.every((v, i) => v === q.correct[i]);
}

export class SessionStore {
  constructor(questions, { perSession = QUESTIONS_PER_SESSION, rng = Math.random } = {}) {
    this.questions = questions;
    this.perSession = perSession;
    this.rng = rng;
    this.sessions = new Map();
  }

  create() {
    this.sweep();
    const session = {
      id: randomUUID(),
      createdAt: Date.now(),
      questions: pickRandom(this.questions, this.perSession, this.rng),
      index: 0,
      score: 0,
      answered: null, // { selected, correct } once the current question is answered
      history: [], // one entry per finished question
      done: false,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id) {
    const s = this.sessions.get(id);
    if (!s) return null;
    if (Date.now() - s.createdAt > SESSION_TTL_MS) { this.sessions.delete(id); return null; }
    return s;
  }

  /** End a session early (used by Reset). */
  delete(id) {
    return this.sessions.delete(id);
  }

  sweep() {
    const now = Date.now();
    for (const [id, s] of this.sessions) if (now - s.createdAt > SESSION_TTL_MS) this.sessions.delete(id);
  }

  /** Grade the current question. Returns null if it was already answered. */
  answer(session, selected) {
    if (session.answered || session.done) return null;
    const q = session.questions[session.index];
    const correct = isCorrect(q, selected);
    if (correct) session.score += 1;
    session.answered = { selected, correct };
    return { correct, correctIndices: q.correct };
  }

  /** Move on. Returns null if the current question is not answered yet. */
  next(session) {
    if (session.done) return { done: true };
    if (!session.answered) return null;
    session.history.push({ question: session.questions[session.index], ...session.answered });
    session.answered = null;
    session.index += 1;
    if (session.index >= session.questions.length) { session.done = true; return { done: true }; }
    return { done: false };
  }

  summary(session) {
    const wrong = session.history
      .filter((h) => !h.correct)
      .map((h) => ({ ...publicQuestion(h.question), selected: h.selected, correctIndices: h.question.correct }));
    return { done: true, score: session.score, total: session.questions.length, wrong };
  }
}
