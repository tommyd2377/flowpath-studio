'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="standalone-notice"><h1>We couldn’t open your workspace.</h1><p>Your saved data has not been reset. Try loading it again.</p><button className="button primary" onClick={reset}>Try again</button></main>;
}
