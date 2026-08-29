'use strict';

/**
 * Six parks forming the demonstration city.
 *
 * Coordinates sit in and around Bengaluru, India. That choice is not
 * cosmetic: the air-quality mathematics uses CPCB breakpoints and the species
 * catalogue is Indian urban biodiversity, so placing the parks in an Indian
 * city keeps the whole dataset internally consistent.
 *
 * Boundaries are simple rectangles around each centre — enough for Leaflet to
 * draw a park outline without shipping real survey polygons.
 */

/** Rectangle of ±`half` degrees around a centre, as a GeoJSON Polygon ring. */
function boxAround([lng, lat], half) {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lng - half, lat - half],
        [lng + half, lat - half],
        [lng + half, lat + half],
        [lng - half, lat + half],
        [lng - half, lat - half], // closing point
      ],
    ],
  };
}

const PARKS = [
  {
    name: 'Central Green Park',
    slug: 'central-green-park',
    description:
      'The flagship civic park at the heart of the city, ringed by arterial roads. High footfall and the highest traffic-borne particulate load of any monitored site.',
    centre: [77.5946, 12.9716],
    halfWidth: 0.0055,
    areaAcres: 84,
    weeklyVisitors: 12400,
    establishedYear: 1974,
    address: 'MG Road, Central Zone',
    manager: 'D. Kulkarni',
    facilities: ['Amphitheatre', 'Children play area', 'Jogging track', 'Public restrooms', 'Drinking water'],
  },
  {
    name: 'Riverside Nature Reserve',
    slug: 'riverside-nature-reserve',
    description:
      'A protected wetland corridor along the river. The richest bird habitat in the network and the reference site for water-quality monitoring.',
    centre: [77.5731, 12.9542],
    halfWidth: 0.0085,
    areaAcres: 210,
    weeklyVisitors: 3200,
    establishedYear: 1998,
    address: 'River Road, South-West Zone',
    manager: 'M. Rethinam',
    facilities: ['Bird hide', 'Nature trail', 'Interpretation centre', 'Boardwalk'],
  },
  {
    name: 'Neem Grove Park',
    slug: 'neem-grove-park',
    description:
      'A neighbourhood park built around a mature neem plantation. Popular with families; the pollinator beds here host the largest recorded butterfly counts.',
    centre: [77.6108, 12.9803],
    halfWidth: 0.0042,
    areaAcres: 46,
    weeklyVisitors: 8900,
    establishedYear: 2006,
    address: 'Sector 7, North-East Zone',
    manager: 'S. Bhatt',
    facilities: ['Pollinator garden', 'Play equipment', 'Open-air gym', 'Seating pavilion'],
  },
  {
    name: 'Lakeview Botanical Garden',
    slug: 'lakeview-botanical-garden',
    description:
      'A curated botanical collection around two lakes. Nutrient runoff from the adjacent residential block makes this the site most prone to algal blooms.',
    centre: [77.5847, 12.9628],
    halfWidth: 0.0065,
    areaAcres: 120,
    weeklyVisitors: 7600,
    establishedYear: 1961,
    address: 'Lake Road, Central-South Zone',
    manager: 'P. Nair',
    facilities: ['Glasshouse', 'Boating jetty', 'Herbarium', 'Cafeteria', 'Guided tours'],
  },
  {
    name: 'Banyan Forest Park',
    slug: 'banyan-forest-park',
    description:
      'The largest closed-canopy site in the network, centred on a banyan grove over two centuries old. Lowest noise readings and the only recorded roost of the Indian Flying Fox.',
    centre: [77.6221, 12.9689],
    halfWidth: 0.008,
    areaAcres: 180,
    weeklyVisitors: 5200,
    establishedYear: 1952,
    address: 'Forest Road, East Zone',
    manager: 'R. Patel',
    facilities: ['Forest trail', 'Bat roost viewpoint', 'Picnic lawns', 'Ranger post'],
  },
  {
    name: 'Sunset Hills Park',
    slug: 'sunset-hills-park',
    description:
      'A hilltop park with the best air quality in the network thanks to its elevation and distance from arterial roads. Solar-powered lighting throughout.',
    centre: [77.6015, 12.9885],
    halfWidth: 0.005,
    areaAcres: 65,
    weeklyVisitors: 4100,
    establishedYear: 2013,
    address: 'Hill Road, North Zone',
    manager: 'T. Beckham',
    facilities: ['Viewpoint deck', 'Solar lighting', 'Hiking path', 'Parking'],
  },
];

module.exports = PARKS.map((park) => ({
  name: park.name,
  slug: park.slug,
  description: park.description,
  location: { type: 'Point', coordinates: park.centre },
  boundary: boxAround(park.centre, park.halfWidth),
  areaAcres: park.areaAcres,
  weeklyVisitors: park.weeklyVisitors,
  establishedYear: park.establishedYear,
  address: park.address,
  city: 'Smart City',
  manager: park.manager,
  facilities: park.facilities,
  images: [],
  active: true,
  /** Kept for the generator so it can scatter assets inside the boundary. */
  _centre: park.centre,
  _halfWidth: park.halfWidth,
}));
