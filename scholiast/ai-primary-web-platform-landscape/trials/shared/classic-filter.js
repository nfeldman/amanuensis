(() => {
  const input = document.querySelector('[data-report-filter]');
  const rows = [...document.querySelectorAll('tbody tr')];
  if (!input) return;
  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    for (const row of rows) row.hidden = !row.textContent.toLowerCase().includes(query);
  });
})();
