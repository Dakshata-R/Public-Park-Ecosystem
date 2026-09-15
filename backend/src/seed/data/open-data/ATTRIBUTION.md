# Data sources and attribution

The files in this directory are a snapshot of open data, built by
`backend/scripts/fetch-open-data.js` (`npm run data:refresh`). The snapshot
date and record counts are in `meta.json`.

## OpenStreetMap — `parks.json`

Park boundaries, areas, facilities and the mapped trees, benches, street
lamps, paths, water bodies and structures inside them.

© OpenStreetMap contributors. Available under the
[Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/).
Retrieved through the Overpass API. Areas are computed by this project from
the mapped boundary and can differ from officially published figures.

Park descriptions, the year established and the managing authority are
written by the project and given only where they are well documented.

## GBIF — `species.json`, `observations.json`

Species recorded inside each park boundary since 1 January 2023, counted per
species per month, together with taxonomy, English vernacular names, IUCN Red
List categories and one photograph per species.

GBIF.org — GBIF Occurrence Search and Species API, https://www.gbif.org.
Occurrence records are published by their respective datasets (principally
eBird and iNaturalist) under CC0, CC BY or CC BY-NC licences; each species
photograph records its own creator and licence in `species.json`
(`image.credit`, `image.license`, `image.source`).

`count` in `observations.json` is the number of GBIF occurrence records, not a
count of individuals. GBIF publication lags field observation by months, so
the most recent months are incomplete.

## GRIIS India

Introduced and invasive status (`isIntroduced`, `isInvasive`) from the Global
Register of Introduced and Invasive Species — India, read from its Darwin Core
archive published on GBIF
(dataset `b09c3987-af9a-4658-9bfd-19cf712ac3d1`).

## Wikimedia Commons — `../sample-images/`

The photographs used for the AI module's seeded detections and its accuracy
evaluation. Author, licence and source page for each file are listed in
`../sample-images/attribution.json`. Images were downscaled to at most 640 px.

## Open-Meteo (live, not in this snapshot)

Weather and air-quality observations are fetched live from
[Open-Meteo.com](https://open-meteo.com) (CC BY 4.0); air quality is derived
from Copernicus Atmosphere Monitoring Service (CAMS) forecasts.
