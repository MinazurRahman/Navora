import { Link } from 'react-router';
import { Compass, Route, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { Button } from '../components/Button.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import styles from './AboutPage.module.css';

const FEATURES = [
  {
    icon: Compass,
    title: 'Explore places',
    text: 'Search Dhaka’s landmarks and hidden gems by name, category, distance, budget, rating and facilities, on a list or a map.',
  },
  {
    icon: Route,
    title: 'Plan day by day',
    text: 'Tell NAVORA where you start, how long you have and what you enjoy. It picks places that fit, checks opening hours where they are known, and orders each day into a short route.',
  },
  {
    icon: Sparkles,
    title: 'Ask the trip assistant',
    text: 'An optional AI assistant explains your plan in plain words. It only explains: places, times and routes always come from NAVORA’s own rules.',
  },
  {
    icon: Users,
    title: 'Built with the community',
    text: 'Anyone with an account can suggest a place, save favourites and write reviews.',
  },
];

// Static information about NAVORA: what it does, how places are checked, and credits.
export function AboutPage() {
  return (
    <main className={`container ${styles.page}`}>
      <title>About | NAVORA</title>
      <PageHeader title="About NAVORA" description="Discover beyond the usual: places in and around Dhaka, and plans that fit your day." />

      <section className={styles.section} aria-labelledby="about-what">
        <h2 id="about-what">What NAVORA does</h2>
        <ul className={styles.features}>
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className={styles.feature}>
              <span className={styles.icon}>
                <Icon size={20} aria-hidden="true" />
              </span>
              <h3>{title}</h3>
              <p className="muted">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="about-moderation">
        <h2 id="about-moderation">
          <ShieldCheck size={20} aria-hidden="true" /> How places are checked
        </h2>
        <p>
          Every place suggested by the community is reviewed by a moderator before it appears in Explore or in anyone’s
          plans. Moderators approve a suggestion or send it back with a reason, which the person who suggested it can
          see; they can then correct it and send it again.
        </p>
        <p>
          NAVORA never presents a guess as a fact. When an entry fee, opening hours or a facility such as parking is not
          known, it says “unknown”, and plans warn you about it. Requirements you set, such as wheelchair access, are
          only met by places confirmed to have it.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="about-sources">
        <h2 id="about-sources">Sources and credits</h2>
        <p>
          Place descriptions are written for NAVORA from facts in the places’ Wikipedia articles. Photos come from{' '}
          <a href="https://commons.wikimedia.org/" rel="noreferrer">
            Wikimedia Commons
          </a>{' '}
          contributors under free licences; each photo is credited with its author and licence on the place’s page.
          Maps use data from{' '}
          <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">
            OpenStreetMap
          </a>{' '}
          contributors.
        </p>
        <p className="muted">
          Details such as opening hours and fees change. Check locally before you travel, especially for places marked
          as not verified.
        </p>
      </section>

      <div className="cluster">
        <Button as={Link} to="/explore" icon={Compass}>
          Explore places
        </Button>
        <Button as={Link} to="/plan" variant="secondary" icon={Route}>
          Plan a trip
        </Button>
      </div>
    </main>
  );
}
