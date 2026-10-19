"""
Network building + the metrics from the reel, adapted for soccer.

Graph per team: directed, passer -> receiver, edge weight = number of times
that passer set up that receiver (key passes by default).

Metrics
-------
assist entropy : how evenly a team spreads its chances across passer->receiver pairs.
                 Normalized Shannon entropy of the edge weights, H / log(#edges).
                 1.0 = every pair contributes equally, lower = a few duos carry the team.
hub score      : HITS hub score. High if you feed the players who get the most chances
                 (the creators, the De Bruyne / Mahrez types).
authority score: HITS authority score, the opposite. High if you get fed by the best
                 creators (the finishers, the Vardy / Haaland types).
                 Both are the top singular vectors of the adjacency matrix, scaled to
                 unit length, so they run 0-1 and are comparable across teams.
share          : % of the team's total assists/key passes this player made.
communities    : Louvain clusters on the undirected graph, i.e. groups of players who
                 combine with each other more than with the rest of the team.
"""

import networkx as nx
import numpy as np
import pandas as pd


def build_team_graph(edges: pd.DataFrame) -> nx.DiGraph:
    """edges = rows for ONE team and ONE kind."""
    G = nx.DiGraph()
    counts = edges.groupby(["passer", "receiver"]).size()
    for (a, b), w in counts.items():
        if a != b:  # just in case of weird data rows
            G.add_edge(a, b, weight=int(w))
    return G


def assist_entropy(G: nx.DiGraph) -> float:
    w = np.array([d["weight"] for _, _, d in G.edges(data=True)], dtype=float)
    if len(w) < 2:
        return 0.0
    p = w / w.sum()
    return float(-(p * np.log(p)).sum() / np.log(len(w)))


def hits_scores(G: nx.DiGraph) -> pd.DataFrame:
    """Weighted HITS via SVD (same answer as power iteration, just quicker to read)."""
    nodes = list(G.nodes())
    A = nx.to_numpy_array(G, nodelist=nodes, weight="weight")
    U, S, Vt = np.linalg.svd(A)
    hub = np.abs(U[:, 0])  # left singular vector -> hubs
    auth = np.abs(Vt[0, :])  # right singular vector -> authorities
    out_w = A.sum(axis=1)
    in_w = A.sum(axis=0)
    return pd.DataFrame(
        {
            "player": nodes,
            "hub": hub,
            "authority": auth,
            "made": out_w.astype(int),  # assists / key passes made
            "received": in_w.astype(int),  # shots/goals off someone's pass
            "share": out_w / max(A.sum(), 1),
        }
    )


def communities(G: nx.DiGraph, seed: int = 7) -> dict:
    """player -> community id (0 = biggest)."""
    U = G.to_undirected()
    # merge both directions into one weight for the undirected version
    for a, b in U.edges():
        U[a][b]["weight"] = (
            G.get_edge_data(a, b, {"weight": 0})["weight"] + G.get_edge_data(b, a, {"weight": 0})["weight"]
        )
    comms = nx.community.louvain_communities(U, weight="weight", seed=seed)
    comms = sorted(comms, key=len, reverse=True)
    return {p: i for i, c in enumerate(comms) for p in c}


def top_players(G: nx.DiGraph, n: int = 14) -> list:
    """Most involved players, so the team charts don't turn into a hairball."""
    inv = {p: G.in_degree(p, weight="weight") + G.out_degree(p, weight="weight") for p in G}
    return sorted(inv, key=inv.get, reverse=True)[:n]


def team_summary(team: str, G: nx.DiGraph) -> dict:
    """One row per team, used for the rankings and the style clustering."""
    h = hits_scores(G)
    w = np.array([d["weight"] for _, _, d in G.edges(data=True)], dtype=float)
    top_pair = max(G.edges(data=True), key=lambda e: e[2]["weight"])
    made = np.sort(h["made"].values)[::-1]
    return {
        "team": team,
        "total": int(w.sum()),
        "players": G.number_of_nodes(),
        "pairs": G.number_of_edges(),
        "entropy": assist_entropy(G),
        "top_hub": h.loc[h.hub.idxmax(), "player"],
        "top_hub_score": h.hub.max(),
        "top_authority": h.loc[h.authority.idxmax(), "player"],
        "top_authority_score": h.authority.max(),
        "top_pair": f"{top_pair[0]} -> {top_pair[1]}",
        "top_pair_share": top_pair[2]["weight"] / w.sum(),
        "top3_creator_share": made[:3].sum() / w.sum(),
    }


def cluster_teams(summary: pd.DataFrame, k: int = 4, seed: int = 7) -> pd.DataFrame:
    """Group teams by HOW they create chances (not how many)."""
    from sklearn.cluster import KMeans
    from sklearn.decomposition import PCA
    from sklearn.preprocessing import StandardScaler

    feats = ["entropy", "top_hub_score", "top_authority_score", "top_pair_share", "top3_creator_share"]
    X = StandardScaler().fit_transform(summary[feats])
    summary = summary.copy()
    summary["style_cluster"] = KMeans(n_clusters=k, n_init=20, random_state=seed).fit_predict(X)
    pcs = PCA(n_components=2, random_state=seed).fit_transform(X)
    summary["pc1"], summary["pc2"] = pcs[:, 0], pcs[:, 1]
    return summary
