import { useEffect, useState } from 'react';
import { api } from './api.js';
import { T } from './strings.js';
import Start from './Start.jsx';
import Question from './Question.jsx';
import Result from './Result.jsx';

const KEY = 'quiz-session';

export default function App() {
  const [info, setInfo] = useState(null);
  const [game, setGame] = useState(null); // question state or final summary from the server
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Page refresh in the middle of an exam: pick up where the learner left off.
  useEffect(() => {
    api.info().then(setInfo).catch(() => setError(T.error));
    const id = sessionStorage.getItem(KEY);
    if (id) api.resume(id).then(setGame).catch(() => sessionStorage.removeItem(KEY));
  }, []);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
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
    setGame(g);
  });

  // Reset: end the current exam on the server and start a new one with new random questions.
  const reset = () => run(async () => {
    const old = sessionStorage.getItem(KEY);
    const g = old ? await api.reset(old) : await api.start();
    sessionStorage.setItem(KEY, g.sessionId);
    setGame(g);
  });

  const leave = () => { sessionStorage.removeItem(KEY); setGame(null); };

  let screen;
  if (!game) screen = <Start info={info} busy={busy} onStart={start} />;
  else if (game.done) screen = <Result summary={game} busy={busy} onAgain={start} onHome={leave} />;
  else screen = <Question key={`${game.sessionId}-${game.index}`} game={game} setGame={setGame} run={run} busy={busy} onReset={reset} />;

  return (
    <div className="app">
      {screen}
      {error && <div className="toast" role="alert">{error}</div>}
    </div>
  );
}
