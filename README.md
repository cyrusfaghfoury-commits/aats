# Alone Among the Stars

A retro-terminal arcade dodger/shooter, built as a single React component.

## Run it locally

```
npm install
npm run dev
```

Then open the local address it prints (usually http://localhost:5173).

## Build for production

```
npm run build
```

This produces a `dist/` folder containing a fully static site (HTML, JS, CSS)
— no server-side code, no backend. Any static host works.

## Deploying

Pick whichever is easiest for you:

### Vercel (easiest)
1. Push this folder to a GitHub repo.
2. Go to vercel.com → "Add New Project" → import the repo.
3. Leave the defaults (it auto-detects Vite). Click Deploy.

### Netlify
1. Push this folder to a GitHub repo.
2. Go to netlify.com → "Add new site" → "Import an existing project".
3. Build command: `npm run build`  /  Publish directory: `dist`

### GitHub Pages
1. `npm run build`
2. Push the contents of `dist/` to a `gh-pages` branch (or use the
   `gh-pages` npm package to automate this).
3. Enable Pages in the repo settings, pointing at that branch.

### Any other static host (Cloudflare Pages, Render, Firebase Hosting, S3, etc.)
Just run `npm run build` and upload the `dist/` folder — it's plain static
files.

## Notes

- Saves (trophies, ship loadout, achievements, etc.) are stored in the
  browser's localStorage, scoped to whatever domain you deploy to. Clearing
  browser data / a different domain / private browsing will reset progress.
- No backend, database, or environment variables are required.
