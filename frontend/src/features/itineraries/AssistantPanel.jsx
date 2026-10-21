import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bot, Lightbulb, MessageCircleQuestion, Send } from 'lucide-react';
import { Badge } from '../../components/Badge.jsx';
import { Button } from '../../components/Button.jsx';
import { Alert } from '../../components/Feedback.jsx';
import { Field, Select, Textarea } from '../../components/Field.jsx';
import { errorMessage } from '../../lib/errors.js';
import { askAssistant, getAssistantStatus } from './api.js';
import styles from './AssistantPanel.module.css';

// AI Trip Assistant: explains this itinerary. It is read-only and its answers are
// AI-generated plain text, so they are shown as text (never HTML) with the backend's
// disclaimer. NAVORA's itinerary above stays authoritative.

const TASKS = [
  { task: 'summarize', label: 'Summarise this trip' },
  { task: 'explain_itinerary', label: 'Why this plan?' },
  { task: 'explain_warnings', label: 'Explain the warnings', needsWarnings: true },
  { task: 'suggest_adjustments', label: 'Suggest changes', currentOnly: true },
];

const SUGGESTION_LABELS = {
  REMOVE_STOP: 'Remove a stop',
  MOVE_STOP: 'Move a stop to another day',
  REORDER_DAY: 'Reorder a day',
  ADD_RECOMMENDED_PLACE: 'Add a recommended place',
  VERIFY_OPENING_HOURS: 'Check opening hours',
  VERIFY_ENTRY_FEE: 'Check the entry fee',
};

function assistantError(error) {
  if (error.code === 'AI_UNAVAILABLE') {
    return error.details?.reason === 'TIMEOUT'
      ? 'The assistant took too long to answer. It may be starting up; try again in a minute.'
      : 'The assistant is not available right now. Try again later.';
  }
  if (error.code === 'ASSISTANT_CONTEXT_TOO_LARGE') {
    return 'This trip is too large to discuss at once. Choose a single day and ask again.';
  }
  return errorMessage(error);
}

function Answer({ result }) {
  return (
    <article className={styles.answer} aria-label="Assistant answer">
      <div className={styles.answerHeader}>
        <Badge tone="info" icon={Bot}>
          AI-generated
        </Badge>
        {result.question && <p className={styles.question}>{result.question}</p>}
      </div>
      {/* Plain text only: the answer may contain anything the model produced. */}
      <p className={styles.answerText}>{result.data.answer}</p>
      {result.data.truncated && <p className={styles.note}>The answer was shortened.</p>}

      {result.data.suggestions.length > 0 && (
        <div className={styles.suggestions}>
          <h4 className={styles.subheading}>
            <Lightbulb size={16} aria-hidden="true" />
            Suggestions (not applied)
          </h4>
          <ul>
            {result.data.suggestions.map((s, i) => (
              <li key={i}>
                <strong>{SUGGESTION_LABELS[s.type] ?? 'Suggestion'}</strong>
                {s.placeName && `: ${s.placeName}`}
                {s.dayNumber && ` (day ${s.dayNumber}${s.targetDayNumber ? ` to day ${s.targetDayNumber}` : ''})`}
                <p className={styles.rationale}>{s.rationale}</p>
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            To apply a suggestion, use Edit day. NAVORA checks every change like any other edit.
          </p>
        </div>
      )}

      {result.data.places.length > 0 && (
        <p className={styles.places}>
          Places mentioned:{' '}
          {result.data.places.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ', '}
              <Link to={`/places/${p.id}`}>{p.name}</Link>
            </span>
          ))}
        </p>
      )}
      <p className={styles.disclaimer}>{result.data.disclaimer}</p>
    </article>
  );
}

export function AssistantPanel({ itinerary }) {
  const status = useQuery({
    queryKey: ['assistant', 'status'],
    queryFn: ({ signal }) => getAssistantStatus({ signal }),
    staleTime: 15_000,
  });
  const [question, setQuestion] = useState('');
  const [dayNumber, setDayNumber] = useState('');
  const [questionError, setQuestionError] = useState(null);
  const [results, setResults] = useState([]); // newest first, kept for this visit only

  const ask = useMutation({
    mutationFn: (request) =>
      askAssistant({ itineraryId: itinerary.id, dayNumber: dayNumber ? Number(dayNumber) : undefined, ...request }),
    onSuccess: (data, request) => setResults((list) => [{ id: Date.now(), question: request.question, data }, ...list]),
  });

  // Hidden entirely when switched off; a short note when on but unreachable.
  if (!status.data?.enabled) return null;
  if (!status.data.available) {
    return (
      <aside className={styles.panel} aria-labelledby="assistant-heading">
        <h2 id="assistant-heading" className={styles.heading}>
          <Bot size={20} aria-hidden="true" />
          Trip assistant
        </h2>
        <p className="muted">The assistant is temporarily unavailable. Your itinerary is not affected.</p>
      </aside>
    );
  }

  function submitQuestion(event) {
    event.preventDefault();
    const text = question.replace(/\s+/g, ' ').trim();
    if (text.length < 3) {
      setQuestionError('Ask a question of at least 3 characters.');
      return;
    }
    setQuestionError(null);
    ask.mutate({ task: 'question', question: text }, { onSuccess: () => setQuestion('') });
  }

  const tasks = TASKS.filter(
    (t) => (!t.needsWarnings || itinerary.warnings.length > 0) && (!t.currentOnly || itinerary.isCurrent),
  );

  return (
    <aside className={styles.panel} aria-labelledby="assistant-heading">
      <h2 id="assistant-heading" className={styles.heading}>
        <Bot size={20} aria-hidden="true" />
        Trip assistant
      </h2>
      <p className={styles.intro}>
        Ask about this plan. Answers are AI-generated from NAVORA&apos;s data and do not change your itinerary.
      </p>

      <Field label="About">
        {(props) => (
          <Select {...props} value={dayNumber} onChange={(e) => setDayNumber(e.target.value)}>
            <option value="">The whole trip</option>
            {itinerary.days.map((d) => (
              <option key={d.dayNumber} value={String(d.dayNumber)}>
                Day {d.dayNumber}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className={styles.tasks}>
        {tasks.map(({ task, label }) => (
          <Button key={task} variant="secondary" size="sm" disabled={ask.isPending} onClick={() => ask.mutate({ task })}>
            {label}
          </Button>
        ))}
      </div>

      <form className={styles.form} onSubmit={submitQuestion} noValidate>
        <Field label="Ask a question" hint="For example: Why is this place on day 1?" error={questionError}>
          {(props) => (
            <Textarea {...props} rows={2} maxLength={500} value={question} onChange={(e) => setQuestion(e.target.value)} />
          )}
        </Field>
        <div>
          <Button type="submit" icon={Send} loading={ask.isPending && ask.variables?.task === 'question'} disabled={ask.isPending}>
            Ask
          </Button>
        </div>
      </form>

      <div aria-live="polite" className={styles.results}>
        {ask.isPending && (
          <p className={styles.thinking}>
            <MessageCircleQuestion size={16} aria-hidden="true" />
            The assistant is reading your itinerary. This can take a little while.
          </p>
        )}
        {ask.isError && <Alert tone="danger">{assistantError(ask.error)}</Alert>}
        {results.map((result) => (
          <Answer key={result.id} result={result} />
        ))}
      </div>
    </aside>
  );
}
