import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DashboardNav } from './dashboard-nav';

describe('DashboardNav', () => {
  it('links to the journal from the dashboard header', () => {
    render(<DashboardNav />);
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(nav).getByRole('link', { name: 'Journal' })).toHaveAttribute('href', '/journal');
  });
});
