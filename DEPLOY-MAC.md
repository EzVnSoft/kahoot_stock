# Host the quiz on a Mac mini at home

Result: the quiz runs 24/7 on your Mac mini, starts by itself after a reboot or power cut, restarts if it
crashes, and (optionally) is reachable from anywhere over HTTPS **without opening any port on your router**.

You need: the Mac mini always on and connected to your router (Ethernet is better than Wi-Fi), and Node.js 18+
(you already run `npm start` on it).

All commands are run in **Terminal on the Mac mini**, from the project folder:

```bash
cd /Users/vohung/Work/kahoot_ckhoan
```

---

## 1. Make the Mac mini behave like a server

```bash
sudo pmset -a sleep 0 autorestart 1 womp 1
pmset -g | grep -E 'sleep|autorestart|womp'
```

- `sleep 0`: the Mac never goes to sleep (the screen may still turn off). A sleeping Mac drops every visitor.
- `autorestart 1`: the Mac switches itself back on after a power cut.
- `womp 1`: the Mac can wake for network access.

Then check disk encryption:

```bash
fdesetup status
```

If it says **FileVault is On**, after a power cut or restart the Mac stops at the unlock screen and nothing
(including this service) starts until someone types the password. For a home server either accept that,
or turn FileVault off in System Settings → Privacy & Security (the disk is then not encrypted).

## 2. Run the server as a background service

```bash
bash deploy/mac/install-service.sh
```

It installs the packages, builds the web app, registers a launchd service (`com.kahoot.ckhoan`) that starts
at boot even when nobody is logged in, and tests that the server answers. It asks for your Mac password once
(for `sudo`). At the end it prints the addresses to open.

Test it:

1. On the Mac: open `http://localhost:3000`.
2. On a phone connected to the same Wi-Fi: open the `http://<mac-name>.local:3000` address the script printed
   (or the `http://192.168.x.x:3000` one if `.local` does not work on that phone).

If the phone cannot connect and the macOS firewall is on (System Settings → Network → Firewall), click
Options and allow incoming connections for `node`.

Handy commands:

```bash
tail -f logs/server.log                              # live log (Ctrl+C to leave)
sudo launchctl kickstart -k system/com.kahoot.ckhoan # restart the server
sudo launchctl print system/com.kahoot.ckhoan | head -30   # service status
```

Options for the script: `PORT=4000 bash deploy/mac/install-service.sh` uses another port;
`HOST=127.0.0.1 bash deploy/mac/install-service.sh` makes the server reachable from this Mac only (use it
once a tunnel from step 3 works, so the home network cannot reach it directly).

## 3. Let people outside your home use it (pick one)

Many home connections in Vietnam have a changing IP, no public IP at all, or blocked ports 80/443, so
port forwarding on the router often does not work. A **tunnel** avoids that: the Mac connects out to the
tunnel provider, and visitors reach the quiz through the provider's HTTPS address.

### Option A: Tailscale Funnel (free, no domain needed)

1. Download Tailscale for Mac from <https://tailscale.com/download/mac>, install it, and sign in
   (a free account is enough).
2. In Terminal:

   ```bash
   /Applications/Tailscale.app/Contents/MacOS/Tailscale funnel --bg 3000
   ```

3. The first time, it opens a web page asking you to enable HTTPS certificates and Funnel for your account.
   Approve it, then run the command again if it asked you to.
4. It prints your public address, like `https://mac-mini.something.ts.net`. Open it from your phone with
   Wi-Fi turned off to prove it works from outside.

Check or stop it:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel status
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel reset     # stop sharing
```

`--bg` keeps the setting across restarts, but Tailscale itself must be running after a reboot: test this in
step 5. Funnel's allowed public ports are 443, 8443 and 10000 (the default, 443, is what you want).

### Option B: Cloudflare Tunnel (your own domain, nicer address)

You need a domain name whose DNS is managed by Cloudflare (add the domain in your Cloudflare account and
change its nameservers at the registrar).

1. Install the connector: `brew install cloudflared` (needs Homebrew).
2. In the Cloudflare dashboard go to **Networking → Tunnels → Create Tunnel**, give it a name, and choose
   macOS. Cloudflare shows an install command that contains your tunnel token. Copy it and run it in Terminal
   (it looks like `sudo cloudflared service install <long token>`). This installs a service that starts at boot.
3. In the tunnel, open **Routes → Add route → Published application** and fill in:
   hostname `quiz.yourdomain.com`, service type `HTTP`, URL `localhost:3000`. Save.
4. Open `https://quiz.yourdomain.com` from a phone on mobile data.

Cloudflare may ask for a payment method when you create the account or the tunnel, even on the free plan.

## 4. Safety notes

- The quiz has **no login**: anyone who has the address can use it. Do not post it publicly unless that is
  what you want. With Cloudflare you can put **Cloudflare Access** (email one-time code) in front of it.
- Do **not** forward router ports to the Mac; the tunnels above do not need it.
- Sessions live in memory: restarting the server or the Mac ends all running quizzes.
- Keep macOS updated. The service comes back by itself after the update restart.

## 5. Test that it survives a restart

1. Apple menu → Restart.
2. Wait about 2 minutes **without logging in** (this tests the power-cut case).
3. Open your public address from a phone on mobile data.

If the site is back, you are done. If it is not back until you log in, check FileVault (step 1); with
Tailscale you may also need the Mac to log in automatically (System Settings → Users & Groups; not possible
while FileVault is on).

## Updating the quiz later

```bash
git pull                              # or copy in the changed files
npm run convert                       # only if Questions_stocks.csv changed
bash deploy/mac/install-service.sh    # rebuilds the web app and restarts the service
```

Run the same script again if you upgrade or switch Node.js (the service remembers the Node path).
To remove the service: `bash deploy/mac/uninstall-service.sh`.

## Troubleshooting

| Problem | What to do |
|---|---|
| Script stops at "Node.js was not found" | Install Node.js 18+ (<https://nodejs.org> or `brew install node`) and open a new Terminal window. |
| "did not answer on port 3000" | Run `tail -n 50 logs/server.log`. If it says the port is in use: `lsof -nP -iTCP:3000 -sTCP:LISTEN`, then stop that program or use `PORT=4000`. |
| Service starts but the log says permission denied | Keep the project outside Documents, Desktop and Downloads (macOS blocks background services there). |
| Works on the Mac but not from a phone | Same Wi-Fi? Firewall allows `node`? Try the IP address instead of `.local`. |
| Public address does not load | Run the tunnel's status command; check the Mac has internet; check `curl http://localhost:3000/api/info` works on the Mac. |
