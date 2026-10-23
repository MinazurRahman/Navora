import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { place } from '../../test/fetchMock.js';
import { PlaceGallery } from './PlaceGallery.jsx';

const photo = (n, author) => ({
  url: `https://img.example/${n}-1280.jpg`,
  thumbUrl: `https://img.example/${n}-500.jpg`,
  author,
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  sourceUrl: `https://commons.example/${n}`,
});
const fort = place({ images: [photo(1, 'First Author'), photo(2, 'Second Author'), photo(3, 'Third Author')] });

describe('place gallery', () => {
  it('browses with buttons, thumbnails and arrow keys, crediting the photo on screen', async () => {
    render(<PlaceGallery place={fort} />);
    const gallery = screen.getByRole('region', { name: 'Photos of Lalbagh Fort' });
    expect(within(gallery).getByText('1 / 3')).toBeDefined();
    expect(within(gallery).getByRole('link', { name: 'First Author' })).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Next photo' }));
    expect(screen.getByText('2 / 3')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Second Author' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Show photo 2' }).getAttribute('aria-current')).toBe('true');

    await userEvent.click(screen.getByRole('button', { name: 'Previous photo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous photo' }));
    expect(screen.getByText('3 / 3')).toBeDefined(); // wraps around

    await userEvent.click(screen.getByRole('button', { name: 'Show photo 1' }));
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('2 / 3')).toBeDefined();
  });

  it('opens the current photo full screen and closes it', async () => {
    render(<PlaceGallery place={fort} />);
    await userEvent.click(screen.getByRole('button', { name: 'Next photo' }));
    await userEvent.click(screen.getByRole('button', { name: 'View photo full screen' }));
    const viewer = screen.getByRole('dialog', { name: 'Photos of Lalbagh Fort' });
    expect(within(viewer).getByRole('img', { name: 'Photo 2 of Lalbagh Fort' }).getAttribute('src')).toBe('https://img.example/2-1280.jpg');
    await userEvent.click(within(viewer).getByRole('button', { name: 'Next photo' }));
    expect(within(viewer).getByText('3 / 3')).toBeDefined();
    await userEvent.click(within(viewer).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a single photo without browsing controls', () => {
    render(<PlaceGallery place={place({ images: [photo(1, 'Only Author')] })} />);
    expect(screen.queryByRole('button', { name: 'Next photo' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Only Author' })).toBeDefined();
  });
});
