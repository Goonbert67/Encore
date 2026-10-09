# Encore

Personal Spotify stats + Claude-powered discovery. Static site for GitHub Pages: no server, no build step.

## Setup
1. Upload these files to the root of a public repo (e.g. `encore`), then Settings → Pages → Deploy from branch → `main` / `(root)`.
2. developer.spotify.com/dashboard → Create app → Redirect URI = your Pages URL exactly (e.g. `https://you.github.io/encore/`), tick Web API → copy the Client ID.
3. console.anthropic.com → add credit → create an API key.
4. Open Encore → Data & connections: paste the Client ID → Connect Spotify; paste the API key → Save key; drop in `my_spotify_data.zip`.

Everything (history, Spotify login, API key) is stored only in the browser you set it up in.

## Removing it
- Spotify app: developer dashboard → Encore → Settings → Delete. Also spotify.com/account/apps.
- API key: console.anthropic.com → API keys → delete.
- Data in a browser: Encore → Data & connections → Remove my data / Disconnect / Remove key.
