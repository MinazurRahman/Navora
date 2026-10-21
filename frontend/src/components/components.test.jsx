import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Bookmark } from 'lucide-react';
import { Button, IconButton } from './Button.jsx';
import { Dialog } from './Dialog.jsx';
import { Field, Input } from './Field.jsx';
import { ToastProvider } from './Toast.jsx';
import { useToast } from './useToast.js';

describe('Field', () => {
  it('labels the control and links hint and error text', () => {
    render(
      <Field label="Trip title" hint="Shown on your trips list" error="Enter a trip title.">
        {(props) => <Input {...props} />}
      </Field>,
    );
    const input = screen.getByLabelText('Trip title');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const descriptions = input
      .getAttribute('aria-describedby')
      .split(' ')
      .map((id) => document.getElementById(id).textContent);
    expect(descriptions).toEqual(['Shown on your trips list', 'Enter a trip title.']);
  });

  it('is not marked invalid without an error', () => {
    render(<Field label="Title">{(props) => <Input {...props} />}</Field>);
    expect(screen.getByLabelText('Title').hasAttribute('aria-invalid')).toBe(false);
  });
});

describe('Button', () => {
  it('cannot be clicked while loading', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.disabled).toBe(true);
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('gives icon-only buttons an accessible name', () => {
    render(<IconButton icon={Bookmark} label="Save place" />);
    expect(screen.getByRole('button', { name: 'Save place' })).toBeDefined();
  });
});

describe('Dialog', () => {
  function Harness({ onClose }) {
    const [open, setOpen] = useState(true);
    return (
      <Dialog
        open={open}
        title="Delete this trip?"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      />
    );
  }

  it('opens with its title and closes from the close button', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Delete this trip?' });
    expect(dialog.open).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    expect(dialog.open).toBe(false);
  });
});

describe('Toast', () => {
  function Trigger() {
    const toast = useToast();
    return <button onClick={() => toast.show({ tone: 'success', message: 'Place saved.' })}>Go</button>;
  }

  it('announces the message in a live region and can be dismissed', async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('status').textContent).toContain('Place saved.');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByRole('status').textContent).not.toContain('Place saved.');
  });
});
