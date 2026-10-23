import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Expand, X } from 'lucide-react';
import { IconButton } from '../../components/Button.jsx';
import { ImageCredit, Photo } from './PlaceImage.jsx';
import styles from './PlaceGallery.module.css';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Photo carousel for a place page. Photos are shown whole (never cropped) over a blurred
// copy of themselves. Swipe or scroll (CSS scroll snap), arrows, arrow keys or thumbnails
// change the photo; the expand button opens a full-screen viewer. Each photo has its credit.
export function PlaceGallery({ place }) {
  const images = place.images;
  const trackRef = useRef(null);
  const settleTimer = useRef(null);
  const [index, setIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const count = images.length;

  const go = (next) => setIndex((next + count) % count);

  // Scroll after the render: Chrome re-snaps a scroll-snap container when its children change,
  // which would cancel a scroll started before React updates the slides.
  useEffect(() => {
    const track = trackRef.current;
    if (!track?.clientWidth || Math.round(track.scrollLeft / track.clientWidth) === index) return;
    track.scrollTo?.({ left: index * track.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [index]);

  // Swiping moves the track; once it settles, follow it so the counter, thumbnails and credit
  // stay in step. Waiting for it to settle keeps a smooth programmatic scroll from flickering
  // the counter back to the photo it is leaving.
  function onScroll() {
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const track = trackRef.current;
      if (!track?.clientWidth) return;
      const current = Math.round(track.scrollLeft / track.clientWidth);
      if (current >= 0 && current < count) setIndex(current);
    }, 150);
  }

  useEffect(() => () => clearTimeout(settleTimer.current), []);

  function onKeyDown(event) {
    if (event.key === 'ArrowLeft') go(index - 1);
    else if (event.key === 'ArrowRight') go(index + 1);
    else return;
    event.preventDefault();
  }

  return (
    <section className={styles.gallery} aria-roledescription="carousel" aria-label={`Photos of ${place.name}`} onKeyDown={onKeyDown}>
      <div className={styles.stage}>
        <div ref={trackRef} className={styles.track} onScroll={onScroll} tabIndex={0} aria-label="Photos, use the arrow keys to browse">
          {images.map((image, i) => (
            <div
              key={image.url}
              className={styles.slide}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              aria-hidden={i !== index || undefined}
            >
              <Photo image={image} alt={`Photo ${i + 1} of ${place.name}`} fit="contain" eager={i === 0} className={styles.photo} />
            </div>
          ))}
        </div>
        {count > 1 && (
          <>
            <IconButton icon={ChevronLeft} label="Previous photo" className={`${styles.nav} ${styles.prev}`} onClick={() => go(index - 1)} />
            <IconButton icon={ChevronRight} label="Next photo" className={`${styles.nav} ${styles.next}`} onClick={() => go(index + 1)} />
            <span className={styles.counter} aria-live="polite">
              {index + 1} / {count}
            </span>
          </>
        )}
        <IconButton icon={Expand} label="View photo full screen" className={styles.expand} onClick={() => setViewerOpen(true)} />
      </div>

      <div className={styles.below}>
        <ImageCredit image={images[index]} />
        {count > 1 && (
          <ul className={styles.thumbs} aria-label="Choose a photo">
            {images.map((image, i) => (
              <li key={image.url}>
                <button
                  type="button"
                  className={styles.thumb}
                  aria-label={`Show photo ${i + 1}`}
                  aria-current={i === index || undefined}
                  onClick={() => go(i)}
                >
                  <img src={image.thumbUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {viewerOpen && <Viewer place={place} index={index} onChange={go} onClose={() => setViewerOpen(false)} />}
    </section>
  );
}

// Full-screen viewer on a native <dialog>: focus stays inside, Escape closes it.
function Viewer({ place, index, onChange, onClose }) {
  const ref = useRef(null);
  const images = place.images;
  const image = images[index];

  useEffect(() => {
    ref.current.showModal();
  }, []);

  function onKeyDown(event) {
    if (event.key === 'ArrowLeft') onChange(index - 1);
    else if (event.key === 'ArrowRight') onChange(index + 1);
    else return;
    event.preventDefault();
  }

  return (
    <dialog ref={ref} className={styles.viewer} aria-label={`Photos of ${place.name}`} onClose={onClose} onKeyDown={onKeyDown}>
      <div className={styles.viewerTop}>
        <span>
          {index + 1} / {images.length}
        </span>
        <IconButton icon={X} label="Close" className={styles.viewerButton} onClick={() => ref.current.close()} />
      </div>
      <img
        key={image.url}
        className={styles.viewerImage}
        src={image.url}
        alt={`Photo ${index + 1} of ${place.name}`}
        referrerPolicy="no-referrer"
      />
      {images.length > 1 && (
        <>
          <IconButton icon={ChevronLeft} label="Previous photo" className={`${styles.viewerButton} ${styles.viewerPrev}`} onClick={() => onChange(index - 1)} />
          <IconButton icon={ChevronRight} label="Next photo" className={`${styles.viewerButton} ${styles.viewerNext}`} onClick={() => onChange(index + 1)} />
        </>
      )}
      <ImageCredit image={image} className={styles.viewerCredit} />
    </dialog>
  );
}
