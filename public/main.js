let socket = io();

let currentPlayerName = "";
let usingTwoCards = true;
let resumeSession = false;
let savedName = null;

try {
  resumeSession = sessionStorage.getItem("cyphaResume") === "true";
  savedName = localStorage.getItem("playerName");
} catch (err) {
  console.warn("⚠️ Could not read saved session or player:", err.message);
}

window.addEventListener("DOMContentLoaded", () => {
  console.log("📱 DOM loaded on:", window.location.href);

  const enterBtn = document.getElementById("enter-game-btn");
  const nameInput = document.getElementById("player-name");
  const welcomeScreen = document.getElementById("welcome-screen");
  const gameUI = document.getElementById("game-ui");
  const card1 = document.getElementById("bingo-card-1");
  const card2 = document.getElementById("bingo-card-2");
  const toggleBtn = document.getElementById("card-toggle");
  const newGameBtn = document.getElementById("new-game-btn");
  const bingoBtn = document.getElementById("call-bingo-btn");

  if (savedName) {
    if (resumeSession) {
      console.log("🔁 Resuming session for player:", savedName);
      currentPlayerName = savedName;
      socket.emit("join-game", savedName);
      // wait for server join-accepted before showing UI
    } else {
      const modal = document.getElementById("resume-modal");
      const resumeNameEl = document.getElementById("resume-name");
      const yesBtn = document.getElementById("resume-yes");
      const noBtn = document.getElementById("resume-no");

      resumeNameEl.textContent = savedName;
      modal.style.display = "flex";
      document.body.classList.add("modal-open");

      yesBtn.onclick = () => {
        sessionStorage.setItem("cyphaResume", "true");
        currentPlayerName = savedName;
        socket.emit("join-game", savedName);
  // wait for server join-accepted before showing UI
        modal.style.display = "none";
        document.body.classList.remove("modal-open");
      };

      noBtn.onclick = () => {
        try {
          localStorage.removeItem("playerName");
          sessionStorage.removeItem("cyphaResume");
        } catch (err) {}
        modal.style.display = "none";
        document.body.classList.remove("modal-open");
      };
    }
  }

  if (enterBtn && nameInput) {
    enterBtn.addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (!name) {
        alert("Please enter your name.");
        return;
      }

      currentPlayerName = name;

      try {
        localStorage.setItem("playerName", name);
      } catch (err) {
        console.warn("⚠️ Could not store player name:", err.message);
      }

  socket.emit("join-game", name);
  // wait for 'join-accepted' event before showing the UI
  console.log("⏳ Sent join request as:", name);
    });
  }

  if (toggleBtn && card2) {
    toggleBtn.addEventListener("click", () => {
      usingTwoCards = !usingTwoCards;
      card2.style.display = usingTwoCards ? "grid" : "none";
      toggleBtn.textContent = usingTwoCards ? "1 Card / 2 Cards" : "2 Cards / 1 Card";
    });
  }

  if (bingoBtn) {
    bingoBtn.addEventListener("click", () => {
      if (!currentPlayerName) {
        alert("Missing player name. Please reload and rejoin.");
        return;
      }

      bingoBtn.classList.add("call-bingo-activated");
      setTimeout(() => {
        bingoBtn.classList.remove("call-bingo-activated");
      }, 10000);

      if (typeof confetti === "function") {
        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.6 }
        });
      }

      const waitMsg = document.getElementById("bingo-wait-msg");
      if (waitMsg) waitMsg.style.display = "block";

      socket.emit("bingo-claim", currentPlayerName);
      console.log("📢 Bingo called by:", currentPlayerName);
    });
  }

  if (newGameBtn) {
    newGameBtn.addEventListener("click", () => {
      try {
        localStorage.removeItem("playerName");
        sessionStorage.removeItem("cyphaResume");
      } catch (err) {
        console.warn("⚠️ Could not clear session storage:", err.message);
      }

      currentPlayerName = "";

      if (socket && socket.connected) {
        socket.disconnect();
      }

      location.reload(true);
    });
  }

  function buildTile(name, idx) {
    const tile = document.createElement("div");
    tile.className = "bingo-tile";
    if (typeof idx !== 'undefined') tile.dataset.index = String(idx);
  // If the incoming name is in the format "Song - Artist", show only the
  // Song part on the tile to save space, but keep the full string as a
  // tooltip so users can see the artist on hover.
  const full = typeof name === 'string' ? name : '';
  const parts = full.split(' - ');
  const songOnly = parts.length > 0 ? parts[0].trim() : full;
  tile.textContent = songOnly;
  tile.title = full;

    if (name === "FREE SPACE") {
      tile.classList.add("free", "selected");
    }

    tile.addEventListener("click", () => {
      if (!tile.classList.contains("free")) {
        tile.classList.toggle("selected");
        // save selection state for this card
        try { saveSelectionsForContainer(tile.closest('.bingo-card')); } catch (e) {}
      }
    });

    return tile;
  }

  function renderCard(container, tiles) {
    container.innerHTML = "";
    tiles.forEach(tile => container.appendChild(tile));
  }

  // Helpers: persist selections per-player + per-card signature
  function cardSignatureFromArray(arr) {
    // conservative signature: join tile texts with | so order matters
    return arr.map(s => String(s)).join('|');
  }

  function storagePrefix() {
    const name = currentPlayerName || savedName || 'anonymous';
    return `cypha:selections:${name}:`;
  }

  function saveSelectionsForContainer(container) {
    if (!container) return;
    const tiles = Array.from(container.querySelectorAll('.bingo-tile'));
    // try to recover the card's text content signature
    const texts = tiles.map(t => t.title || t.textContent || '');
    const sig = cardSignatureFromArray(texts);
    const selectedIndices = tiles.map((t, i) => t.classList.contains('selected') ? i : -1).filter(i => i >= 0);
    try {
      if (selectedIndices.length) {
        localStorage.setItem(storagePrefix() + sig, JSON.stringify(selectedIndices));
      } else {
        // remove empty selection set
        localStorage.removeItem(storagePrefix() + sig);
      }
    } catch (e) { console.warn('⚠️ Could not save selections', e.message); }
  }

  function restoreSelectionsForContainer(container, tilesArr) {
    if (!container) return;
    const tiles = Array.from(container.querySelectorAll('.bingo-tile'));
    const sig = cardSignatureFromArray(tilesArr || tiles.map(t => t.title || t.textContent || ''));
    try {
      const raw = localStorage.getItem(storagePrefix() + sig);
      if (!raw) return;
      const indices = JSON.parse(raw);
      indices.forEach(i => {
        const t = tiles[i];
        if (t && !t.classList.contains('free')) t.classList.add('selected');
      });
    } catch (e) { console.warn('⚠️ Could not restore selections', e.message); }
  }

  function clearSelectionsForPlayer() {
    try {
      const prefix = storagePrefix();
      const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix));
      keys.forEach(k => localStorage.removeItem(k));
      // also clear UI selections
      document.querySelectorAll('.bingo-tile.selected').forEach(t => {
        if (!t.classList.contains('free')) t.classList.remove('selected');
      });
    } catch (e) { console.warn('⚠️ Could not clear selections', e.message); }
  }

  socket.on("generateCard", data => {
    console.log("🎲 Received card data:", data);
    // build tiles with indices so we can persist by position
    const tiles1 = data.card1.map((name, idx) => buildTile(name, idx));
    const tiles2 = data.card2.map((name, idx) => buildTile(name, idx));
    renderCard(card1, tiles1);
    renderCard(card2, tiles2);
    card2.style.display = usingTwoCards ? "grid" : "none";
    // restore previous selections if any (based on card contents signature)
    try { restoreSelectionsForContainer(card1, data.card1); } catch (e) {}
    try { restoreSelectionsForContainer(card2, data.card2); } catch (e) {}
  });

  // Clear selections when host resets / starts a new game
  socket.on('clear-bigscreen', () => { clearSelectionsForPlayer(); });
  socket.on('new-game', () => { clearSelectionsForPlayer(); });
  socket.on('start-game', () => { clearSelectionsForPlayer(); });

  socket.on('join-accepted', (name) => {
    console.log('✅ Join accepted for', name);
    currentPlayerName = name;
    try {
      localStorage.setItem('playerName', name);
    } catch (err) {}
    const welcomeScreen = document.getElementById('welcome-screen');
    const gameUI = document.getElementById('game-ui');
    if (welcomeScreen) welcomeScreen.style.display = 'none';
    if (gameUI) gameUI.style.display = 'block';
  // update player display
  const pd = document.getElementById('player-display');
  if (pd) pd.textContent = `Player: ${currentPlayerName}`;
  });

  socket.on('join-failed', (reason) => {
    console.warn('❌ Join failed:', reason);
    alert(reason || 'Unable to join the game.');
    const nameInput = document.getElementById('player-name');
    if (nameInput) nameInput.focus();
  });

  socket.onAny((event, ...args) => {
    console.log("📡 Event:", event, args);
  });

  socket.on('game-info', info => {
    const themeEl = document.getElementById('theme-name');
    if (themeEl) themeEl.textContent = info.theme || 'No theme';
  });

  // Some legacy flows send the current theme as a simple 'theme' string.
  // Keep compatibility for a short window but prefer 'game-info'.
  socket.on('theme', (theme) => {
    console.warn('Deprecation: server "theme" event is deprecated, prefer "game-info"');
    const themeEl = document.getElementById('theme-name');
    if (themeEl) themeEl.textContent = theme || 'No theme';
  });

  // Listen for now-playing updates (from bigscreen / broadcastSong)
  socket.on('broadcastSong', (songTitle) => {
    const nowEl = document.getElementById('now-playing');
    if (nowEl) nowEl.textContent = `Now Playing: ${songTitle || '—'}`;
  });

  socket.on('name-disambiguated', (newName) => {
    alert(`Name in use — you've been assigned: ${newName}`);
    currentPlayerName = newName;
  });

  socket.on('join-failed', (reason) => {
    const modal = document.getElementById('join-failed-modal');
    const msg = document.getElementById('join-failed-message');
    const ok = document.getElementById('join-failed-ok');
    if (msg) msg.textContent = reason || 'Unable to join';
    if (modal) modal.style.display = 'flex';
    if (ok) ok.onclick = () => { modal.style.display = 'none'; };
  });

  socket.on("connect", () => {
    console.log("✅ Connected to server via socket.io:", socket.id);
    // If we already had a player name (stored), re-assert it so the server
    // treats this socket as the active session for that player. Use the
    // resume flag so the server will replace any previous mapping.
    if (currentPlayerName) {
      console.log('🔁 Re-joining as', currentPlayerName);
      socket.emit('join-game', { name: currentPlayerName, resume: true });
    }
  });

  socket.on("connect_error", (err) => {
    console.error("❌ Connection error:", err.message);
  });

  socket.on("bingo-pattern", pattern => {
  console.log("🎯 Bingo Pattern Set:", pattern);

  // Optional: Store in session or show somewhere in UI
  sessionStorage.setItem("cyphaPattern", pattern);

  // Optional: display to user
  const patternBar = document.getElementById("pattern-bar");
  if (patternBar) {
      patternBar.textContent = `Current Pattern: ${pattern.toUpperCase()}`;
    }
  });
});
