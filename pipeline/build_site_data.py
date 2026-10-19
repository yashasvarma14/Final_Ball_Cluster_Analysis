"""
Builds site/data.json for the interactive site.

Pulls every 2015/16 PL match from StatsBomb open data and keeps:
  - each key pass with the details needed for the play list (minute, opponent,
    outcome, xG, pass type, pass + shot coordinates for the mini pitch)
  - completed-pass counts per pair (for the "All passes" mode)
Then runs the same metrics as main.py for each team and each mode.
"""

import json
import os
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

import networkx as nx
import pandas as pd
import requests

import metrics as M
import viz

BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"
OUT = os.path.join(os.path.dirname(__file__), "site", "data.json")
TOP_N = {"kp": 14, "ga": 12, "pass": 14}


def pull(mid):
    ev = requests.get(f"{BASE}/events/{mid}.json", timeout=60).json()
    lu = requests.get(f"{BASE}/lineups/{mid}.json", timeout=60).json()
    nick = {p["player_name"]: (p.get("player_nickname") or p["player_name"]) for t in lu for p in t["lineup"]}
    by_id = {e["id"]: e for e in ev}
    plays, passes, pos = [], Counter(), defaultdict(Counter)
    for e in ev:
        if "player" in e and "position" in e:
            pos[(e["team"]["name"], nick.get(e["player"]["name"]))][e["position"]["name"]] += 1
        t = e["type"]["name"]
        if t == "Pass" and "outcome" not in e["pass"] and "recipient" in e["pass"]:
            passes[(e["team"]["name"], nick[e["player"]["name"]], nick[e["pass"]["recipient"]["name"]])] += 1
        if t == "Shot" and "key_pass_id" in e["shot"]:
            kp = by_id.get(e["shot"]["key_pass_id"])
            if not kp:
                continue
            p = kp["pass"]
            ptype = (
                "Corner"
                if p.get("type", {}).get("name") == "Corner"
                else "Free kick"
                if p.get("type", {}).get("name") == "Free Kick"
                else "Throw-in"
                if p.get("type", {}).get("name") == "Throw-in"
                else "Cut-back"
                if p.get("cut_back")
                else "Through ball"
                if p.get("through_ball") or p.get("technique", {}).get("name") == "Through Ball"
                else "Cross"
                if p.get("cross")
                else "Pass"
            )
            plays.append(
                {
                    "team": e["team"]["name"],
                    "a": nick[kp["player"]["name"]],
                    "b": nick[e["player"]["name"]],
                    "match": mid,
                    "min": e["minute"],
                    "sec": e["second"],
                    "out": e["shot"]["outcome"]["name"],
                    "xg": round(e["shot"].get("statsbomb_xg", 0), 3),
                    "body": e["shot"]["body_part"]["name"],
                    "ptype": ptype,
                    "ps": [round(v) for v in kp["location"]],
                    "pe": [round(v) for v in p["end_location"]],
                    "sl": [round(v) for v in e["location"]],
                }
            )
    return plays, passes, pos


def main():
    matches = requests.get(f"{BASE}/matches/2/27.json", timeout=60).json()
    ids = [m["match_id"] for m in matches]
    plays, passes, pos = [], Counter(), defaultdict(Counter)
    with ThreadPoolExecutor(24) as pool:
        for i, (pl, pa, po) in enumerate(pool.map(pull, ids), 1):
            plays += pl
            passes.update(pa)
            for k, v in po.items():
                pos[k].update(v)
            if i % 95 == 0:
                print(i, "matches")

    # match table, referenced by index from each play
    mlist, midx = [], {}
    for m in sorted(matches, key=lambda m: m["match_date"]):
        midx[m["match_id"]] = len(mlist)
        mlist.append(
            {
                "d": m["match_date"],
                "wk": m.get("match_week"),
                "h": m["home_team"]["home_team_name"],
                "a": m["away_team"]["away_team_name"],
                "hs": m["home_score"],
                "as": m["away_score"],
            }
        )

    def pos_group(name):
        n = name.lower()
        if "goalkeeper" in n:
            return "GK"
        if "back" in n:
            return "DF"
        if "midfield" in n:
            return "MF"
        if "wing" in n:
            return "W"
        return "FW"

    play_df = pd.DataFrame(plays)
    pass_df = pd.DataFrame(
        [{"team": t, "passer": a, "receiver": b, "w": w} for (t, a, b), w in passes.items()]
    )

    teams_out, summaries = {}, {k: [] for k in TOP_N}
    for team in sorted(play_df.team.unique()):
        code, color = viz.team_info(team)
        tp = play_df[play_df.team == team]
        mode_edges = {
            "kp": tp.rename(columns={"a": "passer", "b": "receiver"}),
            "ga": tp[tp.out == "Goal"].rename(columns={"a": "passer", "b": "receiver"}),
        }
        modes = {}
        for mode in ("kp", "ga", "pass"):
            if mode == "pass":
                pe = pass_df[pass_df.team == team]
                G = nx.DiGraph()
                for r in pe.itertuples():
                    if r.passer != r.receiver:
                        G.add_edge(r.passer, r.receiver, weight=int(r.w))
            else:
                G = M.build_team_graph(mode_edges[mode])
            h = M.hits_scores(G).set_index("player")
            top = M.top_players(G, TOP_N[mode])
            comm = M.communities(G.subgraph(top).copy())
            s = M.team_summary(team, G)
            s["mode"] = mode
            summaries[mode].append(s)
            modes[mode] = {
                "entropy": round(s["entropy"], 4),
                "total": s["total"],
                "nodes": [
                    {
                        "id": p,
                        "pos": pos_group(pos[(team, p)].most_common(1)[0][0]) if pos[(team, p)] else "",
                        "hub": round(float(h.loc[p, "hub"]), 4),
                        "auth": round(float(h.loc[p, "authority"]), 4),
                        "made": int(h.loc[p, "made"]),
                        "recv": int(h.loc[p, "received"]),
                        "share": round(float(h.loc[p, "share"]), 4),
                        "c": comm.get(p, 0),
                    }
                    for p in top
                ],
                # all edges between shown players (others still count in the metrics)
                "edges": [[a, b, d["weight"]] for a, b, d in G.subgraph(top).edges(data=True)],
                "hubs": [
                    [p, round(float(r.hub), 4), round(float(r.share), 4)]
                    for p, r in h.sort_values("hub", ascending=False).head(5).iterrows()
                ],
                "auths": [
                    [p, round(float(r.authority), 4), int(r.received)]
                    for p, r in h.sort_values("authority", ascending=False).head(5).iterrows()
                ],
            }
        teams_out[team] = {
            "code": code,
            "color": color,
            "modes": modes,
            "plays": [
                [r.a, r.b, midx[r.match], r.min, r.sec, r.out, r.xg, r.body, r.ptype, r.ps, r.pe, r.sl]
                for r in tp.itertuples()
            ],
        }

    # league-level stuff
    league = {}
    for mode, rows in summaries.items():
        sdf = pd.DataFrame(rows)
        if mode == "kp":
            sdf = M.cluster_teams(sdf, k=4)
            names = viz.name_clusters(sdf)
            sdf["style"] = sdf.style_cluster.map(names)
        league[mode] = {
            "entropy": [
                [r.team, round(r.entropy, 4)]
                for r in sdf.sort_values("entropy", ascending=False).itertuples()
            ],
        }
        if mode == "kp":
            league[mode]["styles"] = [
                [r.team, r.style, round(r.pc1, 3), round(r.pc2, 3)] for r in sdf.itertuples()
            ]

    # league-wide player tables + duos per mode
    for mode in ("kp", "ga", "pass"):
        rows, duos = [], []
        for team, t in teams_out.items():
            for n in t["modes"][mode]["nodes"]:
                rows.append({"team": team, **n})
            for a, b, w in t["modes"][mode]["edges"]:
                duos.append([team, a, b, w])
        pdf = pd.DataFrame(rows)
        min_vol = {"kp": 15, "ga": 4, "pass": 300}[mode]
        reg = pdf[(pdf.made >= min_vol) | (pdf.recv >= min_vol)]
        league[mode]["hub"] = [
            [r.team, r.id, r.hub] for r in reg.sort_values("hub", ascending=False).head(10).itertuples()
        ]
        league[mode]["auth"] = [
            [r.team, r.id, r.auth] for r in reg.sort_values("auth", ascending=False).head(10).itertuples()
        ]
        league[mode]["duos"] = sorted(duos, key=lambda d: -d[3])[:12]

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(
            {"season": "2015/16", "matches": mlist, "teams": teams_out, "league": league},
            f,
            separators=(",", ":"),
            ensure_ascii=False,
        )
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    main()
