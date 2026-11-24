import { T } from './strings.js';
import { TILES } from './theme.js';

export default function Start({ info, busy, onStart }) {
  return (
    <main className="center start">
      <div className="logo" aria-hidden="true">
        {TILES.slice(0, 4).map((t) => (
          <span key={t.shape} style={{ background: t.color }}>{t.shape}</span>
        ))}
      </div>
      <h1>{T.title}</h1>
      {info && <p className="sub">{T.startInfo(info.perSession, info.bankSize)}</p>}
      {info?.examMinutes > 0 && <p className="sub">{T.startTime(info.examMinutes)}</p>}
      <button className="big-btn" onClick={onStart} disabled={busy || !info}>
        {busy ? T.starting : T.start}
      </button>
    </main>
  );
}
