# Deploy to Google Cloud Run

Cloud Run runs the `Dockerfile` in this project as a managed HTTPS service. You get a public
`https://….run.app` address and pay only for the time it handles requests.

## Read this first: sessions live in memory

The quiz keeps each learner's session in the server's memory. Cloud Run may run several copies of a service,
stop idle ones, and replace them. That has two consequences, and the deploy command below handles the first:

1. **Run exactly one copy** (`--max-instances 1`). With two copies, a learner's next request can land on a copy
   that has never seen the session, and the app shows "Session not found".
2. **Idle shutdown ends sessions.** With `--min-instances 0` (cheapest) Cloud Run stops the copy after a period
   with no requests, and quizzes in progress are lost. The learner just starts a new one. With
   `--min-instances 1` one copy stays warm, which costs money all month (see "Cost" below). Even then, Google
   can restart the copy for maintenance, so a session can occasionally be lost.

If you ever need sessions that survive restarts or more than one copy, the sessions must move out of memory
(for example into Firestore or Redis). Ask for that change if you need it.

## 1. One-time setup

1. Have a Google account and a Google Cloud **project with billing enabled**
   (<https://console.cloud.google.com/billing>; new accounts get a free trial credit).
2. Install the Google Cloud CLI on the Mac: <https://cloud.google.com/sdk/docs/install>
   (or skip the install and use **Cloud Shell**, the terminal icon at the top right of the Cloud Console).
3. Log in and choose the project (replace `YOUR_PROJECT_ID`):

   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```

   To make a new project: `gcloud projects create YOUR_NEW_ID` (the ID must be unique worldwide), then link a
   billing account to it in the Console.
4. Turn on the services used for building and running:

   ```bash
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
   ```

## 2. Deploy

From the project folder on your Mac:

```bash
cd /Users/vohung/Work/kahoot_ckhoan
gcloud run deploy kahoot-ckhoan \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --max-instances 1 \
  --min-instances 0
```

- `--source .` uploads this folder (without `node_modules`, see `.gcloudignore`), builds it with the
  `Dockerfile` in Google's cloud (nothing to install locally) and deploys it.
- `asia-southeast1` is Singapore, the closest region to Vietnam. `asia-east1` (Taiwan) is a bit further but
  billed at the lower "tier 1" rates.
- `--allow-unauthenticated` makes the quiz public. Without it nobody can open it.
- If it asks to create an Artifact Registry repository or enable an API, answer `y`.
- The first build takes a few minutes. At the end it prints **Service URL: https://….run.app**.

Check it:

```bash
curl https://YOUR-SERVICE-URL/api/info        # should print {"bankSize":810,"perSession":50}
```

Then open the URL in a browser and play a few questions.

## 3. Everyday commands

| Task | Command |
|---|---|
| Release a new version | `gcloud run deploy kahoot-ckhoan --source . --region asia-southeast1` (settings from the first deploy are kept) |
| Keep one copy always warm | `gcloud run services update kahoot-ckhoan --region asia-southeast1 --min-instances 1` |
| Back to scale-to-zero | `gcloud run services update kahoot-ckhoan --region asia-southeast1 --min-instances 0` |
| See logs | `gcloud run services logs read kahoot-ckhoan --region asia-southeast1 --limit 50` |
| Show URL and settings | `gcloud run services describe kahoot-ckhoan --region asia-southeast1` |
| Delete everything | `gcloud run services delete kahoot-ckhoan --region asia-southeast1` |

If you change `Questions_stocks.csv`, run `npm run convert` first so `data/questions.json` is updated, then deploy.

The exam time limit is 60 minutes. To change it without touching the code:
`gcloud run services update kahoot-ckhoan --region asia-southeast1 --set-env-vars EXAM_MINUTES=90`.

## Cost

- Cloud Run has a monthly free allowance of requests, CPU time and memory time. A one-learner quiz with
  `--min-instances 0` normally stays inside it, so it should cost close to nothing.
- `--min-instances 1` bills the idle warm copy all month, at a reduced idle rate. For the default 1 vCPU and
  512 MiB this works out to roughly 10 USD a month before the free allowance, about the same as a small VPS.
- Set a budget alert (Console → Billing → Budgets & alerts) so a surprise shows up early.
- Check current numbers on <https://cloud.google.com/run/pricing> and the pricing calculator.

## Safety

- The app has no login: anyone with the URL can use it. For a private test, deploy without
  `--allow-unauthenticated` and use `gcloud run services proxy kahoot-ckhoan --region asia-southeast1`, which
  gives you `http://localhost:8080` on your Mac.
- If your Google Workspace/organization blocks public services ("domain restricted sharing"),
  `--allow-unauthenticated` is refused. Ask your admin or use a personal Google account.
- A custom domain (like `quiz.yourdomain.com`) is possible; see Google's "Mapping custom domains" page and check
  that your region supports it. The default `.run.app` address already has HTTPS.

## Troubleshooting

| Problem | What to do |
|---|---|
| `PERMISSION_DENIED: Build failed because the default service account is missing required IAM permissions` | The account that runs the build has no permissions yet. Follow "Fix: build permission error" below, wait 2-3 minutes, deploy again. |
| `Billing account … not found` / `API not enabled` | Link billing to the project, then re-run the `gcloud services enable …` command. |
| Page loads but shows "Session not found" | A new copy started (idle shutdown or restart). Start a new quiz. Check that `--max-instances 1` is set: `gcloud run services describe …`. |
| "Revision failed to start" | Read the log (`gcloud run services logs read …`). The server must listen on the `PORT` Cloud Run provides; this project already does. |
| Want to test the image on your own computer | `docker build -t quiz .` then `docker run -p 8080:8080 quiz`, and open `http://localhost:8080` (needs Docker Desktop). |

## Fix: build permission error

Cause: Cloud Build now runs builds as the project's **Compute Engine default service account**
(`PROJECT_NUMBER-compute@developer.gserviceaccount.com`), and that account starts with almost no permissions.
Give it the roles it needs (replace `YOUR_PROJECT_ID`):

```bash
PROJECT_ID=YOUR_PROJECT_ID

# 1. Which account runs the build? Copy the e-mail it prints.
gcloud builds get-default-service-account --project "$PROJECT_ID"

# 2. Put that e-mail here (usually the -compute@developer one):
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# 3. Grant the roles, then wait 2-3 minutes.
for ROLE in roles/run.builder roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$ROLE"
done
```

Same thing without the terminal: Console -> IAM & Admin -> IAM -> find the Compute Engine default service account ->
pencil icon -> Add another role -> **Cloud Run Builder** and **Service Usage Consumer** -> Save.

If it still fails, check your own account. The person who runs `gcloud run deploy` needs `roles/owner`, or at least
Cloud Run Source Developer, Service Usage Consumer and Service Account User:

```bash
gcloud projects get-iam-policy "$PROJECT_ID" --flatten="bindings[].members" \
  --filter="bindings.members:user:YOUR_EMAIL" --format="value(bindings.role)"
```

If that does not list `roles/owner`, ask the project owner to grant you those roles in the Console (IAM page).
