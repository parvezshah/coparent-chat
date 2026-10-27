// The one screen. The family is read from the store on the server, so the first paint already holds it.
import CoParent from './components/CoParent';
import { readPeople } from '../lib/store';

export const dynamic = 'force-dynamic';

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default async function Page() {
  return <CoParent initialPeople={await readPeople()} initialToday={localDate(new Date())} />;
}
