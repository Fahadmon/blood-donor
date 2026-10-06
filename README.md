# Blood Donor Registry

Stores: name, age, mobile, email, blood group, last donated date.
Filter by blood group, last-donated date range, availability (90-day gap), or search text.

## Run locally
    APP_PASSWORD=choose-a-password node server.js
    # open http://localhost:3000

No `npm install` needed (no dependencies, Node 18+).

## Host it (Render, easiest)
1. Push this folder to a GitHub repo.
2. On render.com: New > Blueprint > pick the repo (it reads render.yaml).
3. Enter APP_PASSWORD when asked. Deploy. You get a public https:// link.
   The 1 GB disk keeps your data between restarts.

## Other hosts
Works on Railway, Fly.io, any VPS, or with the included Dockerfile.
Whatever host you use, mount a persistent volume and point DATA_DIR at it,
otherwise data is wiped on each redeploy. Always set APP_PASSWORD
(this app holds phone numbers and emails).

## Settings
- WAIT_DAYS in public/index.html (default 90) = days between donations.
- Data lives in DATA_DIR/donors.json - back it up by copying that file.
