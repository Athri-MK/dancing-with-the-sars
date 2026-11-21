# 🛰️ Dancing with the SARs — NISAR L-Band & Sentinel-1 Disaster Intelligence

**An interactive, all-weather orbital radar dashboard built for the NASA Space Apps Challenge 2026.**

🔗 **Live Dashboard:** [https://github.io](https://github.io)  
🏆 **Event:** NASA Space Apps Challenge 2026 — JNNCE Shivamogga Local Hub  
🚀 **Team:** Vyuha Cosmic

---

## 🌍 Overview

During severe floods, wildfires, volcanic eruptions, and oil spills, traditional optical satellites are often blinded by thick storm clouds, wildfire smoke, and darkness. **Dancing with the SARs** bridges that gap by turning complex Synthetic Aperture Radar (SAR) data into an intuitive, mission-control style web interface.

Using multi-temporal L-band and C-band radar acquisitions, the platform visualizes before-and-after surface changes, quantifies backscatter shifts in decibels (dB), and overlays live global natural events.

---

## ✨ Key Features

* **Before / After Swipe Comparison:** Interactive split-screen divider (`50%` default slider) to visually compare baseline and post-event radar/optical views.
* **Dynamic Radar & Optical Overlays:** Toggle between radar backscatter layers and high-resolution Esri World Imagery with adjustable opacity (`0%–100%`).
* **Automated Science Reports:** Displays acquisition timestamps, analyzed area (km²), water/canopy change metrics, mean backscatter shift (dB), and color legends—with one-click report downloads.
* **Live NASA EONET v3 Integration:** Click anywhere on the map to query real-time natural events worldwide via NASA's Earth Observatory Natural Event Tracker API.
* **5 Curated Local & Global Study Zones:**
  1. **Shivamogga & Bhadra Reservoir (Karnataka, India):** Monsoon flooding & waterlogging analysis.
  2. **Kilauea Volcano Eruption (Hawaii, USA):** Volcanic lava flow & ash surface deformation.
  3. **Amazon Deforestation — Porto Velho (Rondônia, Brazil):** Canopy & biomass loss tracking.
  4. **California Wildfire Burn Scar Analysis (USA):** Post-fire burn scar & canopy loss.
  5. **Red Sea Marine Oil Spill (Al Hudaydah Coast, Yemen):** Marine oil slick & surface dampening detection.

---

## ⚙️ End-to-End Engineering Architecture

### 1. Satellite Data Pipeline (`Python` · `Kaggle` · `NASA Earthdata`)
* Queried NASA’s **ASF Vertex** portal for geocoded **NASA-ISRO NISAR (L2 GCOV)** and **ESA Sentinel-1** granules along matching orbital tracks.
* Converted raw backscatter intensities (`HHHH`, `HVHV`, `VV`, `VH`) into decibels using `10 * log10(σ⁰)`.
* Computed temporal change matrices (`After - Before`) and applied morphological de-speckling filters to reduce radar noise.
* Exported transparent RGBA raster overlays paired with standardized `report.json` metadata files.

### 2. Interactive Frontend (`HTML5` · `CSS3` · `Vanilla JS` · `Leaflet.js`)
* Built a lightweight, zero-framework dark-mode dashboard hosted statically on **GitHub Pages**.
* Powered interactive map layers, custom swipe controls, and dynamic JSON report rendering via `Leaflet.js` and `Esri World Imagery`.

---

## 📂 Repository Structure

```text
dancing-with-the-sars/
├── data/               # Processed SAR RGBA overlays & zone science report JSONs
│   ├── flood_zone/     # Shivamogga & Bhadra Reservoir (Monsoon Flooding)
│   ├── forest_zone/    # Porto Velho, Rondônia (Amazon Deforestation)
│   ├── oil_spill_zone/ # Al Hudaydah Coast (Red Sea Marine Oil Spill)
│   ├── volcano_zone/   # Kilauea, Hawaii (Volcanic Lava & Ash)
│   └── wildfire_zone/  # California, USA (Wildfire Burn Scar)
├── index.html          # Main mission-control dashboard layout
├── style.css           # Dark-mode space UI styling & responsive controls
├── app.js              # Leaflet map logic, swipe slider, EONET API & report loader
├── locations.json      # Coordinates & metadata for the 5 featured SAR study zones
└── README.md           # Project documentation
```

---

## 🚀 Running Locally

Because the dashboard fetches local JSON and overlay files via JavaScript, run it using a local HTTP server rather than opening `index.html` directly as a file:

```bash
# 1. Clone the repository
git clone https://github.com

# 2. Navigate into the project directory
cd dancing-with-the-sars

# 3. Start a local Python server
python -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

---

## 👥 Team Vyuha Cosmic

Built by 2nd-year engineering students at **Jawaharlal Nehru National College of Engineering (JNNCE), Shivamogga, Karnataka, India**:

* **Athri M K Hegade** — Team Owner, Core Logic Architect & Version Control Lead
* **Prathik A S** — Collaborator
* **Arhaan Khan** — Collaborator
* **Akash N** — Collaborator
* **Dhanush S** — Collaborator
* **Aijaz A S** — Collaborator

---

## 🙏 Acknowledgments & Data Sources

* **NASA & ISRO** — NISAR L-band SAR mission concepts & open data ecosystem
* **NASA ASF Vertex & Earthdata** — Sentinel-1 & NISAR sample granule access
* **NASA EONET v3** — Live natural event tracking API
* **Leaflet.js, OpenStreetMap & Esri World Imagery** — Interactive mapping and base tiles
