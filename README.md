# Final Ball

Premier League 2025-26 chance networks: who sets up whom at every club.

A network analysis of chance creation: every passer → shooter link becomes an edge in a per-club graph,
players are scored with weighted HITS (hub / authority), squads split into Louvain communities, and
clubs clustered into chance-creation styles with K-means on five club-level features.

## site/
The interactive website (static, no build step).
- `index.html`: page markup
- `css/style.css`: styles, in numbered sections that follow the page; the editorial layer at the end overrides earlier rules
- `js/app.js`: the D3 front end, in numbered sections (config, helpers, crests, network renderer, hero, club grid, clustering, league panels, boot)
- `data.json`: everything the page renders, built by the pipeline
- `logos/`: club crests named by club code (ARS.png ... WOL.png) and PL.png for the opening screen

Run it locally (it needs a local server because the page loads data.json):

    cd site
    python -m http.server 8000

then open http://localhost:8000

## pipeline/
The Python behind the data and the static charts.
- `build_site_data_understat.py`: turns `data/understat_2025_pack.json` (all 380 matches, every assisted shot, pulled from Understat) into `site/data.json`. Output path is `site/data.json` relative to the script, so point `OUT` at `../site/data.json` or copy the file over.
- `metrics.py`: network building, assist entropy, weighted HITS (hub/authority), Louvain clusters, k-means style clusters
- `viz.py` + `main.py`: static PNG charts (grid of all teams, rankings, top-hub star charts). `python main.py --source understat --season 2025` pulls Understat directly through the soccerdata package.
- `build_site_data.py` + `data_sources.py`: the original StatsBomb 2015-16 version

Install: `pip install -r pipeline/requirements.txt`

## Formatting
Site files are formatted with Prettier (`.prettierrc`), Python with Ruff (`pyproject.toml`), both at 110 columns.

## Club codes
ARS AVL BOU BRE BHA BUR CHE CRY EVE FUL LEE LIV MCI MUN NEW NFO SUN TOT WHU WOL
