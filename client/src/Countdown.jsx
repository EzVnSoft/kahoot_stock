import { useEffect, useRef, useState } from 'react';
import { T } from './strings.js';
import { clock } from './time.js';

// Counts down to `endsAt` (a Date.now() timestamp worked out from the time the server says is left).
// Only this small component re-renders every tick. At zero it calls onExpire, and calls it again
// every 4 seconds until the exam has really ended (covers a failed network request).
export default function Countdown({ endsAt, onExpire }) {
  const [now, setNow] = useState(() => Date.now());
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [endsAt]);

  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const over = left === 0;

  useEffect(() => {
    if (!over) return undefined;
    expire.current();
    const id = setInterval(() => expire.current(), 4000);
    return () => clearInterval(id);
  }, [over, endsAt]);

  const level = left <= 60 ? 'danger' : left <= 600 ? 'warn' : '';
  const warnMinutes = left <= 60 ? 1 : left <= 300 ? 5 : left <= 600 ? 10 : 0; // spoken to screen readers
  return (
    <>
      <span className={`pill timer ${level}`} role="timer" aria-label={`${T.timeLeft}: ${clock(left)}`}>
        <span aria-hidden="true">⏱ </span>{clock(left)}
      </span>
      <span className="sr-only" role="status">{warnMinutes ? T.timeWarn(warnMinutes) : ''}</span>
    </>
  );
}
