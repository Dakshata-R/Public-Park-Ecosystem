'use strict';

/**
 * Species catalogue for the demonstration dataset — Indian urban biodiversity.
 *
 * The mix is deliberate rather than arbitrary. It contains:
 *   • common generalists (myna, palm squirrel) that dominate raw abundance,
 *   • specialists and threatened species that carry the conservation weight,
 *   • three invasive species, so the invasive counter and the evenness term
 *     have something real to react to,
 *   • indicator species used to justify the tree-health and water sub-indices.
 *
 * `weight` is the relative abundance the observation generator samples with —
 * it is what makes the Shannon and evenness figures come out at realistic
 * values instead of a flat, implausible distribution.
 *
 * `parkAffinity` lists park slugs where the species is plausible; an empty
 * array means it may appear anywhere.
 */

module.exports = [
  // ---- Birds --------------------------------------------------------------
  {
    commonName: 'Common Myna', scientificName: 'Acridotheres tristis', class: 'bird', family: 'Sturnidae',
    conservationStatus: 'Least Concern', habitat: 'Urban open ground, lawns, refuse areas',
    description: 'An adaptable urban generalist that thrives alongside people. Very high abundance depresses evenness, which is why a myna-dominated park can score poorly on biodiversity despite a long species list.',
    weight: 26, seasonality: [1,2,3,4,5,6,7,8,9,10,11,12], parkAffinity: [],
  },
  {
    commonName: 'Rose-ringed Parakeet', scientificName: 'Psittacula krameri', class: 'bird', family: 'Psittaculidae',
    conservationStatus: 'Least Concern', habitat: 'Mature tree canopy, cavity nester',
    description: 'Cavity-nesting parakeet dependent on old trees. Its presence indicates that the canopy contains mature, undisturbed specimens.',
    weight: 18, isIndicator: true, seasonality: [1,2,3,4,5,6,7,8,9,10,11,12], parkAffinity: ['banyan-forest-park', 'neem-grove-park'],
  },
  {
    commonName: 'Black Kite', scientificName: 'Milvus migrans', class: 'bird', family: 'Accipitridae',
    conservationStatus: 'Least Concern', habitat: 'Open sky over the city, scavenges widely',
    description: 'The dominant urban raptor. A stable kite population indicates a functioning scavenging food web.',
    weight: 9, seasonality: [1,2,3,4,5,6,7,8,9,10,11,12], parkAffinity: [],
  },
  {
    commonName: 'Purple Sunbird', scientificName: 'Cinnyris asiaticus', class: 'bird', family: 'Nectariniidae',
    conservationStatus: 'Least Concern', habitat: 'Flowering shrubs and garden beds',
    description: 'A nectar specialist whose numbers track flowering-plant availability directly — the clearest bird-side signal that pollinator planting is working.',
    weight: 11, isIndicator: true, seasonality: [1,2,3,4,10,11,12], parkAffinity: ['neem-grove-park', 'lakeview-botanical-garden'],
  },
  {
    commonName: 'Indian Pond Heron', scientificName: 'Ardeola grayii', class: 'bird', family: 'Ardeidae',
    conservationStatus: 'Least Concern', habitat: 'Lake margins, marsh, slow water',
    description: 'A wetland wader that feeds on fish and amphibians. Sustained presence requires water clean enough to support prey, making it the field check on the water-quality sub-index.',
    weight: 7, isIndicator: true, seasonality: [1,2,3,4,5,6,7,8,9,10,11,12], parkAffinity: ['riverside-nature-reserve', 'lakeview-botanical-garden'],
  },
  {
    commonName: 'White-throated Kingfisher', scientificName: 'Halcyon smyrnensis', class: 'bird', family: 'Alcedinidae',
    conservationStatus: 'Least Concern', habitat: 'Water edges, open country',
    description: 'A conspicuous kingfisher that hunts from exposed perches over water and grassland.',
    weight: 5, seasonality: [1,2,3,4,5,6,7,8,9,10,11,12], parkAffinity: ['riverside-nature-reserve', 'lakeview-botanical-garden'],
  },
  {
    commonName: 'Indian Peafowl', scientificName: 'Pavo cristatus', class: 'bird', family: 'Phasianidae',
    conservationStatus: 'Least Concern', habitat: 'Scrub, wooded park margins',
    description: 'Ground-dwelling and highly visible. Populations can grow beyond what a small park supports where visitors feed them.',
    weight: 4, seasonality: [3,4,5,6,7,8], parkAffinity: ['banyan-forest-park', 'riverside-nature-reserve'],
  },
  {
    commonName: 'Painted Stork', scientificName: 'Mycteria leucocephala', class: 'bird', family: 'Ciconiidae',
    conservationStatus: 'Near Threatened', habitat: 'Shallow freshwater wetlands',
    description: 'A large colonial wader that is near threatened across its range. Records here are the strongest single indicator of wetland quality in the network.',
    weight: 2, isIndicator: true, seasonality: [11,12,1,2,3], parkAffinity: ['riverside-nature-reserve'],
  },
  {
    commonName: 'Oriental White-backed Vulture', scientificName: 'Gyps bengalensis', class: 'bird', family: 'Accipitridae',
    conservationStatus: 'Critically Endangered', habitat: 'Tall roost trees, open scavenging ground',
    description: 'Collapsed by over 99 % across South Asia following veterinary diclofenac poisoning. Any confirmed record is regionally significant and is escalated to the state forest department.',
    weight: 1, isIndicator: true, seasonality: [1,2,11,12], parkAffinity: ['banyan-forest-park'],
  },

  // ---- Mammals ------------------------------------------------------------
  {
    commonName: 'Three-striped Palm Squirrel', scientificName: 'Funambulus palmarum', class: 'mammal', family: 'Sciuridae',
    conservationStatus: 'Least Concern', habitat: 'Tree trunks, garden walls',
    description: 'Ubiquitous urban rodent and an important seed disperser for native trees.',
    weight: 22, seasonality: [1,2,3,4,5,6,7,8,9,10,11,12], parkAffinity: [],
  },
  {
    commonName: 'Indian Flying Fox', scientificName: 'Pteropus medius', class: 'mammal', family: 'Pteropodidae',
    conservationStatus: 'Least Concern', habitat: 'Large roost trees, forages on fruiting trees',
    description: 'A colonial fruit bat and a major long-distance pollinator and seed disperser. Requires undisturbed roost trees, so a colony is direct evidence of canopy continuity.',
    weight: 6, isIndicator: true, seasonality: [1,2,3,4,5,6,7,8,9,10,11,12], parkAffinity: ['banyan-forest-park'],
  },
  {
    commonName: 'Small Indian Mongoose', scientificName: 'Urva auropunctata', class: 'mammal', family: 'Herpestidae',
    conservationStatus: 'Least Concern', habitat: 'Scrub, hedgerows, park margins',
    description: 'A crepuscular predator of rodents and reptiles. Sightings suggest ground cover is intact enough to support hunting.',
    weight: 3, seasonality: [1,2,3,4,5,6,7,8,9,10,11,12], parkAffinity: ['riverside-nature-reserve', 'banyan-forest-park'],
  },
  {
    commonName: 'Indian Grey Mongoose', scientificName: 'Urva edwardsii', class: 'mammal', family: 'Herpestidae',
    conservationStatus: 'Least Concern', habitat: 'Open scrub and grassland',
    description: 'Larger and more diurnal than its small congener; often seen crossing open lawns at dawn.',
    weight: 2, seasonality: [1,2,3,4,5,6,7,8,9,10,11,12], parkAffinity: ['sunset-hills-park', 'banyan-forest-park'],
  },

  // ---- Butterflies --------------------------------------------------------
  {
    commonName: 'Common Mormon', scientificName: 'Papilio polytes', class: 'butterfly', family: 'Papilionidae',
    conservationStatus: 'Least Concern', habitat: 'Citrus and curry-leaf host plants',
    description: 'A large swallowtail whose females mimic the toxic Common Rose. Depends on specific larval host plants, so it responds quickly to planting decisions.',
    weight: 14, seasonality: [6,7,8,9,10,11], parkAffinity: ['neem-grove-park', 'lakeview-botanical-garden'],
  },
  {
    commonName: 'Plain Tiger', scientificName: 'Danaus chrysippus', class: 'butterfly', family: 'Nymphalidae',
    conservationStatus: 'Least Concern', habitat: 'Open grassland with Calotropis',
    description: 'The Indian analogue of the Monarch, and like it an obligate milkweed feeder. Its abundance is the single best proxy for milkweed availability.',
    weight: 20, isIndicator: true, seasonality: [3,4,5,6,7,8,9,10], parkAffinity: ['neem-grove-park', 'sunset-hills-park'],
  },
  {
    commonName: 'Blue Tiger', scientificName: 'Tirumala limniace', class: 'butterfly', family: 'Nymphalidae',
    conservationStatus: 'Least Concern', habitat: 'Woodland edges; forms migratory aggregations',
    description: 'Migrates in large aggregations before the monsoon. Peak counts are strongly seasonal, which is why the seasonality chart matters for interpreting its numbers.',
    weight: 12, seasonality: [4,5,6,9,10], parkAffinity: ['banyan-forest-park', 'riverside-nature-reserve'],
  },
  {
    commonName: 'Crimson Rose', scientificName: 'Pachliopta hector', class: 'butterfly', family: 'Papilionidae',
    conservationStatus: 'Near Threatened', habitat: 'Aristolochia host vines',
    description: 'Protected under Schedule I of the Indian Wildlife (Protection) Act. Restricted to sites where its Aristolochia host vine survives.',
    weight: 3, isIndicator: true, seasonality: [10,11,12,1,2], parkAffinity: ['lakeview-botanical-garden'],
  },

  // ---- Reptiles & amphibians ---------------------------------------------
  {
    commonName: 'Oriental Garden Lizard', scientificName: 'Calotes versicolor', class: 'reptile', family: 'Agamidae',
    conservationStatus: 'Least Concern', habitat: 'Shrubs, walls, low branches',
    description: 'Common diurnal agamid; males develop a red throat in the breeding season.',
    weight: 10, seasonality: [1,2,3,4,5,6,7,8,9,10,11,12], parkAffinity: [],
  },
  {
    commonName: 'Indian Rat Snake', scientificName: 'Ptyas mucosa', class: 'reptile', family: 'Colubridae',
    conservationStatus: 'Least Concern', habitat: 'Grassland, scrub, near water',
    description: 'A large non-venomous constrictor and an effective rodent control. Frequently killed on sight, so records are a proxy for public tolerance as well as habitat.',
    weight: 3, seasonality: [3,4,5,6,7,8,9], parkAffinity: ['riverside-nature-reserve', 'banyan-forest-park'],
  },
  {
    commonName: 'Indian Bullfrog', scientificName: 'Hoplobatrachus tigerinus', class: 'amphibian', family: 'Dicroglossidae',
    conservationStatus: 'Least Concern', habitat: 'Ponds, ditches, seasonal wetland',
    description: 'Amphibian skin is permeable, making the species acutely sensitive to water contamination — a decline here typically precedes any change in the chemical water readings.',
    weight: 6, isIndicator: true, seasonality: [6,7,8,9], parkAffinity: ['riverside-nature-reserve', 'lakeview-botanical-garden'],
  },

  // ---- Trees --------------------------------------------------------------
  {
    commonName: 'Neem', scientificName: 'Azadirachta indica', class: 'tree', family: 'Meliaceae',
    conservationStatus: 'Least Concern', habitat: 'Dry urban soils, roadside plantings',
    description: 'Drought-hardy native shade tree with high particulate-capture leaf area. The backbone species of the city planting programme.',
    weight: 30, isIndicator: true, seasonality: [1,2,3,4,5,6,7,8,9,10,11,12], parkAffinity: [],
  },
  {
    commonName: 'Banyan', scientificName: 'Ficus benghalensis', class: 'tree', family: 'Moraceae',
    conservationStatus: 'Least Concern', habitat: 'Deep soils, requires space for prop roots',
    description: 'A keystone fig: it fruits year-round and supports more frugivore species than any other tree in the network. Losing one mature banyan removes more habitat than losing fifty saplings.',
    weight: 8, isIndicator: true, seasonality: [1,2,3,4,5,6,7,8,9,10,11,12], parkAffinity: ['banyan-forest-park'],
  },
  {
    commonName: 'Peepal', scientificName: 'Ficus religiosa', class: 'tree', family: 'Moraceae',
    conservationStatus: 'Least Concern', habitat: 'Urban soils, tolerant of compaction',
    description: 'A second keystone fig, culturally protected and therefore often the oldest tree on a site.',
    weight: 12, isIndicator: true, seasonality: [1,2,3,4,5,6,7,8,9,10,11,12], parkAffinity: [],
  },
  {
    commonName: 'Gulmohar', scientificName: 'Delonix regia', class: 'tree', family: 'Fabaceae',
    conservationStatus: 'Least Concern', habitat: 'Avenue planting',
    description: 'Introduced flowering avenue tree. Spectacular in summer but shallow-rooted and the species most often lost to storm-driven tree falls.',
    weight: 14, seasonality: [4,5,6], parkAffinity: ['central-green-park', 'neem-grove-park'],
  },
  {
    commonName: 'Rain Tree', scientificName: 'Samanea saman', class: 'tree', family: 'Fabaceae',
    conservationStatus: 'Least Concern', habitat: 'Large open lawns',
    description: 'A wide-crowned shade tree. Its canopy spread makes it the highest single contributor to cooling in open areas.',
    weight: 10, seasonality: [1,2,3,4,5,6,7,8,9,10,11,12], parkAffinity: ['central-green-park', 'sunset-hills-park'],
  },

  // ---- Plants -------------------------------------------------------------
  {
    commonName: 'Giant Milkweed', scientificName: 'Calotropis gigantea', class: 'plant', family: 'Apocynaceae',
    conservationStatus: 'Least Concern', habitat: 'Waste ground, open sunny margins',
    description: 'The larval host plant of the Plain Tiger. Often cleared as a weed, which is the most common avoidable cause of butterfly decline in the network.',
    weight: 25, isIndicator: true, seasonality: [1,2,3,4,5,6,7,8,9,10,11,12], parkAffinity: ['neem-grove-park', 'sunset-hills-park'],
  },
  {
    commonName: 'Holy Basil', scientificName: 'Ocimum tenuiflorum', class: 'plant', family: 'Lamiaceae',
    conservationStatus: 'Least Concern', habitat: 'Cultivated beds, sunny borders',
    description: 'A widely cultivated aromatic herb and a reliable nectar source for small bees.',
    weight: 15, seasonality: [1,2,3,4,5,6,7,8,9,10,11,12], parkAffinity: ['lakeview-botanical-garden'],
  },

  // ---- Invasives ----------------------------------------------------------
  {
    commonName: 'Lantana', scientificName: 'Lantana camara', class: 'plant', family: 'Verbenaceae',
    conservationStatus: 'Least Concern', habitat: 'Disturbed ground, forest edges',
    description: 'INVASIVE. Forms dense allelopathic thickets that suppress native understorey regeneration. Toxic to grazing animals. Requires removal including the root crown.',
    weight: 7, isInvasive: true, seasonality: [1,2,3,4,5,6,7,8,9,10,11,12], parkAffinity: ['banyan-forest-park', 'riverside-nature-reserve'],
  },
  {
    commonName: 'Congress Grass', scientificName: 'Parthenium hysterophorus', class: 'plant', family: 'Asteraceae',
    conservationStatus: 'Least Concern', habitat: 'Roadsides, waste ground, disturbed soil',
    description: 'INVASIVE. A prolific coloniser of disturbed soil and a significant cause of allergic dermatitis and asthma in maintenance staff.',
    weight: 6, isInvasive: true, seasonality: [6,7,8,9,10], parkAffinity: ['central-green-park', 'sunset-hills-park'],
  },
  {
    commonName: 'Water Hyacinth', scientificName: 'Pontederia crassipes', class: 'plant', family: 'Pontederiaceae',
    conservationStatus: 'Least Concern', habitat: 'Still and slow-moving fresh water',
    description: 'INVASIVE. Doubles its biomass in under two weeks in nutrient-rich water, blocking light and driving dissolved oxygen down until fish kills follow. The primary threat to both lakes.',
    weight: 8, isInvasive: true, seasonality: [1,2,3,4,5,6,7,8,9,10,11,12], parkAffinity: ['lakeview-botanical-garden', 'riverside-nature-reserve'],
  },
];
