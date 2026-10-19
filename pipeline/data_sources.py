"""
Data loaders for the EPL assist network project.

Both loaders return the same thing: a dataframe of "assist events" with columns
    team, passer, receiver, kind, match_id
where kind is one of:
    goal_assist  -> pass that led straight to a goal (the strict soccer "assist")
    key_pass     -> pass that led to a shot (goal or not). Goal assists are included here too.
    pass         -> any completed pass between teammates (StatsBomb only, gives a full pass network)

Why key passes are the default: a PL team only gets ~40-70 goal assists a season,
so the goals-only network is really sparse. Key passes give ~350-500 links per team,
which is closer to what the NBA assist networks look like.

Sources
-------
understat  : current seasons (2014/15 -> now). Shots + who assisted them. Needs internet
             access to understat.com, so run this on your own machine.
statsbomb  : free open data on GitHub. Full event data, but the only complete PL season
             is 2015/16 (Leicester's title year).
"""

import html
import json
import os
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
import requests

STATSBOMB_BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data")


# ---------------------------------------------------------------- Understat


def load_understat(season: int = 2025) -> pd.DataFrame:
    """season = the year the season starts in (2025 -> 2025/26)."""
    cache = os.path.join(CACHE_DIR, f"understat_epl_{season}.csv")
    if os.path.exists(cache):
        return pd.read_csv(cache)

    # soccerdata handles the Understat requests/parsing for us
    import soccerdata as sd

    us = sd.Understat(leagues="ENG-Premier League", seasons=season)
    shots = us.read_shot_events().reset_index()

    # only shots where someone actually set it up
    shots = shots.dropna(subset=["assist_player"])
    # Understat sends names HTML-escaped (O&#039;Reilly)
    for col in ("assist_player", "player"):
        shots[col] = shots[col].map(html.unescape)
    out = pd.DataFrame(
        {
            "team": shots["team"],
            "passer": shots["assist_player"],
            "receiver": shots["player"],
            "kind": "key_pass",
            "match_id": shots["game_id"],
        }
    )
    goals = shots[shots["result"].astype(str).str.lower() == "goal"]
    out = pd.concat(
        [
            out,
            pd.DataFrame(
                {
                    "team": goals["team"],
                    "passer": goals["assist_player"],
                    "receiver": goals["player"],
                    "kind": "goal_assist",
                    "match_id": goals["game_id"],
                }
            ),
        ],
        ignore_index=True,
    )

    os.makedirs(CACHE_DIR, exist_ok=True)
    out.to_csv(cache, index=False)
    return out


# ---------------------------------------------------------------- StatsBomb


def _statsbomb_match_edges(match_id: int) -> list:
    """Pull one match's events and boil it down to passer -> receiver rows."""
    url = f"{STATSBOMB_BASE}/events/{match_id}.json"
    events = requests.get(url, timeout=60).json()
    by_id = {e["id"]: e for e in events}
    rows = []

    for e in events:
        etype = e["type"]["name"]

        # completed passes have no "outcome" key in StatsBomb
        if etype == "Pass" and "outcome" not in e["pass"] and "recipient" in e["pass"]:
            rows.append(
                (e["team"]["name"], e["player"]["name"], e["pass"]["recipient"]["name"], "pass", match_id)
            )

        # shots point back at the pass that set them up
        if etype == "Shot" and "key_pass_id" in e["shot"]:
            kp = by_id.get(e["shot"]["key_pass_id"])
            if kp is None:
                continue
            passer = kp["player"]["name"]
            shooter = e["player"]["name"]
            team = e["team"]["name"]
            rows.append((team, passer, shooter, "key_pass", match_id))
            if e["shot"]["outcome"]["name"] == "Goal":
                rows.append((team, passer, shooter, "goal_assist", match_id))
    return rows


def load_statsbomb(competition_id: int = 2, season_id: int = 27, workers: int = 16) -> pd.DataFrame:
    """Defaults = Premier League 2015/16. Downloads ~1GB of events the first time, then caches."""
    cache = os.path.join(CACHE_DIR, f"statsbomb_{competition_id}_{season_id}.csv")
    if os.path.exists(cache):
        return pd.read_csv(cache)

    matches = requests.get(f"{STATSBOMB_BASE}/matches/{competition_id}/{season_id}.json", timeout=60).json()
    ids = [m["match_id"] for m in matches]

    rows = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i, match_rows in enumerate(pool.map(_statsbomb_match_edges, ids), 1):
            rows.extend(match_rows)
            if i % 50 == 0:
                print(f"  {i}/{len(ids)} matches pulled")

    out = pd.DataFrame(rows, columns=["team", "passer", "receiver", "kind", "match_id"])

    # events use full legal names ("Sergio Leonel Agüero del Castillo"), lineups have the
    # name everyone actually uses ("Sergio Agüero"), so swap those in
    def nicknames(mid):
        lineups = requests.get(f"{STATSBOMB_BASE}/lineups/{mid}.json", timeout=60).json()
        return {
            p["player_name"]: p["player_nickname"]
            for t in lineups
            for p in t["lineup"]
            if p.get("player_nickname")
        }

    nick = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for d in pool.map(nicknames, ids):
            nick.update(d)
    out["passer"] = out["passer"].replace(nick)
    out["receiver"] = out["receiver"].replace(nick)

    os.makedirs(CACHE_DIR, exist_ok=True)
    out.to_csv(cache, index=False)
    return out


def load(source: str, season: int = 2025) -> pd.DataFrame:
    if source == "understat":
        return load_understat(season)
    if source == "statsbomb":
        return load_statsbomb()
    raise ValueError(f"unknown source {source!r}")
