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

// A calm stand-in for a place without photos, marked with its category.
export function PlaceholderImage({ category, className = '' }) {
  const Icon = CATEGORY_ICONS[category?.slug] ?? MapPin;
  return (
    <div className={`${styles.frame} ${styles.placeholder} ${className}`} aria-hidden="true">
      <Icon size={32} strokeWidth={1.5} />
    </div>
  );
}

// One photo. fit 'cover' fills the frame (fine when shapes are close); 'contain' shows the
// whole photo over a blurred copy of itself, so nothing important is cut off.
// No referrer: the photo host does not need to learn which NAVORA page was open.
export function Photo({ image, alt = '', size = 'large', fit = 'cover', eager = false, className = '', onError }) {
  const src = size === 'thumb' ? image.thumbUrl : image.url;
  const common = { referrerPolicy: 'no-referrer', decoding: 'async', loading: eager ? 'eager' : 'lazy' };
  return (
    <div className={`${styles.frame} ${className}`}>
      {fit === 'contain' && <img {...common} className={styles.backdrop} src={image.thumbUrl} alt="" aria-hidden="true" />}
      <img {...common} className={fit === 'contain' ? styles.contained : styles.img} src={src} alt={alt} onError={onError} />
    </div>
  );
}

// The place's cover photo, or the category placeholder when it has none or it fails to load.
// alt: '' on cards (the name is right next to it).
export function PlaceImage({ place, alt = '', className = '', eager = false, size = 'thumb', fit = 'cover' }) {
  const [failed, setFailed] = useState(false);
  const cover = place.images?.[0];
  if (!cover || failed) return <PlaceholderImage category={place.category} className={className} />;
  return <Photo image={cover} alt={alt} size={size} fit={fit} eager={eager} className={className} onError={() => setFailed(true)} />;
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
