import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Browser stubs apply only to jsdom tests (a file can opt into the node environment).
if (typeof window !== 'undefined') {
  afterEach(cleanup);

  // jsdom does not implement <dialog> modality; enough of it for component tests.
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }

  // jsdom has no scrolling; ScrollRestoration calls window.scrollTo on navigation.
  window.scrollTo = () => {};
}
