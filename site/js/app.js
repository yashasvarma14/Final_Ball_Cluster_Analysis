(() => {
  "use strict";

  // Final Ball: interactive front end for the Premier League chance networks.
  // Reads data.json (built by pipeline/build_site_data_understat.py) and renders everything with D3.

  // ==================== 1. Config and state ====================

  const MODES = {
    kp: {
      label: "Key passes",
      unit: "key passes",
      short: "Key-pass network",
      lede: "Every shot someone set up.",
    },
    ga: {
      label: "Assists",
      unit: "assists",
      short: "Assist network",
      lede: "Only the passes that ended in a goal.",
    },
    xg: {
      label: "Chance quality",
      unit: "xG created",
      short: "Chance-quality network",
      lede: "Links weighted by the expected goals of each chance.",
    },
  };
  const S = {
    data: null,
    mode: "kp",
    team: null,
    sel: null,
    ego: null,
    egoDir: "out",
    pf: "all",
    hero: { i: 0, playing: true, t0: 0 },
  };

  // ==================== 2. Helpers: DOM, formatting, colour, data access ====================

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const f3 = (v) => v.toFixed(3);
  const pct = (v) => Math.round(v * 100) + "%";
  const fv = (v) => (S.mode === "xg" ? (+v).toFixed(1) : (+v).toLocaleString());
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  let DARK = false;

  function shortName(full) {
    const parts = String(full).split(" ");
    if (parts.length === 1) return full;
    const particles = new Set(["de", "van", "von", "der", "den", "di", "da", "dos", "le", "el", "al", "ter"]);
    const last = [parts[parts.length - 1]];
    let i = parts.length - 2;
    while (i > 0 && particles.has(parts[i].toLowerCase())) {
      last.unshift(parts[i]);
      i--;
    }
    return parts[0][0] + ". " + last.join(" ");
  }
  const T = (team) => S.data.teams[team];
  const M = (team = S.team, mode = S.mode) => T(team).modes[mode];
  const teams = () => Object.keys(S.data.teams).sort((a, b) => T(a).name.localeCompare(T(b).name));
  const byCode = (c) => teams().find((t) => T(t).code.toLowerCase() === String(c).toLowerCase());
  const lum = (hex) => {
    const c = d3.color(hex);
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  };
  function tcol(team) {
    const h = d3.hsl(T(team).color);
    if (DARK) {
      if (h.l < 0.45) h.l = 0.5 + (0.45 - h.l) * 0.4;
      if (h.s < 0.15) h.l = Math.max(h.l, 0.78);
    } else if (h.l > 0.7) h.l = 0.55;
    return h.formatHex();
  }
  const mix = (a, b, t) => d3.interpolateRgb(a, b)(t);
  // run a render with the dark-theme colour rules (used for the always-dark hero)
  function withDark(fn) {
    const d = DARK;
    DARK = true;
    try {
      return fn();
    } finally {
      DARK = d;
    }
  }
  const isDark = () => lum(d3.color(getComputedStyle(document.body).backgroundColor).formatHex()) < 0.4;

  // ==================== 3. Club crests ====================

  // Club tiles. With a crest file: the crest on a tile ringed in the club colour, tinted in that colour on hover.
  // Without one: outline letters in the club's two colours, with the filled version fading in on hover.
  const LOGOS = {};
  window.FB_LOCAL = true;
  // Logo files live in logos/ named by club code (ARS.png, AVL.png, ...); missing ones keep the colour tile.
  // Crests are shrunk to small data URLs so they also render inside the SVG-as-image chart marks.
  function logoURL(img) {
    try {
      const n = 160,
        c = document.createElement("canvas"),
        k = Math.min(n / img.naturalWidth, n / img.naturalHeight);
      c.width = c.height = n;
      const w = img.naturalWidth * k,
        h = img.naturalHeight * k;
      c.getContext("2d").drawImage(img, (n - w) / 2, (n - h) / 2, w, h);
      return c.toDataURL("image/png");
    } catch (e) {
      return img.src;
    }
  }
  function loadLogos(codes, onDone) {
    let left = codes.length;
    codes.forEach((code) => {
      const tryExt = (exts) => {
        if (!exts.length) {
          if (--left === 0) onDone();
          return;
        }
        const src = `logos/${code}.${exts[0]}`,
          img = new Image();
        img.onload = () => {
          LOGOS[code] = logoURL(img);
          if (--left === 0) onDone();
        };
        img.onerror = () => tryExt(exts.slice(1));
        img.src = src;
      };
      tryExt(["png", "svg", "webp", "jpg"]);
    });
  }
  function adj2(c) {
    const l = lum(c);
    if (!DARK && l > 0.8) return d3.color(c).darker(1.3).formatHex();
    if (DARK && l < 0.2) {
      const h = d3.hsl(c);
      h.l = 0.72;
      return h.formatHex();
    }
    return c;
  }
  function crest(team, uid, variant = "both", explicit = false) {
    const t = T(team),
      id = "g" + t.code + (uid || "") + variant;
    const c1 = tcol(team),
      c2 = adj2(t.color2);
    const base = t.color,
      dark = d3.color(base).darker(0.9).formatHex(),
      light = d3.color(base).brighter(0.35).formatHex();
    const fg = lum(base) > 0.62 ? "#1d1d1f" : "#ffffff";
    const font = `font-family="-apple-system,BlinkMacSystemFont,Inter,Helvetica,Arial,sans-serif" font-size="17" font-weight="800" letter-spacing="-.2" text-anchor="middle"`;
    const tileBg = explicit ? (DARK ? "#1c1c1e" : "#ffffff") : "var(--tile)";
    const outline = `<g class="co"><rect x=".75" y=".75" width="58.5" height="58.5" rx="14" fill="${tileBg}" stroke="${c1}" stroke-opacity=".28" stroke-width="1.5"/>
    <text x="31" y="37" ${font} fill="none" stroke="${c2}" stroke-width="1.2" stroke-linejoin="round">${t.code}</text>
    <text x="30" y="36" ${font} fill="${tileBg}" stroke="${c1}" stroke-width="1.7" stroke-linejoin="round" paint-order="stroke">${t.code}</text></g>`;
    const logo = LOGOS[t.code];
    if (logo) return crestLogo(t, logo, id, c1, tileBg, variant);
    const fill = `<g class="cf"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient>
    <clipPath id="${id}c"><rect width="60" height="60" rx="14"/></clipPath></defs>
    <g clip-path="url(#${id}c)"><rect width="60" height="60" fill="url(#${id})"/><path d="M38 60 L60 38 L60 50 L50 60Z" fill="${t.color2}"/><path d="M0 0 H60 V24 Q30 32 0 24Z" fill="#fff" opacity=".10"/></g>
    <text x="30" y="36" ${font} fill="${fg}">${t.code}</text></g>`;
    if (variant === "tiny") {
      const tiny = `<g class="co"><text x="30" y="38" ${font.replace('font-size="17"', 'font-size="25"').replace('letter-spacing="-.2"', 'letter-spacing="-1"')} fill="${c1}">${t.code}</text><rect x="12" y="45" width="36" height="5" rx="2.5" fill="${c2}"/></g>`;
      return `<svg viewBox="0 0 60 60" aria-hidden="true">${tiny}${fill}</svg>`;
    }
    return `<svg viewBox="0 0 60 60" aria-hidden="true">${variant !== "fill" ? outline : ""}${variant !== "outline" ? fill : ""}</svg>`;
  }
  // Crest version of the tile. A thin light contour keeps dark crests (Spurs navy, Newcastle black) readable on the dark theme.
  function crestLogo(t, logo, id, c1, tileBg, variant) {
    const glow = DARK ? "#ffffff" : "#000000",
      gop = DARK ? 0.9 : 0.14;
    const defs = `<defs><filter id="${id}k" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
    <feMorphology in="SourceAlpha" operator="dilate" radius="${DARK ? 1.1 : 0.6}" result="d"/><feFlood flood-color="${glow}" flood-opacity="${gop}"/><feComposite in2="d" operator="in" result="o"/>
    <feGaussianBlur in="SourceAlpha" stdDeviation="1.4" result="b"/><feOffset in="b" dy="1" result="s"/><feFlood flood-color="#000" flood-opacity="${DARK ? 0.45 : 0.18}"/><feComposite in2="s" operator="in" result="sh"/>
    <feMerge><feMergeNode in="sh"/><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <radialGradient id="${id}r" cx=".5" cy=".38" r=".75"><stop offset="0" stop-color="${c1}" stop-opacity="${DARK ? 0.55 : 0.32}"/><stop offset="1" stop-color="${c1}" stop-opacity="${DARK ? 0.14 : 0.08}"/></radialGradient></defs>`;
    const img = (x, s) =>
      `<image href="${logo}" x="${x}" y="${x}" width="${s}" height="${s}" preserveAspectRatio="xMidYMid meet" filter="url(#${id}k)"/>`;
    if (variant === "tiny") return `<svg viewBox="0 0 60 60" aria-hidden="true">${defs}${img(2, 56)}</svg>`;
    const ring = (op) =>
      `<rect x=".75" y=".75" width="58.5" height="58.5" rx="14" fill="${tileBg}" stroke="${c1}" stroke-opacity="${op}" stroke-width="1.5"/>`;
    const outline = `<g class="co">${ring(0.3)}</g>`;
    const fill = `<g class="cf">${ring(0.9)}<rect x=".75" y=".75" width="58.5" height="58.5" rx="14" fill="url(#${id}r)"/></g>`;
    return `<svg viewBox="0 0 60 60" aria-hidden="true">${defs}${variant !== "fill" ? outline : ""}${variant !== "outline" ? fill : ""}${img(9, 42)}</svg>`;
  }
  const crestURI = (team, variant = "outline") =>
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      crest(team, "u", variant, true).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '),
    );

  // ==================== 4. Network geometry ====================

  function rankOf(team, mode = S.mode) {
    return S.data.league[mode].entropy.findIndex((r) => r[0] === team) + 1;
  }
  function styleOf(team) {
    const r = S.data.league.kp.styles.find((r) => r[0] === team);
    return r ? r[1] : "";
  }
  function pairsFor(m) {
    const map = new Map();
    for (const [a, b, w] of m.edges) {
      const [x, y] = a < b ? [a, b] : [b, a],
        k = x + "|" + y;
      if (!map.has(k)) map.set(k, { key: k, a: x, b: y, ab: 0, ba: 0 });
      const p = map.get(k);
      if (a === x) p.ab += w;
      else p.ba += w;
    }
    return [...map.values()].map((p) => ((p.w = p.ab + p.ba), p));
  }
  function circleLayout(nodes, R) {
    const inv = (n) => n.made + n.recv;
    const order = [...nodes].sort((p, q) => p.c - q.c || inv(q) - inv(p));
    const pos = {};
    order.forEach((d, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / order.length;
      pos[d.id] = { x: R * Math.cos(a), y: R * Math.sin(a) };
    });
    return { pos, order };
  }
  function egoLayout(nodes, center, weights, R) {
    const others = nodes
      .filter((n) => n.id !== center)
      .sort((p, q) => (weights[q.id] || 0) - (weights[p.id] || 0));
    const pos = { [center]: { x: 0, y: 0 } };
    others.forEach((d, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / others.length;
      pos[d.id] = { x: R * Math.cos(a), y: R * Math.sin(a) };
    });
    return pos;
  }
  const chord = (p, q, k = 0.42) =>
    `M${p.x.toFixed(1)},${p.y.toFixed(1)}Q${(((p.x + q.x) / 2) * k).toFixed(1)},${(((p.y + q.y) / 2) * k).toFixed(1)} ${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  function spoke(p, q) {
    const mx = (p.x + q.x) / 2,
      my = (p.y + q.y) / 2,
      dx = q.x - p.x,
      dy = q.y - p.y;
    return `M${p.x.toFixed(1)},${p.y.toFixed(1)}Q${(mx - dy * 0.12).toFixed(1)},${(my + dx * 0.12).toFixed(1)} ${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  }

  // ==================== 5. Network renderer (hero + stage) ====================

  function makeNet(svgEl, opts) {
    const svg = d3.select(svgEl);
    const gB = svg.append("g"),
      gE = svg.append("g"),
      gH = svg.append("g"),
      gN = svg.append("g");
    const api = { svg, R: 330, fs: 13.5 };
    api.scale = () => {
      const w = svgEl.getBoundingClientRect().width || 600;
      api.R = w < 560 ? 262 : 330;
      api.fs = w < 560 ? 11 : 13.5;
      return 1120 / w;
    };
    api.clear = () => [gB, gE, gH, gN].forEach((g) => g.selectAll("*").remove());
    api.render = (team, mode, animate = true, ego = null, egoDir = "out") => {
      const cs = getComputedStyle(svgEl),
        m = M(team, mode),
        k = api.scale();
      const color = opts.dark ? withDark(() => tcol(team)) : tcol(team);
      const bg = cs.getPropertyValue(opts.bgVar).trim(),
        base = cs.getPropertyValue("--track").trim(),
        ink = cs.getPropertyValue("--text").trim();
      const inv = (n) => n.made + n.recv,
        imax = d3.max(m.nodes, inv) || 1;
      const Tm = animate ? 800 : 0;
      let pos,
        pairs = pairsFor(m),
        weights = {};
      if (ego) {
        for (const [a, b, w] of m.edges) {
          if (egoDir === "out" && a === ego) weights[b] = w;
          if (egoDir === "in" && b === ego) weights[a] = w;
        }
        pos = egoLayout(m.nodes, ego, weights, api.R);
        pairs = Object.entries(weights).map(([o, w]) => ({
          key: [ego, o].sort().join("|"),
          a: ego,
          b: o,
          w,
          ego: true,
        }));
      } else pos = circleLayout(m.nodes, api.R).pos;
      const wmax = d3.max(pairs, (p) => p.w) || 1;
      pairs.sort((a, b) => a.w - b.w);

      // soft cluster rings
      let bands = [];
      if (!ego && opts.bands) {
        const { order } = circleLayout(m.nodes, api.R),
          n = order.length,
          step = (2 * Math.PI) / n;
        bands = d3
          .groups(
            order.map((d, i) => ({ d, i })),
            (x) => x.d.c,
          )
          .map(([c, arr], gi) => ({
            c,
            gi,
            s: arr[0].i * step - step / 2 + 0.02,
            e: arr[arr.length - 1].i * step + step / 2 - 0.02,
          }));
      }
      const arc = d3
        .arc()
        .innerRadius(api.R - 26)
        .outerRadius(api.R + 26)
        .cornerRadius(26);
      gB.selectAll("path")
        .data(bands, (d) => team + mode + d.c)
        .join(
          (en) =>
            en
              .append("path")
              .attr("opacity", 0)
              .call((s) =>
                s
                  .transition()
                  .duration(Tm)
                  .delay(Tm * 0.4)
                  .attr("opacity", 1),
              ),
          (up) => up,
          (ex) =>
            ex
              .transition()
              .duration(Tm * 0.4)
              .attr("opacity", 0)
              .remove(),
        )
        .attr("d", (d) => arc({ startAngle: d.s, endAngle: d.e }))
        .attr("fill", (d) => mix(bg, color, (d.gi % 2 ? 0.07 : 0.14) * (opts.dark ? 2 : 1)));

      const geo = (p) => (p.ego ? spoke(pos[p.a], pos[p.b]) : chord(pos[p.a], pos[p.b]));
      const sw = (p) => (opts.thin ? 0.8 : 1.2) + (opts.thin ? 11 : 15) * Math.pow(p.w / wmax, 1.25);
      const sc = (p) => {
        const r = Math.sqrt(p.w / wmax);
        return r > 0.7 ? color : mix(base, color, 0.15 + r * 0.8);
      };
      const so = (p) => (ego ? 0.6 + 0.4 * Math.sqrt(p.w / wmax) : 0.35 + 0.65 * Math.sqrt(p.w / wmax));
      gE.selectAll("path.edge")
        .data(pairs, (d) => d.key)
        .join(
          (en) =>
            en
              .append("path")
              .attr("class", "edge")
              .attr("d", geo)
              .attr("stroke-width", sw)
              .attr("stroke", sc)
              .attr("opacity", 0)
              .each(function () {
                const L = this.getTotalLength();
                d3.select(this).attr("stroke-dasharray", `${L} ${L}`).attr("stroke-dashoffset", L);
              })
              .call((s) =>
                s
                  .transition()
                  .duration(Tm * 1.3)
                  .delay((d, i) => (Tm ? 150 + i * (500 / Math.max(pairs.length, 1)) : 0))
                  .ease(d3.easeCubicOut)
                  .attr("opacity", so)
                  .attr("stroke-dashoffset", 0)
                  .on("end", function () {
                    d3.select(this).attr("stroke-dasharray", null).attr("stroke-dashoffset", null);
                  }),
              ),
          (up) =>
            up
              .attr("stroke-dasharray", null)
              .attr("stroke-dashoffset", null)
              .call((s) =>
                s
                  .transition()
                  .duration(Tm)
                  .attr("d", geo)
                  .attr("stroke-width", sw)
                  .attr("stroke", sc)
                  .attr("opacity", so),
              ),
          (ex) =>
            ex
              .transition()
              .duration(Tm * 0.45)
              .attr("opacity", 0)
              .remove(),
        )
        .order();

      if (opts.interactive) {
        gH.selectAll("path.hit")
          .data(pairs, (d) => d.key)
          .join("path")
          .attr("class", "hit")
          .attr("d", geo)
          .attr("stroke-width", (p) => Math.max(18, sw(p) + 12))
          .on("mouseenter", (ev, p) => {
            hoverPair(p);
            showTip(ev, pairTip(p));
          })
          .on("mousemove", moveTip)
          .on("mouseleave", () => {
            applySel();
            hideTip();
          })
          .on("click", (ev, p) => {
            ev.stopPropagation();
            hideTip();
            openPair(p.a, p.b);
          });
      }

      const nr = (n) => 8 + 18 * Math.sqrt(inv(n) / imax);
      const showLabel = (n) =>
        opts.labels === "all" ||
        (opts.labels === "top" && inv(n) >= [...m.nodes].map(inv).sort((a, b) => b - a)[5]);
      const lp = (n) => {
        const p = pos[n.id];
        if (ego && n.id === ego) return { x: 0, y: 26 + 20 * k, a: "middle" };
        const d = Math.hypot(p.x, p.y) || 1,
          ux = p.x / d,
          uy = p.y / d,
          off = nr(n) + 12;
        return {
          x: ux * off,
          y: uy * off + (uy < -0.3 ? -2 : 5 * k),
          a: ux > 0.1 ? "start" : ux < -0.1 ? "end" : "middle",
        };
      };
      const nodes = gN
        .selectAll("g.node")
        .data(m.nodes, (d) => d.id)
        .join(
          (en) => {
            const g = en
              .append("g")
              .attr("class", "node")
              .attr("transform", (d) => `translate(${pos[d.id].x},${pos[d.id].y}) scale(.01)`);
            if (opts.interactive) g.attr("tabindex", 0).attr("role", "button");
            g.append("circle");
            g.append("text");
            g.transition()
              .duration(Tm)
              .delay((d, i) => (Tm ? 80 + i * 28 : 0))
              .ease(d3.easeBackOut.overshoot(1.4))
              .attr("transform", (d) => `translate(${pos[d.id].x},${pos[d.id].y}) scale(1)`);
            return g;
          },
          (up) =>
            up.call((s) =>
              s
                .transition()
                .duration(Tm)
                .attr("transform", (d) => `translate(${pos[d.id].x},${pos[d.id].y}) scale(1)`),
            ),
          (ex) =>
            ex
              .transition()
              .duration(Tm * 0.4)
              .attr("opacity", 0)
              .remove(),
        );
      nodes
        .select("circle")
        .transition()
        .duration(Tm)
        .attr("r", (d) => (ego && d.id === ego ? 26 : nr(d)))
        .attr("fill", (d) =>
          ego ? (d.id === ego ? ink : weights[d.id] ? color : base) : inv(d) === imax ? ink : color,
        )
        .attr("stroke-width", 3.5);
      nodes
        .select("text")
        .text((d) =>
          showLabel(d) || ego ? shortName(d.id) + (ego && weights[d.id] ? "  " + fv(weights[d.id]) : "") : "",
        )
        .attr("font-size", api.fs * k)
        .transition()
        .duration(Tm)
        .attr("x", (d) => lp(d).x)
        .attr("y", (d) => lp(d).y)
        .attr("text-anchor", (d) => lp(d).a)
        .attr("opacity", (d) => (ego && d.id !== ego && !weights[d.id] ? 0.35 : 1));
      if (opts.interactive) {
        nodes
          .attr("aria-label", (d) => `${d.id}: ${fv(d.made)} ${MODES[mode].unit} made`)
          .on("mouseenter", (ev, d) => {
            hoverNode(d.id);
            showTip(ev, nodeTip(d));
          })
          .on("mousemove", moveTip)
          .on("mouseleave", () => {
            applySel();
            hideTip();
          })
          .on("click", (ev, d) => {
            ev.stopPropagation();
            hideTip();
            selectPlayer(d.id);
          })
          .on("keydown", (ev, d) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              selectPlayer(d.id);
            }
          });
      }
      return { pos, pairs };
    };
    return api;
  }

  let NET, HERO;

  // ==================== 6. Stage hover, selection and tooltip ====================

  function setHot(test, set, dir) {
    NET.svg.classed("dimming", true);
    NET.svg
      .selectAll("path.edge")
      .classed("hot", test)
      .classed("flow", test)
      .classed("rev", (d) => test(d) && dir(d) < 0);
    NET.svg.selectAll("g.node").classed("hot", (d) => set.has(d.id));
  }
  function hoverNode(id) {
    if (S.ego) return;
    const set = new Set([id]);
    setHot(
      (d) => (d.a === id || d.b === id) && (set.add(d.a), set.add(d.b), true),
      set,
      (d) => (d.a === id ? (d.ab >= d.ba ? 1 : -1) : d.ba >= d.ab ? -1 : 1),
    );
  }
  function hoverPair(p) {
    if (S.ego) return;
    setHot(
      (d) => d.key === p.key,
      new Set([p.a, p.b]),
      (d) => (d.ab >= d.ba ? 1 : -1),
    );
  }
  function applySel() {
    const svg = NET.svg;
    svg.classed("dimming", false);
    svg.selectAll("path.edge").classed("hot", false).classed("flow", false).classed("rev", false);
    svg.selectAll("g.node").classed("hot", false);
    if (S.ego) {
      svg
        .selectAll("path.edge")
        .classed("flow", true)
        .classed("rev", S.egoDir === "in");
      return;
    }
    if (S.sel?.type === "player") hoverNode(S.sel.id);
    if (S.sel?.type === "pair") {
      const p = pairsFor(M()).find((p) => p.key === [S.sel.a, S.sel.b].sort().join("|"));
      if (p) hoverPair(p);
    }
  }

  // ---------- tooltip

  const tipEl = () => $("#tip");
  function showTip(ev, html) {
    tipEl().innerHTML = html;
    tipEl().classList.add("on");
    moveTip(ev);
  }
  function moveTip(ev) {
    const box = $("#stage").getBoundingClientRect(),
      t = tipEl();
    let x = ev.clientX - box.left + 16,
      y = ev.clientY - box.top + 16;
    if (x + t.offsetWidth > box.width) x = ev.clientX - box.left - t.offsetWidth - 16;
    if (y + t.offsetHeight > box.height) y = ev.clientY - box.top - t.offsetHeight - 16;
    t.style.left = Math.max(0, x) + "px";
    t.style.top = Math.max(0, y) + "px";
  }
  function hideTip() {
    tipEl().classList.remove("on");
  }
  const posName = { GK: "Goalkeeper", DF: "Defender", MF: "Midfielder", W: "Winger", FW: "Forward" };
  function nodeTip(d) {
    return `<b>${esc(d.id)}</b><br><span class="s">${esc(posName[d.pos] || "")}</span><br>${fv(d.made)} ${MODES[S.mode].unit} made · ${fv(d.recv)} received<br><span class="s">Hub ${f3(d.hub)} · Authority ${f3(d.auth)}</span>`;
  }
  function pairTip(p) {
    if (p.ego) {
      const [a, b] = S.egoDir === "out" ? [S.ego, p.b] : [p.b, S.ego];
      return `<b>${esc(shortName(a))} → ${esc(shortName(b))}</b><br>${fv(p.w)} ${MODES[S.mode].unit}`;
    }
    return `<b>${esc(shortName(p.a))} & ${esc(shortName(p.b))}</b><br>${esc(shortName(p.a))} → ${esc(shortName(p.b))}: ${fv(p.ab)}<br>${esc(shortName(p.b))} → ${esc(shortName(p.a))}: ${fv(p.ba)}<br><span class="s">Tap to see the plays</span>`;
  }

  // ==================== 7. Club info column ====================

  function fillBars(root) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => $$(".fl", root).forEach((el) => (el.style.width = el.dataset.w))),
    );
  }
  function countUp(root) {
    $$("[data-count]", root).forEach((el) => {
      const to = +el.dataset.count,
        dec = +el.dataset.dec || 0,
        t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / 700),
          e = 1 - Math.pow(1 - t, 3);
        el.textContent = (to * e).toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, dec ? "" : ",");
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function infoTeam() {
    const t = T(S.team),
      m = M(),
      u = MODES[S.mode].unit,
      style = S.mode === "kp" ? styleOf(S.team) : "";
    const hubMax = m.hubs[0]?.[1] || 1,
      authMax = m.auths[0]?.[1] || 1;
    const pairs = pairsFor(m)
      .sort((a, b) => b.w - a.w)
      .slice(0, 5);
    const cls = d3.groups(m.nodes, (n) => n.c).sort((a, b) => a[0] - b[0]);
    const color = tcol(S.team),
      tile = cssVar("--tile");
    return `
    <div class="teamHd"><div class="ic solid">${crest(S.team, "i", "fill")}</div><div><h3>${esc(t.name)}</h3><div class="sub">${MODES[S.mode].short} · 2025–26</div></div></div>
    <div class="kpis">
      <div class="kpi"><b class="num" data-count="${m.entropy}" data-dec="3">0</b><span>Entropy<br>${rankOf(S.team)} of 20</span></div>
      <div class="kpi"><b class="num" data-count="${m.total}" data-dec="${S.mode === "xg" ? 1 : 0}">0</b><span>${u}</span></div>
      <div class="kpi"><b class="num" data-count="${m.nodes.length}">0</b><span>players<br>shown</span></div>
    </div>
    ${style ? `<span class="tag">${esc(style)}</span>` : ""}
    <div class="blk"><h4>Creators</h4><p class="note">Hub score. Who feeds the main chance-takers.</p>
      <div class="bars">${m.hubs.map(([p, v, s]) => `<button class="bar" data-player="${esc(p)}"><span class="nm">${esc(shortName(p))}<small>${pct(s)} of team ${u}</small></span><span class="tr"><span class="fl" data-w="${((v / hubMax) * 100).toFixed(1)}%"></span></span><span class="v">${f3(v)}</span></button>`).join("")}</div></div>
    <div class="blk"><h4>Finishers</h4><p class="note">Authority score. Who the best creators look for.</p>
      <div class="bars">${m.auths.map(([p, v, r]) => `<button class="bar" data-player="${esc(p)}"><span class="nm">${esc(shortName(p))}<small>${fv(r)} received</small></span><span class="tr"><span class="fl" data-w="${((v / authMax) * 100).toFixed(1)}%"></span></span><span class="v">${f3(v)}</span></button>`).join("")}</div></div>
    <div class="blk"><h4>Top duos</h4>
      <ul class="rows">${pairs.map((p) => `<li><button data-pair="${esc(p.a)}|${esc(p.b)}"><span class="l">${esc(shortName(p.a))} & ${esc(shortName(p.b))}</span><span class="r">${fv(p.w)}</span><span class="chev">›</span></button></li>`).join("")}</ul></div>
    ${
      cls.length > 1
        ? `<div class="blk"><h4>Clusters</h4><p class="note">Players who combine with each other most. They sit together on the ring.</p>
      <div class="clusters">${cls.map(([c, arr], i) => `<div class="cl" style="--sw:${mix(tile, color, i % 2 ? 0.28 : 0.55)}"><i></i><span><b>Group ${"ABCDE"[i]}</b> · ${arr.map((n) => esc(shortName(n.id))).join(", ")}</span></div>`).join("")}</div></div>`
        : ""
    }`;
  }

  function infoPlayer(id) {
    const m = M(),
      n = m.nodes.find((x) => x.id === id),
      u = MODES[S.mode].unit;
    if (!n) return infoTeam();
    const out = m.edges.filter((e) => e[0] === id).sort((a, b) => b[2] - a[2]);
    const inn = m.edges.filter((e) => e[1] === id).sort((a, b) => b[2] - a[2]);
    const list = (arr, idx) =>
      arr.length
        ? arr
            .map(
              (e) =>
                `<li><button data-pair="${esc(e[0])}|${esc(e[1])}"><span class="l">${esc(shortName(e[idx]))}</span><span class="r">${fv(e[2])}</span><span class="chev">›</span></button></li>`,
            )
            .join("")
        : `<li class="empty">No links with the players shown.</li>`;
    return `
    <button class="backLink" data-back="1">‹ ${esc(T(S.team).name)}</button>
    <div class="teamHd"><div class="ic solid">${crest(S.team, "p", "fill")}</div><div><h3>${esc(id)}</h3><div class="sub">${esc(posName[n.pos] || "Player")} · ${esc(T(S.team).name)}</div></div></div>
    <div class="kpis">
      <div class="kpi"><b class="num" data-count="${n.made}" data-dec="${S.mode === "xg" ? 1 : 0}">0</b><span>${u} made</span></div>
      <div class="kpi"><b class="num" data-count="${n.recv}" data-dec="${S.mode === "xg" ? 1 : 0}">0</b><span>received</span></div>
      <div class="kpi"><b class="num">${pct(n.share)}</b><span>of the team’s</span></div>
      <div class="kpi"><b class="num">${f3(n.hub)}</b><span>hub score</span></div>
      <div class="kpi"><b class="num">${f3(n.auth)}</b><span>authority</span></div>
    </div>
    <div class="vtog" role="group" aria-label="Network view"><button data-view="team" aria-pressed="${S.ego !== id}">Whole team</button><button data-view="focus" data-id="${esc(id)}" aria-pressed="${S.ego === id}">Only ${esc(shortName(id))}’s links</button></div>
    <div class="blk"><h4>He set up</h4><ul class="rows">${list(out, 1)}</ul></div>
    <div class="blk"><h4>Set up by</h4><ul class="rows">${list(inn, 0)}</ul></div>`;
  }

  function renderInfo() {
    const el = $("#info");
    el.style.setProperty("--tc", tcol(S.team));
    el.innerHTML = `<div style="animation:rise .45s cubic-bezier(.2,.8,.2,1) both">${S.sel?.type === "player" ? infoPlayer(S.sel.id) : infoTeam()}</div>`;
    el.scrollTop = 0;
    fillBars(el);
    countUp(el);
  }
  $("#info").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.player) selectPlayer(b.dataset.player);
    else if (b.dataset.pair) {
      const [a, c] = b.dataset.pair.split("|");
      openPair(a, c);
    } else if (b.dataset.view === "focus") {
      if (S.ego !== b.dataset.id) toggleEgo(b.dataset.id);
    } else if (b.dataset.view === "team") {
      if (S.ego) {
        S.ego = null;
        renderStage(true, true);
        renderInfo();
      }
    } else if (b.dataset.back) {
      S.sel = null;
      S.ego = null;
      renderStage(true);
    }
  });

  // ==================== 8. Duo sheet: every chance between two players ====================

  function pitch(p, color) {
    // Understat: X = 0..1 toward the goal being attacked, Y = 0..1 across. Half pitch, goal at top.
    const X = p[6] / 1000,
      Y = p[7] / 1000,
      goal = p[4] === 0;
    const px = Y * 80,
      py = Math.max(1, Math.min(59, (1 - X) * 120));
    const c = goal ? color : cssVar("--text-3");
    const r = 2.2 + Math.sqrt(p[5]) * 5;
    return `<svg viewBox="0 0 80 60" aria-hidden="true"><rect width="80" height="60" fill="var(--track)"/>
    <g fill="none" stroke="var(--text-3)" stroke-opacity=".55" stroke-width="1"><rect x="18" y="0" width="44" height="18"/><rect x="30" y="0" width="20" height="6"/><path d="M0 60 H80"/><path d="M32 18 A10 10 0 0 0 48 18"/></g>
    <rect x="36" y="0" width="8" height="1.6" fill="var(--text-2)"/>
    <line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="40" y2="0.8" stroke="${c}" stroke-width="${goal ? 1.6 : 1}" stroke-dasharray="${goal ? "0" : "2 2"}" opacity=".9"/>
    <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r.toFixed(1)}" fill="${c}" stroke="var(--tile)" stroke-width="1"/></svg>`;
  }
  const VERBS = new Set([
    "Cross",
    "Through ball",
    "Chipped ball",
    "Headed pass",
    "Lay-off",
    "Header",
    "Dribble",
    "Corner",
    "Free kick",
  ]);
  function openPair(a, b) {
    S.sel = { type: "pair", a, b };
    S.pf = "all";
    renderSheet();
    applySel();
    $("#sheet").classList.add("on");
    $("#scrim").classList.add("on");
    setTimeout(() => $("#sheet .closeBtn")?.focus(), 350);
  }
  function closeSheet() {
    $("#sheet").classList.remove("on");
    $("#scrim").classList.remove("on");
    if (S.sel?.type === "pair") {
      S.sel = null;
      applySel();
    }
  }
  function renderSheet() {
    const { a, b } = S.sel,
      m = M(),
      team = S.team,
      color = tcol(team),
      L = S.data.labels,
      u = MODES[S.mode].unit;
    const ab = (m.edges.find((e) => e[0] === a && e[1] === b) || [, , 0])[2];
    const ba = (m.edges.find((e) => e[0] === b && e[1] === a) || [, , 0])[2];
    let plays = T(team).plays.filter((p) => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
    if (S.mode === "ga") plays = plays.filter((p) => p[4] === 0);
    const goals = plays.filter((p) => p[4] === 0).length,
      xg = d3.sum(plays, (p) => p[5]);
    const f = S.pf;
    const shown = plays
      .filter(
        (p) =>
          f === "all" ||
          (f === "goals" && p[4] === 0) ||
          (f === "ab" && p[0] === a) ||
          (f === "ba" && p[0] === b),
      )
      .sort((p, q) => p[2] - q[2] || p[3] - q[3]);
    let body = "",
      last = -1;
    for (const p of shown) {
      if (p[2] !== last) {
        last = p[2];
        const mt = S.data.matches[p[2]],
          home = mt.h === team,
          opp = home ? mt.a : mt.h;
        const date = new Date(mt.d + "T12:00").toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
        });
        body += `<div class="mHd"><span>${home ? "vs" : "at"} <b>${esc(T(opp)?.name || opp)}</b> · ${mt.hs}–${mt.as}</span><span>${date}</span></div>`;
      }
      const goal = p[4] === 0,
        verb = VERBS.has(p[10]) ? esc(p[10].toLowerCase()) + " to" : "to";
      body += `<div class="play">${pitch(p, color)}<div><div class="t">${goal ? `<span class="goalPill">GOAL</span>` : ""}<b>${esc(shortName(p[0]))}</b> ${verb} <b>${esc(shortName(p[1]))}</b></div>
      <div class="m">${p[3]}′ · ${esc(L.res[p[4]] || "Shot")} · xG ${p[5].toFixed(2)} · ${esc(L.sit[p[8]] || "")}</div></div></div>`;
    }
    const sheet = $("#sheet");
    sheet.style.setProperty("--tc", color);
    sheet.innerHTML = `
    <div class="sheetHd">
      <div class="top"><div style="display:flex;align-items:center;gap:10px"><div class="solid" style="width:28px;height:28px">${crest(team, "s", "fill")}</div><span style="font-size:13.5px;color:var(--text-2);font-weight:500">${esc(T(team).name)}</span></div>
        <button class="closeBtn" aria-label="Close">×</button></div>
      <h3>${esc(shortName(a))} & ${esc(shortName(b))}</h3>
      <div class="dirs"><div class="dir"><b class="num">${fv(ab)}</b><span>${esc(shortName(a))} → ${esc(shortName(b))}</span></div><div class="dir"><b class="num">${fv(ba)}</b><span>${esc(shortName(b))} → ${esc(shortName(a))}</span></div></div>
      <p class="sumLine">${plays.length} chance${plays.length === 1 ? "" : "s"} · ${goals} goal${goals === 1 ? "" : "s"} · ${xg.toFixed(2)} xG${S.mode === "xg" ? "" : ` · counted in ${u}`}</p>
      <div class="filters" role="group" aria-label="Filter">${[
        ["all", "All"],
        ["goals", "Goals"],
        ["ab", shortName(a) + " →"],
        ["ba", shortName(b) + " →"],
      ]
        .map(([k, l]) => `<button data-pf="${k}" aria-pressed="${f === k}">${esc(l)}</button>`)
        .join("")}</div>
    </div>
    <div class="sheetBody">${body || `<p class="empty">No chances match this filter.</p>`}</div>`;
  }
  $("#sheet").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.classList.contains("closeBtn")) closeSheet();
    else if (b.dataset.pf) {
      S.pf = b.dataset.pf;
      renderSheet();
    }
  });
  $("#scrim").addEventListener("click", closeSheet);

  // ==================== 9. Club selection ====================

  function selectPlayer(id) {
    if (!M().nodes.some((n) => n.id === id)) return;
    if (S.ego && S.ego !== id) S.ego = id;
    S.sel = { type: "player", id };
    renderInfo();
    if (S.ego) renderStage(true, true);
    else applySel();
  }
  function toggleEgo(id) {
    S.ego = S.ego === id ? null : id;
    S.sel = { type: "player", id };
    renderStage(true);
  }
  function renderStage(animate = true, keepInfo = false) {
    $("#egoBar").hidden = !S.ego;
    $("#hint").hidden = !!S.ego;
    NET.render(S.team, S.mode, animate, S.ego, S.egoDir);
    applySel();
    if (!keepInfo) renderInfo();
    if (S.ego) requestAnimationFrame(() => moveThumb($("#dirSeg")));
  }
  function openTeam(team, opts = {}) {
    const changed = S.team !== team;
    S.team = team;
    if (changed) {
      S.sel = null;
      S.ego = null;
      NET.clear();
    }
    if (opts.player) S.sel = { type: "player", id: opts.player };
    renderPicker();
    renderStage(true);
    try {
      history.replaceState(null, "", "#" + T(team).code.toLowerCase());
    } catch (e) {
      /* sandboxed */
    }
    if (opts.scroll) $("#stageCard").scrollIntoView({ behavior: "smooth", block: "start" });
    if (opts.pair) setTimeout(() => openPair(opts.pair[0], opts.pair[1]), 500);
  }
  function renderPicker() {
    $$("#cMinis .mini").forEach((b) => b.setAttribute("aria-pressed", b.dataset.team === S.team));
  }

  // ==================== 10. Hero ====================

  function heroShow(i, animate = true) {
    const list = teams();
    S.hero.i = (i + list.length) % list.length;
    const team = list[S.hero.i],
      t = T(team);
    HERO.clear();
    HERO.render(team, S.mode, animate);
    $("#heroName").textContent = t.name;
    $("#heroSub").textContent = MODES[S.mode].short;
    const hc = $("#heroCrest"),
      logo = LOGOS[t.code];
    hc.innerHTML = logo
      ? `<img src="${logo}" alt="">`
      : `<div class="solid" style="width:100%;height:100%">${withDark(() => crest(team, "h", "fill"))}</div>`;
    if (animate) {
      hc.classList.remove("pop");
      void hc.offsetWidth;
      hc.classList.add("pop");
    }
    heroHud(team, animate);
    document.querySelector(".hero").style.setProperty(
      "--hero-c",
      withDark(() => tcol(team)),
    );
    document.documentElement.style.setProperty(
      "--live-c",
      withDark(() => tcol(team)),
    );
    S.hero.t0 = performance.now();
  }

  // Corner readouts: the analysis behind the network on screen
  function heroHud(team, animate) {
    const m = M(team),
      ent = S.data.league[S.mode].entropy,
      rank = ent.findIndex((r) => r[0] === team) + 1;
    const hub = m.hubs[0],
      comms = new Set(m.nodes.map((n) => n.c)).size;
    $("#hEnt").textContent = m.entropy.toFixed(3);
    $("#hEntR").textContent = `#${rank} of ${ent.length} most shared`;
    $("#hSty").textContent = styleOf(team) || "—";
    $("#hCom").textContent = comms;
    $("#hHub").textContent = hub ? shortName(hub[0]) : "—";
    $("#hHubV").textContent = hub
      ? `hub ${f3(hub[1])} · ${Math.round(hub[2] * 100)}% of ${MODES[S.mode].unit}`
      : "";
    $("#heroFig").innerHTML = `<b>Figure 1.</b> ${MODES[S.mode].short}, ${esc(T(team).name)}`;
    const h = $("#hud");
    if (animate) {
      h.classList.remove("swap");
      void h.offsetWidth;
      h.classList.add("swap");
    }
    if (S.termEl) showTerm(S.termEl);
  }
  function heroTick(now) {
    if (S.hero.playing) {
      const p = Math.min(1, (now - S.hero.t0) / 5200);
      $("#heroProg").style.width = p * 100 + "%";
      if (p >= 1) heroShow(S.hero.i + 1);
    }
    requestAnimationFrame(heroTick);
  }
  function heroPlay(on) {
    S.hero.playing = on;
    $("#heroPlay").setAttribute("aria-label", on ? "Pause rotation" : "Play rotation");
    $("#heroPlayIc").innerHTML = on
      ? `<rect x="2" y="1.5" width="2.2" height="7" rx=".5"/><rect x="5.8" y="1.5" width="2.2" height="7" rx=".5"/>`
      : `<path d="M2.5 1.2 L8.8 5 L2.5 8.8Z"/>`;
    if (on) S.hero.t0 = performance.now() - ((parseFloat($("#heroProg").style.width) || 0) / 100) * 5200;
  }

  // ==================== 11. Analysis term cards ====================

  // Plain-English definitions for the analysis terms, each with live values for the club in the hero
  const TERMS = {
    hits: {
      k: "Who creates, who finishes",
      t: "Weighted HITS",
      d: "Scores each player twice from the passing network. Hub: how much you feed the team's main shooters. Authority: how much the best creators look for you.",
      v: (team, m) => {
        const a = [...m.nodes].sort((x, y) => y.auth - x.auth)[0];
        return [
          ["Top hub", m.hubs[0] ? `${shortName(m.hubs[0][0])} · ${f3(m.hubs[0][1])}` : "—"],
          ["Top authority", a ? `${shortName(a.id)} · ${f3(a.auth)}` : "—"],
        ];
      },
    },
    entropy: {
      k: "How shared the chances are",
      t: "Assist entropy",
      d: "How evenly a club spreads its chances across passer-to-shooter pairs, from 0 to 1. Close to 1 means lots of players combine. Lower means a few duos carry the attack.",
      v: (team, m) => {
        const e = S.data.league[S.mode].entropy,
          r = e.findIndex((x) => x[0] === team) + 1;
        return [
          ["Entropy", m.entropy.toFixed(3)],
          ["Rank", `${r} of ${e.length}, most shared first`],
        ];
      },
    },
    louvain: {
      k: "Units inside the team",
      t: "Louvain communities",
      d: "Groups of players who combine with each other more than with the rest of the side, found by optimising network modularity. Think of them as the team's attacking units.",
      v: (team, m) => {
        const g = d3
          .groups(m.nodes, (n) => n.c)
          .sort((a, b) => d3.sum(b[1], (n) => n.made + n.recv) - d3.sum(a[1], (n) => n.made + n.recv));
        return [
          ["Groups", g.length],
          [
            "Main unit",
            g[0]
              ? g[0][1]
                  .slice(0, 3)
                  .map((n) => shortName(n.id))
                  .join(", ")
              : "—",
          ],
        ];
      },
    },
    kmeans: {
      k: "Clubs that play alike",
      t: "K-means styles",
      d: "Clubs clustered on five features: entropy, top hub and authority scores, top-duo share and top-3 creator share. Clubs in the same style build chances the same way.",
      v: (team) => {
        const st = styleOf(team),
          same = S.data.league.kp.styles.filter((r) => r[1] === st && r[0] !== team).map((r) => T(r[0]).code);
        return [
          ["Style", st || "—"],
          ["Same style", same.length ? same.slice(0, 5).join(", ") + (same.length > 5 ? "…" : "") : "None"],
        ];
      },
    },
  };
  function showTerm(el) {
    const key = el.dataset.term,
      def = TERMS[key],
      box = $("#term"),
      team = teams()[S.hero.i],
      m = M(team);
    box.innerHTML = `<p class="tk">${def.k}</p><p class="tt">${def.t}</p><p class="td">${def.d}</p>
    <div class="tv"><div><span>Club</span><b>${esc(T(team).name)}</b></div>${def
      .v(team, m)
      .map(([l, v]) => `<div><span>${l}</span><b>${esc(String(v))}</b></div>`)
      .join("")}</div>`;
    box.hidden = false;
    const r = el.getBoundingClientRect(),
      w = box.offsetWidth,
      h = box.offsetHeight;
    let x = r.left + r.width / 2 - w / 2,
      y = r.bottom + 10;
    x = Math.max(12, Math.min(x, innerWidth - w - 12));
    if (y + h > innerHeight - 12) y = r.top - h - 10;
    box.style.left = x + scrollX + "px";
    box.style.top = y + scrollY + "px";
    $$("[data-term]").forEach((t) => t.setAttribute("aria-expanded", t === el));
    S.termEl = el;
    void box.offsetWidth;
    box.classList.add("on");
  }
  function hideTerm() {
    const box = $("#term");
    box.classList.remove("on");
    S.termEl = null;
    $$("[data-term]").forEach((t) => t.setAttribute("aria-expanded", "false"));
    setTimeout(() => {
      if (!S.termEl) box.hidden = true;
    }, 160);
  }
  function bindTerms() {
    $$("[data-term]").forEach((el) => {
      el.addEventListener("mouseenter", () => showTerm(el));
      el.addEventListener("mouseleave", hideTerm);
      el.addEventListener("focus", () => showTerm(el));
      el.addEventListener("blur", hideTerm);
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        S.termEl === el ? hideTerm() : showTerm(el);
      });
    });
    document.addEventListener(
      "scroll",
      () => {
        if (S.termEl) hideTerm();
      },
      { passive: true },
    );
  }

  // ==================== 12. Club grid ====================

  const STY_PAL = () =>
    DARK ? ["#ff9f0a", "#64d2ff", "#30d158", "#bf5af2"] : ["#d97706", "#0a7fd9", "#1f9d47", "#9b45d0"];
  function styleNames() {
    const rows = S.data.league.kp.styles,
      n = (s) => rows.filter((r) => r[1] === s).length;
    return [...new Set(rows.map((r) => r[1]))].sort((a, b) => n(b) - n(a));
  }
  const styleCol = (st) => STY_PAL()[styleNames().indexOf(st) % 4];
  const clubName = (t) =>
    T(t).name.replace(" & Hove Albion", "").replace("Wolverhampton Wanderers", "Wolves");
  function minis() {
    const el = $("#cMinis"),
      base = cssVar("--track"),
      ink = cssVar("--text"),
      tile = cssVar("--tile");
    el.innerHTML = teams()
      .map((t, ti) => {
        const m = M(t),
          color = tcol(t),
          nodes = m.nodes.slice(0, 12),
          ids = new Set(nodes.map((n) => n.id));
        const { pos } = circleLayout(nodes, 80);
        const pairs = pairsFor({ edges: m.edges.filter((e) => ids.has(e[0]) && ids.has(e[1])) }).sort(
          (a, b) => a.w - b.w,
        );
        const wmax = d3.max(pairs, (p) => p.w) || 1,
          inv = (n) => n.made + n.recv,
          imax = d3.max(nodes, inv) || 1;
        const paths = pairs
          .map((p) => {
            const r = p.w / wmax,
              rv = Math.sqrt(r);
            return `<path class="draw" d="${chord(pos[p.a], pos[p.b])}" fill="none" stroke-linecap="round" stroke="${rv > 0.7 ? color : mix(base, color, 0.15 + rv * 0.8)}" stroke-width="${(0.6 + 4.4 * Math.pow(r, 1.25)).toFixed(2)}" stroke-opacity="${(0.35 + 0.65 * rv).toFixed(2)}" style="--d:${(ti * 0.03 + rv * 0.3).toFixed(2)}s"/>`;
          })
          .join("");
        const dots = nodes
          .map(
            (n) =>
              `<circle cx="${pos[n.id].x.toFixed(1)}" cy="${pos[n.id].y.toFixed(1)}" r="${(2.2 + 5 * Math.sqrt(inv(n) / imax)).toFixed(1)}" fill="${inv(n) === imax ? ink : color}" stroke="${tile}" stroke-width="1.4"/>`,
          )
          .join("");
        const logo = LOGOS[T(t).code];
        const mid =
          `<circle r="40" fill="url(#mg${ti})"/>` +
          (logo
            ? `<image href="${logo}" x="-27" y="-27" width="54" height="54" preserveAspectRatio="xMidYMid meet"/>`
            : `<text y="7" text-anchor="middle" font-size="20" font-weight="800" fill="${color}">${T(t).code}</text>`);
        const grad = `<defs><radialGradient id="mg${ti}"><stop offset="0" stop-color="${tile}" stop-opacity="1"/><stop offset=".7" stop-color="${tile}" stop-opacity=".92"/><stop offset="1" stop-color="${tile}" stop-opacity="0"/></radialGradient></defs>`;
        const st = styleOf(t);
        return `<button class="mini" style="--cc:${color};--sc:${styleCol(st)}" data-team="${esc(t)}" aria-label="${esc(T(t).name)}" aria-pressed="false"><svg viewBox="-100 -100 200 200" aria-hidden="true">${grad}${paths}${mid}${dots}</svg><span class="nm">${esc(clubName(t))}</span><span class="st"><i></i>${esc(st)}</span></button>`;
      })
      .join("");
    $$("path.draw", el).forEach((p) => p.style.setProperty("--len", Math.ceil(p.getTotalLength()) + 1));
    renderPicker();
  }

  $("#cMinis").addEventListener("click", (ev) => {
    const b = ev.target.closest(".mini");
    if (b) openTeam(b.dataset.team, { scroll: true });
  });

  // ==================== 13. Clustering: chance-creation styles ====================

  // Club-level features behind the clustering, recomputed from the key-pass networks for the profile bars
  const FEATS = [
    ["entropy", "Entropy"],
    ["hub", "Top hub"],
    ["auth", "Top authority"],
    ["duo", "Top-duo share"],
    ["top3", "Top-3 share"],
  ];
  function clubFeatures(t) {
    const m = T(t).modes.kp,
      tot = m.total || d3.sum(m.edges, (e) => e[2]),
      made = m.nodes.map((n) => n.made).sort((a, b) => b - a);
    return {
      entropy: m.entropy,
      hub: d3.max(m.nodes, (n) => n.hub),
      auth: d3.max(m.nodes, (n) => n.auth),
      duo: d3.max(m.edges, (e) => e[2]) / tot,
      top3: d3.sum(made.slice(0, 3)) / tot,
    };
  }
  function styles() {
    const rows = S.data.league.kp.styles,
      names = styleNames(),
      col = styleCol;
    const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six"];
    $("#styTitle").textContent = `${words[names.length] || names.length} ways to create a chance.`;
    // feature z-scores and per-style means
    const F = Object.fromEntries(rows.map((r) => [r[0], clubFeatures(r[0])]));
    const Z = {};
    FEATS.forEach(([k]) => {
      const v = rows.map((r) => F[r[0]][k]),
        mu = d3.mean(v),
        sd = d3.deviation(v) || 1;
      rows.forEach((r) => {
        (Z[r[0]] ||= {})[k] = (F[r[0]][k] - mu) / sd;
      });
    });
    const prof = (st) =>
      Object.fromEntries(
        FEATS.map(([k]) => [
          k,
          d3.mean(
            rows.filter((r) => r[1] === st),
            (r) => Z[r[0]][k],
          ),
        ]),
      );
    const fmtz = (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1);
    const desc = (p) => {
      const srt = FEATS.map(([k, l]) => [l.toLowerCase(), p[k]]).sort((a, b) => b[1] - a[1]);
      const hi = srt
          .filter((x) => x[1] > 0.35)
          .slice(0, 2)
          .map((x) => x[0]),
        lo = srt
          .filter((x) => x[1] < -0.35)
          .slice(-2)
          .reverse()
          .map((x) => x[0]);
      return (
        [hi.length ? `High ${hi.join(" and ")}` : "", lo.length ? `low ${lo.join(" and ")}` : ""]
          .filter(Boolean)
          .join(", ")
          .replace(/^l/, "L") + "."
      );
    };
    $("#cStyCards").innerHTML = names
      .map((st) => {
        const p = prof(st),
          mem = rows.filter((r) => r[1] === st).map((r) => r[0]);
        return `<div class="styCard" data-style="${esc(st)}" style="--sc:${col(st)}"><div class="sh"><i></i><b>${esc(st)}</b><span>${mem.length} club${mem.length > 1 ? "s" : ""}</span></div>
      <p>${desc(p)}</p>
      <div class="prof">${FEATS.map(([k, l]) => {
        const v = Math.max(-2, Math.min(2, p[k])),
          w = Math.abs(v) * 25;
        return `<div class="pr"><span>${l}</span><span class="pb"><i style="left:${v < 0 ? 50 - w : 50}%;width:${w}%"></i></span><span class="z">${fmtz(p[k])}</span></div>`;
      }).join("")}</div>
      <div class="mem">${mem.map((t) => `<button data-team="${esc(t)}" title="${esc(T(t).name)}">${LOGOS[T(t).code] ? `<img src="${LOGOS[T(t).code]}" alt="${esc(T(t).name)}">` : `<span>${T(t).code}</span>`}</button>`).join("")}</div></div>`;
      })
      .join("");

    const W = 1200,
      H = 560,
      pad = 70;
    const x = d3
      .scaleLinear()
      .domain(d3.extent(rows, (r) => r[2]))
      .nice()
      .range([pad, W - pad]);
    const y = d3
      .scaleLinear()
      .domain(d3.extent(rows, (r) => r[3]))
      .nice()
      .range([H - pad, pad]);
    const pts = rows.map((r) => ({ r, x: x(r[2]), y: y(r[3]), tx: x(r[2]), ty: y(r[3]) }));
    d3.forceSimulation(pts)
      .force("x", d3.forceX((d) => d.tx).strength(0.5))
      .force("y", d3.forceY((d) => d.ty).strength(0.5))
      .force("c", d3.forceCollide(34))
      .stop()
      .tick(220);
    const box = $("#cSty");
    box.innerHTML = "";
    const svg = d3.select(box).append("svg").attr("viewBox", `0 0 ${W} ${H}`).style("min-width", "640px");
    svg
      .append("line")
      .attr("x1", pad - 20)
      .attr("x2", W - pad + 20)
      .attr("y1", y(0))
      .attr("y2", y(0))
      .attr("stroke", "var(--hair)")
      .attr("stroke-dasharray", "3 5");
    svg
      .append("line")
      .attr("y1", pad - 20)
      .attr("y2", H - pad + 20)
      .attr("x1", x(0))
      .attr("x2", x(0))
      .attr("stroke", "var(--hair)")
      .attr("stroke-dasharray", "3 5");
    svg
      .append("text")
      .attr("class", "axl")
      .attr("x", W - pad + 20)
      .attr("y", y(0) - 8)
      .attr("text-anchor", "end")
      .text("PC 1 →");
    svg
      .append("text")
      .attr("class", "axl")
      .attr("x", x(0) + 8)
      .attr("y", pad - 8)
      .text("↑ PC 2");
    // cluster hulls: pad every point with a ring so single clubs still get a blob
    const line = d3.line().curve(d3.curveCatmullRomClosed.alpha(0.6)),
      labels = [];
    names.forEach((st) => {
      const ps = pts.filter((p) => p.r[1] === st),
        ring = [];
      ps.forEach((p) => {
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          ring.push([p.x + Math.cos(a) * 46, p.y + Math.sin(a) * 46]);
        }
      });
      const hull = d3.polygonHull(ring);
      svg
        .insert("path", ":first-child")
        .attr("class", "hull")
        .attr("data-s", st)
        .attr("d", line(hull))
        .attr("fill", col(st))
        .attr("fill-opacity", DARK ? 0.11 : 0.09)
        .attr("stroke", col(st))
        .attr("stroke-opacity", 0.5)
        .attr("stroke-width", 1.5)
        .attr("opacity", 0)
        .transition()
        .delay(500)
        .duration(800)
        .attr("opacity", 1);
      // label straight above the hull, or below it for clusters in the lower half
      const cx = d3.mean(ps, (p) => p.x),
        cy = d3.mean(ps, (p) => p.y),
        below = cy > d3.mean(pts, (p) => p.y) + 20;
      const edge = below ? d3.max(hull, (h) => h[1]) + 20 : d3.min(hull, (h) => h[1]) - 10;
      labels.push({ st, x: cx, y: Math.max(16, Math.min(H - 8, edge)), n: ps.length });
    });
    const g = svg
      .selectAll("g.pt")
      .data(pts)
      .join("g")
      .attr("class", "pt")
      .attr("data-s", (d) => d.r[1])
      .style("cursor", "pointer")
      .attr("transform", `translate(${W / 2},${H / 2}) scale(.2)`)
      .on("click", (ev, d) => openTeam(d.r[0], { scroll: true }));
    g.transition()
      .duration(1100)
      .delay((d, i) => i * 35)
      .ease(d3.easeBackOut.overshoot(1.3))
      .attr("transform", (d) => `translate(${d.x},${d.y}) scale(1)`);
    g.append("circle")
      .attr("r", 27)
      .attr("fill", "var(--tile)")
      .attr("stroke", (d) => col(d.r[1]))
      .attr("stroke-width", 3);
    g.append("image")
      .attr("x", -19)
      .attr("y", -19)
      .attr("width", 38)
      .attr("height", 38)
      .attr("href", (d) => LOGOS[T(d.r[0]).code] || crestURI(d.r[0]));
    labels.forEach((l) =>
      svg
        .append("text")
        .attr("class", "clab")
        .attr("data-s", l.st)
        .attr("x", l.x)
        .attr("y", l.y)
        .attr("text-anchor", "middle")
        .attr("fill", col(l.st))
        .text(`${l.st} · ${l.n}`)
        .each(function () {
          try {
            const bb = this.getBBox(),
              sh = bb.x < 10 ? 10 - bb.x : bb.x + bb.width > W - 10 ? W - 10 - bb.x - bb.width : 0;
            if (sh) this.setAttribute("x", +this.getAttribute("x") + sh);
          } catch (e) {
            /* not rendered yet */
          }
        }),
    );
    const tip = $("#styTip"),
      wrap = tip.parentElement;
    const focus = (st) => {
      box.classList.toggle("focus", !!st);
      $$("#cSty [data-s]").forEach((e) => e.classList.toggle("on", e.dataset.s === st));
      $$(".styCard").forEach((c) => c.classList.toggle("on", c.dataset.style === st));
    };
    g.on("mouseenter", function (ev, d) {
      const t = d.r[0],
        f = F[t],
        hub = T(t).modes.kp.hubs[0];
      tip.style.setProperty("--sc", col(d.r[1]));
      tip.innerHTML = `<b>${esc(T(t).name)}</b><span class="s">${esc(d.r[1])}</span>
      <div class="r"><span>Entropy</span><span>${f.entropy.toFixed(3)}</span></div><div class="r"><span>Top hub</span><span>${hub ? esc(shortName(hub[0])) : "—"}</span></div>
      <div class="r"><span>Top-duo share</span><span>${Math.round(f.duo * 100)}%</span></div><div class="r"><span>Top-3 creator share</span><span>${Math.round(f.top3 * 100)}%</span></div>`;
      const wr = wrap.getBoundingClientRect(),
        r = this.getBoundingClientRect();
      let lx = r.right - wr.left + 10,
        ly = r.top - wr.top - 10;
      if (lx + 230 > wr.width) lx = r.left - wr.left - 230;
      tip.style.left = lx + "px";
      tip.style.top = Math.max(8, ly) + "px";
      tip.classList.add("on");
      focus(d.r[1]);
    }).on("mouseleave", () => {
      tip.classList.remove("on");
      focus(null);
    });
    $$(".styCard").forEach((c) => {
      c.addEventListener("mouseenter", () => focus(c.dataset.style));
      c.addEventListener("mouseleave", () => focus(null));
    });
  }

  $("#cStyCards").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-team]");
    if (b) openTeam(b.dataset.team, { scroll: true });
  });

  // ==================== 14. League panels ====================

  function renderLeague() {
    const L = S.data.league[S.mode],
      u = MODES[S.mode].unit;
    S.tabL = S.tabL || "ent";
    S.tabR = S.tabR || "find";
    const tabs = (grp, cur, list) =>
      `<div class="ptabs" data-group="${grp}">${list.map(([k, l]) => `<button data-tab="${k}" aria-pressed="${cur === k}">${l}</button>`).join("")}</div>`;
    const pane = (grp, k, cur, html) =>
      `<div class="pane" data-group="${grp}" data-pane="${k}"${cur === k ? "" : " hidden"}>${html}</div>`;
    $("#bento").innerHTML = `
    <div class="panel"><div class="pHd"><p class="k">League rankings</p>${tabs("L", S.tabL, [
      ["ent", "Assist entropy"],
      ["hub", "Top creators"],
      ["auth", "Top finishers"],
    ])}</div>
      ${pane("L", "ent", S.tabL, `<p class="d">How evenly each club shares its ${u} across passer-shooter pairs. Zoomed in, since every club sits near 1.</p><div class="chartBox" id="cEnt"></div>`)}
      ${pane("L", "hub", S.tabL, `<p class="d">Hub score: who feeds the main chance-takers in their team.</p><div class="bars" id="cHub"></div>`)}
      ${pane("L", "auth", S.tabL, `<p class="d">Authority score: who the best creators in their team look for.</p><div class="bars" id="cAuth"></div>`)}
    </div>
    <div class="panel"><div class="pHd"><p class="k">Standouts</p>${tabs("R", S.tabR, [
      ["find", "Headline findings"],
      ["duos", "Top duos"],
    ])}</div>
      ${pane("R", "find", S.tabR, `<ul class="facts" id="facts"></ul>`)}
      ${pane("R", "duos", S.tabR, `<ul class="rows" id="cDuos"></ul>`)}
    </div>`;
    entropyChart(L.entropy);
    const bars = (rows, sel) => {
      const max = rows[0][2];
      $(sel).innerHTML = rows
        .slice(0, 8)
        .map(
          ([t, p, v]) =>
            `<button class="bar lead" style="--tc:${tcol(t)}" data-team="${esc(t)}" data-player="${esc(p)}"><span class="nm"><span class="mi">${crest(t, "b" + sel.slice(2), "tiny")}</span>${esc(shortName(p))}</span><span class="tr"><span class="fl" data-w="${((v / max) * 100).toFixed(1)}%"></span></span><span class="v">${f3(v)}</span></button>`,
        )
        .join("");
    };
    bars(L.hub, "#cHub");
    bars(L.auth, "#cAuth");
    $("#facts").innerHTML = factRows();
    $("#cDuos").innerHTML = L.duos
      .slice(0, 7)
      .map(
        ([t, a, b, w]) =>
          `<li><button data-team="${esc(t)}" data-pair="${esc(a)}|${esc(b)}"><span class="mi">${crest(t, "d", "tiny")}</span><span class="l">${esc(shortName(a))} → ${esc(shortName(b))}</span><span class="r">${fv(w)}</span></button></li>`,
      )
      .join("");
    minis();
    styles();
    fillBars($("#bento"));
  }
  function factRows() {
    const L = S.data.league[S.mode],
      u = MODES[S.mode].unit,
      node = (team, id) => M(team).nodes.find((n) => n.id === id);
    const hub = L.hub[0],
      auth = L.auth[0],
      duo = L.duos[0],
      most = L.entropy[0],
      least = L.entropy[L.entropy.length - 1];
    const rows = [
      [
        "Top creator",
        hub[0],
        esc(shortName(hub[1])),
        `${fv(node(hub[0], hub[1])?.made ?? 0)} ${u}`,
        `data-team="${esc(hub[0])}" data-player="${esc(hub[1])}"`,
      ],
      [
        "Top finisher",
        auth[0],
        esc(shortName(auth[1])),
        `${fv(node(auth[0], auth[1])?.recv ?? 0)} received`,
        `data-team="${esc(auth[0])}" data-player="${esc(auth[1])}"`,
      ],
      [
        "Top duo",
        duo[0],
        `${esc(shortName(duo[1]))} → ${esc(shortName(duo[2]))}`,
        `${fv(duo[3])}`,
        `data-team="${esc(duo[0])}" data-pair="${esc(duo[1])}|${esc(duo[2])}"`,
      ],
      [
        "Most shared",
        most[0],
        esc(T(most[0]).name),
        `entropy ${most[1].toFixed(3)}`,
        `data-team="${esc(most[0])}"`,
      ],
      [
        "Most top-heavy",
        least[0],
        esc(T(least[0]).name),
        `entropy ${least[1].toFixed(3)}`,
        `data-team="${esc(least[0])}"`,
      ],
    ];
    return rows
      .map(
        ([l, team, v, n, attrs]) =>
          `<li><button style="--fc:${tcol(team)}" ${attrs}><span class="fl">${l}</span><span class="fv"><span class="mi">${crest(team, "f" + l.length, "tiny", true)}</span>${v}</span><span class="fn">${n}</span></button></li>`,
      )
      .join("");
  }
  function entropyChart(rows) {
    const W = 1000,
      H = 300,
      m = { t: 24, r: 8, b: 56, l: 42 };
    const lo = Math.floor((d3.min(rows, (r) => r[1]) - 0.008) * 100) / 100,
      hi = Math.ceil((d3.max(rows, (r) => r[1]) + 0.003) * 100) / 100;
    const x = d3
      .scaleBand()
      .domain(rows.map((r) => r[0]))
      .range([m.l, W - m.r])
      .padding(0.32);
    const y = d3
      .scaleLinear()
      .domain([lo, hi])
      .range([H - m.b, m.t]);
    const svg = d3.select("#cEnt").append("svg").attr("viewBox", `0 0 ${W} ${H}`).style("min-width", "620px");
    svg
      .append("g")
      .attr("class", "ax")
      .attr("transform", `translate(${m.l},0)`)
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickFormat(d3.format(".2f"))
          .tickSize(-(W - m.l - m.r)),
      )
      .call((g) => g.selectAll(".tick text").attr("x", -8));
    const g = svg
      .append("g")
      .selectAll("g")
      .data(rows)
      .join("g")
      .style("cursor", "pointer")
      .on("click", (ev, d) => openTeam(d[0], { scroll: true }));
    g.append("rect")
      .attr("x", (d) => x(d[0]))
      .attr("width", x.bandwidth())
      .attr("y", H - m.b)
      .attr("height", 0)
      .attr("rx", 5)
      .attr("fill", (d) => tcol(d[0]))
      .transition()
      .duration(1000)
      .delay((d, i) => i * 40)
      .ease(d3.easeCubicOut)
      .attr("y", (d) => y(d[1]))
      .attr("height", (d) => H - m.b - y(d[1]));
    g.append("text")
      .attr("x", (d) => x(d[0]) + x.bandwidth() / 2)
      .attr("y", (d) => y(d[1]) - 8)
      .attr("text-anchor", "middle")
      .attr("font-size", 11.5)
      .attr("fill", "var(--text-2)")
      .attr("font-family", "var(--sans)")
      .text((d) => d[1].toFixed(3).slice(1))
      .attr("opacity", 0)
      .transition()
      .delay((d, i) => 600 + i * 40)
      .attr("opacity", 1);
    const s = Math.min(30, x.bandwidth());
    g.append("image")
      .attr("x", (d) => x(d[0]) + x.bandwidth() / 2 - s / 2)
      .attr("y", H - m.b + 12)
      .attr("width", s)
      .attr("height", s)
      .attr("href", (d) => crestURI(d[0]));
    g.on("mouseenter", function (ev, d) {
      d3.select(this).select("image").attr("href", crestURI(d[0], "fill"));
    }).on("mouseleave", function (ev, d) {
      d3.select(this).select("image").attr("href", crestURI(d[0]));
    });
    g.append("title").text((d) => `${T(d[0]).name}: ${d[1].toFixed(3)}`);
  }

  $("#bento").addEventListener("click", (ev) => {
    const tb = ev.target.closest(".ptabs button");
    if (tb) {
      const grp = tb.parentElement.dataset.group,
        k = tb.dataset.tab;
      S["tab" + grp] = k;
      $$(`.ptabs[data-group="${grp}"] button`).forEach((x) => x.setAttribute("aria-pressed", x === tb));
      $$(`.pane[data-group="${grp}"]`).forEach((p) => (p.hidden = p.dataset.pane !== k));
      return;
    }
    const b = ev.target.closest("button[data-team]");
    if (!b) return;
    if (b.dataset.pair) openTeam(b.dataset.team, { scroll: true, pair: b.dataset.pair.split("|") });
    else openTeam(b.dataset.team, { scroll: true, player: b.dataset.player });
  });

  // ==================== 15. Mode switch and re-render ====================

  function moveThumb(seg) {
    const on = seg.querySelector('button[aria-pressed="true"]'),
      th = seg.querySelector(".thumb");
    if (!on || !th) return;
    th.style.left = on.offsetLeft + "px";
    th.style.width = on.offsetWidth + "px";
  }
  function setMode(mode) {
    S.mode = mode;
    $$("#modeSeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === mode));
    moveThumb($("#modeSeg"));
    if (S.sel?.type === "player" && !M().nodes.some((n) => n.id === S.sel.id)) S.sel = null;
    if (S.ego && !M().nodes.some((n) => n.id === S.ego)) S.ego = null;
    closeSheet();
    renderStage(true);
    renderLeague();
    heroShow(S.hero.i, true);
    renderStats();
  }

  function renderStats() {
    const all = Object.values(S.data.teams),
      L = S.data.league[S.mode],
      u = MODES[S.mode].unit;
    const shots = d3.sum(all, (t) => t.plays.length);
    const goals = d3.sum(all, (t) => t.plays.filter((p) => p[4] === 0).length);
    const node = (team, id) => M(team).nodes.find((n) => n.id === id);
    $("#kick").textContent = `${S.plShown ? "" : "Premier League · "}2025–26 · ${MODES[S.mode].label}`;
    $("#lede").innerHTML =
      `${MODES[S.mode].lede} All 380 matches, every link between teammates. Tap the network to open the club.`;
  }

  function rerender() {
    DARK = isDark();
    renderStage(false);
    renderLeague();
    heroShow(S.hero.i, false);
    renderStats();
  }

  // ==================== 16. Boot ====================

  async function boot() {
    try {
      S.data = await (await fetch("data.json", { cache: "no-cache" })).json();
    } catch (e) {
      $("#lede").textContent = "The match data didn’t load. Refresh the page to try again.";
      return;
    }
    DARK = isDark();
    NET = makeNet($("#net"), { interactive: true, labels: "all", bands: true, bgVar: "--tile" });
    HERO = makeNet($("#hero"), { interactive: false, labels: "top", bands: true, dark: true, bgVar: "--bg" });
    $("#net").addEventListener("click", (ev) => {
      if (ev.target.id === "net" && S.sel) {
        S.sel = null;
        renderStage(false);
      }
    });
    $$("#modeSeg button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    $$("#dirSeg button").forEach((b) =>
      b.addEventListener("click", () => {
        S.egoDir = b.dataset.dir;
        $$("#dirSeg button").forEach((x) => x.setAttribute("aria-pressed", x === b));
        moveThumb($("#dirSeg"));
        renderStage(true, true);
      }),
    );
    $("#egoExit").addEventListener("click", () => {
      S.ego = null;
      renderStage(true);
    });
    $("#heroPlay").addEventListener("click", () => heroPlay(!S.hero.playing));
    $("#heroPrev").addEventListener("click", () => heroShow(S.hero.i - 1));
    bindTerms();
    $("#ctaClusters").addEventListener("click", (ev) => {
      const el = $("#styles");
      ev.preventDefault();
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("#heroNext").addEventListener("click", () => heroShow(S.hero.i + 1));
    $("#hero").addEventListener("click", () => openTeam(teams()[S.hero.i], { scroll: true }));
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        if ($("#sheet").classList.contains("on")) closeSheet();
        else if (S.ego) {
          S.ego = null;
          renderStage(true);
        }
      }
    });
    let rt;
    window.addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        renderStage(false, true);
        heroShow(S.hero.i, false);
        moveThumb($("#modeSeg"));
      }, 160);
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rerender);
    new MutationObserver(rerender).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) heroPlay(false);

    loadLogos(
      Object.values(S.data.teams).map((t) => t.code),
      () => {
        if (Object.keys(LOGOS).length) rerender();
      },
    );
    // logo files only exist in the local copy, so the published page skips the lookup
    if (window.FB_LOCAL)
      (function plLogo() {
        const img = $("#plLogo"),
          srcs = ["logos/PL.svg", "logos/PL.png"];
        const next = () => {
          const src = srcs.shift();
          if (!src) return;
          const t = new Image();
          t.onload = () => {
            img.src = src;
            img.hidden = false;
            $("#plSep").hidden = false;
            S.plShown = true;
            renderStats();
          };
          t.onerror = next;
          t.src = src;
        };
        next();
      })();
    renderStats();
    const h = (location.hash || "").slice(1),
      start = byCode(h) || teams().find((t) => T(t).code === "ARS");
    openTeam(start);
    renderLeague();
    heroShow(teams().indexOf(start) + 1);
    requestAnimationFrame(heroTick);
    document.fonts?.ready.then(() => moveThumb($("#modeSeg")));
    moveThumb($("#modeSeg"));
    window.scrollTo(0, 0);
  }
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  boot();
})();
