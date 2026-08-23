export default function (config) {
  config.addPassthroughCopy({ "shared/report.css": "report.css" });
  config.addPassthroughCopy({ "shared/classic-filter.js": "classic-filter.js" });
}
