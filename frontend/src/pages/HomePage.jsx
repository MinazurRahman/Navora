import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, Compass, ListChecks, MapPinPlus, Route, Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '../components/Button.jsx';
import { ErrorState } from '../components/ErrorState.jsx';
import { Skeleton } from '../components/Feedback.jsx';
import { useCategories } from '../features/catalogue/api.js';
import { usePlaces } from '../features/places/api.js';
import { PlaceCard, PlaceCardSkeleton } from '../features/places/PlaceCard.jsx';
import styles from './HomePage.module.css';

const STEPS = [
  {
    icon: Compass,
    title: 'Explore places',
    text: 'Search approved places in Dhaka, including hidden gems added by the community.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Set your preferences',
    text: 'Choose your interests, budget, travel mode and must-haves such as parking.',
  },
  {
    icon: ListChecks,
    title: 'Get a day-by-day plan',
    text: 'NAVORA checks opening hours and travel times and orders each day into a route.',
  },
];

function HeroSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  function onSubmit(event) {
    event.preventDefault();
    const q = query.trim();
    navigate(q ? `/explore?q=${encodeURIComponent(q)}` : '/explore');
  }

  return (
    <form className={styles.search} role="search" onSubmit={onSubmit}>
      <label htmlFor="home-search" className="visually-hidden">
        Search places
      </label>
      <div className={styles.searchField}>
        <Search size={18} aria-hidden="true" className={styles.searchIcon} />
        <input
          id="home-search"
          type="search"
          className={styles.searchInput}
          placeholder="Search places, for example Lalbagh Fort"
          value={query}
          maxLength={100}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <Button type="submit">Explore</Button>
    </form>
  );
}

function CategoryLinks() {
  const { data, isPending, isError } = useCategories();

  return (
    <section className={styles.categories} aria-labelledby="home-categories">
      <h2 id="home-categories" className={styles.panelTitle}>
        Browse by category
      </h2>
      {isPending && (
        <div className={styles.chips} aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} width={`${5 + (i % 3) * 1.5}rem`} height="2.25rem" />
          ))}
        </div>
      )}
      {isError && <p className="muted">Categories could not be loaded.</p>}
      {data && (
        <ul className={styles.chips}>
          {data.map((category) => (
            <li key={category.slug}>
              <Link to={`/explore?category=${category.slug}`} className={styles.chip}>
                {category.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// emptyText: shown when there are no places; without it an empty section is left out.
function PlaceSection({ id, title, description, filters, count, emptyText }) {
  const { data, isPending, isError, error, refetch } = usePlaces({ ...filters, limit: count });
  if (data && data.data.length === 0 && !emptyText) return null;

  return (
    <section className={styles.section} aria-labelledby={id}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 id={id}>{title}</h2>
          {description && <p className="muted">{description}</p>}
        </div>
        <Link to="/explore" className={styles.viewAll}>
          View all places
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
      {isPending && (
        <div className={styles.grid} aria-busy="true" aria-label={`Loading ${title.toLowerCase()}`}>
          {Array.from({ length: count }, (_, i) => (
            <PlaceCardSkeleton key={i} />
          ))}
        </div>
      )}
      {isError && <ErrorState error={error} onRetry={refetch} title="Places could not be loaded" />}
      {data && data.data.length === 0 && <p className="muted">{emptyText}</p>}
      {data && data.data.length > 0 && (
        <ul className={styles.grid}>
          {data.data.map((place) => (
            <li key={place.id}>
              <PlaceCard place={place} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function HomePage() {
  return (
    <main>
      <title>NAVORA | Discover places and plan journeys in Dhaka</title>

      <div className={styles.heroBand}>
        <div className={`container ${styles.hero}`}>
          <div className={styles.heroText}>
            <p className={styles.eyebrow}>Discover beyond the usual</p>
            <h1 className={styles.heroTitle}>Discover places. Plan better journeys.</h1>
            <p className={styles.heroLead}>
              Find well-known landmarks and hidden gems recommended by people who know Dhaka, then turn
              them into a day-by-day itinerary that fits your time, budget and travel mode.
            </p>
            <HeroSearch />
            <div className={styles.heroActions}>
              <Button as={Link} to="/plan" variant="secondary" icon={Route}>
                Plan a trip
              </Button>
            </div>
          </div>
          <CategoryLinks />
        </div>
      </div>

      <div className="container">
        <PlaceSection
          id="home-recent"
          title="Recently added"
          description="The newest places approved by our moderators."
          filters={{}}
          count={6}
          emptyText="No places have been approved yet."
        />

        <PlaceSection
          id="home-rated"
          title="Rated 4 stars and above"
          description="Places the community has reviewed well."
          filters={{ minRating: 4 }}
          count={3}
        />

        <section className={styles.section} aria-labelledby="home-how">
          <h2 id="home-how">How NAVORA works</h2>
          <ol className={styles.steps}>
            {STEPS.map(({ icon: Icon, title, text }, index) => (
              <li key={title} className={styles.step}>
                <span className={styles.stepIcon}>
                  <Icon size={20} aria-hidden="true" />
                </span>
                <p className={styles.stepNumber}>Step {index + 1}</p>
                <h3>{title}</h3>
                <p className="muted">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.ctaGrid} aria-label="Get started">
          <div className={styles.cta}>
            <h2 className={styles.ctaTitle}>Ready to plan your days?</h2>
            <p className="muted">Tell NAVORA where you start and what you enjoy. Trips can last up to 14 days.</p>
            <div>
              <Button as={Link} to="/plan" icon={Route}>
                Plan a trip
              </Button>
            </div>
          </div>
          <div className={styles.cta}>
            <h2 className={styles.ctaTitle}>Know a place others should see?</h2>
            <p className="muted">Suggest it to the community. Moderators review every submission before it is listed.</p>
            <div>
              <Button as={Link} to="/community/submit" variant="secondary" icon={MapPinPlus}>
                Suggest a place
              </Button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

