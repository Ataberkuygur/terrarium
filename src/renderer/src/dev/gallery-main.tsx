/* ── Dev-only scene gallery ────────────────────────────────────────────────
 * Served by the renderer dev server at /gallery.html — never bundled into the
 * app (electron-vite only builds index.html). Renders one office module in
 * isolation with synthetic agents so it can be screenshotted and iterated on.
 *
 *   ?v=chars      character lineup (&pose=stand|sit|standWork|lounge|slump,
 *                 &set=heroes|civilians|all, &only=<hero-id>, &cam=front|back|side|3q|close)
 *   ?v=loft       loft OfficeScene            (&n=<agent count>, default 10)
 *   ?v=avengers   Avengers facility scene     (&n=<agent count>, default 9)
 *   ?v=city       city view                   (&theme=loft|avengers)
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import '../styles.css'
import { Gallery } from './Gallery'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Gallery />
  </React.StrictMode>
)
