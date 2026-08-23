(() => {
  const input = document.querySelector('[data-report-filter]')
  const reset = document.querySelector('[data-report-reset]')
  const rows = [...document.querySelectorAll('tbody tr')]
  if (!input) return

  const apply = () => {
    const query = input.value.trim().toLowerCase()
    for (const row of rows) row.hidden = !row.textContent.toLowerCase().includes(query)
  }

  input.addEventListener('input', apply)
  reset?.addEventListener('click', () => {
    input.value = ''
    apply()
    input.focus()
  })
})()
