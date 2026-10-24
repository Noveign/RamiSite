# RamiMode Hub · GitHub Pages edition

**The same spoiler-free, dark-themed multiplayer Roblox horror catalog**, now fully static and deployable with **GitHub Pages**. Search, filters, game artwork, original four-sentence summaries, official Roblox descriptions, and game statistics retain the same UI.

## Deploy (first time)

1. Extract this ZIP. Create a **public GitHub repository** (e.g. `ramimode-hub`).
2. Upload **the contents** of this folder to the **root** of the repository. Include the hidden `.github/workflows/pages.yml` file. The default branch must be named **`main`**.
3. In the repository, open **Settings → Pages → Build and deployment → Source → GitHub Actions**. Save.
4. Open the **Actions** tab and run **RamiMode Hub · Publish and refresh → Run workflow** (or allow the workflow triggered by your push to finish).
5. Open the URL shown under **Settings → Pages**: normally `https://YOUR_USERNAME.github.io/ramimode-hub/`. This works with any repository name because asset/data paths are relative.

### How Roblox data updates without a server

- Every 15 minutes (at minutes 07, 22, 37, 52 **UTC**), GitHub Actions runs `scripts/update-games.mjs` on a GitHub-hosted Node.js runner.
- The script requests public Roblox universe metadata (including the creator's **real** description), thumbnails, and ratings, merges it with the previous snapshot if Roblox is partly unavailable, then generates a **static `data/games.json` file**.
- The Actions workflow bundles the exact same site with this JSON snapshot and deploys it using GitHub's official Pages publishing actions.
- Visitors read only **static files**; there are no cross-origin Roblox browser requests, Vercel functions, external backends, authentication credentials, or paid services required.
- The page checks for new **published** data every **2 minutes** while visible. The underlying Roblox numbers are typically up to ~15 minutes old, **not real-time**. GitHub scheduling or Roblox outages can delay updates further; the UI gives the last successful sync time.
- Successful values are reused when Roblox APIs are unreachable, using GitHub Actions' cached previous snapshot. Missing stats show `—`; no descriptions or numbers are invented. On the **very first deployment**, if Roblox cannot be reached, the cards still work but official descriptions and metrics wait for the first successful job.

> **Note:** GitHub warns that scheduled workflows may be delayed or occasionally skipped. On public repositories, schedules are automatically disabled after **60 days without repository activity**. Manually run the workflow in Actions to refresh on demand, and re-enable it if disabled.

## Test and edit

- For a local preview, run `python -m http.server 8080`, then open `http://localhost:8080/`. Static data will appear after the snapshot generator has been run successfully at least once.
- With Node 22+, run `node scripts/update-games.mjs` to fetch and build a new `data/games.json` locally (requires internet access). Run `node --test` for offline generator tests.
- Game titles, links, categories, and original **spoiler-free summaries** live in `catalog.json`. Images bundled in `/assets` are fallbacks created from the screenshots supplied for this project. Current Roblox promotional thumbnails are selected whenever Roblox supplies them.
- Edit the **cron** in `.github/workflows/pages.yml` to change the update frequency. Note that GitHub Actions has a five-minute minimum schedule interval, and GitHub Pages deployment frequency is not a hard guarantee.

## Why this edition differs from Vercel

Vercel ran a request-time API at `/api/games`. **GitHub Pages cannot run that server function**. This edition instead loads a static `./data/games.json` periodically regenerated and deployed by GitHub Actions. The visual design and user-facing functions remain the same; **stats are periodic snapshots rather than per-minute live requests**.

This fan-made directory is not affiliated with Roblox or the game creators. Roblox titles, artwork, and official descriptions belong to their respective owners.

Documentation: [GitHub Pages publishing with Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site), [Scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [Roblox public game endpoints](https://create.roblox.com/docs/cloud/reference/domains/games).
