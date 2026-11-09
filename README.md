# Kurunegala in 3D

An explorable, stylized 3D model of Kurunegala, Sri Lanka, in plain Three.js with no build step.

## View it

From this folder, run:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. It can't be opened directly as a file, because browsers block loading the map data that way.

Add `?quality=low` for slower computers. Use `#clock`, `#town`, `#lake`, `#rock`, `#lakeside`, `#boats`, `#park`, `#tuk`, `#boat`, `#jog`, `#climb`, `#steps`, `#temple` or `#about`, `?time=day` or `?time=night`, and `?weather=rain` or `?weather=storm`, to link to a view.

Sound is off until you press **Sound** (or `M`). It uses recordings in `audio/` (credited in `audio/CREDITS.md`) and generates the rest in the browser.

## Refresh the map data

`python3 -I tools/fetch_data.py` rebuilds `data/`. Delete `tools/.cache` first to download fresh data.

Map data © OpenStreetMap contributors (ODbL). Elevation from Mapzen Terrain Tiles. Building heights are estimated.
