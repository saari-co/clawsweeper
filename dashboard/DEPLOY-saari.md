# Deploy the saari-co ClawSweeper dashboard → `clawsweeper.ztoned.com`

The dashboard is a Cloudflare **Worker** (not Pages): `dashboard/worker.ts`,
deployed with `wrangler` to **your** Cloudflare account. It reads GitHub live
(labels + Actions runs) and renders the same triage/pipeline views upstream runs
at `clawsweeper.openclaw.ai`. Config: **`dashboard/wrangler.saari.toml`**.

Run everything from the clawsweeper fork root: `cd ~/Developer/clawsweeper`.

---

## 0. Prereqs
- A Cloudflare account with **`ztoned.com` as a zone on it** — custom-domain
  routes require the zone to live in the same account.
- A fine-grained, **read-only** GitHub PAT scoped to the 5 saari-co repos
  (`spark-dgx, x-api, pixel-fold, StellarAI, aicommerce`), permissions:
  **Contents: Read, Issues: Read, Pull requests: Read, Metadata: Read**.
  ⚠️ Do **not** use the ClawSweeper App private key here — it stays on spark-2.

## 1. Set your Cloudflare account id
Edit `dashboard/wrangler.saari.toml` → replace
`account_id = "REPLACE_WITH_YOUR_CLOUDFLARE_ACCOUNT_ID"` with your account id
(Cloudflare dashboard → right sidebar, or `npx wrangler whoami` after login).

## 2. Auth → secret → deploy
```bash
npx wrangler@4 login
npx wrangler@4 secret put GITHUB_TOKEN --config dashboard/wrangler.saari.toml   # paste the read-only PAT
npx wrangler@4 deploy            --config dashboard/wrangler.saari.toml
```
- First deploy provisions the SQLite Durable Object (`StatusStore`) — **free Workers plan**, no paid tier needed.
- The `custom_domain` route `clawsweeper.ztoned.com` is created on deploy; Cloudflare adds the DNS record + cert automatically because the zone is yours.
- Smoke locally first if you want: `npx wrangler@4 dev --config dashboard/wrangler.saari.toml` → http://127.0.0.1:8787/triage

## 3. Lock it down (private repos — don't leave it public)
Cloudflare → **Zero Trust → Access → Applications → Add** a self-hosted app for
`clawsweeper.ztoned.com`, policy = allow your identity only. (Warp is already on
your cockpit, so this is a couple of clicks.) The dashboard only renders
labels/metadata, but it's over private repos — gate it.

## 4. Populate the triage views — the **advisory** flip (your call)
`/triage` and `/pr-proof-triage` render `clawsweeper:*` / `impact:*` / `triage:` /
`proof:` labels, which only exist once the bot **applies** them. That happens in
`--advisory` mode (posts one review comment + labels per item; **never closes or
merges**). On spark-2:

- **One-off / manual:**
  `lanes/clawsweeper-review/publish-state.sh --advisory`
  (or scope it: `CLAWSWEEPER_SWEEP_REPOS="spark-dgx" … --advisory`)
- **Scheduled:** add `--advisory` to the `ExecStart` in
  `~/.config/systemd/user/clawsweeper-sweep.service`, then
  `systemctl --user daemon-reload`. The 6h sweep then labels on cadence.

Until you flip advisory, the triage tabs are empty and only `/` (the pipeline
view of Actions runs) shows data. Advisory is reversible (drop the flag).

## 5. Verify
Open `https://clawsweeper.ztoned.com/` (pipeline), `/triage`, `/pr-proof-triage`.
Tab counts fill in as advisory labels land across the 5 repos.

---

### What this dashboard does / doesn't read
- **Reads live from GitHub:** `clawsweeper:*` labels (triage), Actions runs (pipeline). Auth = the `GITHUB_TOKEN` secret.
- **Does NOT read `clawsweeper-state`** (the ledger) beyond one optional marker file — the ledger and the dashboard are independent. The ledger lives in `saari-co/clawsweeper-state`; this Worker renders labels.
- **No metered spend:** the Worker is free-tier; the review brain is the subscription. The only GitHub writes come from the `--advisory` flip, on your repos, never closing/merging.
