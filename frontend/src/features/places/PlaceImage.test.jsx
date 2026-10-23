import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { place } from '../../test/fetchMock.js';
import { ImageCredit, PlaceImage } from './PlaceImage.jsx';

const image = {
  url: 'https://thumb.wikimedia.org/example/960px-Fort.jpg',
  author: 'Farha Fawzia Atashi',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Fort.jpg',
};

describe('place image', () => {
  it('shows the photo without sending a referrer, and falls back when it fails to load', () => {
    render(<PlaceImage place={place({ image })} alt="Photo of Lalbagh Fort" />);
    const img = screen.getByRole('img', { name: 'Photo of Lalbagh Fort' });
    expect(img.getAttribute('src')).toBe(image.url);
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.error(img);
    expect(screen.queryByRole('img', { name: 'Photo of Lalbagh Fort' })).toBeNull();
  });

  it('draws a category placeholder when the place has no photo', () => {
    const { container } = render(<PlaceImage place={place()} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('credits the author, license and source', () => {
    render(<ImageCredit image={image} />);
    expect(screen.getByRole('link', { name: 'Farha Fawzia Atashi' }).getAttribute('href')).toBe(image.sourceUrl);
    expect(screen.getByRole('link', { name: 'CC BY-SA 4.0' }).getAttribute('href')).toBe(image.licenseUrl);
    render(<ImageCredit image={{ ...image, license: 'Public domain', licenseUrl: null }} />);
    expect(screen.getByText(/Public domain/)).toBeDefined();
  });
});
