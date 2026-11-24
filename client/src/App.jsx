import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { T } from './strings.js';
import Start from './Start.jsx';
import Question from './Question.jsx';
import Result from './Result.jsx';

const KEY = 'quiz-session';

// The server says how much time is left; the browser counts down to that moment.
const withClock = (g) => (g && !g.done && typeof g.timeLeftMs === 'number' ? { ...g, endsAt: Date.now() + g.timeLeftMs } : g);

export default function App() {
  const [info, setInfo] = useState(null);
  const [game, setGame] = useState(null); // question state or final summary from the server
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const finishing = useRef(false);
  const show = (g) => setGame(withClock(g));

  // Page refresh in the middle of an exam: pick up where the learner left off.
  useEffect(() => {
    api.info().then(setInfo).catch(() => setError(T.error));
    const id = sessionStorage.getItem(KEY);
    if (id) api.resume(id).then(show).catch(() => sessionStorage.removeItem(KEY));
  }, []);

  // The exam was closed by the clock: fetch the final result from the server.
  const showFinal = async () => {
    const id = sessionStorage.getItem(KEY);
    if (!id) return;
    try {
      const g = await api.resume(id);
      sessionStorage.removeItem(KEY);
      setGame(g);
    } catch {
      setError(T.error);
    }
  };

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      if (e.status === 409 && e.data?.timeUp) { await showFinal(); return null; } // the server closed the exam: time is up
      setError(e.status === 404 ? T.expired : T.error);
      if (e.status === 404) { sessionStorage.removeItem(KEY); setGame(null); }
      return null;
    } finally {
      setBusy(false);
    }
  };

  const start = () => run(async () => {
    const g = await api.start();
    sessionStorage.setItem(KEY, g.sessionId);
    show(g);
  });

  // The countdown reached zero: end the exam and show the result (the server has the final say).
  const timeUp = async () => {
    const id = sessionStorage.getItem(KEY);
    if (!id || finishing.current) return;
    finishing.current = true;
    try {
      const g = await api.finish(id);
      sessionStorage.removeItem(KEY);
      setGame(g);
    } catch (e) {
      if (e.status === 409 && e.data?.timeLeftMs > 0) {
        // our clock was ahead of the server's: re-sync and keep going
        setGame((cur) => (cur && !cur.done ? { ...cur, endsAt: Date.now() + e.data.timeLeftMs } : cur));
      } else if (e.status === 404) {
        sessionStorage.removeItem(KEY);
        setGame(null);
        setError(T.expired);
      } else {
        setError(T.error); // the countdown asks again in a few seconds
      }
    } finally {
      finishing.current = false;
    }
  };

  // Reset: end the current exam on the server and start a new one with new random questions.
  const reset = () => run(async () => {
    const old = sessionStorage.getItem(KEY);
    const g = old ? await api.reset(old) : await api.start();
    sessionStorage.setItem(KEY, g.sessionId);
    show(g);
  });

  const leave = () => { sessionStorage.removeItem(KEY); setGame(null); };

  let screen;
  if (!game) screen = <Start info={info} busy={busy} onStart={start} />;
  else if (game.done) screen = <Result summary={game} busy={busy} onAgain={start} onHome={leave} />;
  else screen = <Question key={`${game.sessionId}-${game.index}`} game={game} setGame={show} run={run} busy={busy} onReset={reset} onTimeUp={timeUp} />;

  return (
    <div className="app">
      {screen}
      {error && <div className="toast" role="alert">{error}</div>}
    </div>
  );
}
