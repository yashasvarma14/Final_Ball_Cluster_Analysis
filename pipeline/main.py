"""
Premier League assist networks, the soccer version of graphsketball's NBA reel.

Examples
--------
    python main.py --source understat --season 2025          # 2025/26, key passes
    python main.py --source understat --season 2025 --kind goal_assist
    python main.py --source statsbomb                        # 2015/16, works offline after first pull
    python main.py --source statsbomb --kind pass            # full pass network instead
"""

import argparse
import os
import re

import pandas as pd

import data_sources
import metrics as M
import viz

KIND_LABEL = {"key_pass": "Key-pass network", "goal_assist": "Goal-assist network", "pass": "Pass network"}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["understat", "statsbomb"], default="understat")
    ap.add_argument("--season", type=int, default=2025, help="start year, 2025 = 2025/26 (understat only)")
    ap.add_argument("--kind", choices=["key_pass", "goal_assist", "pass"], default="key_pass")
    ap.add_argument("--clusters", type=int, default=4, help="number of team style clusters")
    ap.add_argument("--out", default="output")
    args = ap.parse_args()

    season_txt = "2015/16" if args.source == "statsbomb" else f"{args.season}/{str(args.season + 1)[-2:]}"
    label = f"Premier League {season_txt} · {KIND_LABEL[args.kind]}"
    out = os.path.join(args.out, f"{args.source}_{season_txt.replace('/', '-')}_{args.kind}")
    os.makedirs(os.path.join(out, "teams"), exist_ok=True)

    print("loading data...")
    df = data_sources.load(args.source, args.season)
    df = df[df.kind == args.kind]
    if df.empty:
        raise SystemExit(f"no rows for kind={args.kind} from {args.source}")

    # ---- build one graph per team + metrics
    graphs, rows, players, edges = {}, [], [], []
    for team, g in df.groupby("team"):
        G = M.build_team_graph(g)
        if G.number_of_edges() < 3:
            continue
        graphs[team] = G
        rows.append(M.team_summary(team, G))
        h = M.hits_scores(G)
        h["team"] = team
        players.append(h)
        for a, b, d in G.edges(data=True):
            edges.append({"team": team, "passer": a, "receiver": b, "weight": d["weight"]})

    summary = pd.DataFrame(rows)
    summary = M.cluster_teams(summary, k=args.clusters)
    names = viz.name_clusters(summary)
    summary["style_name"] = summary.style_cluster.map(names)
    summary["entropy_rank"] = summary.entropy.rank(ascending=False, method="min").astype(int)
    players = pd.concat(players, ignore_index=True)
    edges = pd.DataFrame(edges)

    summary.sort_values("entropy", ascending=False).to_csv(os.path.join(out, "team_summary.csv"), index=False)
    players.sort_values("hub", ascending=False).to_csv(os.path.join(out, "player_scores.csv"), index=False)
    edges.sort_values("weight", ascending=False).to_csv(os.path.join(out, "edges.csv"), index=False)

    # ---- league-wide charts
    print("drawing league charts...")
    viz.fig_grid(graphs, label, os.path.join(out, "01_all_teams_grid.png"))
    viz.fig_entropy(summary, label, os.path.join(out, "02_assist_entropy.png"))
    # min volume so a sub with 3 key passes to one guy doesn't top the list
    regulars = players[(players.made >= 15) | (players.received >= 15)]
    viz.fig_league_top(
        regulars,
        "hub",
        "Hub Score (Top 10)",
        "How much a player feeds his team's top chance-takers",
        label,
        os.path.join(out, "03_hub_top10.png"),
    )
    viz.fig_league_top(
        regulars,
        "authority",
        "Authority Score (Top 10)",
        "The opposite of Hub Score: who the best creators look for",
        label,
        os.path.join(out, "04_authority_top10.png"),
    )
    viz.fig_top_duos(edges, label, os.path.join(out, "05_top_duos.png"))
    viz.fig_style_clusters(summary, label, os.path.join(out, "06_style_clusters.png"))

    # ---- star chart for each team's top hub
    print("drawing team star charts...")
    for team, G in graphs.items():
        row = summary[summary.team == team].iloc[0]
        viz.fig_ego(team, G, row.top_hub, label, os.path.join(out, "teams", f"{slug(team)}_top_hub.png"))

    print(f"done -> {out}")
    print(
        summary[["team", "entropy", "top_hub", "top_authority", "style_name"]]
        .sort_values("entropy", ascending=False)
        .to_string(index=False)
    )


if __name__ == "__main__":
    main()
