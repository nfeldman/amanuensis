import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import { Report } from "./report"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Report />
  </StrictMode>,
)
