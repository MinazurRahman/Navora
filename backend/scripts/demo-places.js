// Well-known Dhaka-area places for development and demos.
// Coordinates are APPROXIMATE (good to roughly 100–300 m) and must be verified before
// any production use. Entry fees, opening hours and facilities are deliberately left
// unknown: they change, and unverified values would be presented to users as facts.
// [name, category slug, latitude, longitude, tags, description]
export const DEMO_PLACES = [
  // Old Dhaka
  ['Lalbagh Fort', 'historical_site', 23.7189, 90.3882, ['history', 'architecture', 'photography'], 'Unfinished 17th-century Mughal fort complex.'],
  ['Ahsan Manzil', 'museum', 23.7086, 90.4062, ['history', 'architecture'], 'The "Pink Palace" of the Nawabs of Dhaka, now a museum, on the Buriganga.'],
  ['Star Mosque', 'religious_site', 23.7154, 90.4011, ['religion', 'architecture', 'photography'], 'Mosque decorated with star mosaics, in Armanitola.'],
  ['Armenian Church of the Holy Resurrection', 'religious_site', 23.7139, 90.4043, ['religion', 'history'], '18th-century Armenian church in Armanitola.'],
  ['Dhakeshwari Temple', 'religious_site', 23.7232, 90.3886, ['religion', 'culture', 'history'], 'Hindu temple complex, often called the national temple.'],
  ['Khan Mohammad Mridha Mosque', 'religious_site', 23.7197, 90.3846, ['religion', 'history', 'architecture'], 'Mughal-era mosque on a raised platform near Lalbagh.'],
  ['Hussaini Dalan', 'religious_site', 23.7200, 90.3953, ['religion', 'history', 'culture'], 'Mughal-era Shia imambara.'],
  ['Bara Katra', 'historical_site', 23.7135, 90.3980, ['history', 'architecture'], 'Remains of a 17th-century Mughal caravanserai near the river.'],
  ['Chhota Katra', 'historical_site', 23.7128, 90.4005, ['history'], 'Remains of a smaller 17th-century Mughal caravanserai.'],
  ['Rose Garden Palace', 'historical_site', 23.7163, 90.4196, ['history', 'architecture', 'photography'], 'Early 20th-century mansion in Old Dhaka.'],
  ['Ruplal House', 'historical_site', 23.7083, 90.4088, ['history', 'architecture'], '19th-century merchant mansion on the Buriganga.'],
  ['Sadarghat', 'lake_or_river', 23.7058, 90.4106, ['local_experience', 'photography'], 'Busy river port on the Buriganga.'],
  ['Shankhari Bazar', 'market', 23.7101, 90.4106, ['culture', 'local_experience', 'history'], 'Narrow old street of conch-shell craftsmen.'],
  ['Chawkbazar', 'street_food', 23.7172, 90.3960, ['food', 'local_experience'], 'Old Dhaka market area known for its food.'],
  ['Nazira Bazar', 'street_food', 23.7175, 90.4080, ['food', 'local_experience'], 'Old Dhaka neighbourhood known for biryani shops.'],
  ['Baldha Garden', 'park', 23.7170, 90.4195, ['nature', 'history'], 'Historic botanical garden in Wari.'],

  // Central Dhaka
  ['Curzon Hall', 'historical_site', 23.7281, 90.4005, ['architecture', 'history'], 'Early 20th-century building of the University of Dhaka.'],
  ['Central Shaheed Minar', 'historical_site', 23.7270, 90.3969, ['history', 'culture'], 'National monument to the 1952 Language Movement.'],
  ['Bangladesh National Museum', 'museum', 23.7375, 90.3950, ['history', 'culture', 'art'], 'The national museum, in Shahbagh.'],
  ['Baitul Mukarram National Mosque', 'religious_site', 23.7296, 90.4127, ['religion', 'architecture'], 'The national mosque of Bangladesh.'],
  ['Ramna Park', 'park', 23.7380, 90.4010, ['nature', 'relaxation'], 'Large central park with a lake.'],
  ['Suhrawardy Udyan', 'park', 23.7325, 90.3990, ['history', 'nature'], 'Historic park, site of the 1971 surrender.'],
  ['Bangladesh Shilpakala Academy', 'cultural_center', 23.7353, 90.4040, ['culture', 'art'], 'National academy of fine and performing arts.'],
  ['Bangla Academy', 'cultural_center', 23.7301, 90.3990, ['culture', 'history'], 'National language institute; hosts the Ekushey Book Fair.'],
  ['Central Public Library', 'library', 23.7365, 90.3960, ['culture'], 'Public library in Shahbagh.'],
  ['Kamalapur Railway Station', 'historical_site', 23.7320, 90.4260, ['architecture', 'photography'], 'Main railway station, known for its modernist roof.'],
  ['New Market', 'market', 23.7330, 90.3842, ['shopping', 'local_experience'], 'Large shopping market opened in the 1950s.'],
  ['Karwan Bazar', 'market', 23.7514, 90.3936, ['local_experience', 'food'], 'One of the city\'s largest wholesale markets.'],
  ['Bashundhara City', 'shopping_mall', 23.7509, 90.3907, ['shopping', 'family'], 'Large shopping mall in Panthapath.'],
  ['Hatirjheel', 'lake_or_river', 23.7536, 90.3994, ['nature', 'photography', 'relaxation'], 'Lake and waterfront promenade.'],
  ['Dhanmondi Lake', 'lake_or_river', 23.7465, 90.3770, ['nature', 'relaxation'], 'Lake with walking paths through Dhanmondi.'],

  // North and west
  ['National Parliament House', 'historical_site', 23.7626, 90.3786, ['architecture', 'photography'], 'Jatiya Sangsad Bhaban, designed by Louis Kahn.'],
  ['Liberation War Museum', 'museum', 23.7808, 90.3779, ['history'], 'Museum of the 1971 Liberation War, in Agargaon.'],
  ['Bangladesh Military Museum', 'museum', 23.7795, 90.3875, ['history', 'family'], 'Military history museum in Bijoy Sarani.'],
  ['Sat Gambuj Mosque', 'religious_site', 23.7568, 90.3584, ['religion', 'history', 'architecture'], 'Seven-domed Mughal mosque in Mohammadpur.'],
  ['Gulshan Lake Park', 'park', 23.7900, 90.4140, ['nature', 'relaxation'], 'Lakeside park in Gulshan.'],
  ['Jamuna Future Park', 'shopping_mall', 23.8134, 90.4243, ['shopping', 'family'], 'Very large shopping mall in Kuril.'],
  ['Bangladesh National Zoo', 'zoo', 23.8136, 90.3456, ['family', 'nature'], 'The national zoo, in Mirpur.'],
  ['National Botanical Garden', 'park', 23.8167, 90.3489, ['nature', 'family'], 'Botanical garden in Mirpur.'],
  ['Diabari', 'lake_or_river', 23.8780, 90.3720, ['nature', 'photography'], 'Lakes and open fields in Uttara.'],

  // Outside the city
  ['National Martyrs\' Memorial', 'historical_site', 23.9113, 90.2547, ['history', 'architecture'], 'Jatiyo Smriti Soudho in Savar, memorial to the Liberation War.'],
  ['Fantasy Kingdom', 'amusement_park', 23.8960, 90.3195, ['family', 'adventure'], 'Amusement park in Ashulia.'],
  ['Panam Nagar', 'historical_site', 23.6510, 90.6062, ['history', 'architecture', 'photography'], 'Abandoned 19th-century merchant town in Sonargaon.'],
  ['Folk Art and Crafts Museum, Sonargaon', 'museum', 23.6460, 90.6075, ['culture', 'art', 'history'], 'Folk art and crafts museum in Sonargaon.'],
];
