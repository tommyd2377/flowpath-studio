import { notFound } from 'next/navigation';
import VisitorTestTimeline from '@/components/VisitorTestTimeline';
export default function TestRecordingsPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <VisitorTestTimeline/>;
}
