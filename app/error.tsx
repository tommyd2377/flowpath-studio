'use client';
import Image from 'next/image';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="standalone-notice"><div className="standalone-brand"><Image src="/brand/flowpath-icon.png" alt="" width={220} height={146}/></div><span className="sr-only">FlowPath Studio</span><h1>We couldn’t open FlowPath Studio.</h1><p>Your saved data has not been reset. Try loading it again.</p><button className="button primary" onClick={reset}>Try again</button></main>;
}
