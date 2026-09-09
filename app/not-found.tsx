import Link from 'next/link';
export default function NotFound() {
  return <main className="standalone-notice"><h1>This site is not published yet.</h1><p>Publish a draft from the local dashboard to make it available here.</p><Link href="/">Return to dashboard</Link></main>;
}
