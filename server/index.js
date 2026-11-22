import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionStore, publicQuestion, validSelection, QUESTIONS_PER_SESSION } from './exam.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp(questions, options = {}) {
  const store = new SessionStore(questions, options);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));

  const state = (s) => ({
    sessionId: s.id,
    index: s.index,
    total: s.questions.length,
    score: s.score,
    question: publicQuestion(s.questions[s.index]),
    answered: s.answered
      ? { ...s.answered, correctIndices: s.questions[s.index].correct }
      : null,
  });

  const withSession = (req, res, next) => {
    const s = store.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found or expired. Please start a new exam.' });
    req.exam = s;
    next();
  };

  app.get('/api/info', (_req, res) =>
    res.json({ bankSize: questions.length, perSession: Math.min(QUESTIONS_PER_SESSION, questions.length) }));

  // Start a session: 50 random questions out of the whole bank.
  app.post('/api/sessions', (_req, res) => {
    const s = store.create();
    res.status(201).json(state(s));
  });

  // Reset: end this session (if it still exists) and start a brand new one with 50 new random questions.
  app.post('/api/sessions/:id/reset', (req, res) => {
    store.delete(req.params.id);
    res.status(201).json(state(store.create()));
  });

  // Current state (lets the page survive a refresh).
  app.get('/api/sessions/:id', withSession, (req, res) => {
    res.json(req.exam.done ? store.summary(req.exam) : state(req.exam));
  });

  // Answer the current question; the server decides right or wrong.
  app.post('/api/sessions/:id/answer', withSession, (req, res) => {
    const s = req.exam;
    if (s.done) return res.status(409).json({ error: 'This exam is already finished.' });
    const q = s.questions[s.index];
    const { selected } = req.body ?? {};
    if (!validSelection(q, selected)) return res.status(400).json({ error: 'Invalid answer for this question.' });
    const result = store.answer(s, selected);
    if (!result) return res.status(409).json({ error: 'This question was already answered.' });
    res.json({ ...result, score: s.score });
  });

  // "Next question". After the last one this returns the final summary.
  app.post('/api/sessions/:id/next', withSession, (req, res) => {
    const s = req.exam;
    const moved = store.next(s);
    if (!moved) return res.status(409).json({ error: 'Answer the current question first.' });
    res.json(moved.done ? store.summary(s) : state(s));
  });

  // Built React app
  const dist = path.join(root, 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    app.get('/', (_req, res) =>
      res.type('text').send('API is running. The web app is not built yet: run "npm run build", or use "npm run dev".'));
  }

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  });
  return app;
}

// Start listening only when run directly (node server/index.js), not when imported by tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const questions = JSON.parse(fs.readFileSync(path.join(root, 'data', 'questions.json'), 'utf8'));
  const port = Number(process.env.PORT) || 3000;
  createApp(questions).listen(port, () => {
    console.log(`Quiz server ready: ${questions.length} questions, ${Math.min(QUESTIONS_PER_SESSION, questions.length)} per session`);
    console.log(`Open http://localhost:${port}`);
  });
}
