'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent, type ReactElement } from 'react';
import { createClient } from '@/lib/supabase/client';

function LoginForm(): ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    searchParams.get('error') === 'auth-callback'
      ? 'Email confirmation failed. Please try signing in, or sign up again.'
      : null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSignIn(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setPending(false);
      return;
    }

    router.replace('/');
    router.refresh();
  }

  return (
    <main className="cc-login">
      <form className="cc-login-card" onSubmit={handleSignIn}>
        <h1>Command Center</h1>
        <p className="cc-login-hint">Sign in to your dashboard.</p>

        {error ? (
          <p className="cc-alert" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="cc-notice" role="status">
            {notice}
          </p>
        ) : null}

        <div className="cc-field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="cc-field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <div className="cc-login-actions">
          <button type="submit" className="cc-btn" disabled={pending}>
            {pending ? 'Working…' : 'Sign in'}
          </button>
        </div>
      </form>
    </main>
  );
}

export default function LoginPage(): ReactElement {
  // useSearchParams requires a Suspense boundary during prerendering.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
