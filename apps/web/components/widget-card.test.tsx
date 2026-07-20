import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useQuickAction, useQuickActionDispatch, WidgetCard } from '@command-center/ui';

function Subscriber({ onAction }: { onAction: () => void }): ReactElement {
  useQuickAction('add-item', onAction);
  return <p>widget body</p>;
}

function SelfDispatcher(): ReactElement {
  const dispatch = useQuickActionDispatch();
  const [count, setCount] = useState(0);
  useQuickAction('add-item', () => setCount((current) => current + 1));
  return (
    <div>
      <p>fired {count} times</p>
      <button type="button" onClick={() => dispatch('add-item')}>
        Fire from inside
      </button>
    </div>
  );
}

describe('WidgetCard quickActions', () => {
  it('renders no action buttons when the widget declares none', () => {
    render(
      <WidgetCard title="Plain">
        <p>body</p>
      </WidgetCard>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a labelled header button per quick action', () => {
    render(
      <WidgetCard
        title="Reminders"
        quickActions={[{ id: 'add-item', label: 'Add reminder', icon: <span>+</span> }]}
      >
        <p>body</p>
      </WidgetCard>,
    );
    expect(screen.getByRole('button', { name: 'Add reminder' })).toBeInTheDocument();
  });

  it('dispatches the action to a widget-body subscriber on click', async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    render(
      <WidgetCard title="Reminders" quickActions={[{ id: 'add-item', label: 'Add reminder' }]}>
        <Subscriber onAction={handler} />
      </WidgetCard>,
    );

    await user.click(screen.getByRole('button', { name: 'Add reminder' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('stops dispatching after the subscriber unmounts', async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    const { rerender } = render(
      <WidgetCard title="Reminders" quickActions={[{ id: 'add-item', label: 'Add reminder' }]}>
        <Subscriber onAction={handler} />
      </WidgetCard>,
    );
    rerender(
      <WidgetCard title="Reminders" quickActions={[{ id: 'add-item', label: 'Add reminder' }]}>
        <p>no subscriber</p>
      </WidgetCard>,
    );

    await user.click(screen.getByRole('button', { name: 'Add reminder' }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('lets the widget fire its own quick action via useQuickActionDispatch', async () => {
    const user = userEvent.setup();
    render(
      <WidgetCard title="Reminders" quickActions={[{ id: 'add-item', label: 'Add reminder' }]}>
        <SelfDispatcher />
      </WidgetCard>,
    );

    await user.click(screen.getByRole('button', { name: 'Fire from inside' }));
    expect(screen.getByText('fired 1 times')).toBeInTheDocument();
  });

  it('is a safe no-op when the hooks run outside a WidgetCard', () => {
    const handler = vi.fn();
    expect(() => render(<Subscriber onAction={handler} />)).not.toThrow();
  });
});
