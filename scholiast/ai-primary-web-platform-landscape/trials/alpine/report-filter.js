document.addEventListener('alpine:init', () => {
  Alpine.data('reportFilter', () => ({
    query: '',
    rows: [['Native HTML', 'shortlist'], ['Observable Framework', 'reject as primary'], ['Quarto', 'benchmark']],
    get filtered() { return this.rows.filter((row) => row.join(' ').toLowerCase().includes(this.query.toLowerCase())); }
  }));
});
