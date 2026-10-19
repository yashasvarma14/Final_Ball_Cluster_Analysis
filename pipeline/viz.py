"""
All the plotting. Goes for the same look as the graphsketball reel:
paper background, faint grid, slab-serif titles, curved edges, team colors.
"""

import math
import os

import matplotlib.pyplot as plt
import networkx as nx
import numpy as np
from matplotlib import font_manager
from matplotlib.colors import to_rgb
from matplotlib.patches import FancyArrowPatch, Wedge

import metrics as M

# ------------------------------------------------------------------ style

HERE = os.path.dirname(__file__)
for f in ("Arvo-Bold.ttf", "Arvo-Regular.ttf"):
    p = os.path.join(HERE, "fonts", f)
    if os.path.exists(p):
        font_manager.fontManager.addfont(p)

SLAB = "Arvo" if any(f.name == "Arvo" for f in font_manager.fontManager.ttflist) else "DejaVu Serif"
PAPER = "#EDE8DD"
GRID = "#DDD7C9"
INK = "#1E1E1E"
MUTED = "#6B665C"

plt.rcParams.update(
    {
        "font.family": [SLAB, "DejaVu Serif"],  # DejaVu covers the glyphs Arvo doesn't (→, ć, Þ...)
        "text.color": INK,
        "axes.edgecolor": INK,
        "savefig.facecolor": PAPER,
    }
)

# (name fragment, short code, color). First fragment found in the lowercase team name wins,
# so the specific ones (manchester city) sit above anything more generic.
TEAMS = [
    ("manchester city", "MCI", "#6CABDD"),
    ("manchester united", "MUN", "#DA291C"),
    ("arsenal", "ARS", "#EF0107"),
    ("aston villa", "AVL", "#670E36"),
    ("bournemouth", "BOU", "#B50E12"),
    ("brentford", "BRE", "#E30613"),
    ("brighton", "BHA", "#0057B8"),
    ("burnley", "BUR", "#6C1D45"),
    ("chelsea", "CHE", "#034694"),
    ("crystal palace", "CRY", "#1B458F"),
    ("everton", "EVE", "#003399"),
    ("fulham", "FUL", "#111111"),
    ("ipswich", "IPS", "#3A64A3"),
    ("leeds", "LEE", "#1D428A"),
    ("leicester", "LEI", "#003090"),
    ("liverpool", "LIV", "#C8102E"),
    ("luton", "LUT", "#F78F1E"),
    ("newcastle", "NEW", "#241F20"),
    ("norwich", "NOR", "#00A650"),
    ("nottingham", "NFO", "#DD0000"),
    ("sheffield", "SHU", "#EE2737"),
    ("southampton", "SOU", "#D71920"),
    ("stoke", "STK", "#E03A3E"),
    ("sunderland", "SUN", "#EB172B"),
    ("swansea", "SWA", "#121212"),
    ("tottenham", "TOT", "#132257"),
    ("watford", "WAT", "#C9A400"),
    ("west brom", "WBA", "#122F67"),
    ("west ham", "WHU", "#7A263A"),
    ("wolverhampton", "WOL", "#C99700"),
    ("wolves", "WOL", "#C99700"),
]


def team_info(name: str):
    low = name.lower()
    for frag, code, color in TEAMS:
        if frag in low:
            return code, color
    return name[:3].upper(), "#444444"


def short_name(full: str) -> str:
    """'Riyad Mahrez' -> 'R. Mahrez', 'Kevin De Bruyne' -> 'K. De Bruyne', 'Rodri' -> 'Rodri'."""
    full = str(full).replace("''", "'")
    parts = full.split()
    if len(parts) == 1:
        return full
    particles = {"de", "van", "von", "der", "den", "di", "da", "dos", "le", "el", "al", "ter"}
    last = [parts[-1]]
    i = len(parts) - 2
    while i > 0 and parts[i].lower() in particles:
        last.insert(0, parts[i])
        i -= 1
    return f"{parts[0][0]}. {' '.join(last)}"


def tint(color, amount):
    """Blend a color toward the paper color (amount 0 = color, 1 = paper)."""
    c, p = np.array(to_rgb(color)), np.array(to_rgb(PAPER))
    return tuple(c * (1 - amount) + p * amount)


def paper_figure(w, h, dpi=120):
    fig = plt.figure(figsize=(w, h), dpi=dpi, facecolor=PAPER)
    bg = fig.add_axes([0, 0, 1, 1], zorder=-10)
    bg.set_xlim(0, w)
    bg.set_ylim(0, h)
    step = 0.25
    for x in np.arange(0, w, step):
        bg.axvline(x, color=GRID, lw=0.4)
    for y in np.arange(0, h, step):
        bg.axhline(y, color=GRID, lw=0.4)
    bg.set_facecolor(PAPER)
    bg.axis("off")
    return fig


def header(fig, subtitle=None, sub2=None):
    """Positions are in inches from the top so it works for tall and wide figures."""
    h = fig.get_figheight()
    y = lambda inches: 1 - inches / h
    fig.text(0.5, y(0.55), "Assist Networks", ha="center", va="center", fontsize=30, weight="bold")
    nxt = 1.1
    if subtitle:
        fig.text(0.5, y(nxt), subtitle, ha="center", va="center", fontsize=21, weight="bold")
        nxt += 0.45
    if sub2:
        fig.text(0.5, y(nxt), sub2, ha="center", va="center", fontsize=13, color=MUTED)


def footer(fig, text):
    fig.text(0.5, 0.012, text, ha="center", va="bottom", fontsize=8.5, color=MUTED)


# ------------------------------------------------------------------ network drawing


def _circle_layout(G, players, comm):
    """Players on a circle, grouped by cluster so each cluster sits together."""
    inv = {p: G.in_degree(p, weight="weight") + G.out_degree(p, weight="weight") for p in players}
    order = sorted(players, key=lambda p: (comm.get(p, 99), -inv[p]))
    n = len(order)
    pos = {}
    for i, p in enumerate(order):
        ang = math.pi / 2 - 2 * math.pi * i / n
        pos[p] = (math.cos(ang), math.sin(ang))
    return pos, order, inv


def draw_network(ax, G, color, n_players=14, labels=True, show_clusters=True, lw_scale=1.0):
    players = M.top_players(G, n_players)
    comm = M.communities(G.subgraph(players).copy()) if len(players) > 2 else {}
    pos, order, inv = _circle_layout(G, players, comm)

    # soft band behind each cluster
    if show_clusters and comm:
        n = len(order)
        step = 360 / n
        groups = {}
        for i, p in enumerate(order):
            groups.setdefault(comm[p], []).append(i)
        shades = [0.80, 0.90]
        for k, (cid, idx) in enumerate(sorted(groups.items())):
            # angles in degrees, clockwise from top
            start = 90 - step * (idx[-1] + 0.5)
            end = 90 - step * (idx[0] - 0.5)
            ax.add_patch(
                Wedge(
                    (0, 0),
                    1.13,
                    start,
                    end,
                    width=0.26,
                    facecolor=tint(color, shades[k % 2]),
                    edgecolor="none",
                    zorder=0,
                )
            )

    # undirected thickness = both directions added together
    pairs = {}
    for a, b, d in G.subgraph(players).edges(data=True):
        key = tuple(sorted((a, b)))
        pairs[key] = pairs.get(key, 0) + d["weight"]
    if not pairs:
        return pos
    wmax = max(pairs.values())
    for (a, b), w in sorted(pairs.items(), key=lambda kv: kv[1]):
        r = w / wmax
        rv = r**0.5  # visual scale, keeps weaker links visible when one duo dominates
        edge_color = color if rv > 0.7 else tint(color, 0.1 + 0.6 * (1 - rv))
        ax.add_patch(
            FancyArrowPatch(
                pos[a],
                pos[b],
                connectionstyle="arc3,rad=0.22",
                arrowstyle="-",
                lw=lw_scale * (0.35 + 4.8 * r**1.3),
                color=edge_color,
                alpha=0.3 + 0.7 * rv,
                zorder=1 + r,
                capstyle="round",
            )
        )

    imax = max(inv.values())
    for p in players:
        x, y = pos[p]
        s = (20 + 260 * inv[p] / imax) * lw_scale**2
        ax.scatter(
            x, y, s=s, color=INK if inv[p] == imax else color, edgecolor=PAPER, linewidth=1.2, zorder=5
        )
        if labels:
            ax.text(
                x * 1.2,
                y * 1.2,
                short_name(p),
                fontsize=10.5,
                weight="bold",
                ha="left" if x > 0.15 else ("right" if x < -0.15 else "center"),
                va="center",
                zorder=6,
            )

    lim = 1.55 if labels else 1.2
    ax.set_xlim(-lim, lim)
    ax.set_ylim(-lim, lim)
    ax.set_aspect("equal")
    ax.axis("off")
    return pos


def draw_ego(ax, G, player, color, direction="out", max_n=12):
    """Star chart for one player, like the Jokic one. out = who they feed, in = who feeds them."""
    nbrs = G.successors(player) if direction == "out" else G.predecessors(player)
    vals = {}
    for q in nbrs:
        e = G[player][q] if direction == "out" else G[q][player]
        vals[q] = e["weight"]
    vals = dict(sorted(vals.items(), key=lambda kv: -kv[1])[:max_n])
    if not vals:
        ax.axis("off")
        return
    vmax = max(vals.values())
    n = len(vals)
    for i, (q, w) in enumerate(vals.items()):
        ang = math.pi / 2 - 2 * math.pi * i / n
        rad = 1.0
        x, y = rad * math.cos(ang), rad * math.sin(ang)
        r = w / vmax
        ax.add_patch(
            FancyArrowPatch(
                (0, 0),
                (x, y),
                connectionstyle="arc3,rad=0.12",
                arrowstyle="-",
                lw=0.8 + 4.5 * r,
                color=color,
                alpha=0.45 + 0.55 * r,
                zorder=1,
            )
        )
        ax.scatter(x, y, s=25 + 120 * r, color=color, edgecolor=PAPER, zorder=3)
        ax.text(
            x * 1.16,
            y * 1.16,
            f"{short_name(q)}  ({w})",
            fontsize=10,
            weight="bold",
            va="center",
            ha="left" if x > 0.15 else ("right" if x < -0.15 else "center"),
        )
    ax.scatter(0, 0, s=320, color=INK, edgecolor=PAPER, linewidth=1.5, zorder=5)
    ax.text(
        0,
        -0.13,
        short_name(player),
        ha="center",
        va="top",
        fontsize=12,
        weight="bold",
        zorder=6,
        bbox=dict(boxstyle="round,pad=0.2", fc=PAPER, ec="none", alpha=0.85),
    )
    ax.set_xlim(-1.75, 1.75)
    ax.set_ylim(-1.5, 1.5)
    ax.set_aspect("equal")
    ax.axis("off")


def bar_row(ax, labels, values, colors, sublabels=None, fmt="{:.3f}", fontsize=10):
    x = np.arange(len(values))
    ax.bar(x, values, color=colors, width=0.62, edgecolor=INK, linewidth=0.6)
    for xi, v in zip(x, values):
        ax.text(xi, v + max(values) * 0.02, fmt.format(v), ha="center", va="bottom", fontsize=fontsize - 1)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=fontsize, weight="bold")
    if sublabels:
        for xi, s in zip(x, sublabels):
            ax.annotate(
                s,
                (xi, 0),
                xycoords=("data", "axes fraction"),
                xytext=(0, -20),
                textcoords="offset points",
                ha="center",
                va="top",
                fontsize=fontsize - 2,
                color=MUTED,
            )
    ax.tick_params(axis="x", length=0, pad=4)
    ax.set_yticks([])
    for s in ax.spines.values():
        s.set_visible(False)
    ax.set_facecolor("none")
    lo = min(values)
    ax.set_ylim(max(0, lo - (max(values) - lo) * 1.5) if lo > 0.5 else 0, max(values) * 1.12)


# ------------------------------------------------------------------ full figures


def fig_grid(graphs: dict, label: str, path: str):
    teams = sorted(graphs)
    cols = 5
    rows = math.ceil(len(teams) / cols)
    fig = paper_figure(10, 2.25 * rows + 1.6)
    header(fig, sub2=label)
    top = 0.86
    h = (top - 0.04) / rows
    for i, t in enumerate(teams):
        r, c = divmod(i, cols)
        ax = fig.add_axes([0.02 + c * 0.192, top - (r + 1) * h + 0.018, 0.192, h - 0.018])
        code, color = team_info(t)
        draw_network(ax, graphs[t], color, n_players=12, labels=False, show_clusters=False, lw_scale=0.55)
        ax.text(0, -1.3, code, ha="center", va="center", fontsize=12, weight="bold", color=color)
    footer(
        fig,
        "Each dot = one of the team's 12 most involved players · line thickness = chances created between the pair",
    )
    fig.savefig(path, dpi=120)
    plt.close(fig)


def fig_entropy(summary, label, path):
    s = summary.sort_values("entropy", ascending=False)
    fig = paper_figure(11, 6.2)
    header(fig, "Assist Entropy", label)
    ax = fig.add_axes([0.04, 0.16, 0.92, 0.58])
    codes = [team_info(t)[0] for t in s.team]
    cols = [team_info(t)[1] for t in s.team]
    bar_row(ax, codes, s.entropy.values, cols, fontsize=10)
    fig.text(
        0.5,
        0.06,
        "Higher = chances spread across many combinations  ·  Lower = a few duos do the work",
        ha="center",
        fontsize=11,
        color=MUTED,
    )
    fig.savefig(path)
    plt.close(fig)


def fig_league_top(players, score, title, caption, label, path, n=10):
    p = players.sort_values(score, ascending=False).head(n)
    fig = paper_figure(11, 6.2)
    header(fig, title, label)
    ax = fig.add_axes([0.04, 0.24, 0.92, 0.52])
    names = [short_name(x) for x in p.player]
    cols = [team_info(t)[1] for t in p.team]
    bar_row(ax, names, p[score].values, cols, sublabels=[team_info(t)[0] for t in p.team], fontsize=9.5)
    fig.text(0.5, 0.04, caption, ha="center", fontsize=11, color=MUTED)
    fig.savefig(path)
    plt.close(fig)


def fig_top_duos(edges_all, label, path, n=12):
    d = edges_all.sort_values("weight", ascending=False).head(n).iloc[::-1]
    fig = paper_figure(10, 7.5)
    header(fig, "Top Duos", label)
    ax = fig.add_axes([0.33, 0.05, 0.6, 0.74])
    cols = [team_info(t)[1] for t in d.team]
    ax.barh(range(len(d)), d.weight, color=cols, edgecolor=INK, linewidth=0.6, height=0.62)
    ax.set_yticks(range(len(d)))
    ax.set_yticklabels(
        [
            f"{short_name(a)} → {short_name(b)}  ({team_info(t)[0]})"
            for a, b, t in zip(d.passer, d.receiver, d.team)
        ],
        fontsize=10.5,
        weight="bold",
    )
    for i, w in enumerate(d.weight):
        ax.text(w + d.weight.max() * 0.01, i, str(w), va="center", fontsize=10)
    ax.set_xticks([])
    ax.tick_params(axis="y", length=0)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.set_facecolor("none")
    fig.savefig(path)
    plt.close(fig)


CLUSTER_NAMES = {
    "entropy": "Shared creativity",
    "top_hub_score": "One main creator",
    "top_authority_score": "One main finisher",
    "top_pair_share": "Built on a duo",
    "top3_creator_share": "Few creators",
}


def name_clusters(summary):
    feats = list(CLUSTER_NAMES)
    z = (summary[feats] - summary[feats].mean()) / summary[feats].std()
    means = z.groupby(summary["style_cluster"]).mean()
    names, used = {}, set()
    for cid in means.mean(axis=1).sort_values().index:  # just a stable order
        for f in means.loc[cid].sort_values(ascending=False).index:
            if f not in used:
                names[cid] = CLUSTER_NAMES[f]
                used.add(f)
                break
    return names


def fig_style_clusters(summary, label, path):
    names = name_clusters(summary)
    fig = paper_figure(10, 8.5)
    header(fig, "Chance-Creation Styles", label)
    ax = fig.add_axes([0.06, 0.06, 0.88, 0.66])
    palette = ["#C8553D", "#2D6A8E", "#588157", "#8E6C8A", "#B08900"]
    handles = []
    for cid, g in summary.groupby("style_cluster"):
        pc = palette[cid % len(palette)]
        handles.append(
            plt.Line2D(
                [],
                [],
                marker="o",
                ls="",
                markersize=13,
                markerfacecolor=PAPER,
                markeredgecolor=pc,
                markeredgewidth=3,
                label=f"{names[cid]} ({len(g)})",
            )
        )
        for _, r in g.iterrows():
            code, color = team_info(r.team)
            ax.scatter(r.pc1, r.pc2, s=420, color=PAPER, edgecolor=pc, lw=3, zorder=2)
            ax.scatter(r.pc1, r.pc2, s=150, color=color, edgecolor=INK, lw=0.6, zorder=3)
            ax.text(
                r.pc1 + 0.12,
                r.pc2 + 0.06,
                code,
                ha="left",
                va="bottom",
                fontsize=10.5,
                weight="bold",
                color=pc,
                zorder=4,
            )
    fig.legend(
        handles=handles,
        loc="upper center",
        bbox_to_anchor=(0.5, 0.815),
        ncol=len(handles),
        frameon=False,
        fontsize=11.5,
        handletextpad=0.3,
        columnspacing=1.6,
    )
    ax.margins(0.12)
    ax.axis("off")
    footer(
        fig,
        "K-means on entropy, top hub & authority scores, top-duo share and top-3 creator share "
        "(PCA for the 2D view; teams close together create chances the same way)",
    )
    fig.savefig(path)
    plt.close(fig)


def fig_ego(team, G, player, label, path, direction="out"):
    code, color = team_info(team)
    fig = paper_figure(9, 9)
    verb = "Who he set up" if direction == "out" else "Who set him up"
    header(fig, f"{short_name(player)} · {code}", f"{verb} · {label}")
    ax = fig.add_axes([0.03, 0.04, 0.94, 0.82])
    draw_ego(ax, G, player, color, direction)
    fig.savefig(path)
    plt.close(fig)
