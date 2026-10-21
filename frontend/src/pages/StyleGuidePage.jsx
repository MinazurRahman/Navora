import { useState } from 'react';
import { Bookmark, Compass, MapPin, Plus, Search, Trash2 } from 'lucide-react';
import { Badge } from '../components/Badge.jsx';
import { Button, IconButton } from '../components/Button.jsx';
import { Card } from '../components/Card.jsx';
import { Dialog } from '../components/Dialog.jsx';
import { Alert, EmptyState, Skeleton } from '../components/Feedback.jsx';
import { Checkbox, Field, Input, Select, Textarea } from '../components/Field.jsx';
import { Logo } from '../components/Logo.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { useToast } from '../components/useToast.js';
import styles from './StyleGuidePage.module.css';

// Development reference for the design system. Every control here works; content is
// illustrative only and is never shown to users as real data.
const COLORS = [
  ['Navy', '--color-navy', 'Headings, structure, links'],
  ['Action', '--color-action', 'Primary buttons, selected states'],
  ['Emerald', '--color-emerald', 'Brand accent only'],
  ['Cyan', '--color-cyan', 'Sparse accent'],
  ['Amber', '--color-amber', 'Sparse accent'],
  ['Background', '--color-bg', 'Page background'],
  ['Surface', '--color-surface', 'Cards, inputs'],
  ['Muted text', '--text-muted', 'Secondary text'],
];

function Section({ title, children }) {
  return (
    <section className={styles.section} aria-labelledby={`sg-${title}`}>
      <h2 id={`sg-${title}`} className={styles.sectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function StyleGuidePage() {
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const titleError = submitted && !title.trim() ? 'Enter a trip title.' : undefined;

  function simulateSave() {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      toast.show({ tone: 'success', message: 'Changes saved.' });
    }, 1200);
  }

  return (
    <main className="container">
      <PageHeader
        title="Design system"
        description="Tokens and components used across NAVORA. Development reference only."
      />

      <Section title="Logo">
        <div className={styles.logoRow}>
          <Logo />
          <Logo layout="stacked" />
        </div>
      </Section>

      <Section title="Colour">
        <div className={styles.swatches}>
          {COLORS.map(([name, token, use]) => (
            <div key={token} className={styles.swatch}>
              <span className={styles.swatchColor} style={{ background: `var(${token})` }} />
              <p className={styles.swatchName}>{name}</p>
              <p className={styles.swatchMeta}>
                <code>{token}</code>
              </p>
              <p className={styles.swatchMeta}>{use}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <div className="stack">
          <h1>Discover places. Plan better journeys.</h1>
          <h2>Old Dhaka in two days</h2>
          <h3>Day 1 itinerary</h3>
          <p>
            Body text is 16px Inter at 1.5 line height. Keep paragraphs short and labels concise so pages
            stay easy to scan on a phone.
          </p>
          <p className="muted">Secondary text for supporting details and metadata.</p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="cluster">
          <Button icon={Compass}>Explore places</Button>
          <Button variant="secondary" icon={Plus}>
            Add to trip
          </Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger" icon={Trash2}>
            Delete trip
          </Button>
          <Button loading={saving} onClick={simulateSave}>
            {saving ? 'Saving' : 'Save changes'}
          </Button>
          <Button disabled>Disabled</Button>
          <Button size="sm" variant="secondary">
            Small
          </Button>
          <IconButton icon={Bookmark} label="Save place" variant="secondary" />
        </div>
      </Section>

      <Section title="Form fields">
        <form
          className={styles.form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
            if (title.trim()) toast.show({ tone: 'success', message: `Form is valid: "${title.trim()}".` });
          }}
        >
          <Field label="Trip title" required error={titleError}>
            {(props) => <Input {...props} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Search" hint="Name or description">
            {(props) => <Input {...props} type="search" placeholder="Lalbagh Fort" />}
          </Field>
          <Field label="Travel mode">
            {(props) => (
              <Select {...props} defaultValue="walking">
                <option value="car">Car</option>
                <option value="walking">Walking</option>
                <option value="cycling">Cycling</option>
                <option value="public_transport">Public transport</option>
              </Select>
            )}
          </Field>
          <Field label="Notes" optional>
            {(props) => <Textarea {...props} />}
          </Field>
          <Checkbox
            label="Parking required"
            description="Only places with confirmed parking are included. Unknown does not count."
          />
          <Field label="Disabled field">{(props) => <Input {...props} disabled value="Read only" />}</Field>
          <div>
            <Button type="submit" icon={Search}>
              Validate form
            </Button>
          </div>
        </form>
      </Section>

      <Section title="Badges">
        <div className="cluster">
          <Badge>Museum</Badge>
          <Badge tone="success">Approved</Badge>
          <Badge tone="warning">Pending review</Badge>
          <Badge tone="danger">Rejected</Badge>
          <Badge tone="info">Estimated travel times</Badge>
        </div>
      </Section>

      <Section title="Alerts">
        <div className="stack">
          <Alert tone="warning" title="Opening hours could not be verified">
            This stop is included, but it may be closed when you arrive.
          </Alert>
          <Alert tone="info">Travel times are estimates based on distance.</Alert>
          <Alert tone="success">Your place was submitted and is waiting for review.</Alert>
          <Alert tone="danger" role="none" title="Something went wrong">
            The request could not be completed. Try again.
          </Alert>
        </div>
      </Section>

      <Section title="Card and loading">
        <div className={styles.cards}>
          <Card>
            <div className="stack">
              <div className="cluster">
                <Badge>Historical site</Badge>
              </div>
              <h3>Example place</h3>
              <p className="muted">
                <MapPin size={14} aria-hidden="true" className={styles.inlineIcon} />
                Sample address
              </p>
            </div>
          </Card>
          <Card aria-busy="true" aria-label="Loading place">
            <div className="stack">
              <Skeleton width="30%" height="1.25rem" />
              <Skeleton width="70%" height="1.5rem" />
              <Skeleton width="50%" />
            </div>
          </Card>
        </div>
      </Section>

      <Section title="Empty state">
        <Card>
          <EmptyState
            icon={Compass}
            title="No trips yet"
            description="Plan a trip to get a day-by-day itinerary with an ordered route."
            action={<Button icon={Plus}>Plan a trip</Button>}
          />
        </Card>
      </Section>

      <Section title="Dialog and toast">
        <div className="cluster">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Open dialog
          </Button>
          <Button variant="secondary" onClick={() => toast.show({ tone: 'info', message: 'Filters cleared.' })}>
            Show toast
          </Button>
        </div>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Delete this trip?"
          description="The trip and all its itinerary versions will be removed. This cannot be undone."
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setDialogOpen(false);
                  toast.show({ tone: 'info', message: 'Nothing was deleted: this is a preview.' });
                }}
              >
                Delete trip
              </Button>
            </>
          }
        />
      </Section>
    </main>
  );
}
