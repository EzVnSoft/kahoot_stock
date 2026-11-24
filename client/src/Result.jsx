import { T } from './strings.js';
import { LETTERS } from './theme.js';
import { clock } from './time.js';

const list = (q, indices, ordered) =>
  indices.length ? indices.map((i) => `${LETTERS[i]}. ${q.options[i]}`).join(ordered ? '  →  ' : '\n') : T.none;

export default function Result({ summary, busy, onAgain, onHome }) {
  const { score, total, wrong, timedOut, unanswered, elapsedMs } = summary;
  const pct = Math.round((score / total) * 100);
  const verdict = T.verdicts[pct >= 90 ? 3 : pct >= 75 ? 2 : pct >= 50 ? 1 : 0];

  return (
    <main className="result">
      <section className="card summary">
        <h1>{timedOut ? T.timeUpTitle : T.resultTitle}</h1>
        {timedOut && <p className="timeup">{T.timeUpNote(summary.answeredCount, total)}</p>}
        <div className="big-score">{pct}%</div>
        <p className="sub dark">{T.outOf(score, total)}</p>
        {unanswered > 0 && <p className="sub dark">{T.unanswered(unanswered)}</p>}
        {elapsedMs != null && <p className="sub dark">{T.elapsed(clock(elapsedMs / 1000))}</p>}
        <p className="verdict">{verdict}</p>
        <div className="actions">
          <button className="big-btn" onClick={onAgain} disabled={busy}>{T.again}</button>
          <button className="link-btn" onClick={onHome}>←</button>
        </div>
      </section>

      {wrong.length > 0 && (
        <section className="review">
          <h2>{T.review} ({wrong.length})</h2>
          {wrong.map((w) => (
            <article className="card review-item" key={w.id}>
              <p className="qtext small">{w.text}</p>
              <p className="line bad"><b>{T.yourAnswer}:</b><br />{list(w, w.selected, w.type === 'order')}</p>
              <p className="line good"><b>{T.correctIs}:</b><br />{list(w, w.correctIndices, w.type === 'order')}</p>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
