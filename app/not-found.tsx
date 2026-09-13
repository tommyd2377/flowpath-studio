import Link from 'next/link';
import Image from 'next/image';
export default function NotFound() {
  return <main className="standalone-notice"><div className="standalone-brand"><Image src="/brand/flowpath-icon.png" alt="" width={220} height={146}/></div><span className="sr-only">FlowPath Studio</span><h1>This FlowPath site is not published yet.</h1><p>Publish a draft from the FlowPath Studio dashboard to make it available here.</p><Link href="/">Return to FlowPath Studio</Link></main>;
}
