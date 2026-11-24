/** Seconds -> "mm:ss". Minutes may pass 59, so a 60-minute exam starts at "60:00". */
export const clock = (totalSeconds) => {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
