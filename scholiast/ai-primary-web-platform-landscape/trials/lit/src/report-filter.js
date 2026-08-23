import { LitElement, css, html } from 'lit';

class ReportFilter extends LitElement {
  static properties = { query: { state: true } };
  static styles = css`:host{display:block} label{display:block;margin:1rem 0} input{font:inherit;padding:.4rem}`;
  constructor() { super(); this.query = ''; }
  render() {
    const rows = [
      ['Native HTML', 'shortlist'],
      ['Observable Framework', 'reject as primary'],
      ['Quarto', 'benchmark']
    ].filter((row) => row.join(' ').toLowerCase().includes(this.query.toLowerCase()));
    return html`<label>Filter candidates <input type="search" @input=${(event) => { this.query = event.target.value; }}></label>
      <table><caption>Candidate evidence</caption><thead><tr><th scope="col">Candidate</th><th scope="col">Disposition</th></tr></thead>
      <tbody>${rows.map((row) => html`<tr><th scope="row">${row[0]}</th><td>${row[1]}</td></tr>`)}</tbody></table>`;
  }
}
customElements.define('report-filter', ReportFilter);
