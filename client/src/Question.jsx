import { useEffect, useState } from 'react';
import { api } from './api.js';
import { T } from './strings.js';
import { TILES, LETTERS } from './theme.js';

const fmt = (indices) => (indices.length ? indices.map((i) => LETTERS[i]).join(', ') : T.none);

export default function Question({ game, setGame, run, busy, onReset }) {
  const { question: q, index, total, score, sessionId } = game;
  const [picked, setPicked] = useState([]); // option indexes (for "order": in the order tapped)
  const [result, setResult] = useState(
    game.answered ? { correct: game.answered.correct, correctIndices: game.answered.correctIndices, selected: game.answered.selected } : null,
  );
  const [shownScore, setShownScore] = useState(score);
  const [confirming, setConfirming] = useState(false); // "start a new exam?" confirmation

  useEffect(() => {
    if (!confirming) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setConfirming(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming]);

  const answered = result !== null;
  const shownPicked = answered ? result.selected : picked;

  const submit = (selected) =>
    run(async () => {
      const r = await api.answer(sessionId, selected);
      setResult({ correct: r.correct, correctIndices: r.correctIndices, selected });
      setShownScore(r.score);
    });

  const tap = (i) => {
    if (answered) return;
    if (q.type === 'single') return submit([i]); // one tap = final answer, like Kahoot
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  };

  const next = () =>
    run(async () => {
      const g = await api.next(sessionId);
      if (g.done) sessionStorage.removeItem('quiz-session');
      setGame(g);
    });

  const canCheck = q.type === 'order' ? picked.length === q.options.length : true;
  const last = index + 1 === total;

  const state = (i) => {
    if (!answered) return picked.includes(i) ? 'picked' : '';
    // order questions: a tile is right when the learner put it in its correct position
    if (q.type === 'order') return result.selected.indexOf(i) === result.correctIndices.indexOf(i) ? 'right' : 'wrong';
    const isRight = result.correctIndices.includes(i);
    const isPicked = result.selected.includes(i);
    if (isRight) return 'right';
    return isPicked ? 'wrong' : 'dim';
  };

  return (
    <main className="quiz">
      <header className="topbar">
        <span className="pill">{T.question(index + 1, total)}</span>
        <button type="button" className="pill pill-btn" onClick={() => setConfirming(true)} disabled={busy || confirming}>
          ↻ {T.reset}
        </button>
        <span className="pill">{T.score}: {shownScore}</span>
      </header>
      {confirming && (
        <div className="confirm-bar" role="alert">
          <span>{T.resetAsk}</span>
          <button type="button" className="mini" onClick={() => setConfirming(false)} autoFocus>{T.resetNo}</button>
          <button type="button" className="mini danger" onClick={onReset} disabled={busy}>{T.resetYes}</button>
        </div>
      )}
      <div className="progress"><div style={{ width: `${((index + (answered ? 1 : 0)) / total) * 100}%` }} /></div>

      <section className="card">
        <p className="qtext">{q.text}</p>
        {q.type === 'multi' && <p className="hint">{T.hintMulti}</p>}
        {q.type === 'order' && <p className="hint">{T.hintOrder}</p>}
      </section>

      <section className={`answers n${q.options.length}`}>
        {q.options.map((text, i) => {
          const tile = TILES[i];
          const s = state(i);
          const order = q.type === 'order' ? shownPicked.indexOf(i) + 1 : 0;
          return (
            <button
              key={i}
              className={`tile ${s}`}
              style={{ '--tile': tile.color }}
              onClick={() => tap(i)}
              disabled={answered}
              aria-pressed={!answered && q.type !== 'single' ? picked.includes(i) : undefined}
            >
              <span className="shape">{tile.shape}</span>
              <span className="letter">{LETTERS[i]}</span>
              <span className="otext">{text}</span>
              {q.type === 'order' && order > 0 && <span className="badge">{order}</span>}
              {q.type === 'multi' && !answered && picked.includes(i) && <span className="badge">✓</span>}
              {answered && q.type !== 'order' && s === 'right' && <span className="badge ok">✓</span>}
              {answered && q.type !== 'order' && s === 'wrong' && <span className="badge bad">✗</span>}
            </button>
          );
        })}
      </section>

      {!answered && q.type !== 'single' && (
        <div className="actions">
          <button className="big-btn" onClick={() => submit(picked)} disabled={!canCheck}>{T.check}</button>
        </div>
      )}

      {answered && (
        <div className={`feedback ${result.correct ? 'good' : 'bad'}`}>
          <div className="msg">
            <strong>{result.correct ? T.correct : T.wrong}</strong>
            {!result.correct && (
              <span> {T.correctIs}: {q.type === 'order' ? result.correctIndices.map((i) => LETTERS[i]).join(' → ') : fmt(result.correctIndices)}</span>
            )}
          </div>
          <button className="big-btn" onClick={next} autoFocus>{last ? T.finish : T.next}</button>
        </div>
      )}
    </main>
  );
}
