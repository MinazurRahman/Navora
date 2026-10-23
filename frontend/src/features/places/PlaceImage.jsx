import { useState } from 'react';
import {
  BookOpen,
  Building2,
  Castle,
  Coffee,
  FerrisWheel,
  Landmark,
  MapPin,
  Mountain,
  Palette,
  PawPrint,
  ShoppingBag,
  Soup,
  Store,
  Theater,
  Trees,
  UtensilsCrossed,
  Waves,
} from 'lucide-react';
import styles from './PlaceImage.module.css';

const CATEGORY_ICONS = {
  amusement_park: FerrisWheel,
  art_gallery: Palette,
  cafe: Coffee,
  cultural_center: Theater,
  historical_site: Castle,
  lake_or_river: Waves,
  library: BookOpen,
  market: Store,
  museum: Landmark,
  park: Trees,
  religious_site: Building2,
  restaurant: UtensilsCrossed,
  shopping_mall: ShoppingBag,
  street_food: Soup,
  viewpoint: Mountain,
  zoo: PawPrint,
};

// The place's photo, or a calm category placeholder when it has none or it fails to load.
// alt: '' on cards (the name is right next to it); a description where the photo stands alone.
// No referrer: the photo host does not need to learn which NAVORA page was open.
export function PlaceImage({ place, alt = '', className = '', eager = false }) {
  const [failed, setFailed] = useState(false);
  const url = place.image?.url;

  if (!url || failed) {
    const Icon = CATEGORY_ICONS[place.category.slug] ?? MapPin;
    return (
      <div className={`${styles.frame} ${styles.placeholder} ${className}`} aria-hidden="true">
        <Icon size={32} strokeWidth={1.5} />
      </div>
    );
  }

  return (
    <div className={`${styles.frame} ${className}`}>
      <img
        className={styles.img}
        src={url}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

// "Photo: author, license" with links to the license and the source page, as the licenses require.
export function ImageCredit({ image, className = '' }) {
  if (!image) return null;
  return (
    <p className={`${styles.credit} ${className}`}>
      Photo:{' '}
      <a href={image.sourceUrl} rel="noreferrer">
        {image.author}
      </a>
      ,{' '}
      {image.licenseUrl ? (
        <a href={image.licenseUrl} rel="license noreferrer">
          {image.license}
        </a>
      ) : (
        image.license
      )}
      , via Wikimedia Commons
    </p>
  );
}
