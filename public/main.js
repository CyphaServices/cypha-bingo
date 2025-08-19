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
      welcomeScreen.style.display = "none";
      gameUI.style.display = "block";
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
        welcomeScreen.style.display = "none";
        gameUI.style.display = "block";
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
      welcomeScreen.style.display = "none";
      gameUI.style.display = "block";
      console.log("✅ Entered game as:", name);
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

  function buildTile(name) {
    const tile = document.createElement("div");
    tile.className = "bingo-tile";
    tile.textContent = name;

    if (name === "FREE SPACE") {
      tile.classList.add("free", "selected");
    }

    tile.addEventListener("click", () => {
      if (!tile.classList.contains("free")) {
        tile.classList.toggle("selected");
      }
    });

    return tile;
  }

  function renderCard(container, tiles) {
    container.innerHTML = "";
    tiles.forEach(tile => container.appendChild(tile));
  }

  socket.on("generateCard", data => {
    console.log("🎲 Received card data:", data);
    const tiles1 = data.card1.map(buildTile);
    const tiles2 = data.card2.map(buildTile);
    renderCard(card1, tiles1);
    renderCard(card2, tiles2);
    card2.style.display = usingTwoCards ? "grid" : "none";
  });

  socket.onAny((event, ...args) => {
    console.log("📡 Event:", event, args);
  });

  socket.on("connect", () => {
    console.log("✅ Connected to server via socket.io:", socket.id);
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
