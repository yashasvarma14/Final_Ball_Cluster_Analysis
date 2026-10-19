"""
Builds site/data.json from the Understat 2025/26 package (data/understat_2025_pack.json).

The pack was pulled from Understat's match feed: every shot with the player who set it up,
plus match rosters (for positions and minutes).

Modes
  kp : key passes (any shot someone set up), weight = count
  ga : goal assists, weight = count
  xg : chance quality, weight = total xG of the chances one player created for another
"""

import html
import json
import os
from collections import defaultdict

import networkx as nx
import numpy as np
import pandas as pd

import metrics as M
import viz

HERE = os.path.dirname(__file__)
PACK = os.path.join(HERE, "data", "understat_2025_pack.json")
OUT = os.path.join(HERE, "..", "site", "data.json")
TOP_N = {"kp": 14, "ga": 12, "xg": 14}

# display name, code, primary, secondary
CLUBS = {
    "Arsenal": ("Arsenal", "ARS", "#EF0107", "#9C824A"),
    "Aston Villa": ("Aston Villa", "AVL", "#7A003C", "#95BFE5"),
    "Bournemouth": ("Bournemouth", "BOU", "#DA291C", "#111111"),
    "Brentford": ("Brentford", "BRE", "#E30613", "#FBB800"),
    "Brighton": ("Brighton & Hove Albion", "BHA", "#0057B8", "#FFCD00"),
    "Burnley": ("Burnley", "BUR", "#6C1D45", "#99D6EA"),
    "Chelsea": ("Chelsea", "CHE", "#034694", "#DBA111"),
    "Crystal Palace": ("Crystal Palace", "CRY", "#1B458F", "#C4122E"),
    "Everton": ("Everton", "EVE", "#003399", "#0B1D5C"),
    "Fulham": ("Fulham", "FUL", "#1A1A1A", "#CC0000"),
    "Leeds": ("Leeds United", "LEE", "#1D428A", "#FFCD00"),
    "Liverpool": ("Liverpool", "LIV", "#C8102E", "#00B2A9"),
    "Manchester City": ("Manchester City", "MCI", "#6CABDD", "#1C2C5B"),
    "Manchester United": ("Manchester United", "MUN", "#DA291C", "#FBE122"),
    "Newcastle United": ("Newcastle United", "NEW", "#241F20", "#41B6E6"),
    "Nottingham Forest": ("Nottingham Forest", "NFO", "#DD0000", "#8B0000"),
    "Sunderland": ("Sunderland", "SUN", "#EB172B", "#211E1E"),
    "Tottenham": ("Tottenham Hotspur", "TOT", "#132257", "#4B5D9C"),
    "West Ham": ("West Ham United", "WHU", "#7A263A", "#1BB1E7"),
    "Wolverhampton Wanderers": ("Wolverhampton Wanderers", "WOL", "#FDB913", "#231F20"),
}
RES = ["Goal", "Saved", "Missed", "Blocked", "Hit the post"]
SIT = ["Open play", "Corner", "Set piece", "Free kick", "Penalty"]
ACT = {
    "Pass": "Pass",
    "Cross": "Cross",
    "Throughball": "Through ball",
    "Chipped": "Chipped ball",
    "HeadPass": "Headed pass",
    "LayOff": "Lay-off",
    "Aerial": "Header",
    "TakeOn": "Dribble",
    "Cornerkick": "Corner",
    "Freekick": "Free kick",
    "Standard": "Set piece",
    "Rebound": "Rebound",
}


def pos_group(p):
    if not p or p == "Sub":
        return ""
    if p == "GK":
        return "GK"
    if p.startswith("DM") or p in ("MC", "ML", "MR"):
        return "MF"
    if p.startswith("D"):
        return "DF"
    if p in ("AML", "AMR"):
        return "W"
    if p.startswith("AM"):
        return "MF"
    return "FW"


def main():
    P = json.load(open(PACK))
    # Understat sends names HTML-escaped (O&#039;Reilly)
    names, acts = [html.unescape(n) for n in P["names"]], P["acts"]
    tname = [t[0] for t in P["teams"]]
    matches = P["matches"]  # [date, h, a, hg, ag, week]
    pos = {}
    for k, p, mins in P["pos"]:
        ti, ni = map(int, k.split("|"))
        pos[(tname[ti], names[ni])] = (pos_group(p), mins)

    rows = []
    for mi, side, a, b, minute, res, xg, X, Y, sit, stype, act in P["plays"]:
        m = matches[mi]
        team = tname[m[1] if side == 0 else m[2]]
        rows.append(
            {
                "team": team,
                "passer": names[a],
                "receiver": names[b],
                "match": mi,
                "min": minute,
                "res": res,
                "xg": xg / 1000,
                "X": X,
                "Y": Y,
                "sit": sit,
                "st": stype,
                "act": acts[act],
            }
        )
    df = pd.DataFrame(rows)

    teams_out, summaries = {}, {k: [] for k in TOP_N}
    for team in sorted(df.team.unique(), key=lambda t: CLUBS[t][0]):
        disp, code, c1, c2 = CLUBS[team]
        tp = df[df.team == team]
        modes = {}
        for mode in TOP_N:
            sub = tp if mode != "ga" else tp[tp.res == 0]
            G = nx.DiGraph()
            agg = sub.groupby(["passer", "receiver"]).agg(n=("xg", "size"), xg=("xg", "sum")).reset_index()
            for r in agg.itertuples():
                if r.passer != r.receiver:
                    G.add_edge(r.passer, r.receiver, weight=float(r.xg) if mode == "xg" else int(r.n))
            h = M.hits_scores(G).set_index("player")
            out_w = dict(G.out_degree(weight="weight"))
            in_w = dict(G.in_degree(weight="weight"))
            total = sum(out_w.values())
            top = M.top_players(G, TOP_N[mode])
            comm = M.communities(G.subgraph(top).copy())
            ent = M.assist_entropy(G)
            rnd = (lambda v: round(v, 2)) if mode == "xg" else int
            hub_top = h.sort_values("hub", ascending=False).head(5)
            auth_top = h.sort_values("authority", ascending=False).head(5)
            w_all = np.array([d["weight"] for *_, d in G.edges(data=True)])
            tp_edge = max(G.edges(data=True), key=lambda e: e[2]["weight"])
            made_sorted = np.sort(np.array(list(out_w.values())))[::-1]
            summaries[mode].append(
                {
                    "team": team,
                    "entropy": ent,
                    "top_hub_score": h.hub.max(),
                    "top_authority_score": h.authority.max(),
                    "top_pair_share": tp_edge[2]["weight"] / w_all.sum(),
                    "top3_creator_share": made_sorted[:3].sum() / w_all.sum(),
                }
            )
            modes[mode] = {
                "entropy": round(ent, 4),
                "total": rnd(total),
                "nodes": [
                    {
                        "id": p,
                        "pos": pos.get((team, p), ("", 0))[0],
                        "hub": round(float(h.loc[p, "hub"]), 4),
                        "auth": round(float(h.loc[p, "authority"]), 4),
                        "made": rnd(out_w.get(p, 0)),
                        "recv": rnd(in_w.get(p, 0)),
                        "share": round(out_w.get(p, 0) / total, 4) if total else 0,
                        "c": comm.get(p, 0),
                    }
                    for p in top
                ],
                "edges": [[a, b, rnd(d["weight"])] for a, b, d in G.subgraph(top).edges(data=True)],
                "hubs": [
                    [p, round(float(r.hub), 4), round(out_w.get(p, 0) / total, 4)]
                    for p, r in hub_top.iterrows()
                ],
                "auths": [
                    [p, round(float(r.authority), 4), rnd(in_w.get(p, 0))] for p, r in auth_top.iterrows()
                ],
            }
        teams_out[team] = {
            "name": disp,
            "code": code,
            "color": c1,
            "color2": c2,
            "modes": modes,
            "plays": [
                [
                    r.passer,
                    r.receiver,
                    r.match,
                    r.min,
                    r.res,
                    round(r.xg, 3),
                    r.X,
                    r.Y,
                    r.sit,
                    r.st,
                    ACT.get(r.act, r.act),
                ]
                for r in tp.itertuples()
            ],
        }

    league = {}
    for mode, rows_ in summaries.items():
        sdf = pd.DataFrame(rows_)
        league[mode] = {
            "entropy": [
                [r.team, round(r.entropy, 4)]
                for r in sdf.sort_values("entropy", ascending=False).itertuples()
            ]
        }
        if mode == "kp":
            sdf = M.cluster_teams(sdf, k=4)
            names_ = viz.name_clusters(sdf)
            league[mode]["styles"] = [
                [r.team, names_[r.style_cluster], round(r.pc1, 3), round(r.pc2, 3)] for r in sdf.itertuples()
            ]
        prow, duos = [], []
        for team, t in teams_out.items():
            for n in t["modes"][mode]["nodes"]:
                prow.append({"team": team, **n})
            for a, b, w in t["modes"][mode]["edges"]:
                duos.append([team, a, b, w])
        pdf = pd.DataFrame(prow)
        min_vol = {"kp": 15, "ga": 4, "xg": 2}[mode]
        reg = pdf[(pdf.made >= min_vol) | (pdf.recv >= min_vol)]
        league[mode]["hub"] = [
            [r.team, r.id, r.hub] for r in reg.sort_values("hub", ascending=False).head(10).itertuples()
        ]
        league[mode]["auth"] = [
            [r.team, r.id, r.auth] for r in reg.sort_values("auth", ascending=False).head(10).itertuples()
        ]
        league[mode]["duos"] = sorted(duos, key=lambda d: -d[3])[:12]

    mlist = [{"d": m[0], "h": tname[m[1]], "a": tname[m[2]], "hs": m[3], "as": m[4]} for m in matches]
    out = {
        "season": "2025/26",
        "source": "Understat",
        "matches": mlist,
        "teams": teams_out,
        "league": league,
        "labels": {"res": RES, "sit": SIT},
    }
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")
    for mode in ("kp",):
        print(league[mode]["entropy"][:3], league[mode]["entropy"][-3:])
        print(league[mode]["hub"][:5])
        print(league[mode]["duos"][:5])
        print(league[mode]["styles"][:4])


if __name__ == "__main__":
    main()
