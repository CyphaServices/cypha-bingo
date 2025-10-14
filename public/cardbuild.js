// cardbuild.js - Handles custom card creation and theme management

const gridSize = 5;
const cardGrid = document.getElementById('card-grid');
const cardForm = document.getElementById('card-form');
const themeNameInput = document.getElementById('theme-name');
const themeList = document.getElementById('theme-list');

// Generate 5x5 grid of inputs
function createGrid() {
  cardGrid.innerHTML = '';
  for (let i = 0; i < gridSize * gridSize; i++) {
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 32;
    input.placeholder = i === 12 ? 'FREE' : `Cell ${i+1}`;
    if (i === 12) {
      input.value = 'FREE';
      input.disabled = true;
    }
    cardGrid.appendChild(input);
  }
}

// Load custom themes from localStorage
function loadThemes() {
  const themes = JSON.parse(localStorage.getItem('customThemes') || '[]');
  themeList.innerHTML = '';
  themes.forEach(theme => {
    const li = document.createElement('li');
    li.textContent = `${theme.name}: ${theme.card.join(', ')}`;
    themeList.appendChild(li);
  });
}

// Save new card to localStorage
cardForm.onsubmit = function(e) {
  e.preventDefault();
  const cells = Array.from(cardGrid.querySelectorAll('input')).map(input => input.value.trim());
  if (cells.length !== 25 || cells.some((cell, i) => i !== 12 && !cell)) {
    alert('Please fill in all cells except the FREE space.');
    return;
  }
  const themeName = themeNameInput.value.trim();
  if (!themeName) {
    alert('Please enter a theme name.');
    return;
  }
  const themes = JSON.parse(localStorage.getItem('customThemes') || '[]');
  themes.push({ name: themeName, card: cells });
  localStorage.setItem('customThemes', JSON.stringify(themes));
  loadThemes();
  cardForm.reset();
  createGrid();
};

createGrid();
loadThemes();
