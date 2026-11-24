# Luyện thi chứng khoán — Kahoot-style practice for one learner

A small web app for exam practice. One person starts a session, gets **50 random questions** out of the
**810-question bank**, answers them one at a time, sees right/wrong straight away, and presses
**Câu tiếp theo** (Next question). At the end there is a score and a review of the questions that were wrong.

Stack: **Node.js (Express)** server + **React (Vite)** front end. All JavaScript.

## Run it

Needs Node.js 18 or newer.

```bash
npm install
npm run build     # builds the React app into client/dist (once, and after UI changes)
npm start         # http://localhost:3000
```

Use another port with `PORT=4000 npm start`. Each exam has a **60-minute** limit; change it with
`EXAM_MINUTES=90 npm start`.

To keep it running 24/7 on a Mac mini at home (starts at boot, optional public HTTPS address), follow [DEPLOY-MAC.md](DEPLOY-MAC.md).

To run it on Google Cloud Run instead, follow [DEPLOY-CLOUDRUN.md](DEPLOY-CLOUDRUN.md) (uses the `Dockerfile`).

## Develop

```bash
npm run dev       # server on :3000 (auto-restart) + Vite on http://localhost:5173 (hot reload)
npm test          # server tests: bank sanity, random pick, grading rules, a full 50-question session
```

## Update the question bank

The bank comes from `Questions_stocks.csv` (the "Questions" tab of the Google Sheet, downloaded as CSV).
After replacing the CSV:

```bash
npm run convert   # rewrites data/questions.json, and stops with a message if a row cannot be understood
npm start
```

## How it works

- `POST /api/sessions` picks 50 distinct random questions and keeps the session **in server memory**
  (a session is dropped after 3 hours; restarting the server ends all sessions).
- The browser never receives the correct answer before it answers: grading happens on the server.
  Refreshing the page in the middle of an exam resumes the same session.
- Each question appears once and cannot be answered twice.
- **Countdown:** every exam (a new one from the start screen, from **Làm đề mới**, or from **Đề mới**) has 60 minutes for its 50 questions.
  The clock is kept by the server (the session stores its deadline; every response says how much time is left), so refreshing the page does
  not restart it and the browser's own clock cannot cheat. The timer in the top bar turns amber at 10 minutes and red at 1 minute.
  At zero the exam ends and the result screen shows what was done (unanswered questions count as not correct). An answer that arrives
  up to 3 seconds after the deadline (network delay) still counts; later ones are refused. Change the limit with `EXAM_MINUTES`.
- **Đề mới** (top of the question screen) asks for confirmation, then ends the current session on the server
  (`POST /api/sessions/:id/reset`) and starts a new one with 50 new random questions and a fresh 60-minute clock. "Next" is only allowed after answering.

### Question types (detected by `scripts/convert-csv.js`)

| Type | Count | How it is answered |
|---|---|---|
| single | 772 | tap one coloured tile; the answer is final, like Kahoot |
| multi | 35 | statement lists (I, II, III…) whose answer is a combination; tick the right ones, press **Kiểm tra**. "Tất cả đều sai" means tick nothing |
| order | 3 | answer is a sequence (#656, #663, #703); tap the options in order, press **Kiểm tra** |

Options are shown in the original order (not shuffled) because some options refer to each other
(e.g. "Cả a, b, c đều sai").

## Layout

```
server/          Express API, session logic, tests
client/src/      React screens (Start, Question, Result, Countdown), theme.js (tile colours), strings.js (all UI text)
scripts/         convert-csv.js
data/            questions.json (generated from the CSV)
Questions_stocks.csv
```

All visible text is in `client/src/strings.js` — change wording or language there.
