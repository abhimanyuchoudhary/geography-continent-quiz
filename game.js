(() => {
  "use strict";

  const MAX_QUESTIONS = 50;
  const NAME_MAX = 20;
  const LB_KEY = "gcq-leaderboard-v1";
  const LB_STORE = 20;
  const LB_SHOW = 10;
  const SVG_NS = "http://www.w3.org/2000/svg";

  const DIFF_NAMES = { easy: "Tourist", medium: "Globetrotter", hard: "Cartographer" };
  const AVATARS = {
    easy: "assets/avatars/tourist.svg",
    medium: "assets/avatars/globetrotter.svg",
    hard: "assets/avatars/cartographer.svg",
    random: "assets/avatars/random.svg",
  };
  const DIFF_HINTS = {
    easy: "Well-known countries, with other familiar names as choices.",
    medium: "A mix of familiar countries and trickier choices.",
    hard: "Less familiar countries. Choices are nearby countries that are easy to mix up.",
    random: "Picks Tourist, Globetrotter, or Cartographer once for the whole round.",
  };

  const $ = (id) => document.getElementById(id);

  const screens = {
    start: $("screen-start"),
    question: $("screen-question"),
    end: $("screen-end"),
  };

  const els = {
    roundLength: $("round-length"),
    lengthHint: $("length-hint"),
    diffHint: $("diff-hint"),
    btnPlay: $("btn-play"),
    btnNext: $("btn-next"),
    btnAgain: $("btn-again"),
    btnHome: $("btn-home"),
    progressBar: $("progress-bar"),
    qProgress: $("q-progress"),
    hudDiff: $("hud-diff"),
    hudAvatar: $("hud-avatar"),
    hudDiffLabel: $("hud-diff-label"),
    score: $("score"),
    streak: $("streak"),
    mapCaption: $("map-caption"),
    map: $("map"),
    choices: $("choices"),
    feedback: $("feedback"),
    endEmoji: $("end-emoji"),
    endMessage: $("end-message"),
    finalCorrect: $("final-correct"),
    finalTotal: $("final-total"),
    finalStreak: $("final-streak"),
    endMeta: $("end-meta"),
    endAvatar: $("end-avatar"),
    endMetaText: $("end-meta-text"),
    endCapNote: $("end-cap-note"),
    reviewList: $("review-list"),
    saveForm: $("save-form"),
    playerName: $("player-name"),
    saveError: $("save-error"),
    saveDone: $("save-done"),
    saveButton: $("btn-save"),
    lbStart: $("lb-start"),
    lbEnd: $("lb-end"),
    lbYours: $("lb-yours"),
  };

  const state = {
    questions: [],
    index: 0,
    correct: 0,
    streak: 0,
    bestStreak: 0,
    answered: false,
    autoTimer: null,
    pick: "easy",
    difficulty: "easy",
    requested: 10,
    saved: false,
    savedId: null,
  };

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      const on = key === name;
      el.classList.toggle("active", on);
      el.hidden = !on;
    });
    window.scrollTo(0, 0);
  }

  function selectedPick() {
    const el = document.querySelector('input[name="difficulty"]:checked');
    return el ? el.value : "easy";
  }

  function diffLabel(level, viaRandom) {
    const name = DIFF_NAMES[level] || "Tourist";
    return viaRandom ? `${name} · Random` : name;
  }

  function avatarSrc(level) {
    return AVATARS[level] || AVATARS.easy;
  }

  function resolveDifficulty(pick) {
    if (pick !== "random") return pick;
    return shuffle(["easy", "medium", "hard"])[0];
  }

  function hasShape(country) {
    const cont = typeof MAPS !== "undefined" && MAPS[country.continent];
    return Boolean(cont && cont.countries[country.iso]);
  }

  function poolFor(level) {
    return difficultyPool(level).filter(hasShape);
  }

  function syncDiffUI() {
    document.querySelectorAll('input[name="difficulty"]').forEach((input) => {
      input.closest(".diff-option").classList.toggle("is-selected", input.checked);
    });
    const pick = selectedPick();
    els.diffHint.textContent = DIFF_HINTS[pick] || "";
    updateLengthHint();
  }

  function updateLengthHint() {
    const pick = selectedPick();
    const requested = parseInt(els.roundLength.value, 10) || 10;
    const easyN = poolFor("easy").length;
    if (pick !== "random") {
      const poolN = poolFor(pick).length;
      if (requested > poolN) {
        els.lengthHint.hidden = false;
        els.lengthHint.textContent = `${DIFF_NAMES[pick]} has ${poolN} countries, so this round will be ${Math.min(poolN, MAX_QUESTIONS)} questions.`;
        return;
      }
    } else if (requested > easyN) {
      els.lengthHint.hidden = false;
      els.lengthHint.textContent = `Random picks one level for the whole round. Tourist has ${easyN} countries, so a Tourist roll plays ${easyN}.`;
      return;
    }
    els.lengthHint.hidden = true;
    els.lengthHint.textContent = "";
  }

  function pickDistractors(answer, difficulty, count) {
    const same = poolFor("all").filter((c) => c.continent === answer.continent && c.iso !== answer.iso);
    const near = new Set((typeof NEIGHBORS !== "undefined" && NEIGHBORS[answer.iso]) || []);
    const isNear = (c) => near.has(c.iso);
    const prefs =
      difficulty === "easy"
        ? [
            (c) => c.tier === "easy" && !isNear(c),
            (c) => c.tier === "easy",
            (c) => c.tier === "medium" && !isNear(c),
            (c) => c.tier !== "hard",
            () => true,
          ]
        : difficulty === "hard"
          ? [
              (c) => isNear(c) && c.tier === "hard",
              (c) => isNear(c),
              (c) => c.tier === "hard",
              () => true,
            ]
          : [
              (c) => isNear(c) && c.tier === "medium",
              (c) => c.tier === "medium",
              (c) => isNear(c),
              (c) => c.tier !== "hard",
              () => true,
            ];

    const chosen = [];
    const used = new Set();
    prefs.forEach((pred) => {
      if (chosen.length >= count) return;
      shuffle(same.filter((c) => pred(c) && !used.has(c.iso))).forEach((c) => {
        if (chosen.length >= count) return;
        chosen.push(c);
        used.add(c.iso);
      });
    });
    return chosen;
  }

  function pickRoundCountries(level, n) {
    const pool = poolFor(level);
    if (level !== "medium") return shuffle(pool).slice(0, n);
    const med = shuffle(pool.filter((c) => c.tier === "medium"));
    const easy = shuffle(pool.filter((c) => c.tier === "easy"));
    const nMed = Math.min(med.length, Math.round(n * 0.65));
    const picked = med.slice(0, nMed);
    const used = new Set(picked.map((c) => c.iso));
    easy.forEach((c) => {
      if (picked.length >= n || used.has(c.iso)) return;
      picked.push(c);
      used.add(c.iso);
    });
    if (picked.length < n) {
      shuffle(pool).forEach((c) => {
        if (picked.length >= n || used.has(c.iso)) return;
        picked.push(c);
        used.add(c.iso);
      });
    }
    return shuffle(picked).slice(0, n);
  }

  function makeQuestion(country, difficulty) {
    const distractors = pickDistractors(country, difficulty, 3);
    const options = shuffle([country, ...distractors]).map((c) => ({ iso: c.iso, name: c.name }));
    return {
      iso: country.iso,
      name: country.name,
      continent: country.continent,
      flag: country.flag,
      options,
      answer: country.name,
      answerLabel: country.flag ? `${country.flag} ${country.name}` : country.name,
      promptLabel: `Highlighted country in ${country.continent}`,
    };
  }

  function zoomView(map, shape) {
    const [vx, vy, vw, vh] = map.view;
    const [x, y, w, h] = shape.b;
    const dominates = w / vw >= 0.4 || h / vh >= 0.4;
    let viewW = vw;
    let viewH = vh;
    if (!dominates) {
      const pad = 2.55;
      viewW = w * pad;
      viewH = h * pad;
      // Keep the camera from becoming a thin ribbon around Chile-like or
      // Gambia-like countries, so some neighboring coastline stays in frame.
      const maxAspect = 1.85;
      if (viewW / Math.max(viewH, 0.01) > maxAspect) viewH = viewW / maxAspect;
      if (viewH / Math.max(viewW, 0.01) > maxAspect) viewW = viewH / maxAspect;
      viewW = Math.min(Math.max(viewW, w * 1.35), vw);
      viewH = Math.min(Math.max(viewH, h * 1.35), vh);
    }
    let x0 = x + w / 2 - viewW / 2;
    let y0 = y + h / 2 - viewH / 2;
    x0 = Math.max(vx, Math.min(x0, vx + vw - viewW));
    y0 = Math.max(vy, Math.min(y0, vy + vh - viewH));
    const zoomed = viewW < vw * 0.92 || viewH < vh * 0.92;
    return { box: [x0, y0, viewW, viewH], zoomed };
  }

  function svgEl(name) {
    return document.createElementNS(SVG_NS, name);
  }

  function renderMap(q) {
    const map = MAPS[q.continent];
    const shape = map.countries[q.iso];
    const zoom = zoomView(map, shape);
    const [x, y, w, h] = zoom.box;
    const svg = els.map;
    svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    svg.replaceChildren();

    const title = svgEl("title");
    title.id = "map-title";
    title.textContent = `Map of ${q.continent}. One country is highlighted.`;
    svg.append(title);

    const ocean = svgEl("rect");
    ocean.setAttribute("class", "ocean");
    ocean.setAttribute("x", String(x));
    ocean.setAttribute("y", String(y));
    ocean.setAttribute("width", String(w));
    ocean.setAttribute("height", String(h));
    svg.append(ocean);

    const makePath = (iso, countryShape, highlighted) => {
      const path = svgEl("path");
      path.setAttribute("d", countryShape.d);
      path.setAttribute("class", highlighted ? "country hi" : "country");
      path.setAttribute("data-iso", iso);
      path.setAttribute("vector-effect", "non-scaling-stroke");
      path.setAttribute("fill-rule", "evenodd");
      return path;
    };

    Object.entries(map.countries).forEach(([iso, countryShape]) => {
      if (iso === q.iso) return;
      svg.append(makePath(iso, countryShape, false));
    });

    const halo = svgEl("path");
    halo.setAttribute("d", shape.d);
    halo.setAttribute("class", "halo");
    halo.setAttribute("vector-effect", "non-scaling-stroke");
    halo.setAttribute("fill-rule", "evenodd");
    svg.append(halo);
    svg.append(makePath(q.iso, shape, true));

    els.mapCaption.textContent = zoom.zoomed ? `${q.continent} · zoomed in` : q.continent;
  }

  function clearAuto() {
    if (state.autoTimer) {
      clearTimeout(state.autoTimer);
      state.autoTimer = null;
    }
  }

  function updateHud() {
    const total = state.questions.length;
    const cur = Math.min(state.index + 1, total);
    els.qProgress.textContent = `${cur} / ${total}`;
    els.score.textContent = String(state.correct);
    els.streak.textContent = String(state.streak);
    els.hudDiffLabel.textContent = diffLabel(state.difficulty, state.pick === "random");
    els.hudAvatar.src = avatarSrc(state.difficulty);
    els.hudDiff.classList.remove("easy", "medium", "hard");
    if (state.difficulty) els.hudDiff.classList.add(state.difficulty);
    const pct = total ? (state.index / total) * 100 : 0;
    els.progressBar.style.width = `${pct}%`;
  }

  function renderQuestion() {
    clearAuto();
    state.answered = false;
    els.btnNext.hidden = true;
    els.feedback.textContent = "";
    els.feedback.className = "feedback";

    const q = state.questions[state.index];
    if (!q) return finishRound();

    renderMap(q);
    els.choices.replaceChildren();
    q.options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice";
      btn.dataset.iso = opt.iso;
      btn.textContent = opt.name;
      btn.addEventListener("click", () => onAnswer(btn, opt));
      els.choices.append(btn);
    });

    updateHud();
  }

  function onAnswer(btn, opt) {
    if (state.answered) return;
    state.answered = true;

    const q = state.questions[state.index];
    const isCorrect = opt.iso === q.iso;
    q.picked = opt.name;
    q.pickedLabel = opt.name;
    q.wasCorrect = isCorrect;

    els.choices.querySelectorAll(".choice").forEach((b) => {
      b.disabled = true;
      if (b.dataset.iso === q.iso) b.classList.add("correct");
      else if (b === btn && !isCorrect) b.classList.add("wrong");
      else b.classList.add("dim");
    });

    if (isCorrect) {
      state.correct += 1;
      state.streak += 1;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
      els.feedback.textContent = "Correct!";
      els.feedback.className = "feedback good";
    } else {
      state.streak = 0;
      els.feedback.textContent = `It's ${q.name}.`;
      els.feedback.className = "feedback bad";
    }

    updateHud();
    const last = state.index >= state.questions.length - 1;
    els.btnNext.textContent = last ? "See results" : "Next →";
    els.btnNext.hidden = false;

    state.autoTimer = setTimeout(() => {
      goNext();
    }, 1100);
  }

  function goNext() {
    clearAuto();
    if (!state.answered && state.questions[state.index]) return;
    state.index += 1;
    if (state.index >= state.questions.length) {
      els.progressBar.style.width = "100%";
      finishRound();
    } else {
      renderQuestion();
    }
  }

  function renderReview() {
    els.reviewList.replaceChildren();
    state.questions.forEach((q) => {
      const li = document.createElement("li");
      li.className = `review-item ${q.wasCorrect ? "ok" : "bad"}`;

      const top = document.createElement("div");
      top.className = "review-top";

      const label = document.createElement("span");
      label.className = "review-q";
      label.textContent = q.promptLabel;

      const mark = document.createElement("span");
      mark.className = "review-mark";
      mark.textContent = q.wasCorrect ? "Correct" : "Wrong";

      top.append(label, mark);
      li.append(top);

      if (!q.wasCorrect) {
        const picked = document.createElement("p");
        picked.className = "review-detail you-picked";
        picked.textContent = `You picked: ${q.pickedLabel}`;
        li.append(picked);
      }

      const ans = document.createElement("p");
      ans.className = "review-detail";
      ans.textContent = `Answer: ${q.answerLabel}`;
      li.append(ans);
      els.reviewList.append(li);
    });
  }

  function sanitizeName(raw) {
    const cleaned = String(raw)
      .replace(/<[^>]*>/g, "")
      .replace(/[<>]/g, "")
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return [...cleaned].slice(0, NAME_MAX).join("");
  }

  function isEntry(e) {
    return Boolean(
      e &&
        typeof e.id === "string" &&
        typeof e.name === "string" &&
        Number.isFinite(e.correct) &&
        Number.isFinite(e.total) &&
        e.total > 0 &&
        ["easy", "medium", "hard"].includes(e.difficulty) &&
        typeof e.date === "string"
    );
  }

  function loadBoard() {
    try {
      const raw = localStorage.getItem(LB_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isEntry).sort(compareScores);
    } catch (err) {
      return [];
    }
  }

  function compareScores(a, b) {
    const pa = a.correct / a.total;
    const pb = b.correct / b.total;
    if (pb !== pa) return pb - pa;
    if (b.total !== a.total) return b.total - a.total;
    if (b.correct !== a.correct) return b.correct - a.correct;
    return new Date(b.date) - new Date(a.date);
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function scoreMeta(e) {
    const pct = Math.round((e.correct / e.total) * 100);
    const diff = diffLabel(e.difficulty, Boolean(e.viaRandom));
    const when = formatDate(e.date);
    return `${e.correct}/${e.total} (${pct}%) · ${diff} · ${e.total} questions · ${when}`;
  }

  function renderBoard(listEl, noteEl, highlightId) {
    const entries = loadBoard().slice(0, LB_SHOW);
    listEl.replaceChildren();
    if (!entries.length) {
      const li = document.createElement("li");
      li.className = "lb-empty";
      li.textContent = "No scores yet. Finish a round to save one on this device.";
      listEl.append(li);
    } else {
      entries.forEach((e) => {
        const li = document.createElement("li");
        li.className = "lb-item";
        if (highlightId && e.id === highlightId) li.classList.add("is-new");

        const top = document.createElement("span");
        top.className = "lb-top";

        const face = document.createElement("img");
        face.className = "avatar avatar-sm";
        face.alt = "";
        face.width = 22;
        face.height = 22;
        face.src = avatarSrc(e.difficulty);

        const name = document.createElement("span");
        name.className = "lb-name";
        name.textContent = sanitizeName(e.name) || "Player";

        top.append(face, name);

        const meta = document.createElement("span");
        meta.className = "lb-meta";
        meta.textContent = scoreMeta(e);

        li.append(top, meta);
        listEl.append(li);
      });
    }

    if (noteEl) {
      const onBoard = highlightId && entries.some((e) => e.id === highlightId);
      noteEl.hidden = !highlightId || onBoard;
      if (!noteEl.hidden) {
        noteEl.textContent = "Your score is saved on this device. It is outside the top 10.";
      }
    }
  }

  function renderLeaderboards(highlightId) {
    renderBoard(els.lbStart, null, null);
    renderBoard(els.lbEnd, els.lbYours, highlightId || null);
  }

  function resetSaveForm() {
    state.saved = false;
    state.savedId = null;
    els.saveForm.hidden = false;
    els.saveDone.hidden = true;
    els.saveError.hidden = true;
    els.saveError.textContent = "";
    els.saveButton.disabled = false;
  }

  function saveScore(event) {
    event.preventDefault();
    if (state.saved) return;

    const name = sanitizeName(els.playerName.value);
    if (!name) {
      els.saveError.hidden = false;
      els.saveError.textContent = "Enter a display name.";
      els.playerName.focus();
      return;
    }

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      correct: state.correct,
      total: state.questions.length,
      difficulty: state.difficulty,
      viaRandom: state.pick === "random",
      date: new Date().toISOString(),
    };

    try {
      const next = loadBoard().concat(entry).sort(compareScores).slice(0, LB_STORE);
      localStorage.setItem(LB_KEY, JSON.stringify(next));
    } catch (err) {
      els.saveError.hidden = false;
      els.saveError.textContent = "Couldn't save on this browser.";
      return;
    }

    state.saved = true;
    state.savedId = entry.id;
    els.playerName.value = name;
    els.saveForm.hidden = true;
    els.saveDone.hidden = false;
    els.saveDone.textContent = `Saved as "${name}" on this device.`;
    renderLeaderboards(entry.id);
  }

  function finishRound() {
    clearAuto();
    const total = state.questions.length;
    const score = state.correct;
    const pct = total ? score / total : 0;

    let emoji = "🌟";
    let msg = "Nice try — play again and the maps will stick!";
    if (pct === 1) {
      emoji = "🏆";
      msg = "Perfect! You know your maps!";
    } else if (pct >= 0.8) {
      emoji = "🎉";
      msg = "Awesome job!";
    } else if (pct >= 0.5) {
      emoji = "👍";
      msg = "Good work — keep exploring!";
    }

    els.endEmoji.textContent = emoji;
    els.endMessage.textContent = msg;
    els.finalCorrect.textContent = String(score);
    els.finalTotal.textContent = String(total);
    els.finalStreak.textContent = String(state.bestStreak);
    els.endMetaText.textContent = `${diffLabel(state.difficulty, state.pick === "random")} · ${total} questions`;
    els.endAvatar.src = avatarSrc(state.difficulty);

    if (state.requested > total) {
      els.endCapNote.hidden = false;
      els.endCapNote.textContent = `Round shortened from ${state.requested} to ${total} so each country is asked only once.`;
    } else {
      els.endCapNote.hidden = true;
      els.endCapNote.textContent = "";
    }

    resetSaveForm();
    renderReview();
    renderLeaderboards(null);
    showScreen("end");
  }

  function startGame() {
    clearAuto();
    const pick = selectedPick();
    const difficulty = resolveDifficulty(pick);
    const requested = parseInt(els.roundLength.value, 10) || 10;
    const pool = poolFor(difficulty);
    const n = Math.min(requested, pool.length, MAX_QUESTIONS);
    if (n < 1) return;

    state.pick = pick;
    state.difficulty = difficulty;
    state.requested = requested;
    state.questions = pickRoundCountries(difficulty, n).map((country) => makeQuestion(country, difficulty));
    state.index = 0;
    state.correct = 0;
    state.streak = 0;
    state.bestStreak = 0;
    state.answered = false;
    showScreen("question");
    renderQuestion();
  }

  document.querySelectorAll('input[name="difficulty"]').forEach((input) => {
    input.addEventListener("change", syncDiffUI);
  });
  els.roundLength.addEventListener("change", updateLengthHint);
  els.btnPlay.addEventListener("click", startGame);
  els.btnNext.addEventListener("click", goNext);
  els.btnAgain.addEventListener("click", startGame);
  els.btnHome.addEventListener("click", () => {
    clearAuto();
    renderLeaderboards(null);
    showScreen("start");
  });
  els.saveForm.addEventListener("submit", saveScore);
  els.playerName.addEventListener("input", () => {
    els.saveError.hidden = true;
  });

  if (typeof MAPS === "undefined") {
    els.btnPlay.disabled = true;
    els.diffHint.textContent = "Map data did not load. Refresh and try again.";
  }

  syncDiffUI();
  renderLeaderboards(null);
  showScreen("start");
})();
