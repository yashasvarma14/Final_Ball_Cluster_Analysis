# Final Ball

**Who creates for whom: a network analysis of every chance in the Premier League, 2025–26.**

### [View the live site →](https://yashasvarma14.github.io/Final_Ball_Cluster_Analysis/)

Every shot that someone set up becomes a link between a passer and a shooter. Each club's links form a
network, and network science turns those networks into a picture of how each team actually creates its
chances: who the creators are, who the finishers are, which players work as a unit, and which clubs build
their attacks the same way.

## What's on the site

- **The networks.** All 20 clubs as passing networks, each opening into a full interactive view of its
  players, their hub and authority scores, and every chance between any two of them.
- **Clustering.** Clubs grouped into four chance-creation styles with K-means, shown in principal-component
  space with a feature profile for each style.
- **The league.** Rankings for assist entropy, top creators and top finishers, plus the standout duos.
- **Method.** The full pipeline, the formulas behind each metric, and the caveats.

Three link types can be switched at any time: key passes, goal assists, and chance quality (xG created).

## Method

| Step               | What happens                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Collect**        | Every shot of the season from Understat: 380 matches, the shooter, the credited passer, xG and pitch location.                      |
| **Build networks** | One directed, weighted graph per club; an edge runs passer → shooter.                                                              |
| **Score players**  | Weighted HITS (hub and authority via SVD), Louvain communities on the undirected graph, normalised Shannon entropy of the edges. |
| **Cluster clubs**  | Five club-level features standardised and grouped with K-means (k = 4); PCA reduces them to two axes for the chart.               |

The five clustering features are assist entropy, top hub score, top authority score, top-duo share and
top-3 creator share.

## Tech

Python (pandas, NetworkX, scikit-learn, NumPy) for the analysis, and a static D3.js front end that reads one
JSON file. No build step; the site is published straight from `site/` by GitHub Actions.

## Repository layout

```
site/                  the website (published to GitHub Pages)
  index.html           page markup
  css/style.css        styles, in numbered sections that follow the page
  js/app.js            the D3 front end, in numbered sections
  data.json            everything the page renders, built by the pipeline
  logos/               club crests by club code (ARS.png … WOL.png)
pipeline/              the Python analysis
  build_site_data_understat.py   Understat data → site/data.json
  metrics.py                     networks, entropy, weighted HITS, Louvain, K-means
  viz.py, main.py                static PNG charts
  data/understat_2025_pack.json  the season's assisted shots
.github/workflows/     the Pages deployment
```

## Development

To work on the site locally, serve the `site/` folder (the page fetches `data.json`, so it needs a server
rather than opening the file directly):

```bash
cd site
python -m http.server 8000
```

To rebuild the data, install the pipeline's requirements and run the builder:

```bash
pip install -r pipeline/requirements.txt
python pipeline/build_site_data_understat.py
```

Site files are formatted with Prettier (`.prettierrc`) and Python with Ruff (`pyproject.toml`).

## Caveats

- Understat credits one passer per shot, so second assists and earlier passes are not captured.
- Shots with no credited pass (dribbles, rebounds, direct set pieces) are left out of the networks.
- Assist networks are small samples; a handful of goals can move a club a long way.

## Acknowledgements

The website's design and the clustering visualisation were created with the help of Claude (Anthropic).

Data from Understat. Club crests belong to their clubs and are used for identification only.
